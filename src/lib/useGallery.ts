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
  const [attempt, setAttempt] = useState(0);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = state.openId;
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.cursor;
  const loadingRef = useRef(false);
  loadingRef.current = state.loading !== null;
  const pageAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getGalleryConfig(controller.signal)
      .then((c) => setGenerationEnabled(c.generation_enabled))
      .catch(() => {});
    return () => controller.abort();
  }, [attempt]);

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

  const loadMore = useCallback(() => {
    const after = cursorRef.current;
    if (!after || loadingRef.current) return;
    pageAbort.current?.abort();
    const controller = new AbortController();
    pageAbort.current = controller;
    dispatch({ type: "load", kind: "page" });
    getGalleryPage(after, controller.signal)
      .then((page) => !controller.signal.aborted && dispatch({ type: "page", page }))
      .catch(() => !controller.signal.aborted && dispatch({ type: "failed" }));
  }, []);

  const retry = useCallback(() => {
    setError(false);
    setAttempt((n) => n + 1);
  }, []);

  // --- reporting -------------------------------------------------------------
  // An unsettled report keeps its reason and key until a retry settles it,
  // even if the form is closed and opened again: a lost reply is not proof
  // that nothing was saved.
  const [report, setReport] = useState<ReportState>({ kind: "idle" });
  const reportSent = useRef<{ id: string; reason: ArtifactReportReason; key: string } | null>(null);
  const sendReport = useCallback(async (id: string, reason: ArtifactReportReason) => {
    const prior = reportSent.current;
    const frozen = prior && prior.id === id ? prior : { id, reason, key: crypto.randomUUID() };
    reportSent.current = frozen;
    setReport({ kind: "sending" });
    try {
      await reportArtifact(frozen.id, frozen.reason, frozen.key);
      reportSent.current = null;
      setReport({ kind: "received" });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        reportSent.current = null;
        setReport({ kind: "refused", message: err.status === 404 ? "This object is no longer here." : err.message });
      } else {
        setReport({ kind: "unsettled", message: "We couldn't confirm the report was received. Try again: it won't be sent twice." });
      }
    }
  }, []);
  const frozenReason = useCallback((id: string): ArtifactReportReason | null => {
    const f = reportSent.current;
    return f && f.id === id ? f.reason : null;
  }, []);

  const open = useCallback((id: string | null) => {
    dispatch({ type: "open", id });
    // a new object starts a new report unless one is still unsettled
    setReport((r) => (r.kind === "unsettled" && reportSent.current?.id === id ? r : { kind: "idle" }));
  }, []);

  return {
    items: state.items,
    total: state.total,
    loading: state.revision < 0 && !error,
    loadingMore: state.loading === "page",
    error,
    reconnecting,
    generationEnabled,
    hasMore: state.hasMore,
    loadMore,
    retry,
    selected: openArtifact(state),
    openId: state.openId,
    open,
    report,
    sendReport,
    frozenReason,
  };
}
