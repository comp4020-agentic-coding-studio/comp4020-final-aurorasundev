import { useRef } from "react";
import { ArtifactDialog } from "./components/ArtifactDialog.tsx";
import { useGallery } from "./lib/useGallery.ts";

// The public Gallery: abstract objects left after Release papers were burned.
// An unordered collection, not a feed; no counts of attention, no dates, no
// way back to any paper. It never loads the room's scene.

export function GalleryApp() {
  const g = useGallery();
  // focus goes back to the tile that opened the dialog
  const opener = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    g.open(null);
    // after the modal dialog has closed and released focus
    const tile = opener.current;
    requestAnimationFrame(() => tile?.focus({ preventScroll: true }));
  };

  return (
    <div className="gallery-page">
      <header className="gallery-header">
        <a className="wordmark gallery-wordmark" href="/">
          Throwaway
        </a>
        <nav className="header-links" aria-label="Site">
          <a className="header-link" href="/">
            Back to the space
          </a>
          <a className="header-link" href="/readme/">
            About
          </a>
        </nav>
      </header>

      <main className="gallery-main">
        <h1 className="gallery-title">The Gallery</h1>
        <p className="gallery-intro">Abstract objects left after a paper was let go. The original words and drawings are gone.</p>
        {g.generationEnabled === false && <p className="gallery-paused">New objects are not being generated right now.</p>}
        <p className="visually-hidden" role="status">
          {g.reconnecting ? "Reconnecting…" : ""}
        </p>

        {g.error && g.items.length === 0 ? (
          <div className="gallery-state" role="alert">
            <p>The Gallery could not be opened. Try again.</p>
            <button type="button" className="button button-secondary" onClick={g.retry}>
              Try again
            </button>
          </div>
        ) : g.loading ? (
          <p className="gallery-state" role="status">
            Opening the Gallery…
          </p>
        ) : g.items.length === 0 ? (
          <div className="gallery-state">
            <p className="gallery-empty">No objects have arrived yet.</p>
            <p className="gallery-empty-note">Released papers leave abstract keepsakes here after they are burned and their images pass safety checks.</p>
          </div>
        ) : (
          <>
            <ul className="gallery-grid" aria-label="Objects">
              {g.items.map((a) => (
                <li key={a.id} className="gallery-item">
                  <button
                    type="button"
                    className="gallery-tile"
                    onClick={(e) => {
                      opener.current = e.currentTarget;
                      g.open(a.id);
                    }}
                  >
                    <img src={a.image_url} alt={a.alt} width={a.width} height={a.height} loading="lazy" decoding="async" />
                    <span className="gallery-caption">{a.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {g.hasMore && (
              <div className="gallery-more">
                <button type="button" className="button button-secondary" onClick={g.loadMore} disabled={g.loadingMore}>
                  {g.loadingMore ? "Opening more…" : "See more objects"}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {g.selected && (
        <ArtifactDialog
          key={g.selected.id}
          artifact={g.selected}
          report={g.report}
          frozenReason={g.frozenReason(g.selected.id)}
          onReport={(reason) => void g.sendReport(g.selected!.id, reason)}
          onClose={close}
        />
      )}
    </div>
  );
}
