import { useEffect, useRef, useState } from "react";
import type { ArtifactReportReason, PublicArtifact } from "../lib/gallery-api.ts";
import type { ReportState } from "../lib/useGallery.ts";

// One record, opened (G02): the complete square image in its sleeve beside
// the record, the generic title and a way to report it, in a native modal
// dialog. The text is HTML. Nothing here can lead back to a paper, and the
// player slot is honest: records are image-only until sound is generated
// and checked, so nothing pretends to play.

const REASONS: { value: ArtifactReportReason; label: string }[] = [
  { value: "threats_abuse", label: "Threats or targeted abuse" },
  { value: "private_information", label: "Private information" },
  { value: "sexual_graphic", label: "Sexual or graphic content" },
  { value: "harmful_instructions", label: "Harmful instructions" },
  { value: "spam_scam", label: "Spam or scam" },
  { value: "something_else", label: "Something else" },
];

type Props = {
  artifact: PublicArtifact;
  report: ReportState;
  // a reason held from an unsettled send, which a retry must reuse
  frozenReason: ArtifactReportReason | null;
  // the orbit is carrying the sleeve forward; the HTML takes over after it
  arriving: boolean;
  canStep: boolean;
  onStep: (dir: 1 | -1) => void;
  onReport: (reason: ArtifactReportReason) => void;
  onClose: () => void;
};

export function RecordView({ artifact, report, frozenReason, arriving, canStep, onStep, onReport, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"look" | "report">(report.kind === "unsettled" ? "report" : "look");
  const [reason, setReason] = useState<ArtifactReportReason | null>(frozenReason);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    // the dialog itself takes focus, so no ring shows until the keyboard moves
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  // a different record (the arrows) starts at its image again
  useEffect(() => {
    setFailed(false);
    setView(report.kind === "unsettled" ? "report" : "look");
    setReason(frozenReason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  const locked = report.kind === "sending" || report.kind === "unsettled";
  const chosen = frozenReason ?? reason;

  return (
    <dialog
      ref={dialogRef}
      className={`record-dialog${arriving ? " is-arriving" : ""}`}
      aria-labelledby="record-title"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (view !== "look" || !canStep || e.target instanceof HTMLInputElement) return;
        if (e.key === "ArrowLeft") onStep(-1);
        if (e.key === "ArrowRight") onStep(1);
      }}
    >
      <div className="record-frame">
        <div className="records-header record-header-copy">
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
        </div>
        <button type="button" className="record-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M20 12H4M10 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the Gallery
        </button>
        <button type="button" className="record-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <div className="record-art sleeve">
          {failed ? (
            <p className="record-missing">This image could not be shown.</p>
          ) : (
            <img
              className="sleeve-image"
              src={artifact.image_url}
              alt={artifact.alt}
              width={artifact.width}
              height={artifact.height}
              decoding="async"
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <div className="record-disc vinyl" aria-hidden="true">
          {!failed && <img className="vinyl-label" src={artifact.image_url} alt="" decoding="async" />}
          <span className="vinyl-hole" />
        </div>

        <div className="record-text">
          {view === "look" ? (
            <>
              <h2 id="record-title" className="record-title">
                {artifact.title}
              </h2>
              <p className="record-lede">An image shaped by a released note.</p>
              <p className="record-lede">The original note is gone.</p>
              <p className="record-credit">AI-generated image</p>

              <div className="record-player" role="group" aria-label="Sound">
                <button type="button" className="player-button" disabled aria-describedby="player-note">
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
                  </svg>
                  <span className="visually-hidden">Listen</span>
                </button>
                <p className="player-note" id="player-note">
                  There is no sound for this record yet.
                </p>
              </div>

              {report.kind === "received" ? (
                <p className="record-note" role="status">
                  Report received. It will be reviewed.
                </p>
              ) : (
                <button type="button" className="record-report-link" onClick={() => setView("report")}>
                  Report this record
                </button>
              )}
            </>
          ) : (
            <form
              className="record-report"
              aria-labelledby="record-report-title"
              onSubmit={(e) => {
                e.preventDefault();
                if (chosen) onReport(chosen);
              }}
            >
              <h2 id="record-report-title" className="record-report-title">
                Report this record
              </h2>
              <fieldset className="report-reasons" disabled={locked}>
                <legend>What is wrong with it?</legend>
                {REASONS.map((r) => (
                  <label key={r.value} className="choice">
                    <input type="radio" name="artifact-reason" value={r.value} checked={chosen === r.value} onChange={() => setReason(r.value)} />
                    <span className="choice-label">{r.label}</span>
                  </label>
                ))}
              </fieldset>
              {(report.kind === "unsettled" || report.kind === "refused") && (
                <p className="form-error" role="alert">
                  {report.message}
                </p>
              )}
              {report.kind === "received" && (
                <p className="record-note" role="status">
                  Report received. It will be reviewed.
                </p>
              )}
              <div className="record-report-actions">
                <button type="button" className="button button-secondary" onClick={() => setView("look")}>
                  {report.kind === "received" ? "Back" : "Cancel"}
                </button>
                {report.kind !== "received" && (
                  <button type="submit" className="button button-primary" disabled={!chosen || report.kind === "sending"}>
                    {report.kind === "sending" ? "Sending…" : report.kind === "unsettled" ? "Try again" : "Send report"}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>

        {canStep && (
          <div className="record-steps">
            <button type="button" className="record-step" aria-label="Previous record" onClick={() => onStep(-1)}>
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M20 12H4M10 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="record-step" aria-label="Next record" onClick={() => onStep(1)}>
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M4 12h16M14 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
