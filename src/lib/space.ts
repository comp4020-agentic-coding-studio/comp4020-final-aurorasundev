// The shared space as this page instance holds it. The server is the source of
// truth: snapshots replace what we know, events are merged by revision, and
// which papers are on screen (and where) stays local.

export type PaperStatus = "active" | "destroyed" | "quarantined" | "missing";

export type Snapshot = {
  revision: number;
  active_total: number;
  window: { id: string; version: number }[];
  known: { id: string; status: PaperStatus; version: number }[];
};

export type Space = {
  status: "loading" | "error" | "ready";
  // rendered window, oldest first
  ids: string[];
  total: number;
  revision: number;
  connection: "connecting" | "live" | "reconnecting";
};

export const initialSpace: Space = { status: "loading", ids: [], total: 0, revision: -1, connection: "connecting" };

export type SpaceAction =
  | { type: "snapshot"; snapshot: Snapshot; limit: number; reading: string | null }
  | { type: "arrived"; id: string; revision: number; total: number; limit: number; reading: string | null }
  | { type: "counted"; revision: number; total: number }
  | { type: "revised"; revision: number }
  | { type: "removed"; id: string; revision: number; total: number; reading: string | null }
  | { type: "connection"; connection: Space["connection"] }
  | { type: "failed" };

// Makes room for a newcomer by dropping the oldest paper nobody is reading.
function admit(ids: string[], id: string, limit: number, reading: string | null): string[] {
  const next = [...ids.filter((x) => x !== id), id];
  while (next.length > limit) {
    const victim = next.findIndex((x) => x !== reading && x !== id);
    if (victim < 0) break;
    next.splice(victim, 1);
  }
  return next;
}

const newer = (space: Space, revision: number): boolean => revision > space.revision;

export function spaceReducer(space: Space, action: SpaceAction): Space {
  switch (action.type) {
    case "snapshot": {
      const { snapshot, limit, reading } = action;
      const status = new Map(snapshot.known.map((k) => [k.id, k.status]));
      const kept = space.ids.filter((id) => id === reading || status.get(id) === "active");
      const fill = snapshot.window.map((w) => w.id).filter((id) => !kept.includes(id));
      const ids = [...kept, ...fill.slice(0, Math.max(0, limit - kept.length))];
      return { status: "ready", ids, total: snapshot.active_total, revision: snapshot.revision, connection: "live" };
    }
    case "arrived": {
      const ids = admit(space.ids, action.id, action.limit, action.reading);
      if (!newer(space, action.revision)) return { ...space, ids };
      return { ...space, ids, total: action.total, revision: action.revision };
    }
    case "counted":
      return newer(space, action.revision) ? { ...space, total: action.total, revision: action.revision } : space;
    case "removed": {
      const ids = action.id === action.reading ? space.ids : space.ids.filter((x) => x !== action.id);
      if (!newer(space, action.revision)) return { ...space, ids };
      return { ...space, ids, total: action.total, revision: action.revision };
    }
    case "revised":
      return newer(space, action.revision) ? { ...space, revision: action.revision } : space;
    case "connection":
      return { ...space, connection: action.connection };
    case "failed":
      return space.status === "ready" ? { ...space, connection: "reconnecting" } : { ...space, status: "error" };
  }
}

export const countLine = (total: number): string =>
  total === 0 ? "No papers are here yet." : `${total.toLocaleString("en-AU")} ${total === 1 ? "thing is" : "things are"} still here.`;
