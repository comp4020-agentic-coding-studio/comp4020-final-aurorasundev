import { useEffect, useRef, useState } from "react";
import type { ArtifactReportReason, PublicArtifact } from "../lib/gallery-api.ts";
import type { ReportState } from "../lib/useGallery.ts";

// One object, larger, in a native dialog: the image, its generic caption, and
// a way to report it. Nothing here can lead back to a paper.

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
  onReport: (reason: ArtifactReportReason) => void;
  onClose: () => void;
};

export function ArtifactDialog({ artifact, report, frozenReason, onReport, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"look" | "report">(report.kind === "unsettled" ? "report" : "look");
  const [reason, setReason] = useState<ArtifactReportReason | null>(frozenReason);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    // the dialog itself takes focus, not the close cross, so no ring shows
    // until the visitor moves with the keyboard
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  const locked = report.kind === "sending" || report.kind === "unsettled";
  const chosen = frozenReason ?? reason;

  return (
    <dialog
      ref={dialogRef}
      className="dialog artifact-dialog"
      aria-labelledby="artifact-title"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // a click on the backdrop closes, like Escape
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="artifact-sheet">
        <button type="button" className="sheet-close sheet-close-icon artifact-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {view === "look" ? (
          <>
            <div className="artifact-frame">
              {failed ? (
                <p className="artifact-missing">This image could not be shown.</p>
              ) : (
                <img
                  className="artifact-image"
                  src={artifact.image_url}
                  alt={artifact.alt}
                  width={artifact.width}
                  height={artifact.height}
                  decoding="async"
                  onError={() => setFailed(true)}
                />
              )}
            </div>
            <div className="artifact-foot">
              <h2 id="artifact-title" className="artifact-title">
                {artifact.title}
              </h2>
              {report.kind === "received" ? (
                <p className="artifact-note" role="status">
                  Report received. It will be reviewed.
                </p>
              ) : (
                <button type="button" className="text-button artifact-report-link" onClick={() => setView("report")}>
                  Report this object
                </button>
              )}
            </div>
          </>
        ) : (
          <form
            className="artifact-report"
            aria-labelledby="artifact-report-title"
            onSubmit={(e) => {
              e.preventDefault();
              if (chosen) onReport(chosen);
            }}
          >
            <h2 id="artifact-report-title" className="artifact-title">
              Report this object
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
              <p className="artifact-note" role="status">
                Report received. It will be reviewed.
              </p>
            )}
            <div className="artifact-report-actions">
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
    </dialog>
  );
}
