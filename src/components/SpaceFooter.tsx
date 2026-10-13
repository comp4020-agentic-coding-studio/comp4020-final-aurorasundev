type Props = {
  onWrite: () => void;
  // the keyboard (and no-WebGL) way to do what dragging the floor does
  onExplore: () => void;
  exploring: boolean;
  // more papers exist than fit on screen, so exploring can show new ones
  canExplore: boolean;
  // reading or writing: the main action steps aside
  busy: boolean;
  reconnecting: boolean;
};

export function SpaceFooter({ onWrite, onExplore, exploring, canExplore, busy, reconnecting }: Props) {
  return (
    <footer className={`space-footer${busy ? " is-busy" : ""}`}>
      {/* Hidden rather than unmounted, so focus can come back to it. */}
      <button type="button" className="button button-primary space-write" onClick={onWrite} hidden={busy}>
        Leave something here
      </button>
      {(!busy || reconnecting) && (
        <p className="space-hint" role="status">
          {reconnecting ? "Reconnecting…" : "Open a paper. Leave something if you want to."}
        </p>
      )}
      {!busy && canExplore && (
        <button type="button" className="text-button space-explore" onClick={onExplore} disabled={exploring}>
          Explore the space
        </button>
      )}
    </footer>
  );
}
