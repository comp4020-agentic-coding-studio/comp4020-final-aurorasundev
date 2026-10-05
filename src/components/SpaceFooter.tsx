type Props = {
  total: number;
  onWrite: () => void;
  hidden: boolean;
};

const countLine = (total: number): string =>
  total === 0
    ? "No papers are here yet."
    : `${total} ${total === 1 ? "thing is" : "things are"} still here.`;

export function SpaceFooter({ total, onWrite, hidden }: Props) {
  return (
    <footer className="space-footer" hidden={hidden}>
      <p className="space-count" aria-live="polite">
        {countLine(total)}
      </p>
      <button type="button" className="button button-primary space-write" onClick={onWrite}>
        Leave something here
      </button>
      <p className="space-hint">
        <span>Open a paper.</span> <span>Leave something if you want to.</span>
      </p>
    </footer>
  );
}
