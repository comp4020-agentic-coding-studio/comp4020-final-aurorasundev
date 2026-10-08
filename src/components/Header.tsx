type Props = {
  onReturnKey: () => void;
  // a paper is being let go: the header stays, its key flow waits
  busy?: boolean;
};

export function Header({ onReturnKey, busy = false }: Props) {
  return (
    <header className="site-header">
      <span className="wordmark">Throwaway</span>
      <nav className="header-links" aria-label="Site">
        <button type="button" className="header-link" onClick={onReturnKey} disabled={busy}>
          Return key
        </button>
        <a className="header-link" href="/readme/">
          <span className="wide-only">About / </span>Readme
        </a>
      </nav>
    </header>
  );
}
