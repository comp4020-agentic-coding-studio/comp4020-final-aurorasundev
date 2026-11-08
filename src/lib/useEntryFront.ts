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
  front: (artifacts: PublicArtifact[]) => void;
};

export function useEntryFront(g: Gallery, openedAtLoad: ReadonlySet<string>, enabled: boolean) {
  const { items, recent, loading, moreAhead, loadingMore, loadMore, front: promote } = g;
  // null until chosen; without the orbit (grid, reduced motion) nothing is arranged
  const [front, setFront] = useState<string[] | null>(enabled ? null : []);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (front || loading) return;
    const timer = setTimeout(() => setTimedOut(true), FRONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [front, loading]);

  const pool = useMemo(() => [...recent, ...items], [recent, items]);
  const settled = !loading && (timedOut || frontSettled(pool, openedAtLoad, !moreAhead));

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
    const next = shown.current ? keepArrangement(shown.current, items) : withFront(items, front);
    // the fronts lead from the first window that holds them all
    if (shown.current || front.every((id) => items.some((a) => a.id === id))) shown.current = next;
    return next;
  }, [items, front]);

  return { ready: front !== null, items: ordered, lead: front?.[0] ?? null };
}
