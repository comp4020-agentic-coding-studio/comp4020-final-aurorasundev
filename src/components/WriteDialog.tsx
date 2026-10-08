import { useEffect, useRef, useState } from "react";
import { ApiError, countCodePoints, createPaper, MAX_CODE_POINTS, type Created } from "../lib/api.ts";

type Props = {
  onCancel: () => void;
  onThrown: (created: Created) => void;
  // keys being saved here, so the page knows its own paper's SSE echo
  pendingOps: Set<string>;
  // no live connection: saving waits rather than pretending
  offline: boolean;
};

const formatCount = (n: number): string => n.toLocaleString("en-AU");

export function WriteDialog({ onCancel, onThrown, pendingOps, offline }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per distinct text: a retry of the same words reuses it, so the
  // server can recognise it; changing the words makes it a new submission.
  const submission = useRef<{ text: string; key: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const count = countCodePoints(text);
  const blank = text.trim() === "";
  const tooLong = count > MAX_CODE_POINTS;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || blank || tooLong || offline) return;
    if (submission.current?.text !== text) submission.current = { text, key: crypto.randomUUID() };
    const key = submission.current.key;
    setSaving(true);
    setError(null);
    pendingOps.add(key);
    try {
      const result = await createPaper(text, key);
      onThrown(result);
    } catch (err) {
      setSaving(false);
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't confirm it was saved. Try again: it won't be left twice.",
      );
    } finally {
      pendingOps.delete(key);
    }
  }

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
            readOnly={saving}
            aria-describedby="write-count write-notice"
            autoFocus
          />
          <span id="write-count" className={`write-count${tooLong ? " is-over" : ""}`}>
            {formatCount(count)} / {formatCount(MAX_CODE_POINTS)}
          </span>
        </div>
        <p id="write-notice" className="write-notice">
          This paper will be readable by strangers.
          <br />
          Once thrown, it cannot be edited or retrieved from a personal history.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="write-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={saving || blank || tooLong || offline}>
            {saving ? "Saving…" : offline ? "Reconnecting…" : "Crumple & throw"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
