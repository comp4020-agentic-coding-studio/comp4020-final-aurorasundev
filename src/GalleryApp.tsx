import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GalleryGridFallback } from "./components/GalleryGridFallback.tsx";
import { GalleryOrbit, type OrbitHandle } from "./components/GalleryOrbit.tsx";
import { GalleryMist } from "./components/GalleryMist.tsx";
import { RecordView } from "./components/RecordView.tsx";
import { createGate, takesInput } from "./lib/gallery-progress.ts";
import { recordReveal } from "./lib/record-reveal.ts";
import { useEntryProgress, type EntryRefs } from "./lib/useEntryProgress.ts";
import { useGallery } from "./lib/useGallery.ts";
import { canDrawOrbit } from "./scene/gallery-belt.ts";
import type { Mist } from "./scene/mist.ts";
import "./styles/gallery.css";

// The Gallery: a record exhibition of things let go (G01–G03). Each sleeve
// holds an image shaped by one burned Release note; the record in the middle
// shows whichever is in front. No feed, counts, dates or way back to a paper.
// It never loads the room's scene.

function prefersStill(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const TITLE = "The Throwaway Gallery";
const LEDE = "Images shaped by released notes.";

export function GalleryApp() {
  const g = useGallery();
  const [still] = useState(prefersStill);
  const [webgl] = useState(canDrawOrbit);
  const [orbit, setOrbit] = useState(() => !still && webgl);
  // the entry mist: live on the entry, one still frame under reduced motion,
  // and the photograph when there is no WebGL or the context is lost
  const [mistOn, setMistOn] = useState(webgl);
  const mist = useRef<Mist | null>(null);
  // the entry plays on every visit where the exhibition can move
  const [entry] = useState(() => !still && webgl);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The scene's timelines own the hand-over: `arriving` holds the HTML
  // record back until the open (or a step) has finished in WebGL, and
  // `returning` keeps the browsing page stepped back until the close has
  // carried the sleeve away. Both end from the scene's callbacks, not timers.
  const [arriving, setArriving] = useState(false);
  const [returning, setReturning] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<OrbitHandle>(null);
  const band = useRef<HTMLDivElement>(null);
  const ghostArt = useRef<HTMLDivElement>(null);
  const ghostDisc = useRef<HTMLDivElement>(null);
  // the opened record's mineral surface, faded by the scene's open timeline
  const backdrop = useRef<HTMLDivElement>(null);
  // the grid's tile that opened a record gets focus back
  const opener = useRef<HTMLElement | null>(null);

  const focused = useMemo(() => g.items.find((a) => a.id === focusedId) ?? g.items[0] ?? null, [g.items, focusedId]);
  const isOpen = g.selected !== null;

  const showOrbit = orbit && g.items.length > 0;

  // --- the entry and its virtual progress p (design 2026-10-19 §1–§3) -------
  const gate = useMemo(createGate, []);
  const titleEl = useRef<HTMLHeadingElement>(null);
  const ledeEl = useRef<HTMLParagraphElement>(null);
  const enterEl = useRef<HTMLButtonElement>(null);
  const cornerEl = useRef<HTMLAnchorElement>(null);
  const mainEl = useRef<HTMLElement>(null);
  const entryRefs = useMemo<EntryRefs>(() => ({ root: page, title: titleEl, lede: ledeEl, enter: enterEl, corner: cornerEl, exhibition: mainEl }), []);
  const { stage, advance } = useEntryProgress({
    enabled: entry && orbit,
    recordOpen: isOpen,
    refs: entryRefs,
    mist,
    gate,
    sceneEntry: (v) => orbitRef.current?.setEntry(v),
    atRest: () => orbitRef.current?.atRest() ?? true,
  });
  const live = takesInput(stage);
  // with no scene to wait for (empty, failed), the exhibition is ready
  useEffect(() => {
    if (!g.loading && !showOrbit) gate.set(true);
  }, [g.loading, showOrbit, gate]);
  // the exhibition takes input only at p = 1
  useEffect(() => {
    orbitRef.current?.setInput(live);
  }, [live, showOrbit]);

  const openRecord = useCallback(
    (id: string) => {
      setArriving(showOrbit);
      setReturning(false);
      g.open(id);
    },
    [g, showOrbit],
  );

  const close = useCallback(() => {
    g.open(null);
    setArriving(false);
    setReturning(showOrbit);
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }, [g, showOrbit]);

  // a record closed from outside (hidden live) hands back the same way
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen && showOrbit) setReturning(true);
    if (!isOpen) setArriving(false);
    wasOpen.current = isOpen;
  }, [isOpen, showOrbit]);

  const onArrive = useCallback(() => setArriving(false), []);
  const onHandBack = useCallback(() => setReturning(false), []);
  const reveal = useCallback(() => {
    const dialog = page.current?.querySelector<HTMLElement>(".record-dialog");
    return dialog ? recordReveal(dialog) : null;
  }, []);

  // a settled turn moves the focus; inside an open record the arrows turn
  // the orbit and the open record follows it
  const onFocus = useCallback(
    (id: string) => {
      setFocusedId(id);
      if (g.openId && g.openId !== id) g.open(id);
    },
    [g],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (showOrbit) {
        // the orbit carries the next sleeve in; the HTML record follows it
        setArriving(true);
        orbitRef.current?.step(dir);
        return;
      }
      const n = g.items.length;
      if (!n || !g.openId) return;
      const at = g.items.findIndex((a) => a.id === g.openId);
      const next = g.items[(at + dir + n) % n];
      setFocusedId(next.id);
      g.open(next.id);
    },
    [g, showOrbit],
  );

  // Left/Right turn the collection while browsing
  useEffect(() => {
    if (!orbit || isOpen || !live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") orbitRef.current?.step(-1);
      else if (e.key === "ArrowRight") orbitRef.current?.step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orbit, isOpen, live]);

  // the window never retires the record in front
  const { hasMore, loadMore, loadingMore, focus: setWindowFocus } = g;
  useEffect(() => setWindowFocus(focused?.id ?? null), [focused, setWindowFocus]);

  // A sliding window: near its end, ask for the next page. The window retires
  // records from its start, so the end keeps moving forward and turning on
  // reaches every record; after the last one it wraps to the first page.
  // One request per focused record, so an empty page cannot chain requests.
  const askedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!orbit || !hasMore || loadingMore || !focused || askedAt.current === focused.id) return;
    const at = g.items.findIndex((a) => a.id === focused.id);
    if (at >= g.items.length - 4) {
      askedAt.current = focused.id;
      loadMore();
    }
  }, [orbit, hasMore, loadingMore, loadMore, focused, g.items]);

  const frames = useCallback(
    () => (band.current && ghostArt.current && ghostDisc.current ? { band: band.current, art: ghostArt.current, disc: ghostDisc.current, backdrop: backdrop.current } : null),
    [],
  );

  const many = g.items.length > 1;

  return (
    <div
      ref={page}
      data-stage={stage}
      className={`records-page${showOrbit ? " has-orbit" : ""}${entry && orbit ? " has-entry" : " is-plain"}${isOpen ? " is-open" : ""}${returning && showOrbit && !isOpen ? " is-returning" : ""}`}
    >
      <div className="records-surface" aria-hidden="true" />
      {/* behind the scene, above the stage plate: the opened record's ground */}
      {showOrbit && <div ref={backdrop} className="record-backdrop" aria-hidden="true" />}
      {mistOn && <GalleryMist mist={mist} still={still || !entry} behind={!entry || stage === "exhibition"} onLost={() => setMistOn(false)} />}
      {showOrbit && (
        <GalleryOrbit
          ref={orbitRef}
          held={stage === "entry" || stage === "returning"}
          onReady={() => gate.set(true)}
          items={g.items}
          open={isOpen}
          frames={frames}
          onFocus={onFocus}
          onOpen={openRecord}
          onLost={() => setOrbit(false)}
          onArrive={onArrive}
          onHandBack={onHandBack}
          reveal={reveal}
        />
      )}
      {/* where an opened record's art and disc sit, measured by the scene */}
      <div className="record-frame record-ghost" aria-hidden="true">
        <div className="record-back" />
        <div ref={ghostArt} className="record-art" />
        <div ref={ghostDisc} className="record-disc" />
      </div>

      <header className="records-header">
        <a ref={cornerEl} className="wordmark" href="/">
          Throwaway
        </a>
        <nav className="records-links" aria-label="Site">
          <a className="header-link" href="/">
            <span className="wide-only">Back to the space</span>
            <span className="narrow-only">Space</span>
          </a>
          <a className="header-link" href="/readme/">
            About
          </a>
        </nav>
      </header>

      {/* the entry (p = 0); with no motion or no WebGL, a plain title above the grid */}
      <section className="gallery-entry" aria-label="Gallery entry">
        <h1 ref={titleEl} className="entry-title">
          {TITLE}
        </h1>
        <p ref={ledeEl} className="entry-lede">
          {LEDE}
        </p>
        {entry && orbit && (
          <button ref={enterEl} type="button" className="entry-enter" onClick={advance}>
            <span className="entry-enter-hint" aria-hidden="true">
              <span className="wide-only">Scroll</span>
              <span className="narrow-only">Swipe up</span>
            </span>
            <span className="entry-enter-word">Enter</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </section>

      <main ref={mainEl} className="records-main">
        {g.generationEnabled === false && <p className="records-paused">New records are not being made right now.</p>}
        <p className="visually-hidden" role="status">
          {g.reconnecting ? "Reconnecting…" : ""}
        </p>

        {g.error && g.items.length === 0 ? (
          <div className="records-state" role="alert">
            <p>The Gallery could not be opened. Try again.</p>
            <button type="button" className="button button-secondary" onClick={g.retry}>
              Try again
            </button>
          </div>
        ) : g.loading ? (
          <p className="records-state" role="status">
            Opening the Gallery…
          </p>
        ) : g.items.length === 0 ? (
          <div className="records-state">
            <p className="records-empty">No records have arrived yet.</p>
            <p className="records-empty-note">When a released paper is burned, an image shaped by it can arrive here after it passes safety checks.</p>
          </div>
        ) : showOrbit ? (
          <>
            <div ref={band} className="orbit-band" />
            <div className="orbit-foot">
              <div className="orbit-caption" aria-live="polite">
                <h2 className="orbit-title">
                  <button type="button" className="orbit-title-button" onClick={() => focused && openRecord(focused.id)}>
                    {focused?.title}
                  </button>
                </h2>
                <p className="orbit-sub">The original note is gone.</p>
              </div>
              <p className="orbit-hint">
                <span className="wide-only">{many ? "Scroll to turn · Click to open" : "Click to open"}</span>
                <span className="narrow-only">{many ? "Swipe to turn" : ""}</span>
              </p>
              <div className="orbit-controls">
                {many && (
                  <button type="button" className="orbit-arrow" aria-label="Previous record" onClick={() => orbitRef.current?.step(-1)}>
                    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                      <path className="chevron" d="M15 4l-8 8 8 8" />
                      <path className="arrow" d="M20 12H4M10 6l-6 6 6 6" />
                    </svg>
                  </button>
                )}
                <button type="button" className="button button-primary orbit-open" onClick={() => focused && openRecord(focused.id)}>
                  Open record
                </button>
                {many && (
                  <button type="button" className="orbit-arrow" aria-label="Next record" onClick={() => orbitRef.current?.step(1)}>
                    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                      <path className="chevron" d="M9 4l8 8-8 8" />
                      <path className="arrow" d="M4 12h16M14 6l6 6-6 6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <GalleryGridFallback
            items={g.items}
            hasMore={g.moreAhead}
            retired={g.retired}
            loadingMore={g.loadingMore}
            onLoadMore={g.loadMore}
            onRestart={g.restart}
            onOpen={(id, el) => {
              opener.current = el;
              openRecord(id);
            }}
          />
        )}
      </main>

      {g.selected && (
        <RecordView
          artifact={g.selected}
          report={g.reportFor(g.selected.id)}
          frozenReason={g.frozenReason(g.selected.id)}
          arriving={arriving && showOrbit}
          canStep={many}
          onStep={step}
          onReport={(reason) => void g.sendReport(g.selected!.id, reason)}
          onClose={close}
        />
      )}
    </div>
  );
}
