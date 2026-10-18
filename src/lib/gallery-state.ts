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
// - Pages continue from the last server cursor, never from live tiles.
// - At most MAX_TILES tiles are kept; the open object is never evicted.

export const MAX_TILES = 48;

export type GalleryState = {
  items: PublicArtifact[];
  total: number;
  revision: number;
  // the cursor of the last page the server sent; null once there are no more
  cursor: string | null;
  hasMore: boolean;
  // ids (with the version at which they were hidden) that must not return
  hidden: Record<string, number>;
  // deltas held while a snapshot or page request is in flight
  pending: GalleryChange[];
  loading: "snapshot" | "page" | null;
  openId: string | null;
};

export const initialGallery: GalleryState = {
  items: [],
  total: 0,
  revision: -1,
  cursor: null,
  hasMore: false,
  hidden: {},
  pending: [],
  loading: "snapshot",
  openId: null,
};

export type GalleryAction =
  | { type: "load"; kind: "snapshot" | "page" }
  | { type: "snapshot"; page: GalleryPage }
  | { type: "page"; page: GalleryPage }
  | { type: "change"; change: GalleryChange }
  | { type: "open"; id: string | null }
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

// Retires the oldest tiles past the cap, never the open one.
function bound(items: PublicArtifact[], openId: string | null): PublicArtifact[] {
  if (items.length <= MAX_TILES) return items;
  const out = [...items];
  for (let i = out.length - 1; out.length > MAX_TILES && i >= 0; i--) {
    if (out[i].id !== openId) out.splice(i, 1);
  }
  return out;
}

function apply(state: GalleryState, change: GalleryChange): GalleryState {
  if (change.revision <= state.revision) return state;
  if (change.type === "artifact:published") {
    return {
      ...state,
      revision: change.revision,
      total: change.total,
      items: bound(upsert(state.items, state.hidden, [change.artifact], true), state.openId),
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
      const base: GalleryState = {
        ...state,
        loading: null,
        revision: action.page.revision,
        total: action.page.total,
        cursor: action.page.next_cursor,
        hasMore: action.page.next_cursor !== null,
        items: bound(open && !fresh.some((a) => a.id === open.id) ? [...fresh, open] : fresh, state.openId),
        pending: [],
      };
      return state.pending.reduce(apply, base);
    }
    case "page": {
      const base: GalleryState = {
        ...state,
        loading: null,
        cursor: action.page.next_cursor,
        hasMore: action.page.next_cursor !== null,
        items: bound(upsert(state.items, state.hidden, action.page.items, false), state.openId),
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
    case "revalidated":
      if (action.artifact) return { ...state, items: bound(upsert(state.items, state.hidden, [action.artifact], true), state.openId) };
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
