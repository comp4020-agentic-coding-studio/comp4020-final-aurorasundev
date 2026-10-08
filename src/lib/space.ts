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
  // Papers this page has learned are gone for good, most recent last. A late
  // reply (a creation answered after someone destroyed it, a sample taken
  // just before) must not bring one back. Bounded: only the recent past can
  // still have a reply in flight.
  ended: string[];
};

export const MAX_ENDED = 200;

export const initialSpace: Space = { status: "loading", ids: [], total: 0, revision: -1, connection: "connecting", ended: [] };

export type SpaceAction =
  | { type: "snapshot"; snapshot: Snapshot; limit: number; reading: string | null }
  | { type: "arrived"; id: string; status?: string; revision: number; total: number; limit: number; reading: string | null }
  | { type: "counted"; revision: number; total: number }
  | { type: "revised"; revision: number }
  | { type: "removed"; id: string; revision: number; total: number; reading: string | null }
  // exploring (replace) or topping up after the window grew (fill)
  | { type: "sampled"; ids: string[]; revision: number; total: number; limit: number; reading: string | null; replace: boolean }
  | { type: "limited"; limit: number; reading: string | null }
  | { type: "connection"; connection: Space["connection"] }
  | { type: "failed" };

// Drops the oldest papers nobody is reading until the window fits.
function trim(ids: string[], limit: number, keep: (string | null)[]): string[] {
  const next = [...ids];
  while (next.length > limit) {
    const victim = next.findIndex((x) => !keep.includes(x));
    if (victim < 0) break;
    next.splice(victim, 1);
  }
  return next;
}

// Makes room for a newcomer by dropping the oldest paper nobody is reading.
const admit = (ids: string[], id: string, limit: number, reading: string | null): string[] =>
  trim([...ids.filter((x) => x !== id), id], limit, [reading, id]);

function end(ended: string[], ...ids: string[]): string[] {
  const fresh = ids.filter((id) => !ended.includes(id));
  return fresh.length ? [...ended, ...fresh].slice(-MAX_ENDED) : ended;
}

const newer = (space: Space, revision: number): boolean => revision > space.revision;

// The count and revision move only forward: an older reply never undoes a
// newer total.
const count = (space: Space, revision: number, total: number): Pick<Space, "total" | "revision"> =>
  newer(space, revision) ? { total, revision } : { total: space.total, revision: space.revision };

export const isEnded = (space: Space, id: string): boolean => space.ended.includes(id);

export function spaceReducer(space: Space, action: SpaceAction): Space {
  switch (action.type) {
    case "snapshot": {
      const { snapshot, limit, reading } = action;
      const status = new Map(snapshot.known.map((k) => [k.id, k.status]));
      const ended = end(space.ended, ...snapshot.known.filter((k) => k.status !== "active").map((k) => k.id));
      const kept = space.ids.filter((id) => id === reading || status.get(id) === "active");
      const fill = snapshot.window.map((w) => w.id).filter((id) => !kept.includes(id) && !ended.includes(id));
      const ids = [...kept, ...fill.slice(0, Math.max(0, limit - kept.length))];
      return { status: "ready", ids, total: snapshot.active_total, revision: snapshot.revision, connection: "live", ended };
    }
    case "arrived": {
      // A paper already known gone, or answered as gone, is never admitted;
      // the reply can still carry a newer count.
      if (isEnded(space, action.id) || (action.status && action.status !== "active")) {
        const ended = action.status && action.status !== "active" ? end(space.ended, action.id) : space.ended;
        return { ...space, ...count(space, action.revision, action.total), ended };
      }
      const ids = admit(space.ids, action.id, action.limit, action.reading);
      return { ...space, ids, ...count(space, action.revision, action.total) };
    }
    case "counted":
      return { ...space, ...count(space, action.revision, action.total) };
    case "removed": {
      const ids = action.id === action.reading ? space.ids : space.ids.filter((x) => x !== action.id);
      return { ...space, ids, ...count(space, action.revision, action.total), ended: end(space.ended, action.id) };
    }
    case "sampled": {
      const { reading, limit } = action;
      const fresh = [...new Set(action.ids)].filter((id) => !isEnded(space, id) && id !== reading);
      const moved = count(space, action.revision, action.total);
      if (action.replace) {
        // nothing new to move to: stay where we are
        if (fresh.length === 0) return { ...space, ...moved };
        const kept = reading && space.ids.includes(reading) ? [reading] : [];
        return { ...space, ids: [...kept, ...fresh].slice(0, Math.max(limit, kept.length)), ...moved };
      }
      const ids = [...space.ids, ...fresh.filter((id) => !space.ids.includes(id))].slice(0, Math.max(limit, space.ids.length));
      return { ...space, ids, ...moved };
    }
    case "limited":
      return { ...space, ids: trim(space.ids, action.limit, [action.reading]) };
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
