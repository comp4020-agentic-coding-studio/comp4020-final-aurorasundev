import { useEffect, useMemo, useRef, useState } from "react";
import { frontChoice, frontSettled, keepArrangement, withFront } from "./entry-front.ts";
import type { PublicArtifact } from "./gallery-api.ts";

// The entry's front three (owner, 2026-11-08), bridged to the page: read on
// until three unopened records are known or the pages run out (at most
// FRONT_WAIT_MS), choose once, bring any recent front into the window, then
// hand the belt the window with those three in front. After that choice the
// belt keeps its arrangement and its own rules (pages, arrivals, hides).

export const FRONT_WAIT_MS = 2000;

type Gallery = {
  items: PublicArtifact[];
  recent: PublicArtifact[];
  loading: boolean;
  moreAhead: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  hidden: Record<string, number>;
  front: (artifacts: PublicArtifact[]) => void;
};

export function useEntryFront(g: Gallery, openedAtLoad: ReadonlySet<string>, enabled: boolean) {
  const { items, recent, hidden, loading, moreAhead, loadingMore, loadMore, front: promote } = g;
  // null until chosen; without the orbit (grid, reduced motion) nothing is arranged
  const [front, setFront] = useState<string[] | null>(enabled ? null : []);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (front || loading) return;
    const timer = setTimeout(() => setTimedOut(true), FRONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [front, loading]);

  // every record met while choosing, not only the current window: reading on
  // past MAX_TILES retires the first page from the window, and an unopened
  // record there must stay a candidate (a chosen one rejoins through
  // `front`). A record hidden since it was met is never chosen.
  const met = useRef(new Map<string, PublicArtifact>());
  const pool = useMemo(() => {
    for (const a of [...recent, ...items]) met.current.set(a.id, a);
    return [...met.current.values()].filter((a) => hidden[a.id] === undefined || hidden[a.id] < a.version);
  }, [recent, items, hidden]);
  // a failed first load (nothing in yet) is not "nothing more to read": the
  // retry's snapshot still gets a front
  const settled = !loading && items.length > 0 && (timedOut || frontSettled(pool, openedAtLoad, !moreAhead));

  // read the next page while the front still lacks unopened records; once per
  // window size, so a repeated effect can't abort the request it just made
  const askedAt = useRef<number>(-1);
  useEffect(() => {
    if (front || loading || settled || loadingMore || !moreAhead || askedAt.current === items.length) return;
    askedAt.current = items.length;
    loadMore();
  }, [front, loading, settled, loadingMore, moreAhead, loadMore, items.length]);

  useEffect(() => {
    if (front || !settled) return;
    const chosen = frontChoice(pool, openedAtLoad);
    setFront(chosen.map((a) => a.id));
    promote(chosen);
  }, [front, settled, pool, openedAtLoad, promote]);

  // the front order is set once; every later window keeps that arrangement
  const shown = useRef<PublicArtifact[] | null>(null);
  const ordered = useMemo(() => {
    if (!front) return items;
    // the `front` action lands in the same commit as the choice, so the first
    // window here already holds the fronts; it locks the arrangement at once
    // (a front hidden later just drops out, nothing is reshuffled)
    shown.current = shown.current ? keepArrangement(shown.current, items) : withFront(items, front);
    return shown.current;
  }, [items, front]);

  return { ready: front !== null, items: ordered, lead: front?.[0] ?? null };
}
