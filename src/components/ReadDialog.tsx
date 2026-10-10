import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  countCodePoints,
  getPaper,
  MAX_REPORT_NOTE,
  reportPaper,
  witnessPaper,
  type OpenedPaper,
  type PaperState,
  type ReportReason,
  type SafetyConfig,
} from "../lib/api.ts";
import type { PaperStatus } from "../lib/space.ts";
import type { SheetRect } from "./PaperField.tsx";

export type Ended = Exclude<PaperStatus, "active">;

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "threats_abuse", label: "Threats or targeted abuse" },
  { value: "private_information", label: "Private information" },
  { value: "sexual_graphic", label: "Sexual or graphic content" },
  { value: "harmful_instructions", label: "Harmful instructions" },
  { value: "spam_scam", label: "Spam or scam" },
  { value: "something_else", label: "Something else" },
];

const REPORTED = "Report received. It will be checked against the space's safety rules.";

type Props = {
  safety: SafetyConfig | null;
  id: string;
  // false while the paper is still unfolding: the words wait for a flat sheet
  revealed: boolean;
  // where the unfolded 3D sheet sits on screen; null means no scene to sit on
  rect: SheetRect | null;
  // the newest version the live stream has announced for this paper
  liveVersion: number;
  // set when the paper left the shared space while open here
  ended: Ended | null;
  // the live stream is down: what this sheet shows may be out of date
  reconnecting: boolean;
  // "Release it": prepares the furnace ritual with this reading's receipt.
  // Nothing is sent yet; the drop into the furnace is the confirmation.
  onRelease: (receipt: string) => void;
  // this reader may let it go: worth fetching the fire ahead of time
  onReleasable: () => void;
  onEnded: (why: Ended) => void;
  onClose: () => void;
};

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; paper: OpenedPaper };

// The reading sheet sits over the unfolded 3D sheet, a little wider for the
// text. On a phone that sheet projects too short to read more than a few
// lines (M03), so it grows to a readable height around the same centre,
// staying clear of the header above and the count below.
const SHEET_MIN = 620;
const CLEAR_TOP = 108;
const CLEAR_BOTTOM = 80;

function sheetBox(rect: SheetRect): { left: number; top: number; width: number; height: number } {
  const width = Math.min(rect.width * 1.2, window.innerWidth - 24);
  const height = Math.max(rect.height, Math.min(SHEET_MIN, window.innerHeight - CLEAR_TOP - CLEAR_BOTTOM));
  const centred = rect.top + rect.height / 2 - height / 2;
  const top = height === rect.height ? rect.top : Math.max(CLEAR_TOP, Math.min(centred, window.innerHeight - CLEAR_BOTTOM - height));
  return { left: rect.left - (width - rect.width) / 2, top, width, height };
}

export const witnessLine = (n: number): string | null =>
  n === 0 ? null : `${n.toLocaleString("en-AU")} ${n === 1 ? "person has" : "people have"} witnessed this.`;

export function ReadDialog({ id, revealed, rect, liveVersion, ended, reconnecting, onRelease, onReleasable, onEnded, onClose, safety }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [view, setView] = useState<"read" | "report">("read");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [reported, setReported] = useState(false);
  // one key per report attempt, kept across retries so a lost reply can't
  // file it twice
  const reportKey = useRef<string | null>(null);
  const reportDraft = useRef<{ reason: ReportReason; note: string; key: string } | null>(null);
  const [unsettledReport, setUnsettledReport] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Once the paper has left the space, no late answer may bring it back.
  const endedRef = useRef(ended);
  endedRef.current = ended;

  // Never let an older answer overwrite a newer one, whichever arrives last.
  const merge = useCallback((state: PaperState, content?: { content: string; read_receipt: string | null }) => {
    if (endedRef.current) return;
    setLoad((current) => {
      if (current.kind !== "ready") return content ? { kind: "ready", paper: { ...state, ...content } } : current;
      if (state.version < current.paper.version) return current;
      return { kind: "ready", paper: { ...current.paper, ...state, ...(content ?? {}) } };
    });
  }, []);

  const fetchPaper = useCallback(() => {
    let live = true;
    getPaper(id)
      .then((paper) => live && merge(paper, { content: paper.content, read_receipt: paper.read_receipt }))
      .catch((err: Error) => {
        if (!live || endedRef.current) return;
        if (err instanceof ApiError && err.status === 404) setLoad((c) => (c.kind === "ready" ? c : { kind: "missing" }));
        else setLoad((c) => (c.kind === "ready" ? c : { kind: "error", message: err.message }));
      });
    return () => {
      live = false;
    };
  }, [id, merge]);

  useEffect(fetchPaper, [fetchPaper]);

  // Someone else witnessed it: refresh this reading's state (count, rights).
  const heldVersion = load.kind === "ready" ? load.paper.version : null;
  useEffect(() => {
    if (heldVersion !== null && liveVersion > heldVersion && !ended) return fetchPaper();
  }, [liveVersion, heldVersion, ended, fetchPaper]);

  // A quarantined paper's words go at once; a destroyed one stays readable
  // here until closed, if they had already arrived.
  useEffect(() => {
    if (ended === "quarantined") setLoad({ kind: "missing" });
    else if (ended) setLoad((c) => (c.kind === "ready" ? c : { kind: "missing" }));
    if (ended) setView("read");
  }, [ended]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function sawIt() {
    if (load.kind !== "ready" || !load.paper.read_receipt || acting) return;
    setActing(true);
    setActionError(null);
    try {
      merge(await witnessPaper(id, load.paper.read_receipt));
    } catch (err) {
      if (err instanceof ApiError && err.code === "paper_gone") onEnded("destroyed");
      else setActionError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    } finally {
      setActing(false);
    }
  }

  function release() {
    if (load.kind !== "ready" || !load.paper.read_receipt || !load.paper.viewer.can_burn || acting) return;
    onRelease(load.paper.read_receipt);
  }

  function startReport() {
    reportKey.current ??= crypto.randomUUID();
    if (!unsettledReport) setActionError(null);
    setView("report");
  }

  // Reporting is not acknowledging: it counts nothing, grants nothing and
  // changes nothing about the paper here. The server queues a check.
  async function sendReport(event: React.FormEvent) {
    event.preventDefault();
    if (load.kind !== "ready" || !load.paper.read_receipt || !reason || !reportKey.current || acting) return;
    setActing(true);
    setActionError(null);
    try {
      if (!unsettledReport) reportDraft.current = { reason, note, key: reportKey.current };
      const draft = reportDraft.current!;
      await reportPaper(id, load.paper.read_receipt, draft.reason, draft.note, draft.key);
      setUnsettledReport(false);
      setReported(true);
      setView("read");
    } catch (err) {
      if (err instanceof ApiError && err.code === "paper_gone") onEnded("destroyed");
      else if (err instanceof ApiError && err.status < 500) {
        setUnsettledReport(false);
        setActionError(err.message);
      } else {
        setUnsettledReport(true);
        setActionError("We couldn't confirm your report was received. Try again: it won't be sent twice.");
      }
    } finally {
      setActing(false);
    }
  }

  const noteCount = countCodePoints(note);
  const box = rect ? sheetBox(rect) : null;
  const paper = load.kind === "ready" ? load.paper : null;
  const count = paper ? witnessLine(paper.witness_count) : null;
  const finalReading = !!ended && ended !== "quarantined" && !!paper;
  const goneText = ended === "quarantined" ? "This paper is no longer available." : "This paper is no longer here.";
  // Keep: only its author sees the action at all. Release: everyone sees it,
  // usable once they have witnessed the paper (the author by the same rule).
  const showBurn = paper && (paper.mode === "release" || paper.viewer.is_author);
  const releasable = !!paper && !ended && !!showBurn && paper.viewer.can_burn;
  useEffect(() => {
    if (releasable) onReleasable();
  }, [releasable, onReleasable]);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog read-dialog${revealed ? " is-revealed" : ""}${rect ? " over-scene" : ""}${finalReading ? " is-final" : ""}`}
      style={box ? { ...box, margin: 0 } : undefined}
      aria-label="A paper someone left"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <article className="paper-sheet read-sheet">
        <button type="button" className="sheet-close" onClick={onClose} autoFocus>
          Close
        </button>
        {paper && !ended && view === "report" ? (
          <form className="read-report" onSubmit={sendReport} aria-labelledby="report-title">
            <div className="read-body" tabIndex={0}>
              <h2 id="report-title" className="read-report-title">
                Report this paper
              </h2>
              <p className="read-report-lead">
                Reporting starts an automated check. It does not give you permission to destroy this paper.
              </p>
              <fieldset className="report-reasons" disabled={acting || unsettledReport}>
                <legend>What concerns you?</legend>
                {REASONS.map((r) => (
                  <label key={r.value} className="choice">
                    <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                    <span className="choice-label">{r.label}</span>
                  </label>
                ))}
              </fieldset>
              <label className="report-note-label" htmlFor="report-note">
                Anything to add? (optional)
              </label>
              <p id="report-note-hint" className="report-note-hint">
                Don't add names, contact details or anything private.
              </p>
              <textarea
                id="report-note"
                className="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                readOnly={acting || unsettledReport}
                aria-describedby="report-note-hint report-note-count"
                rows={3}
              />
              <p id="report-note-count" className={`report-note-count${noteCount > MAX_REPORT_NOTE ? " is-over" : ""}`}>
                {noteCount.toLocaleString("en-AU")} / {MAX_REPORT_NOTE}
              </p>
            </div>
            <div className="read-foot">
              <p className="read-report-caveat">The paper is only removed from the space if the check requires it.</p>
              {reconnecting && <p className="read-reconnecting">Reconnecting… wait a moment before sending.</p>}
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
              <div className="read-actions">
                <button type="button" className="button button-secondary" onClick={() => setView("read")} disabled={acting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={!reason || noteCount > MAX_REPORT_NOTE || acting || reconnecting || !paper.read_receipt}
                >
                  {acting ? "Sending…" : unsettledReport ? "Try again" : "Send report"}
                </button>
              </div>
            </div>
          </form>
        ) : (
        <div className="read-body" tabIndex={0}>
          {load.kind === "loading" && <p className="read-status">Opening paper…</p>}
          {load.kind === "missing" && <p className="read-status">{goneText}</p>}
          {load.kind === "error" && (
            <div className="read-status" role="alert">
              <p>This paper couldn't be opened. {load.message}</p>
              <button type="button" className="button button-secondary" onClick={fetchPaper}>
                Try again
              </button>
            </div>
          )}
          {paper && <p className="read-text">{paper.content}</p>}
        </div>
        )}

        {finalReading && (
          <div className="read-foot read-final" role="status">
            <p className="read-final-title">This was let go while you were holding it.</p>
            <p className="read-final-note">You may finish reading. Once you close it, it is gone.</p>
          </div>
        )}

        {paper && !ended && view === "read" && (
          <div className="read-foot">
            {count && <p className="read-count">{count}</p>}
            {/* While the stream is down the count and rights may be stale, so
                nothing here claims a fresh success until it is back. */}
            {reconnecting && (
              <p className="read-reconnecting" role="status">
                Reconnecting… this paper's details will catch up.
              </p>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            {reported && (
              <p className="read-reported" role="status">
                {REPORTED}
              </p>
            )}
            <div className="read-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={sawIt}
                disabled={paper.viewer.has_witnessed || acting || !paper.read_receipt || reconnecting}
              >
                {paper.viewer.has_witnessed ? "Witnessed" : "I saw it"}
              </button>
              {showBurn && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={release}
                  disabled={!paper.viewer.can_burn || !paper.read_receipt || acting || reconnecting}
                >
                  Release it
                </button>
              )}
            </div>
            <div className="read-meta">
              <p className="read-origin">{paper.viewer.is_author ? "You left this here." : "Someone left this here."}</p>
              {safety?.reports && !reported && (
                <button type="button" className="text-button read-report-link" onClick={startReport} disabled={acting}>
                  Report this paper
                </button>
              )}
            </div>
          </div>
        )}

      </article>
    </dialog>
  );
}
