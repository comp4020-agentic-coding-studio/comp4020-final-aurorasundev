import { useEffect, useRef, useState, type FormEvent } from "react";
import { register, signIn, type SignedIn } from "../lib/api.ts";
import { errorMsg, useT, type Msg } from "../lib/i18n.ts";

// Signing in or creating an optional account (ADR 009), on the same paper
// sheet as the other dialogs. "offer" is the gentle suggestion after a
// guest's first Keep or third paper: it opens on Create account and can be
// declined. Accounts carry a username and a password only: no email.
export type AccountView = "signin" | "register" | "offer";

type Props = {
  view: AccountView;
  // false when the server has accounts switched off
  available: boolean;
  onClose: () => void;
  onSignedIn: (account: SignedIn) => void;
};

export function AccountDialog({ view: initial, available, onClose, onSignedIn }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"signin" | "register">(initial === "signin" ? "signin" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Msg | null>(null);
  const t = useT();
  const creating = view === "register";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const account = await (creating ? register : signIn)(username.trim(), password);
      onSignedIn(account);
    } catch (err) {
      setError(errorMsg(err, "That didn't reach the space. Try again."));
      setBusy(false);
    }
  }

  const switchTo = (next: "signin" | "register") => {
    setView(next);
    setError(null);
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog account-dialog"
      aria-labelledby="account-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form className="paper-sheet account-sheet" onSubmit={submit}>
        <button type="button" className="sheet-close" onClick={onClose} disabled={busy}>
          {t("Close")}
        </button>
        <h2 id="account-title" className="account-title">
          {creating ? t("Keep an account") : t("Sign in")}
        </h2>
        <p className="account-principle">
          {initial === "offer" && creating
            ? t("Want to find your papers again later? An account lets you come back to them from any browser.")
            : t("Only you can see your own papers and what they became. Everyone else still meets them anonymously.")}
        </p>

        {!available ? (
          <>
            <p className="account-note" role="status">
              {t("Accounts aren't available right now. You can keep using Throwaway as a guest.")}
            </p>
            <div className="account-done">
              <button type="button" className="button button-primary" onClick={onClose} autoFocus>
                {t("Back to the space")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="account-label" htmlFor="account-username">
              {t("Username")}
            </label>
            <input
              id="account-username"
              className="account-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              readOnly={busy}
              required
              autoFocus
            />
            {creating && <p className="account-note">{t("3–24 letters, numbers, hyphens or underscores. Only you will see it.")}</p>}
            <label className="account-label" htmlFor="account-password">
              {t("Password")}
            </label>
            <input
              id="account-password"
              className="account-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={creating ? "new-password" : "current-password"}
              minLength={creating ? 8 : undefined}
              maxLength={128}
              readOnly={busy}
              required
            />
            {creating && (
              <p className="account-note">
                {t("At least 8 characters. There's no password recovery yet, so keep it somewhere safe.")}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {t.msg(error)}
              </p>
            )}
            <div className="write-actions">
              <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
                {initial === "offer" ? t("Not now") : t("Cancel")}
              </button>
              <button type="submit" className="button button-primary" disabled={busy || !username.trim() || !password}>
                {busy ? (creating ? t("Creating…") : t("Signing in…")) : creating ? t("Create account") : t("Sign in")}
              </button>
            </div>
            <p className="account-switch">
              {creating ? t("Already have an account?") : t("New here?")}{" "}
              <button type="button" className="text-button" onClick={() => switchTo(creating ? "signin" : "register")} disabled={busy}>
                {creating ? t("Sign in") : t("Create an account")}
              </button>
            </p>
          </>
        )}
      </form>
    </dialog>
  );
}
