import { countLine } from "../lib/space.ts";

type Props = {
  onReturnKey: () => void;
  // the shared total, once the space has loaded; shown beside the wordmark
  total: number | null;
  // a paper is being let go: the header stays, its key flow waits
  busy?: boolean;
  // only from the idle space: leaving mid-draft, mid-reading or mid-ritual
  // would drop what the visitor is doing
  canVisitGallery?: boolean;
};

export function Header({ onReturnKey, total, busy = false, canVisitGallery = false }: Props) {
  return (
    <header className="site-header">
      <div className="header-brand">
        <span className="wordmark">Throwaway</span>
        {total !== null && (
          // Only the number shows; the full sentence is what assistive tech
          // hears, and it is announced when the shared total changes.
          <span className="space-count" role="status" aria-live="polite" aria-label={countLine(total)}>
            <span aria-hidden="true">{total.toLocaleString("en-AU")}</span>
          </span>
        )}
      </div>
      <nav className="header-links" aria-label="Site">
        <button type="button" className="header-link" onClick={onReturnKey} disabled={busy}>
          Return key
        </button>
        {canVisitGallery && (
          <a className="header-link" href="/gallery/">
            Gallery
          </a>
        )}
        <a className="header-link" href="/readme/">
          About
        </a>
      </nav>
    </header>
  );
}
