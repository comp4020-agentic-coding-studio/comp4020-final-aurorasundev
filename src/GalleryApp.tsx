import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GalleryGridFallback } from "./components/GalleryGridFallback.tsx";
import { GalleryOrbit, type OrbitHandle } from "./components/GalleryOrbit.tsx";
import { RecordView } from "./components/RecordView.tsx";
import { recordReveal } from "./lib/record-reveal.ts";
import { useGallery } from "./lib/useGallery.ts";
import { canDrawOrbit } from "./scene/gallery-orbit.ts";
import "./styles/gallery.css";

// The Gallery: a record exhibition of things let go (G01–G03). Each sleeve
// holds an image shaped by one burned Release note; the record in the middle
// shows whichever is in front. No feed, counts, dates or way back to a paper.
// It never loads the room's scene.

function prefersStill(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function GalleryApp() {
  const g = useGallery();
  const [orbit, setOrbit] = useState(() => !prefersStill() && canDrawOrbit());
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
  // the grid's tile that opened a record gets focus back
  const opener = useRef<HTMLElement | null>(null);

  const focused = useMemo(() => g.items.find((a) => a.id === focusedId) ?? g.items[0] ?? null, [g.items, focusedId]);
  const isOpen = g.selected !== null;

  const showOrbit = orbit && g.items.length > 0;

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
    if (!orbit || isOpen) return;
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
  }, [orbit, isOpen]);

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
    () => (band.current && ghostArt.current && ghostDisc.current ? { band: band.current, art: ghostArt.current, disc: ghostDisc.current } : null),
    [],
  );

  const many = g.items.length > 1;

  return (
    <div ref={page} className={`records-page${showOrbit ? " has-orbit" : ""}${isOpen ? " is-open" : ""}${returning && showOrbit && !isOpen ? " is-returning" : ""}`}>
      <div className="records-surface" aria-hidden="true" />
      {showOrbit && (
        <GalleryOrbit
          ref={orbitRef}
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
        <a className="wordmark" href="/">
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

      <main className="records-main">
        <div className="records-intro">
          <h1 className="records-title">The Gallery</h1>
          <p className="records-lede">Images shaped by released notes.</p>
          {g.generationEnabled === false && <p className="records-paused">New records are not being made right now.</p>}
        </div>
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
