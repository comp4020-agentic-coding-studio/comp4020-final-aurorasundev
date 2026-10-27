import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError } from "./api.ts";
import {
  getArtifact,
  getGalleryConfig,
  getGalleryPage,
  reportArtifact,
  type ArtifactReportReason,
  type GalleryChange,
  type GalleryPage,
} from "./gallery-api.ts";
import { galleryReducer, initialGallery, openArtifact } from "./gallery-state.ts";

// One live Gallery for the page: a single EventSource, a fresh snapshot on
// every (re)connect (never a replay of old arrivals), buffered deltas while a
// load is in flight, pages from the server's own cursor, and an open object
// revalidated by id after a reconnect so a hidden one closes.

export type ReportState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "unsettled"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "received" };

export function useGallery() {
  const [state, dispatch] = useReducer(galleryReducer, initialGallery);
  const [error, setError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [generationEnabled, setGenerationEnabled] = useState<boolean | null>(null);
  // whether this server serves record music; missing (an older server) is no
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // the config is read again on every reconnect, so a server whose music was
  // switched off (or on) is believed, without resetting focus or reports
  const [configRead, setConfigRead] = useState(0);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = state.openId;
  const cursorRef = useRef<{ cursor: string | null; hasMore: boolean }>({ cursor: null, hasMore: false });
  cursorRef.current = { cursor: state.cursor, hasMore: state.hasMore };
  const loadingRef = useRef(false);
  loadingRef.current = state.loading !== null;
  const pageAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getGalleryConfig(controller.signal)
      .then((c) => {
        setGenerationEnabled(c.generation_enabled);
        setMusicEnabled(c.music_enabled === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [attempt, configRead]);

  useEffect(() => {
    let live = true;
    const source = new EventSource("/api/gallery/events");
    let connectedOnce = false;
    // the snapshot arrives as the first event of every connection
    source.addEventListener("gallery:snapshot", (e) => {
      if (!live) return;
      const page = JSON.parse((e as MessageEvent).data) as GalleryPage;
      dispatch({ type: "snapshot", page });
      setError(false);
      setReconnecting(false);
      // after a reconnect, an open object outside the first page is checked by id
      const open = openIdRef.current;
      if (connectedOnce && open && !page.items.some((a) => a.id === open)) {
        getArtifact(open)
          .then((artifact) => live && dispatch({ type: "revalidated", id: open, artifact }))
          .catch((err: unknown) => {
            if (live && err instanceof ApiError && err.status === 404) dispatch({ type: "revalidated", id: open, artifact: null });
          });
      }
      if (connectedOnce) setConfigRead((n) => n + 1);
      connectedOnce = true;
    });
    for (const type of ["artifact:published", "artifact:hidden"] as const) {
      source.addEventListener(type, (e) => {
        if (!live) return;
        dispatch({ type: "change", change: { type, ...JSON.parse((e as MessageEvent).data) } as GalleryChange });
      });
    }
    source.onerror = () => {
      if (!live) return;
      // the browser reconnects on its own; until then the safe view stays
      if (connectedOnce) setReconnecting(true);
      else if (source.readyState === EventSource.CLOSED) setError(true);
      // a load awaiting this connection's snapshot is now waiting on the next one
      dispatch({ type: "load", kind: "snapshot" });
    };
    dispatch({ type: "load", kind: "snapshot" });
    return () => {
      live = false;
      source.close();
      pageAbort.current?.abort();
    };
  }, [attempt]);

  // stalled first load: say so instead of waiting forever
  useEffect(() => {
    if (state.revision >= 0 || error) return;
    const timer = setTimeout(() => setError(true), 10_000);
    return () => clearTimeout(timer);
  }, [state.revision, error]);

  // The next page of the sliding window, from the server's cursor; a null
  // cursor with more to show is the wrap back to the first page. The page
  // carries the cursor it was asked for, so a stale one changes nothing.
  const loadMore = useCallback(() => {
    const { cursor: after, hasMore } = cursorRef.current;
    if (!hasMore || loadingRef.current) return;
    pageAbort.current?.abort();
    const controller = new AbortController();
    pageAbort.current = controller;
    dispatch({ type: "load", kind: "page" });
    getGalleryPage(after ?? undefined, controller.signal)
      .then((page) => !controller.signal.aborted && dispatch({ type: "page", page, after }))
      .catch(() => !controller.signal.aborted && dispatch({ type: "failed" }));
  }, []);

  // the record in front, which the window never retires
  const focus = useCallback((id: string | null) => dispatch({ type: "focus", id }), []);

  // The way back: the first page replaces the window (an in-flight page for
  // the old cursor is aborted, and would be stale anyway).
  const restart = useCallback(() => {
    pageAbort.current?.abort();
    const controller = new AbortController();
    pageAbort.current = controller;
    dispatch({ type: "load", kind: "page" });
    getGalleryPage(undefined, controller.signal)
      .then((page) => !controller.signal.aborted && dispatch({ type: "restart", page }))
      .catch(() => !controller.signal.aborted && dispatch({ type: "failed" }));
  }, []);

  const retry = useCallback(() => {
    setError(false);
    setAttempt((n) => n + 1);
  }, []);

  // --- reporting -------------------------------------------------------------
  // Each record has its own report: its state, and while the operation is
  // open (sending, or unsettled after a lost reply) its frozen reason and key.
  // A reply only ever settles the record it was sent for, so a late answer
  // for one record never changes another's form. An unsettled report keeps
  // its reason and key until a retry settles it, through closing, reopening
  // and reporting other records: a lost reply is not proof nothing was saved.
  const [reports, setReports] = useState<Record<string, ReportState>>({});
  const reportOps = useRef(new Map<string, { reason: ArtifactReportReason; key: string }>());
  const settleReport = (id: string, next: ReportState) => setReports((r) => ({ ...r, [id]: next }));
  const sendReport = useCallback(async (id: string, reason: ArtifactReportReason) => {
    const prior = reportOps.current.get(id);
    const frozen = prior ?? { reason, key: crypto.randomUUID() };
    reportOps.current.set(id, frozen);
    settleReport(id, { kind: "sending" });
    try {
      await reportArtifact(id, frozen.reason, frozen.key);
      reportOps.current.delete(id);
      settleReport(id, { kind: "received" });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        reportOps.current.delete(id);
        settleReport(id, { kind: "refused", message: err.status === 404 ? "This object is no longer here." : err.message });
      } else {
        settleReport(id, { kind: "unsettled", message: "We couldn't confirm the report was received. Try again: it won't be sent twice." });
      }
    }
  }, []);
  const reportFor = useCallback((id: string): ReportState => reports[id] ?? { kind: "idle" }, [reports]);
  const frozenReason = useCallback((id: string): ArtifactReportReason | null => reportOps.current.get(id)?.reason ?? null, []);

  const open = useCallback((id: string | null) => dispatch({ type: "open", id }), []);

  return {
    items: state.items,
    total: state.total,
    loading: state.revision < 0 && !error,
    loadingMore: state.loading === "page",
    error,
    reconnecting,
    generationEnabled,
    musicEnabled,
    // more pages, including the orbit's wrap back to the first one
    hasMore: state.hasMore,
    // more pages after the ones shown, for the grid's "See more"
    moreAhead: state.hasMore && state.cursor !== null,
    // earlier records left the window: the grid offers the way back
    retired: state.retired,
    loadMore,
    restart,
    focus,
    retry,
    selected: openArtifact(state),
    openId: state.openId,
    open,
    reportFor,
    sendReport,
    frozenReason,
  };
}
