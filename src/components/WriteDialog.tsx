import { useEffect, useRef, useState } from "react";
import { ApiError, countCodePoints, createPaper, MAX_CODE_POINTS, type Created, type PaperMode, type SafetyConfig } from "../lib/api.ts";

type Props = {
  safety: SafetyConfig | null;
  safetyLoading?: boolean;
  onRetrySafety?: () => void;
  onCancel: () => void;
  onThrown: (created: Created) => void;
  // keys being saved here, so the page knows its own paper's SSE echo
  pendingOps: Set<string>;
  // no live connection: saving waits rather than pretending
  offline: boolean;
};

const formatCount = (n: number): string => n.toLocaleString("en-AU");

// Server answers that mean nothing was saved, even though they are 5xx.
const SETTLED = new Set(["moderation_unavailable"]);

export function WriteDialog({ onCancel, onThrown, pendingOps, offline, safety, safetyLoading = false, onRetrySafety }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<PaperMode | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a save's outcome is unknown (the reply never came). The words and
  // the choice are then held as sent until a retry with the same key tells us
  // what happened; a new key would only guess, and could save it twice.
  const [unsettled, setUnsettled] = useState(false);
  const submission = useRef<{ text: string; mode: PaperMode; key: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const count = countCodePoints(text);
  const blank = text.trim() === "";
  const tooLong = count > MAX_CODE_POINTS;
  const locked = saving || unsettled;
  const ready = !blank && !tooLong && mode !== null && confirmed && !offline && !!safety?.provider;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !ready || mode === null) return;
    const same = submission.current && submission.current.text === text && submission.current.mode === mode;
    if (!same) submission.current = { text, mode, key: crypto.randomUUID() };
    const key = submission.current!.key;
    setSaving(true);
    setError(null);
    pendingOps.add(key);
    try {
      const result = await createPaper(text, mode, key);
      onThrown(result);
    } catch (err) {
      setSaving(false);
      // A refusal, or a check that couldn't run, is a definite "not saved":
      // the draft stays editable. Only an unknown outcome locks it.
      if (err instanceof ApiError && (err.status < 500 || SETTLED.has(err.code))) {
        setUnsettled(false);
        setError(err.message);
      } else {
        setUnsettled(true);
        setError("We couldn't confirm it was saved. Try again: it won't be left twice.");
      }
    } finally {
      pendingOps.delete(key);
    }
  }

  // Saving includes the automated safety check, which is most of the wait.
  const savingLabel = "Checking this paper…";
  const submitLabel = saving ? savingLabel : offline ? "Reconnecting…" : unsettled ? "Try again" : "Crumple & throw";

  return (
    <dialog
      ref={dialogRef}
      className="dialog write-dialog"
      aria-labelledby="write-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <form className="paper-sheet write-sheet" onSubmit={submit}>
        <button type="button" className="sheet-close" onClick={onCancel} disabled={saving}>
          Close
        </button>
        <h2 id="write-title" className="write-title">
          What are you ready to put down?
        </h2>
        <div className="write-field">
          <label htmlFor="paper-text" className="visually-hidden">
            Your paper
          </label>
          <textarea
            id="paper-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write something you have been carrying."
            readOnly={locked}
            aria-describedby="write-count"
            autoFocus
          />
          <span id="write-count" className={`write-count${tooLong ? " is-over" : ""}`}>
            {formatCount(count)} / {formatCount(MAX_CODE_POINTS)}
          </span>
        </div>

        <fieldset className="write-modes" disabled={locked}>
          <legend>Choose how to leave it</legend>
          <label className="choice">
            <input type="radio" name="mode" value="KEEP" checked={mode === "KEEP"} onChange={() => setMode("KEEP")} />
            <span>
              <span className="choice-label">Keep it</span>
              <span className="choice-hint">Only you may destroy it if you encounter it again.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="mode" value="RELEASE" checked={mode === "RELEASE"} onChange={() => setMode("RELEASE")} />
            <span>
              <span className="choice-label">Release it</span>
              <span className="choice-hint">Its fate is no longer yours to control.</span>
            </span>
          </label>
        </fieldset>

        <p className="write-disclosure" id="write-disclosure" role={!safety?.provider ? "status" : undefined}>
          {safety?.provider === "openai"
            ? "Before it enters the space, your text is sent to OpenAI for automated safety checks. Do not include private details. "
            : safety?.provider === "fixture"
              ? "Automated safety checks run before this paper enters the space. "
              : "Safety checks are unavailable. Your words stay here until checks can run. "}
          <a href="/readme/">How checks work</a>
          {!safety?.provider && onRetrySafety && <> {" "}<button type="button" className="text-button" onClick={onRetrySafety} disabled={safetyLoading}>
            {safetyLoading ? "Connecting to checks…" : "Retry checks"}
          </button></>}
        </p>

        <label className="choice choice-check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={locked} />
          <span>I understand: once thrown, this paper cannot be edited or found in a personal history.</span>
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saving && (
          <p className="visually-hidden" role="status">
            {savingLabel}
          </p>
        )}
        <div className="write-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={saving || !ready}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
