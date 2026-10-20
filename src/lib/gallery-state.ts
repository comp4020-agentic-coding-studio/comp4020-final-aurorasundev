import type { GalleryChange, GalleryPage, PublicArtifact } from "./gallery-api.ts";

// The Gallery's live collection as a pure reducer, so its races can be tested
// without a browser.
//
// - A fresh snapshot replaces the collection; deltas that arrive while a
//   snapshot or page is loading are buffered and replayed over it, dropping
//   any at or below the revision it reflects.
// - Objects are deduplicated by id and version: an older version never
//   replaces a newer one, and a hidden id stays gone even if a slower page
//   still lists it.
// - Pages continue from the last server cursor, never from live tiles. A page
//   carries the cursor it was asked for; one that no longer matches (a
//   reconnect or a later page moved on) is stale and changes nothing.
// - The collection is a sliding window of at most MAX_TILES tiles over the
//   server's id order; the open object is never evicted. A new page retires
//   the tiles at the window's start, furthest from where it is appended, so
//   the page just fetched is always kept. A live arrival over the cap retires
//   tiles at whichever end is further from the focused tile; retiring paged
//   tiles from the end steps the cursor back so the next page brings them
//   again. The open and focused tiles are never retired.
// - The way back is the beginning: once the server's pages end and some
//   tiles were retired, the next page starts again from the first one
//   (`after` omitted). The window keeps sliding, so going forward reaches
//   every record, and going on past the last one returns to the earliest.

export const MAX_TILES = 48;

export type GalleryState = {
  items: PublicArtifact[];
  total: number;
  revision: number;
  // the cursor of the last page the server sent; null when the next page
  // (if hasMore) starts from the beginning
  cursor: string | null;
  hasMore: boolean;
  // tiles left the window since paging last started from the beginning, so
  // the end of the server's pages wraps back to the first one
  retired: boolean;
  // ids (with the version at which they were hidden) that must not return
  hidden: Record<string, number>;
  // deltas held while a snapshot or page request is in flight
  pending: GalleryChange[];
  loading: "snapshot" | "page" | null;
  openId: string | null;
  // the tile in front, so retiring never takes the one being looked at
  focusId: string | null;
};

export const initialGallery: GalleryState = {
  items: [],
  total: 0,
  revision: -1,
  cursor: null,
  hasMore: false,
  retired: false,
  hidden: {},
  pending: [],
  loading: "snapshot",
  openId: null,
  focusId: null,
};

export type GalleryAction =
  | { type: "load"; kind: "snapshot" | "page" }
  | { type: "snapshot"; page: GalleryPage }
  // `after` is the cursor the page was requested from (null: the first page)
  | { type: "page"; page: GalleryPage; after: string | null }
  // the way back: the first page (fetched by HTTP) replaces the window
  | { type: "restart"; page: GalleryPage }
  | { type: "change"; change: GalleryChange }
  | { type: "open"; id: string | null }
  | { type: "focus"; id: string | null }
  | { type: "revalidated"; id: string; artifact: PublicArtifact | null }
  | { type: "failed" };

function upsert(items: PublicArtifact[], hidden: Record<string, number>, incoming: PublicArtifact[], front: boolean): PublicArtifact[] {
  const byId = new Map(items.map((a) => [a.id, a]));
  const added: PublicArtifact[] = [];
  for (const art of incoming) {
    if (hidden[art.id] !== undefined && hidden[art.id] >= art.version) continue;
    const known = byId.get(art.id);
    if (known) {
      if (art.version > known.version) byId.set(art.id, art);
      continue;
    }
    byId.set(art.id, art);
    added.push(art);
  }
  const kept = items.map((a) => byId.get(a.id)!);
  return front ? [...added, ...kept] : [...kept, ...added];
}

type Window = Pick<GalleryState, "items" | "cursor" | "hasMore" | "retired">;

type Keep = Pick<GalleryState, "openId" | "focusId">;

// Retires tiles past the cap, never the open or focused one: from the
// window's start after a page, or after a live arrival (sparing the `fresh`
// ids just added) from the end further from the focus. Retiring from the
// end steps the cursor back so the retired paged tiles come again on the
// next page; anything it cannot return to is left for the wrap.
function bound(w: Window, keep: Keep, end: "start" | "far", fresh: ReadonlySet<string> = new Set()): Window {
  const over = w.items.length - MAX_TILES;
  if (over <= 0) return w;
  const at = w.items.findIndex((a) => a.id === keep.focusId);
  const from = end === "start" || (at >= 0 && at >= w.items.length / 2) ? "start" : "end";
  const order = w.items.map((_, i) => i);
  if (from === "end") order.reverse();
  const drop = new Set<number>();
  for (const i of order) {
    if (drop.size >= over) break;
    const a = w.items[i];
    if (a.id !== keep.openId && a.id !== keep.focusId && !fresh.has(a.id)) drop.add(i);
  }
  const items = w.items.filter((_, i) => !drop.has(i));
  const gone = w.items.filter((_, i) => drop.has(i)).map((a) => a.id);
  let { cursor, hasMore } = w;
  if (from === "end" && cursor !== null) {
    // ids are compared as the server orders them; only tiles at or behind
    // the cursor need it to step back
    const behind = gone.filter((g) => g <= cursor!);
    if (behind.length) {
      const low = behind.reduce((m, g) => (g < m ? g : m));
      const before = items.map((a) => a.id).filter((k) => k < low);
      // the largest kept id below them, or the beginning if there is none
      cursor = before.length ? before.reduce((m, k) => (k > m ? k : m)) : null;
      hasMore = true;
    }
  }
  return { items, cursor, hasMore, retired: true };
}

// The window after a page or snapshot that reported `next` as its cursor:
// the end of the server's pages wraps to the beginning if tiles were retired.
function advance(w: Window, next: string | null): Window {
  return next === null && w.retired ? { ...w, cursor: null, hasMore: true } : { ...w, cursor: next, hasMore: next !== null };
}

function apply(state: GalleryState, change: GalleryChange): GalleryState {
  if (change.revision <= state.revision) return state;
  if (change.type === "artifact:published") {
    const items = upsert(state.items, state.hidden, [change.artifact], true);
    return {
      ...state,
      ...bound({ ...state, items }, state, "far", new Set([change.artifact.id])),
      revision: change.revision,
      total: change.total,
    };
  }
  return {
    ...state,
    revision: change.revision,
    total: change.total,
    hidden: { ...state.hidden, [change.id]: change.version },
    items: state.items.filter((a) => a.id !== change.id),
    openId: state.openId === change.id ? null : state.openId,
  };
}

export function galleryReducer(state: GalleryState, action: GalleryAction): GalleryState {
  switch (action.type) {
    case "load":
      return { ...state, loading: action.kind };
    case "snapshot": {
      // the snapshot is the truth at its revision; buffered deltas past it
      // follow. An open object outside it is kept (its detail stays up) until
      // it is revalidated by id.
      const open = state.openId ? state.items.find((a) => a.id === state.openId) : undefined;
      const fresh = upsert([], state.hidden, action.page.items, false);
      const items = open && !fresh.some((a) => a.id === open.id) ? [...fresh, open] : fresh;
      const base: GalleryState = {
        ...state,
        ...advance(bound({ items, cursor: null, hasMore: false, retired: false }, state, "start"), action.page.next_cursor),
        loading: null,
        revision: action.page.revision,
        total: action.page.total,
        pending: [],
      };
      return state.pending.reduce(apply, base);
    }
    case "page": {
      // A page for a cursor the window has moved past (a reconnect or the way
      // back reset it) is stale and adds nothing. The hook aborts superseded
      // requests, so whatever arrives still settles the load it was for.
      if (!state.hasMore || action.after !== state.cursor) {
        if (state.loading !== "page") return state;
        return state.pending.reduce(apply, { ...state, loading: null, pending: [] });
      }
      // paging from the beginning again: everything is ahead of the cursor
      const retired = action.after === null ? false : state.retired;
      const items = upsert(state.items, state.hidden, action.page.items, false);
      const base: GalleryState = {
        ...state,
        ...advance(bound({ ...state, items, retired }, state, "start"), action.page.next_cursor),
        loading: null,
        pending: [],
      };
      return state.pending.reduce(apply, base);
    }
    case "restart": {
      // Unlike a snapshot this keeps the live revision: the page is not a
      // stream event, and hides and arrivals already applied stay applied
      // (the tombstones keep a hidden id out of it). The open object stays.
      const open = state.openId ? state.items.find((a) => a.id === state.openId) : undefined;
      const fresh = upsert([], state.hidden, action.page.items, false);
      const items = open && !fresh.some((a) => a.id === open.id) ? [...fresh, open] : fresh;
      const base: GalleryState = {
        ...state,
        ...advance(bound({ items, cursor: null, hasMore: false, retired: false }, state, "start"), action.page.next_cursor),
        loading: null,
        pending: [],
      };
      return state.pending.reduce(apply, base);
    }
    case "change": {
      if (!state.loading) return apply(state, action.change);
      const pending = [...state.pending, action.change];
      if (action.change.type === "artifact:published") return { ...state, pending };
      // a hide removes the object at once, even mid-load, and is remembered so
      // the load that is still on its way cannot bring it back
      const { id, version } = action.change;
      return {
        ...state,
        pending,
        hidden: { ...state.hidden, [id]: version },
        items: state.items.filter((a) => a.id !== id),
        openId: state.openId === id ? null : state.openId,
      };
    }
    case "open":
      return { ...state, openId: action.id };
    case "focus":
      return state.focusId === action.id ? state : { ...state, focusId: action.id };
    case "revalidated":
      if (action.artifact) {
        const items = upsert(state.items, state.hidden, [action.artifact], true);
        return { ...state, ...bound({ ...state, items }, state, "far", new Set([action.id])) };
      }
      return {
        ...state,
        items: state.items.filter((a) => a.id !== action.id),
        openId: state.openId === action.id ? null : state.openId,
      };
    case "failed":
      return { ...state, loading: null, pending: [] };
  }
}

export const openArtifact = (state: GalleryState): PublicArtifact | null =>
  state.openId ? (state.items.find((a) => a.id === state.openId) ?? null) : null;
