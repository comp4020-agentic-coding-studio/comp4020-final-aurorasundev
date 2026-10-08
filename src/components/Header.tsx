type Props = {
  onReturnKey: () => void;
};

export function Header({ onReturnKey }: Props) {
  return (
    <header className="site-header">
      <span className="wordmark">Throwaway</span>
      <nav className="header-links" aria-label="Site">
        <button type="button" className="header-link" onClick={onReturnKey}>
          Return key
        </button>
        <a className="header-link" href="/readme/">
          <span className="wide-only">About / </span>Readme
        </a>
      </nav>
    </header>
  );
}
