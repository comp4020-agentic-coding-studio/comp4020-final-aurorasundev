import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ensureSession } from "./api.ts";
import { initialSpace, spaceReducer, type PaperStatus, type Snapshot, type Space, type SpaceAction } from "./space.ts";

type Options = {
  limit: number;
  // the paper open right now, which is never evicted and is always reconciled
  reading: () => string | null;
  // submission keys this page is saving; their own arrival comes via HTTP
  pendingOps: Set<string>;
  // a paper this page holds turned out to be gone (from an event or a snapshot)
  onGone: (id: string, status: Exclude<PaperStatus, "active">) => void;
};

const RETRY_MS = [500, 1000, 2000, 4000, 8000];

// One EventSource per page instance. Every (re)connect sends the ids on
// screen, and the snapshot that opens the stream says which still exist and
// refills the rest of the window: missed events are recovered as current
// facts, never replayed.
export function useLiveSpace({ limit, reading, pendingOps, onGone }: Options) {
  const [space, dispatch] = useReducer(spaceReducer, initialSpace);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ space, limit, reading, onGone });
  latest.current = { space, limit, reading, onGone };

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let closed = false;

    const act = (action: SpaceAction): void => {
      if (!closed) dispatch(action);
    };

    const connect = (): void => {
      if (closed) return;
      const { space, limit, reading } = latest.current;
      const open = reading();
      const known = [...new Set(open ? [...space.ids, open] : space.ids)].slice(-32);
      const query = new URLSearchParams({ limit: String(limit) });
      if (known.length) query.set("known", known.join(","));
      source = new EventSource(`/api/events?${query}`);

      source.addEventListener("space:snapshot", (e) => {
        failures = 0;
        const snapshot = JSON.parse((e as MessageEvent<string>).data) as Snapshot;
        const { limit, reading } = latest.current;
        act({ type: "snapshot", snapshot, limit, reading: reading() });
        for (const k of snapshot.known) if (k.status !== "active") latest.current.onGone(k.id, k.status);
      });

      source.addEventListener("paper:created", (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as {
          id: string;
          revision: number;
          active_total: number;
          op: string;
        };
        if (pendingOps.has(d.op)) act({ type: "counted", revision: d.revision, total: d.active_total });
        else {
          const { limit, reading } = latest.current;
          act({ type: "arrived", id: d.id, revision: d.revision, total: d.active_total, limit, reading: reading() });
        }
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
  }, [attempt, pendingOps]);

  const retry = useCallback(() => {
    dispatch({ type: "connection", connection: "connecting" });
    setAttempt((n) => n + 1);
  }, []);

  return { space: space as Space, dispatch, retry };
}
