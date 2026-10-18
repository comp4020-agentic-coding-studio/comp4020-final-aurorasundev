import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GalleryGridFallback } from "./components/GalleryGridFallback.tsx";
import { GalleryOrbit, type OrbitHandle } from "./components/GalleryOrbit.tsx";
import { RecordView } from "./components/RecordView.tsx";
import { useGallery } from "./lib/useGallery.ts";
import { canDrawOrbit } from "./scene/gallery-orbit.ts";
import "./styles/gallery.css";

// The Gallery: a record exhibition of things let go (G01–G03). Each sleeve
// holds an image shaped by one burned Release note; the record in the middle
// shows whichever is in front. No feed, counts, dates or way back to a paper.
// It never loads the room's scene.

const ARRIVE_MS = 620;

function prefersStill(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function GalleryApp() {
  const g = useGallery();
  const [orbit, setOrbit] = useState(() => !prefersStill() && canDrawOrbit());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);
  const orbitRef = useRef<OrbitHandle>(null);
  const band = useRef<HTMLDivElement>(null);
  const ghostArt = useRef<HTMLDivElement>(null);
  const ghostDisc = useRef<HTMLDivElement>(null);
  // the grid's tile that opened a record gets focus back
  const opener = useRef<HTMLElement | null>(null);

  const focused = useMemo(() => g.items.find((a) => a.id === focusedId) ?? g.items[0] ?? null, [g.items, focusedId]);
  const isOpen = g.selected !== null;

  const openRecord = useCallback(
    (id: string) => {
      setArriving(orbit);
      g.open(id);
    },
    [g, orbit],
  );

  useEffect(() => {
    if (!arriving) return;
    const t = setTimeout(() => setArriving(false), ARRIVE_MS);
    return () => clearTimeout(t);
  }, [arriving]);

  const close = useCallback(() => {
    g.open(null);
    setArriving(false);
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }, [g]);

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
      if (orbit) {
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
    [g, orbit],
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

  // a bounded collection: near its end, ask for the next page
  const { hasMore, loadMore, loadingMore } = g;
  useEffect(() => {
    if (!orbit || !hasMore || loadingMore || !focused) return;
    const at = g.items.findIndex((a) => a.id === focused.id);
    if (at >= g.items.length - 4) loadMore();
  }, [orbit, hasMore, loadingMore, loadMore, focused, g.items]);

  const frames = useCallback(
    () => (band.current && ghostArt.current && ghostDisc.current ? { band: band.current, art: ghostArt.current, disc: ghostDisc.current } : null),
    [],
  );

  const showOrbit = orbit && g.items.length > 0;
  const many = g.items.length > 1;

  return (
    <div className={`records-page${showOrbit ? " has-orbit" : ""}${isOpen ? " is-open" : ""}`}>
      <div className="records-surface" aria-hidden="true" />
      {showOrbit && (
        <GalleryOrbit ref={orbitRef} items={g.items} open={isOpen} frames={frames} onFocus={onFocus} onOpen={openRecord} onLost={() => setOrbit(false)} />
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
            hasMore={g.hasMore}
            loadingMore={g.loadingMore}
            onLoadMore={g.loadMore}
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
          report={g.report}
          frozenReason={g.frozenReason(g.selected.id)}
          arriving={arriving}
          canStep={many}
          onStep={step}
          onReport={(reason) => void g.sendReport(g.selected!.id, reason)}
          onClose={close}
        />
      )}
    </div>
  );
}
