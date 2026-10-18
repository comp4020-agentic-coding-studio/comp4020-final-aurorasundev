import { describe, expect, it } from "vitest";
import type { GalleryChange, GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";
import { galleryReducer, initialGallery, MAX_TILES, openArtifact, type GalleryAction, type GalleryState } from "../src/lib/gallery-state.ts";

// The Gallery's live collection under races: arrivals during loads, stale
// versions, hides that must stay hidden, pagination beside live inserts and
// the tile cap.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const art = (n: number, version = 1): PublicArtifact => ({
  id: id(n),
  version,
  image_url: `/api/gallery/${id(n)}/image`,
  width: 1024,
  height: 1024,
  title: "Knot in clay",
  alt: "An abstract object.",
});
const page = (ns: number[], revision: number, total: number, next: string | null = null): GalleryPage => ({
  revision,
  items: ns.map((n) => art(n)),
  next_cursor: next,
  total,
});
const published = (n: number, revision: number, total: number, version = 1): GalleryChange => ({
  type: "artifact:published",
  revision,
  total,
  artifact: art(n, version),
});
const hidden = (n: number, revision: number, total: number, version = 2): GalleryChange => ({ type: "artifact:hidden", revision, total, id: id(n), version });
const run = (actions: GalleryAction[], from: GalleryState = initialGallery) => actions.reduce(galleryReducer, from);
const ids = (s: GalleryState) => s.items.map((a) => a.id);

describe("live arrivals", () => {
  it("dedupes a repeated arrival and ignores a stale revision", () => {
    const s = run([
      { type: "snapshot", page: page([1], 5, 1) },
      { type: "change", change: published(2, 6, 2) },
      { type: "change", change: published(2, 6, 2) },
      { type: "change", change: published(3, 4, 9) },
    ]);
    expect(ids(s)).toEqual([id(2), id(1)]);
    expect([s.total, s.revision]).toEqual([2, 6]);
  });

  it("never replaces a newer version with an older one", () => {
    const s = run([
      { type: "snapshot", page: { ...page([], 1, 1), items: [art(1, 3)] } },
      { type: "page", page: { ...page([], 1, 1), items: [art(1, 2)] } },
    ]);
    expect(s.items[0].version).toBe(3);
  });

  it("buffers a publish during a snapshot load and replays it past the snapshot's revision only", () => {
    const s = run([
      { type: "load", kind: "snapshot" },
      { type: "change", change: published(7, 3, 1) },
      { type: "change", change: published(8, 6, 3) },
      { type: "snapshot", page: page([7], 5, 2) },
    ]);
    // 7 is in the snapshot (rev 5); its rev-3 event is stale; 8 (rev 6) is new
    expect(ids(s)).toEqual([id(8), id(7)]);
    expect([s.total, s.revision, s.pending]).toEqual([3, 6, []]);
  });
});

describe("hides", () => {
  it("a hide during a page load removes the object now and the slower page cannot restore it", () => {
    const s = run([
      { type: "snapshot", page: page([1, 2], 1, 3, id(2)) },
      { type: "open", id: id(1) },
      { type: "load", kind: "page" },
      { type: "change", change: hidden(1, 2, 2) },
      { type: "change", change: hidden(3, 3, 1) },
    ]);
    expect(ids(s)).toEqual([id(2)]);
    expect(s.openId).toBeNull();
    // the page was read before the hides committed and still lists 3
    const after = galleryReducer(s, { type: "page", page: page([3], 1, 3) });
    expect(ids(after)).toEqual([id(2)]);
    expect([after.total, after.revision]).toEqual([1, 3]);
  });

  it("a hide during a snapshot load keeps the object out of the snapshot", () => {
    const s = run([
      { type: "snapshot", page: page([1], 1, 1) },
      { type: "load", kind: "snapshot" },
      { type: "change", change: hidden(1, 2, 0) },
      // a snapshot read just before the hide committed
      { type: "snapshot", page: page([1], 1, 1) },
    ]);
    expect(ids(s)).toEqual([]);
    expect([s.total, s.revision]).toEqual([0, 2]);
  });

  it("live hide removes both the tile and the open detail", () => {
    const s = run([
      { type: "snapshot", page: page([1, 2], 1, 2) },
      { type: "open", id: id(2) },
    ]);
    expect(openArtifact(s)?.id).toBe(id(2));
    const after = galleryReducer(s, { type: "change", change: hidden(2, 2, 1) });
    expect(openArtifact(after)).toBeNull();
    expect(ids(after)).toEqual([id(1)]);
  });
});

describe("reconnecting", () => {
  it("reconnect_revalidates_open_detail_outside_first_page", () => {
    let s = run([
      { type: "snapshot", page: page([1], 1, 2, id(1)) },
      { type: "page", page: page([2], 1, 2) },
      { type: "open", id: id(2) },
      // reconnect: a fresh snapshot of the first page, without the open one
      { type: "load", kind: "snapshot" },
      { type: "snapshot", page: page([1], 4, 2, id(1)) },
    ]);
    // the open object's detail survives the snapshot until it is revalidated
    expect(openArtifact(s)?.id).toBe(id(2));
    s = galleryReducer(s, { type: "revalidated", id: id(2), artifact: null });
    expect(s.openId).toBeNull();
    expect(ids(s)).not.toContain(id(2));
    const still = run([
      { type: "snapshot", page: page([1], 1, 2) },
      { type: "open", id: id(2) },
      { type: "revalidated", id: id(2), artifact: art(2) },
    ]);
    expect(openArtifact(still)?.id).toBe(id(2));
  });

  it("does not replay history: a snapshot replaces the collection", () => {
    const s = run([
      { type: "snapshot", page: page([1, 2, 3], 1, 3) },
      { type: "snapshot", page: page([4], 9, 1) },
    ]);
    expect(ids(s)).toEqual([id(4)]);
  });
});

describe("paging and the tile cap", () => {
  it("pages from the server cursor, deduplicating live arrivals against later pages", () => {
    const s = run([
      { type: "snapshot", page: page([1, 2], 1, 4, id(2)) },
      // object 4 arrives live before its page is loaded
      { type: "change", change: published(4, 2, 4) },
    ]);
    // the next request continues from the server's cursor, not from tile 4
    expect(s.cursor).toBe(id(2));
    const after = galleryReducer(s, { type: "page", page: page([3, 4], 2, 4) });
    expect(ids(after)).toEqual([id(4), id(1), id(2), id(3)]);
    expect(after.hasMore).toBe(false);
  });

  it("keeps at most 48 tiles over 60 objects, never evicting the open one", () => {
    let s = run([{ type: "snapshot", page: page(Array.from({ length: 12 }, (_, i) => i + 1), 1, 60, id(12)) }, { type: "open", id: id(1) }]);
    for (let p = 1; p < 5; p++) {
      const ns = Array.from({ length: 12 }, (_, i) => p * 12 + i + 1);
      s = run([{ type: "load", kind: "page" }, { type: "page", page: page(ns, 1, 60, p < 4 ? id(ns[11]) : null) }], s);
    }
    expect(s.items.length).toBe(MAX_TILES);
    expect(ids(s)).toContain(id(1));
    expect(new Set(ids(s)).size).toBe(MAX_TILES);
    // live arrivals also respect the cap and the open object
    for (let n = 61; n < 70; n++) s = galleryReducer(s, { type: "change", change: published(n, n, n) });
    expect(s.items.length).toBe(MAX_TILES);
    expect(ids(s)).toContain(id(1));
    expect(ids(s)[0]).toBe(id(69));
  });
});
