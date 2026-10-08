import { useEffect, useRef, useState } from "react";
import { ApiError, issueReturnKey, markReturnKeySaved, restoreIdentity } from "../lib/api.ts";

type Props = {
  // issue: right after a Keep, show this identity's key once.
  // restore: a returning visitor types theirs in (D05).
  variant: "issue" | "restore";
  onClose: () => void;
  onRestored: () => void;
};

type Issue = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; key: string };

export function ReturnKeyDialog({ variant, onClose, onRestored }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [issue, setIssue] = useState<Issue>({ kind: "loading" });
  const [copied, setCopied] = useState(false);
  const [entered, setEntered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const requestKey = () => {
    setIssue({ kind: "loading" });
    issueReturnKey()
      .then(({ return_key }) => setIssue({ kind: "ready", key: return_key }))
      .catch((err: Error) => setIssue({ kind: "error", message: err.message }));
  };

  useEffect(() => {
    if (variant === "issue") requestKey();
  }, [variant]);

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setError("Copying isn't available here. Select the key and copy it yourself.");
    }
  }

  async function saved() {
    setBusy(true);
    try {
      await markReturnKeySaved();
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    }
  }

  async function restore(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !entered.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await restoreIdentity(entered);
      setRestored(true);
      onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = variant === "issue" ? "Keep your return key" : "Return with your key";

  return (
    <dialog
      ref={dialogRef}
      className="dialog key-dialog"
      aria-labelledby="key-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form className="paper-sheet key-sheet" onSubmit={restore}>
        <button type="button" className="sheet-close" onClick={onClose} disabled={busy}>
          Close
        </button>
        <h2 id="key-title" className="key-title">
          {title}
        </h2>
        <p className="key-principle">A return key restores your rights, not your history.</p>

        {variant === "issue" && (
          <>
            {issue.kind === "loading" && <p className="read-status">Making your key…</p>}
            {issue.kind === "error" && (
              <div className="read-status" role="alert">
                <p>{issue.message}</p>
                <button type="button" className="button button-secondary" onClick={requestKey}>
                  Try again
                </button>
              </div>
            )}
            {issue.kind === "ready" && (
              <>
                <p className="key-label" id="return-key-label">
                  Your return key
                </p>
                {/* Text, not an input: it wraps at the dashes on a phone instead
                    of hiding part of the key behind a scroll. */}
                <p id="return-key" className="key-input key-value" aria-labelledby="return-key-label" tabIndex={0}>
                  {issue.key}
                </p>
                <p className="key-note">
                  It is shown only now. With it, another browser can let go of the papers you kept.
                </p>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="write-actions">
                  <button type="button" className="button button-secondary" onClick={() => copy(issue.key)}>
                    {copied ? "Copied" : "Copy key"}
                  </button>
                  <button type="button" className="button button-primary" onClick={saved} disabled={busy}>
                    I have saved it
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {variant === "restore" && !restored && (
          <>
            <label className="key-label" htmlFor="return-key">
              Your return key
            </label>
            <input
              id="return-key"
              className="key-input"
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              readOnly={busy}
              autoFocus
            />
            <p className="key-note">You will still need to encounter your papers naturally.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="write-actions">
              <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={busy || !entered.trim()}>
                {busy ? "Restoring…" : "Restore identity"}
              </button>
            </div>
          </>
        )}

        {variant === "restore" && restored && (
          <>
            <p className="key-note" role="status">
              Your rights are back on this browser. You will still need to encounter your papers naturally.
            </p>
            <div className="key-done">
              <button type="button" className="button button-primary" onClick={onClose} autoFocus>
                Back to the space
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
