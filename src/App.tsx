import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import { PaperField, type ExploreEdge, type PaperFieldHandle, type SheetRect } from "./components/PaperField.tsx";
import { ReadDialog, type Ended } from "./components/ReadDialog.tsx";
import { ReturnKeyDialog } from "./components/ReturnKeyDialog.tsx";
import { SpaceFooter } from "./components/SpaceFooter.tsx";
import { WriteDialog } from "./components/WriteDialog.tsx";
import { samplePapers, type Burned, type Created } from "./lib/api.ts";
import { useLiveSpace } from "./lib/useLiveSpace.ts";

type Mode =
  | { kind: "space" }
  | { kind: "writing" }
  | { kind: "key"; variant: "issue" | "restore" }
  | { kind: "reading"; id: string; revealed: boolean; rect: SheetRect | null; ended: Ended | null };

// The references show generously spaced papers rather than the demo's crowded
// 40-paper stage; the window stays small enough to keep that negative space.
// It is a rendering budget, not the whole space: exploring moves it.
const NARROW = "(max-width: 600px)";
const visibleLimit = (): number => (window.matchMedia(NARROW).matches ? 5 : 8);

// After a throw lands, the return-key offer waits this long, and only while
// nothing else is open.
const KEY_OFFER_DELAY_MS = 1800;
// How many recently seen papers exploring steers away from, besides those on screen.
const RECENT = 24;
const EXPLORE_COOLDOWN_MS = 600;

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: "space" });
  // newest version announced live for the paper being read
  const [readingVersion, setReadingVersion] = useState(0);
  // A first Keep earns a key offer. It waits for an idle space rather than a
  // timer that a new draft could swallow; the header can still reach it.
  const [keyOffer, setKeyOffer] = useState(false);
  const [limit, setLimit] = useState(visibleLimit);
  const [exploring, setExploring] = useState(false);
  const field = useRef<PaperFieldHandle>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const pendingOps = useMemo(() => new Set<string>(), []);
  const recent = useRef<string[]>([]);
  const lastExplore = useRef(-Infinity);
  const inFlight = useRef(false);

  const readingId = (): string | null => (modeRef.current.kind === "reading" ? modeRef.current.id : null);

  const { space, dispatch, retry, current } = useLiveSpace({
    limit: () => limitRef.current,
    reading: readingId,
    pendingOps,
    onGone: (id, why) => {
      setMode((m) => (m.kind === "reading" && m.id === id && !m.ended ? { ...m, ended: why } : m));
    },
    onChanged: (id, version) => {
      if (readingId() === id) setReadingVersion((v) => Math.max(v, version));
    },
  });

  const openPaper = useCallback((id: string) => {
    // a paper on its way out (explored past, let go) is no longer here to open
    if (!current().ids.includes(id)) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setReadingVersion(0);
    setMode({ kind: "reading", id, revealed: false, rect: null, ended: null });
    field.current?.openPaper(id, (rect) =>
      setMode((m) => (m.kind === "reading" && m.id === id ? { ...m, revealed: true, rect } : m)),
    );
  }, [current]);

  const moveSheet = useCallback((rect: SheetRect) => {
    setMode((m) => (m.kind === "reading" && m.revealed ? { ...m, rect } : m));
  }, []);

  // Closing an ended paper is the last of it: a let-go paper fades instead of
  // crumpling back; one taken out for safety simply goes. Either way it
  // leaves this page's window.
  const closePaper = useCallback(() => {
    const m = modeRef.current;
    if (m.kind === "reading" && m.ended) {
      if (m.ended === "quarantined") field.current?.removeOpenPaper();
      else field.current?.burnOpenPaper();
      dispatch({ type: "removed", id: m.id, revision: -1, total: 0, reading: null });
    } else field.current?.closePaper();
    setMode({ kind: "space" });
  }, [dispatch]);

  // This page let it go: the server has committed, so it plays its own
  // ending; other pages learn of it from the stream.
  const burned = useCallback(
    (result: Burned) => {
      const m = modeRef.current;
      if (m.kind !== "reading") return;
      field.current?.burnOpenPaper();
      dispatch({ type: "removed", id: m.id, revision: result.revision, total: result.total, reading: null });
      setMode({ kind: "space" });
      document.querySelector<HTMLElement>(".space-write")?.focus();
    },
    [dispatch],
  );

  const ended = useCallback((why: Ended) => {
    setMode((m) => (m.kind === "reading" && !m.ended ? { ...m, ended: why } : m));
  }, []);

  const startWriting = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMode({ kind: "writing" });
  }, []);

  const cancelWriting = useCallback(() => {
    setMode({ kind: "space" });
  }, []);

  // The server confirmed the save: only now does the paper crumple and fly.
  // Its own SSE echo (matched by submission key) only moved the count. A
  // reply that arrives after the paper was already let go (or that answers a
  // retry with a paper no longer here) moves the count but throws nothing:
  // there is no paper left to throw.
  const thrown = useCallback(
    (created: Created) => {
      setMode({ kind: "space" });
      const { id, status } = created.paper;
      dispatch({ type: "arrived", id, status, revision: created.revision, total: created.total, limit: limitRef.current, reading: null });
      if (current().ids.includes(id)) field.current?.throwCreatedPaper(id);
      if (created.offer_return_key) setKeyOffer(true);
    },
    [dispatch, current],
  );

  // The key offer appears once the space is idle and the throw has landed;
  // anything opened first (a new draft, a paper) postpones it, never drops it.
  useEffect(() => {
    if (!keyOffer || mode.kind !== "space") return;
    const timer = setTimeout(() => {
      if (modeRef.current.kind !== "space") return;
      setKeyOffer(false);
      setMode({ kind: "key", variant: "issue" });
    }, KEY_OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [keyOffer, mode.kind]);

  const openReturnKey = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMode({ kind: "key", variant: "restore" });
  }, []);

  const closeKey = useCallback(() => {
    setMode({ kind: "space" });
  }, []);

  // Another identity now: nothing pending belongs to it.
  const restored = useCallback(() => {
    setKeyOffer(false);
    retry();
  }, [retry]);

  const busy = mode.kind !== "space";
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Moves the window to another part of the shared pool: a bounded random
  // sample of papers not on screen (nor just seen), entering from the edge
  // the visitor moved toward. One request at a time; paused while anything
  // is open. A small space may repeat papers; nothing ranks them.
  const explore = useCallback(
    async (edge: ExploreEdge) => {
      if (busyRef.current || inFlight.current || performance.now() - lastExplore.current < EXPLORE_COOLDOWN_MS) return;
      inFlight.current = true;
      setExploring(true);
      try {
        const onScreen = current().ids;
        const steerAway = [...new Set([...recent.current, ...onScreen])].slice(-32);
        let sample = await samplePapers(limitRef.current, steerAway);
        if (sample.papers.length === 0 && sample.total > 0) sample = await samplePapers(limitRef.current, onScreen.slice(-32));
        if (sample.papers.length === 0 && sample.total > 0) sample = await samplePapers(limitRef.current, []);
        if (busyRef.current) return;
        recent.current = [...recent.current, ...onScreen].slice(-RECENT);
        field.current?.setEntryEdge(edge);
        dispatch({
          type: "sampled",
          ids: sample.papers.map((p) => p.id),
          revision: sample.revision,
          total: sample.total,
          limit: limitRef.current,
          reading: null,
          replace: true,
        });
      } catch {
        // a failed sample leaves the space as it was
      } finally {
        lastExplore.current = performance.now();
        inFlight.current = false;
        setExploring(false);
      }
    },
    [current, dispatch],
  );

  // The window follows the viewport: fewer papers on a phone, more on a wide
  // screen, without a reload or touching what is open.
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const update = () => setLimit(visibleLimit());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const shownLimit = useRef(limit);
  useEffect(() => {
    const before = shownLimit.current;
    shownLimit.current = limit;
    if (limit === before || current().status !== "ready") return;
    if (limit < before) {
      dispatch({ type: "limited", limit, reading: readingId() });
      return;
    }
    const onScreen = current().ids;
    samplePapers(limit - onScreen.length, onScreen.slice(-32))
      .then((sample) =>
        dispatch({
          type: "sampled",
          ids: sample.papers.map((p) => p.id),
          revision: sample.revision,
          total: sample.total,
          limit,
          reading: readingId(),
          replace: false,
        }),
      )
      .catch(() => {});
  }, [limit, current, dispatch]);

  // Focus goes back to whatever opened the dialog once it can take it: the
  // field is inert until the space re-renders, and a paper's button stays
  // hidden while it crumples back into place (two seconds or more on a slow
  // device). Gives up after six seconds, or once the visitor moves focus.
  useEffect(() => {
    if (busy) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (!target) return;
    const until = performance.now() + 6000;
    let frame = 0;
    const tryFocus = () => {
      if (!target.isConnected || performance.now() > until) return;
      const idle = document.activeElement === document.body || document.activeElement === null;
      if (!idle) return;
      target.focus();
      if (document.activeElement !== target) frame = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  const ready = space.status === "ready";
  const reconnecting = space.connection === "reconnecting";

  return (
    <div className={`app${mode.kind === "writing" ? " is-writing" : ""}`}>
      <Header onReturnKey={openReturnKey} />
      {ready && (
        <PaperField
          ref={field}
          ids={space.ids}
          onOpen={openPaper}
          onOpenRect={moveSheet}
          onExplore={explore}
          inert={busy}
        />
      )}
      {space.status === "loading" && <p className="space-status">Finding the space…</p>}
      {space.status === "error" && (
        <div className="space-status" role="alert">
          <p>The space couldn't be reached.</p>
          <button type="button" className="button button-secondary" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {ready && (
        <SpaceFooter
          total={space.total}
          onWrite={startWriting}
          onExplore={() => explore("right")}
          exploring={exploring}
          busy={busy}
          reconnecting={reconnecting}
        />
      )}
      {mode.kind === "writing" && (
        <WriteDialog onCancel={cancelWriting} onThrown={thrown} pendingOps={pendingOps} offline={reconnecting} />
      )}
      {mode.kind === "key" && <ReturnKeyDialog variant={mode.variant} onClose={closeKey} onRestored={restored} />}
      {mode.kind === "reading" && (
        <ReadDialog
          id={mode.id}
          revealed={mode.revealed}
          rect={mode.rect}
          liveVersion={readingVersion}
          ended={mode.ended}
          reconnecting={reconnecting}
          pendingOps={pendingOps}
          onBurned={burned}
          onEnded={ended}
          onClose={closePaper}
        />
      )}
    </div>
  );
}
