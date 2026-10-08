import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import {
  PaperField,
  type ExploreEdge,
  type PaperFieldHandle,
  type RitualEvent,
  type RitualLayout,
  type SheetRect,
} from "./components/PaperField.tsx";
import { ReadDialog, type Ended } from "./components/ReadDialog.tsx";
import { ReturnKeyDialog } from "./components/ReturnKeyDialog.tsx";
import { RitualOverlay, type RitualOutcome, type RitualStage } from "./components/RitualOverlay.tsx";
import { SpaceFooter } from "./components/SpaceFooter.tsx";
import { WriteDialog } from "./components/WriteDialog.tsx";
import { ApiError, burnPaper, getPaper, samplePapers, type Created } from "./lib/api.ts";
import { useLiveSpace, type Ending } from "./lib/useLiveSpace.ts";

type Mode =
  | { kind: "space" }
  | { kind: "writing" }
  | { kind: "key"; variant: "issue" | "restore" }
  | { kind: "reading"; id: string; revealed: boolean; rect: SheetRect | null; ended: Ended | null }
  | {
      kind: "ritual";
      id: string;
      stage: RitualStage;
      outcome: RitualOutcome;
      error: string | null;
      canPlace: boolean;
      // no scene to hold the paper: HTML confirmation and a drawn ending
      fallback: boolean;
    };

// What the ritual keeps in memory, outside React's render cycle: the paper,
// this reading's receipt, and one operation key for every attempt, so a
// retry after a lost reply can't let anything go twice.
type Ritual = { id: string; receipt: string; opKey: string; committing: boolean; ignited: boolean };

const BURN_DEFAULT_MS = 4800;
// the server's effect seed is hex; the scene wants a number
const seedOf = (seed: string | undefined, id: string): number =>
  parseInt((seed ?? id.replace(/[^0-9a-f]/gi, "")).slice(0, 8), 16) || 1;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const ritualRef = useRef<Ritual | null>(null);
  const [ritualLayout, setRitualLayout] = useState<RitualLayout | null>(null);
  const sceneAvailable = useRef(true);

  // The paper being read, or held over the furnace: never evicted, always
  // reconciled.
  const readingId = (): string | null =>
    modeRef.current.kind === "reading" || modeRef.current.kind === "ritual" ? modeRef.current.id : null;

  const setRitual = useCallback((patch: Partial<Extract<Mode, { kind: "ritual" }>>) => {
    setMode((m) => (m.kind === "ritual" ? { ...m, ...patch } : m));
  }, []);

  const { space, dispatch, retry, current } = useLiveSpace({
    limit: () => limitRef.current,
    reading: readingId,
    pendingOps,
    onGone: (id, why, ending) => {
      const r = ritualRef.current;
      const m = modeRef.current;
      if (r && r.id === id && m.kind === "ritual" && !r.ignited) {
        // gone before this visitor's own let-go was confirmed
        if (why === "destroyed" && r.committing && !ending) return; // a snapshot: the retry loop learns whose it was
        r.ignited = true;
        if (why === "quarantined" || !ending) {
          field.current?.clearRitual();
          setRitual({ outcome: why === "quarantined" ? "removed" : "other", stage: "ashes", error: null });
        } else {
          field.current?.burnRitualRemotely({ seed: seedOf(ending.effect_seed, id), durationMs: ending.burn_duration_ms ?? BURN_DEFAULT_MS });
          setRitual({ outcome: "other", stage: "burning", error: null });
        }
        return;
      }
      setMode((m) => (m.kind === "reading" && m.id === id && !m.ended ? { ...m, ended: why } : m));
      // someone else let it go: if this page shows it closed, it burns where
      // it lies (a reader keeps the final reading instead)
      if (why === "destroyed" && ending && readingId() !== id) {
        field.current?.burnRemote(id, { seed: seedOf(ending.effect_seed, id), durationMs: ending.burn_duration_ms ?? BURN_DEFAULT_MS });
      }
    },
    onOwnDestroyed: (ending: Ending) => {
      if (ritualRef.current && ending.op === ritualRef.current.opKey) {
        confirmRitual({ ...ending, total: ending.active_total });
      } else {
        // an earlier let-go of this page's, no longer on screen
        dispatch({ type: "removed", id: ending.id, revision: ending.revision, total: ending.active_total, reading: readingId() });
        if (ending.op) pendingOps.delete(ending.op);
      }
    },
    onChanged: (id, version) => {
      if (modeRef.current.kind === "reading" && modeRef.current.id === id) setReadingVersion((v) => Math.max(v, version));
    },
  });

  // The server has confirmed it, by its reply or by the stream, whichever
  // came first: it leaves the shared space now, and burns here once.
  const confirmRitual = useCallback(
    (ending: { revision: number; total: number; effect_seed?: string; burn_duration_ms?: number }) => {
      const r = ritualRef.current;
      if (!r || r.ignited) return;
      r.ignited = true;
      r.committing = false;
      dispatch({ type: "removed", id: r.id, revision: ending.revision, total: ending.total, reading: null });
      const m = modeRef.current;
      if (m.kind !== "ritual" || m.id !== r.id) {
        // resolved after the visitor went back to the space: nothing to show
        pendingOps.delete(r.opKey);
        ritualRef.current = null;
        return;
      }
      setRitual({ stage: "burning", error: null });
      if (m.fallback) {
        // the drawn paper chars and falls to ash, then the quiet ending
        setTimeout(() => setRitual({ stage: "ashes" }), reducedMotion() ? 400 : 1800);
      } else {
        field.current?.igniteRitual({
          seed: seedOf(ending.effect_seed, r.id),
          durationMs: ending.burn_duration_ms ?? BURN_DEFAULT_MS,
        });
      }
    },
    [dispatch, pendingOps, setRitual],
  );

  // "Release it": the reading closes, the paper balls up over the furnace.
  // Nothing has been sent; Cancel leaves everything as it was.
  const startRitual = useCallback((receipt: string) => {
    const m = modeRef.current;
    if (m.kind !== "reading" || m.ended) return;
    const prepared = sceneAvailable.current && (field.current?.prepareRitual(m.id) ?? false);
    ritualRef.current = { id: m.id, receipt, opKey: crypto.randomUUID(), committing: false, ignited: false };
    setRitualLayout(null);
    setMode({
      kind: "ritual",
      id: m.id,
      stage: prepared ? "preparing" : "ready",
      outcome: "own",
      error: null,
      canPlace: true,
      fallback: !prepared,
    });
  }, []);

  // Placed in the furnace (dropped inside the opening, or "Place in
  // furnace"): the one confirmation. The paper waits at the rim until the
  // server answers; nothing burns before it does. A lost answer is asked
  // again with the same operation key until it is definite.
  const commitRitual = useCallback(async () => {
    const r = ritualRef.current;
    const m = modeRef.current;
    if (!r || r.committing || r.ignited || m.kind !== "ritual" || m.outcome !== "own") return;
    r.committing = true;
    pendingOps.add(r.opKey);
    setRitual({ stage: "committing", error: null });
    for (let attempt = 0; ritualRef.current === r && !r.ignited; attempt++) {
      try {
        const burned = await burnPaper(r.id, r.receipt, r.opKey);
        confirmRitual(burned);
        return;
      } catch (err) {
        if (ritualRef.current !== r || r.ignited) return;
        if (err instanceof ApiError && err.status < 500) {
          r.committing = false;
          pendingOps.delete(r.opKey);
          if (err.code === "paper_gone") {
            // someone else let it go first (ours would have answered as ours)
            r.ignited = true;
            dispatch({ type: "removed", id: r.id, revision: -1, total: current().total, reading: null });
            field.current?.clearRitual();
            setRitual({ outcome: "other", stage: "ashes", error: null });
            return;
          }
          // a definite no: the paper stays, and its rights are asked again
          field.current?.returnRitual();
          setRitual({ stage: "ready", error: err.message });
          getPaper(r.id)
            .then((paper) => {
              if (ritualRef.current !== r) return;
              if (paper.read_receipt) r.receipt = paper.read_receipt;
              if (!paper.viewer.can_burn) setRitual({ canPlace: false, error: "You can't let this paper go any more." });
            })
            .catch(() => {});
          return;
        }
        // unknown outcome: never claim it wasn't released; ask again
        setRitual({ stage: "checking" });
        await sleep(Math.min(8000, 1000 * 2 ** attempt));
      }
    }
  }, [confirmRitual, current, dispatch, pendingOps, setRitual]);

  const placeRitual = useCallback(() => {
    const m = modeRef.current;
    if (m.kind !== "ritual" || !m.canPlace || (m.stage !== "ready" && m.stage !== "preparing")) return;
    field.current?.placeRitual();
    void commitRitual();
  }, [commitRitual]);

  const ritualEvent = useCallback(
    (event: RitualEvent) => {
      const m = modeRef.current;
      if (m.kind !== "ritual") return;
      if (event.type === "ready" && m.stage === "preparing") setRitual({ stage: "ready" });
      else if (event.type === "dropped") {
        if (m.canPlace && (m.stage === "ready" || m.stage === "preparing")) void commitRitual();
        else field.current?.returnRitual();
      } else if (event.type === "ashes" && (m.stage === "burning" || m.stage === "committing")) setRitual({ stage: "ashes" });
    },
    [commitRitual, setRitual],
  );

  // Cancel (or Escape) before placing: the paper drops back into the space.
  // No request was made, so nothing changed for anyone.
  const cancelRitual = useCallback(() => {
    const m = modeRef.current;
    const r = ritualRef.current;
    if (m.kind !== "ritual" || !r || r.committing || r.ignited) return;
    if (m.stage !== "preparing" && m.stage !== "ready") return;
    field.current?.cancelRitual();
    ritualRef.current = null;
    setMode({ kind: "space" });
  }, []);

  // "Back to the space": the presentation ends. A confirmed let-go stays
  // let go; an unresolved one keeps being asked about in the background.
  const leaveRitual = useCallback(() => {
    const m = modeRef.current;
    const r = ritualRef.current;
    if (m.kind !== "ritual") return;
    field.current?.endRitual();
    if (r && r.ignited) {
      pendingOps.delete(r.opKey);
      ritualRef.current = null;
    }
    // Gone for certain: out of this page's window. Still unresolved: the
    // paper stays in the window until the answer comes, and comes back to
    // the floor if it turns out it wasn't released.
    if (!r || r.ignited || m.outcome !== "own") {
      dispatch({ type: "removed", id: m.id, revision: -1, total: current().total, reading: null });
    }
    returnFocus.current = document.querySelector<HTMLElement>(".space-write");
    setMode({ kind: "space" });
  }, [current, dispatch, pendingOps]);

  // Escape cancels only before placing; afterwards it only ends the view.
  useEffect(() => {
    if (mode.kind !== "ritual") return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const m = modeRef.current;
      if (m.kind !== "ritual") return;
      e.preventDefault();
      if (m.stage === "preparing" || m.stage === "ready") {
        if (m.outcome === "own") cancelRitual();
        else leaveRitual();
      } else if (m.stage !== "committing") leaveRitual();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode.kind, cancelRitual, leaveRitual]);

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

  const prefetchFire = useCallback(() => field.current?.prefetchFire(), []);

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
    if (modeRef.current.kind === "ritual") return;
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
    <div className={`app${mode.kind === "writing" ? " is-writing" : ""}${mode.kind === "ritual" ? " is-ritual" : ""}`}>
      <Header onReturnKey={openReturnKey} busy={mode.kind === "ritual"} />
      {ready && (
        <PaperField
          ref={field}
          ids={space.ids}
          onOpen={openPaper}
          onOpenRect={moveSheet}
          onExplore={explore}
          onRitual={ritualEvent}
          onRitualLayout={setRitualLayout}
          onAvailable={(available) => {
            sceneAvailable.current = available;
          }}
          // the ritual's paper is dragged on the canvas, so it stays live
          inert={busy && mode.kind !== "ritual"}
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
          onRelease={startRitual}
          onReleasable={prefetchFire}
          onEnded={ended}
          onClose={closePaper}
        />
      )}
      {mode.kind === "ritual" && (
        <RitualOverlay
          stage={mode.stage}
          outcome={mode.outcome}
          error={mode.error}
          canPlace={mode.canPlace && !reconnecting}
          fallback={mode.fallback}
          layout={ritualLayout}
          onCancel={cancelRitual}
          onPlace={placeRitual}
          onBack={leaveRitual}
        />
      )}
    </div>
  );
}
