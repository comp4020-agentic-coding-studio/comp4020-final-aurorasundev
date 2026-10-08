import { useCallback, useEffect, useRef, useState } from "react";
import { ensureSession } from "./api.ts";
import { initialSpace, spaceReducer, type PaperStatus, type Snapshot, type Space, type SpaceAction } from "./space.ts";

type Options = {
  limit: () => number;
  // the paper open right now, which is never evicted and is always reconciled
  reading: () => string | null;
  // submission keys this page is saving; their own arrival comes via HTTP
  pendingOps: Set<string>;
  // a paper this page holds turned out to be gone (from an event or a snapshot)
  onGone: (id: string, status: Exclude<PaperStatus, "active">) => void;
  // a paper's version moved (someone witnessed it); only its readers care
  onChanged: (id: string, version: number) => void;
};

const RETRY_MS = [500, 1000, 2000, 4000, 8000];

type Ended = { id: string; version: number; revision: number; active_total: number; op?: string };

// One EventSource per page instance. Every (re)connect sends the ids on
// screen, and the snapshot that opens the stream says which still exist and
// refills the rest of the window: missed events are recovered as current
// facts, never replayed.
export function useLiveSpace({ limit, reading, pendingOps, onGone, onChanged }: Options) {
  // The state is applied here first and rendered after, so a reply that
  // lands between an event and the next render (a late creation answer)
  // is checked against what this page has already learned.
  const state = useRef<Space>(initialSpace);
  const [space, setSpace] = useState<Space>(initialSpace);
  const dispatch = useCallback((action: SpaceAction) => {
    state.current = spaceReducer(state.current, action);
    setSpace(state.current);
  }, []);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ limit, reading, onGone, onChanged });
  latest.current = { limit, reading, onGone, onChanged };

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let closed = false;

    const act = (action: SpaceAction): void => {
      if (!closed) dispatch(action);
    };
    const parse = <T>(e: Event): T => JSON.parse((e as MessageEvent<string>).data) as T;

    const connect = (): void => {
      if (closed) return;
      const { limit, reading } = latest.current;
      const open = reading();
      const ids = state.current.ids;
      const known = [...new Set(open ? [...ids, open] : ids)].slice(-32);
      const query = new URLSearchParams({ limit: String(limit()) });
      if (known.length) query.set("known", known.join(","));
      source = new EventSource(`/api/events?${query}`);

      source.addEventListener("space:snapshot", (e) => {
        failures = 0;
        const snapshot = parse<Snapshot>(e);
        const { limit, reading } = latest.current;
        act({ type: "snapshot", snapshot, limit: limit(), reading: reading() });
        for (const k of snapshot.known) {
          if (k.status !== "active") latest.current.onGone(k.id, k.status);
          // a witness (or anything else) missed while disconnected: an open
          // reader refetches its own facts; nothing is fetched for the rest
          else latest.current.onChanged(k.id, k.version);
        }
      });

      source.addEventListener("paper:created", (e) => {
        const d = parse<{ id: string; revision: number; active_total: number; op: string }>(e);
        if (pendingOps.has(d.op)) act({ type: "counted", revision: d.revision, total: d.active_total });
        else {
          const { limit, reading } = latest.current;
          act({ type: "arrived", id: d.id, revision: d.revision, total: d.active_total, limit: limit(), reading: reading() });
        }
      });

      // A paper this page let go itself arrives here too; that page plays its
      // own ending from the HTTP reply, so its echo only moves the count.
      source.addEventListener("paper:destroyed", (e) => {
        const d = parse<Ended>(e);
        if (d.op && pendingOps.has(d.op)) {
          act({ type: "counted", revision: d.revision, total: d.active_total });
          return;
        }
        act({ type: "removed", id: d.id, revision: d.revision, total: d.active_total, reading: latest.current.reading() });
        latest.current.onGone(d.id, "destroyed");
      });

      // Taken out for safety: gone at once everywhere, readers included.
      source.addEventListener("paper:quarantined", (e) => {
        const d = parse<Ended>(e);
        act({ type: "removed", id: d.id, revision: d.revision, total: d.active_total, reading: latest.current.reading() });
        latest.current.onGone(d.id, "quarantined");
      });

      source.addEventListener("paper:witnessed", (e) => {
        const d = parse<{ id: string; version: number; revision: number }>(e);
        act({ type: "revised", revision: d.revision });
        latest.current.onChanged(d.id, d.version);
      });

      // EventSource would retry by itself with the same URL, which carries a
      // stale id list; reconnect by hand so each snapshot reconciles what's
      // on screen now.
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        act({ type: "failed" });
        timer = setTimeout(connect, RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
      };
    };

    ensureSession()
      .then(connect)
      .catch(() => act({ type: "failed" }));

    return () => {
      closed = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [attempt, pendingOps, dispatch]);

  const retry = useCallback(() => {
    dispatch({ type: "connection", connection: "connecting" });
    setAttempt((n) => n + 1);
  }, [dispatch]);

  // What this page knows right now, including anything not yet rendered.
  const current = useCallback(() => state.current, []);

  return { space, dispatch, retry, current };
}
