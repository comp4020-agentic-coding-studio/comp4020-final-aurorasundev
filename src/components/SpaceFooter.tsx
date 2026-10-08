import { countLine } from "../lib/space.ts";

type Props = {
  total: number;
  onWrite: () => void;
  // the keyboard (and no-WebGL) way to do what dragging the floor does
  onExplore: () => void;
  exploring: boolean;
  // reading or writing: the count stays, the main action steps aside
  busy: boolean;
  reconnecting: boolean;
};

export function SpaceFooter({ total, onWrite, onExplore, exploring, busy, reconnecting }: Props) {
  return (
    <footer className={`space-footer${busy ? " is-busy" : ""}`}>
      <p className="space-count" aria-live="polite">
        {countLine(total)}
      </p>
      {/* Hidden rather than unmounted, so focus can come back to it. */}
      <button type="button" className="button button-primary space-write" onClick={onWrite} hidden={busy}>
        Leave something here
      </button>
      {(!busy || reconnecting) && (
        <div className="space-side">
          <p className="space-hint" role="status">
            {reconnecting ? (
              "Reconnecting…"
            ) : (
              <>
                <span>Open a paper.</span> <span>Leave something if you want to.</span>
              </>
            )}
          </p>
          {!busy && total > 0 && (
            <button type="button" className="text-button space-explore" onClick={onExplore} disabled={exploring}>
              Explore the space
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
