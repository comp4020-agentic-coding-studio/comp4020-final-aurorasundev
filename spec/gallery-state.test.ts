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
      { type: "snapshot", page: { ...page([], 1, 1, id(0)), items: [art(1, 3)] } },
      { type: "page", page: { ...page([], 1, 1), items: [art(1, 2)] }, after: id(0) },
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
    const after = galleryReducer(s, { type: "page", page: page([3], 1, 3), after: id(2) });
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
      { type: "page", page: page([2], 1, 2), after: id(1) },
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
    const after = galleryReducer(s, { type: "page", page: page([3, 4], 2, 4), after: id(2) });
    expect(ids(after)).toEqual([id(4), id(1), id(2), id(3)]);
    expect(after.hasMore).toBe(false);
  });

  it("live arrivals respect the cap and never evict the open object", () => {
    let s = run([{ type: "snapshot", page: page(Array.from({ length: 12 }, (_, i) => i + 1), 1, 60, id(12)) }, { type: "open", id: id(1) }]);
    for (let n = 61; n < 61 + MAX_TILES; n++) s = galleryReducer(s, { type: "change", change: published(n, n, n) });
    expect(s.items.length).toBe(MAX_TILES);
    expect(ids(s)).toContain(id(1));
    expect(ids(s)[0]).toBe(id(60 + MAX_TILES));
    // the paged records an arrival pushed out were behind the cursor: it
    // steps back before them so the next page brings them again
    expect([s.cursor, s.hasMore]).toEqual([id(1), true]);
  });

  it("a live arrival over the cap retires the end away from the focused tile, never the focus", () => {
    const serve = server(Array.from({ length: 48 }, (_, i) => i + 1));
    let s = run([{ type: "snapshot", page: serve(null) }]);
    for (let p = 0; p < 3; p++) s = run([{ type: "load", kind: "page" }, { type: "page", page: serve(s.cursor), after: s.cursor }], s);
    expect(s.items.length).toBe(48);
    // looking at the last record: the arrival retires from the start instead
    s = run([{ type: "focus", id: id(48) }, { type: "change", change: published(99, 2, 49) }], s);
    expect(ids(s)).toContain(id(48));
    expect(ids(s)[0]).toBe(id(99));
    expect(s.items.length).toBe(48);
    expect(s.retired).toBe(true);
  });
});

// A fake server over `n` published ids, paging by id like galleryPage().
function server(ns: number[]) {
  const sorted = [...ns].sort((a, b) => (id(a) < id(b) ? -1 : 1));
  return (after: string | null, revision = 1): GalleryPage => {
    const rest = sorted.filter((n) => after === null || id(n) > after);
    const items = rest.slice(0, 12);
    return page(items, revision, sorted.length, rest.length > 12 ? id(items[11]) : null);
  };
}
// Pages forward the way the hook does, from the server's cursor, recording
// every id that was ever in the window and the largest window seen. It stops
// at the end of the server's pages: where the window would wrap to the start.
function explore(s: GalleryState, serve: (after: string | null) => GalleryPage, seen = new Set<string>()) {
  let widest = s.items.length;
  for (const a of s.items) seen.add(a.id);
  for (let guard = 0; s.hasMore && s.cursor !== null && guard < 100; guard++) {
    const after = s.cursor;
    s = run([{ type: "load", kind: "page" }, { type: "page", page: serve(after), after }], s);
    widest = Math.max(widest, s.items.length);
    for (const a of s.items) seen.add(a.id);
  }
  return { s, seen, widest };
}

describe("a bounded window that still reaches every record", () => {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  for (const n of [60, 180]) {
    it(`reaches all ${n} records going forward, within ${MAX_TILES} tiles, keeping the open one`, () => {
      const serve = server(range(1, n));
      const first = run([{ type: "snapshot", page: serve(null) }, { type: "open", id: id(3) }]);
      const { s, seen, widest } = explore(first, serve);
      expect(widest).toBeLessThanOrEqual(MAX_TILES);
      for (const k of range(1, n)) expect(seen.has(id(k)), `record ${k}`).toBe(true);
      // the last record is in the window at the end, with the open one
      expect(ids(s)).toContain(id(n));
      expect(ids(s)).toContain(id(3));
      expect(openArtifact(s)?.id).toBe(id(3));
      expect(new Set(ids(s)).size).toBe(s.items.length);
      // earlier records were retired, so going on wraps to the first page
      expect([s.retired, s.hasMore, s.cursor]).toEqual([true, true, null]);
      const wrapped = run([{ type: "load", kind: "page" }, { type: "page", page: serve(null), after: null }], s);
      expect(ids(wrapped)).toEqual(expect.arrayContaining(range(1, 12).map(id)));
      expect(wrapped.items.length).toBeLessThanOrEqual(MAX_TILES);
      expect(wrapped.cursor).toBe(id(12));
      // the explicit way back replaces the window with the first page
      const back = run([{ type: "load", kind: "page" }, { type: "restart", page: serve(null) }], s);
      expect(ids(back)).toEqual([...range(1, 12), 3].filter((k, i, a) => a.indexOf(k) === i).map(id));
      expect([back.retired, back.cursor]).toEqual([false, id(12)]);
      // and forward again reaches the end once more
      expect(ids(explore(back, serve).s)).toContain(id(n));
    });
  }

  it("records 49-60 of 60 are in the window after paging, not discarded", () => {
    const serve = server(range(1, 60));
    const { s } = explore(run([{ type: "snapshot", page: serve(null) }]), serve);
    for (const k of range(49, 60)) expect(ids(s)).toContain(id(k));
    expect(s.items.length).toBeLessThanOrEqual(MAX_TILES);
  });

  it("an arrival and a hide during paging: the hidden one never returns, the arrival stays, the end is reached", () => {
    const serve = server(range(1, 60));
    let s = run([
      { type: "snapshot", page: serve(null) },
      { type: "load", kind: "page" },
      // 15 is on the page in flight; 99 arrives live
      { type: "change", change: hidden(15, 2, 59) },
      { type: "change", change: published(99, 3, 60) },
      { type: "page", page: serve(id(12)), after: id(12) },
    ]);
    expect(ids(s)).not.toContain(id(15));
    expect(ids(s)[0]).toBe(id(99));
    const out = explore(s, serve);
    s = out.s;
    expect(out.seen.has(id(15))).toBe(false);
    expect(ids(s)).toContain(id(60));
    expect(out.seen.has(id(99))).toBe(true);
    // going back to the start with a page read before the hide committed
    s = run([{ type: "load", kind: "page" }, { type: "restart", page: serve(null) }], s);
    expect(explore(s, serve).seen.has(id(15))).toBe(false);
  });

  it("a stale page from an earlier cursor cannot add records or resurrect a hidden one", () => {
    const serve = server(range(1, 60));
    let s = explore(run([{ type: "snapshot", page: serve(null) }]), serve).s;
    // the way back is taken while a page for the old cursor is still in flight
    s = run([{ type: "load", kind: "page" }, { type: "restart", page: serve(null) }, { type: "change", change: hidden(30, 9, 59) }], s);
    const before = ids(s);
    s = run([{ type: "load", kind: "page" }, { type: "page", page: serve(id(24)), after: id(24) }], s);
    expect(ids(s)).toEqual(before);
    expect(s.cursor).toBe(id(12));
    // the right page comes next, and a stale listing of 30 stays out
    s = run([{ type: "load", kind: "page" }, { type: "page", page: serve(id(12)), after: id(12) }], s);
    s = run([{ type: "load", kind: "page" }, { type: "page", page: serve(id(24)), after: id(24) }], s);
    expect(ids(s)).not.toContain(id(30));
    expect(ids(s)).toContain(id(36));
  });
});
