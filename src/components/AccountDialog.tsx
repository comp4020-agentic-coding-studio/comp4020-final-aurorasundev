import { useEffect, useRef, useState, type FormEvent } from "react";
import { recoverAccount, register, signIn, type SignedIn } from "../lib/api.ts";
import { errorMsg, useT, type Msg } from "../lib/i18n.ts";

// Signing in or creating an optional account (ADR 009), on the same paper
// sheet as the other dialogs. "offer" is the gentle suggestion after a
// guest's first Keep or third paper: it opens on Create account and can be
// declined. Accounts carry a username and a password only: no email. The
// way back from a forgotten password is the recovery code shown once after
// sign-up (and a new one after each reset), on this same sheet.
export type AccountView = "signin" | "register" | "offer";

type Props = {
  view: AccountView;
  // false when the server has accounts switched off
  available: boolean;
  onClose: () => void;
  onSignedIn: (account: SignedIn) => void;
};

type Step = "signin" | "register" | "recover";

export function AccountDialog({ view: initial, available, onClose, onSignedIn }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<Step>(initial === "signin" ? "signin" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Msg | null>(null);
  // signed in already, holding the code on screen until its owner saves it
  const [issued, setIssued] = useState<{ account: SignedIn; code: string; reset: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = useT();
  const creating = view === "register";
  const recovering = view === "recover";

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
      if (creating || recovering) {
        const { recovery_code, ...account } = creating
          ? await register(username.trim(), password)
          : await recoverAccount(username.trim(), code, password);
        setPassword("");
        setCode("");
        setIssued({ account, code: recovery_code, reset: recovering });
        setBusy(false);
      } else {
        onSignedIn(await signIn(username.trim(), password));
      }
    } catch (err) {
      setError(errorMsg(err, "That didn't reach the space. Try again."));
      setBusy(false);
    }
  }

  const switchTo = (next: Step) => {
    setView(next);
    setError(null);
  };

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
    } catch {
      // no clipboard here: the code stays on screen to write down
    }
  }

  // The account exists (or its password is reset) and this browser is
  // already signed in; the sheet stays until its owner says the code is
  // saved. Escape does nothing here: the code is never shown again.
  const finish = () => issued && onSignedIn(issued.account);

  const title = creating ? t("Keep an account") : recovering ? t("Forgot your password?") : t("Sign in");
  const principle =
    initial === "offer" && creating
      ? t("Want to find your papers again later? An account lets you come back to them from any browser.")
      : recovering
        ? t("Enter your username and the recovery code you saved when you created your account, then choose a new password.")
        : t("Only you can see your own papers and what they became. Everyone else still meets them anonymously.");
  const pending = creating ? t("Creating…") : recovering ? t("Changing…") : t("Signing in…");
  const action = creating ? t("Create account") : recovering ? t("Set new password") : t("Sign in");

  return (
    <dialog
      ref={dialogRef}
      className="dialog account-dialog"
      aria-labelledby="account-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!issued && !busy) onClose();
      }}
    >
      {issued ? (
        <div className="paper-sheet account-sheet">
          <h2 id="account-title" className="account-title">
            {issued.reset ? t("Your password is changed") : t("Your account is ready")}
          </h2>
          <p className="account-principle">
            {issued.reset
              ? t("Your old recovery code no longer works. Here is your new one.")
              : t("This is your recovery code. It is how you get back in if you forget your password.")}
          </p>
          <p className="account-label" id="recovery-label">
            {t("Recovery code")}
          </p>
          <p className="recovery-code" aria-labelledby="recovery-label" translate="no">
            {issued.code}
          </p>
          <p className="account-note recovery-warning">
            {t("Save it somewhere safe now. It is shown only this once, and there is no email to send it to you again.")}
          </p>
          <p className="account-switch">
            <button type="button" className="text-button" onClick={copy}>
              {copied ? t("Copied") : t("Copy the code")}
            </button>
          </p>
          <label className="choice choice-check recovery-saved">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span className="choice-label">{t("I have saved my recovery code.")}</span>
          </label>
          <div className="write-actions">
            <button type="button" className="button button-primary" onClick={finish} disabled={!saved}>
              {t("Done")}
            </button>
          </div>
        </div>
      ) : (
        <form className="paper-sheet account-sheet" onSubmit={submit}>
          <button type="button" className="sheet-close" onClick={onClose} disabled={busy}>
            {t("Close")}
          </button>
          <h2 id="account-title" className="account-title">
            {title}
          </h2>
          <p className="account-principle">{principle}</p>

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
              {recovering && (
                <>
                  <label className="account-label" htmlFor="account-recovery">
                    {t("Recovery code")}
                  </label>
                  <input
                    id="account-recovery"
                    className="account-input recovery-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={40}
                    readOnly={busy}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    required
                  />
                </>
              )}
              <label className="account-label" htmlFor="account-password">
                {recovering ? t("New password") : t("Password")}
              </label>
              <input
                id="account-password"
                className="account-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creating || recovering ? "new-password" : "current-password"}
                minLength={creating || recovering ? 8 : undefined}
                maxLength={128}
                readOnly={busy}
                required
              />
              {creating && (
                <p className="account-note">
                  {t("At least 8 characters. Once your account is made, you'll get a recovery code for a forgotten password.")}
                </p>
              )}
              {recovering && <p className="account-note">{t("At least 8 characters.")}</p>}
              {error && (
                <p className="form-error" role="alert">
                  {t.msg(error)}
                </p>
              )}
              <div className="write-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={recovering ? () => switchTo("signin") : onClose}
                  disabled={busy}
                >
                  {recovering ? t("Back to sign in") : initial === "offer" ? t("Not now") : t("Cancel")}
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || !username.trim() || !password || (recovering && !code.trim())}
                >
                  {busy ? pending : action}
                </button>
              </div>
              {view === "signin" && (
                <p className="account-switch">
                  <button type="button" className="text-button" onClick={() => switchTo("recover")} disabled={busy}>
                    {t("Forgot your password?")}
                  </button>
                </p>
              )}
              {!recovering && (
                <p className="account-switch">
                  {creating ? t("Already have an account?") : t("New here?")}{" "}
                  <button type="button" className="text-button" onClick={() => switchTo(creating ? "signin" : "register")} disabled={busy}>
                    {creating ? t("Sign in") : t("Create an account")}
                  </button>
                </p>
              )}
            </>
          )}
        </form>
      )}
    </dialog>
  );
}
