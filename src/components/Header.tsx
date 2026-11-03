import { countLine } from "../lib/space.ts";

type Props = {
  // "Sign in" for a guest; the username for an account, opening its papers
  onAccount: () => void;
  username: string | null;
  // the shared total, once the space has loaded; shown beside the wordmark
  total: number | null;
  // a paper is being let go: the header stays, its account entry waits
  busy?: boolean;
  // only from the idle space: leaving mid-draft, mid-reading or mid-ritual
  // would drop what the visitor is doing
  canVisitGallery?: boolean;
};

export function Header({ onAccount, username, total, busy = false, canVisitGallery = false }: Props) {
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
        {canVisitGallery && (
          <a className="header-link" href="/gallery/">
            Gallery
          </a>
        )}
        <a className="header-link" href="/readme/">
          About
        </a>
        <button
          type="button"
          className="header-link header-account"
          onClick={onAccount}
          disabled={busy}
          aria-label={username ? `Your papers (signed in as ${username})` : undefined}
        >
          {username ?? "Sign in"}
        </button>
      </nav>
    </header>
  );
}
