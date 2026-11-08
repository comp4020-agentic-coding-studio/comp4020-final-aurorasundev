import { Router, type Request, type Response } from "express";
import { publicArtifact } from "./artifacts/store.ts";
import type { DB } from "./db.ts";
import { clientAddress, windowCounter } from "./address.ts";
import { log, person } from "./log.ts";
import { burnDecoy, hashPassword, pepperFingerprint, pepperFrom, verifyPassword } from "./password.ts";
import { endSession, identityFor, rotateSession } from "./session.ts";

// Optional accounts (ADR 009): a username and password attached to an
// anonymous identity, so a person can find their own papers again from
// another browser. Nothing here is ever public: the username is shown only
// to its owner, and the private lists never reach the shared space, the
// Gallery or any event. Logs carry the person, never the username.

export const USERNAME = /^[\p{L}\p{N}_-]{3,24}$/u;
export const PASSWORD_LENGTH = [8, 128] as const;
const EXCERPT_CHARS = 80;

const usernameOf = (raw: unknown): { name: string; key: string } | null => {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim();
  return USERNAME.test(name) ? { name, key: name.toLowerCase() } : null;
};

const passwordProblem = (password: unknown, name: string): string | null => {
  if (typeof password !== "string") return "Choose a password.";
  const length = [...password].length;
  if (length < PASSWORD_LENGTH[0]) return "Use at least 8 characters for your password.";
  if (length > PASSWORD_LENGTH[1]) return "Use at most 128 characters for your password.";
  if (password.normalize("NFKC").toLowerCase() === name.toLowerCase()) return "Your password can't be your username.";
  return null;
};

type AccountRow = { identity_id: string; username: string; password_hash: string };

const accountFor = (db: DB, identityId: string): AccountRow | undefined =>
  db.prepare("SELECT identity_id, username, password_hash FROM accounts WHERE identity_id = ?").get(identityId) as AccountRow | undefined;

// In memory, like the other abuse limits. Only failures count, so people
// sharing an address (a campus, a café) can still sign in and sign up. A
// username locks after 10 wrong passwords in 15 minutes whichever address
// they come from; an address after 50, so one address can't sweep many
// names. Account creation is capped per address against bulk sign-ups.
export const LIMITS = { nameFailures: 10, addressFailures: 50, creations: 30 } as const;

const unauthenticated = { code: "unauthenticated", error: "Your session has expired. Reload the page and try again." };
const unconfigured = { code: "accounts_unconfigured", error: "Accounts aren't available right now. You can keep using Throwaway as a guest." };
const wrong = { code: "invalid_credentials", error: "Username or password is incorrect." };
const tooMany = { code: "rate_limited", error: "Too many tries. Wait a few minutes and try again." };

// The papers a person left that are still here: enough to recognise each
// one, never a witness count, a reader or any other paper.
function ownPapers(db: DB, identityId: string) {
  const rows = db
    .prepare(
      `SELECT id, mode, content, drawing IS NOT NULL AS has_drawing, created_at FROM papers
       WHERE owner_identity_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC`,
    )
    .all(identityId) as { id: string; mode: string; content: string; has_drawing: number; created_at: string }[];
  return rows.map((row) => {
    const chars = [...row.content.trim()];
    const excerpt = chars.slice(0, EXCERPT_CHARS).join("") + (chars.length > EXCERPT_CHARS ? "…" : "");
    return { id: row.id, mode: row.mode.toLowerCase(), excerpt, has_drawing: row.has_drawing === 1, created_at: row.created_at };
  });
}

// The published records this person's Release papers became, in exactly the
// public shape the Gallery serves: the private link is the database's own
// (paper → job → record) and never leaves this reply.
function ownRecords(db: DB, identityId: string, musicEnabled: boolean) {
  const rows = db
    .prepare(
      `SELECT a.id, a.version, a.title, a.alt, a.music_score, a.published_at FROM artifacts a
       JOIN artifact_jobs j ON j.id = a.job_id
       JOIN papers p ON p.id = j.paper_id
       WHERE p.owner_identity_id = ? AND a.status = 'PUBLISHED' ORDER BY a.published_at DESC`,
    )
    .all(identityId) as Parameters<typeof publicArtifact>[0][];
  return rows.map((row) => publicArtifact(row, musicEnabled));
}

// Signing in from a browser that was a guest: whatever that guest left moves
// to the account, so nothing written before signing in is stranded. The
// account then counts as the author of those papers, so its own witness on
// them stops counting, as an author's never does.
function adoptGuest(db: DB, guestId: string, accountId: string): number {
  const moved = db.prepare("UPDATE papers SET owner_identity_id = ? WHERE owner_identity_id = ?").run(accountId, guestId).changes;
  if (moved) {
    db.prepare(
      "UPDATE witnesses SET counts = 0 WHERE identity_id = ? AND paper_id IN (SELECT id FROM papers WHERE owner_identity_id = ?)",
    ).run(accountId, accountId);
  }
  return moved;
}

// A changed ACCOUNT_PEPPER would make every stored password stop matching,
// and each sign-in would just look like a wrong password. So the pepper's
// fingerprint is kept, and if it no longer matches while accounts exist,
// accounts switch off (as with no pepper at all) and guests carry on until
// the original pepper is restored. With no accounts yet, nothing depends on
// the old pepper and the new fingerprint simply replaces it.
export function checkedPepper(db: DB, pepper: Buffer | null): Buffer | null {
  if (!pepper) return null;
  const fingerprint = pepperFingerprint(pepper);
  const stored = db.prepare("SELECT value FROM pepper_fingerprint WHERE id = 1").get() as { value: string } | undefined;
  if (stored?.value === fingerprint) return pepper;
  const accounts = db.prepare("SELECT 1 FROM accounts LIMIT 1").get();
  if (stored && accounts) {
    log("account_pepper", { outcome: "mismatch" });
    console.error("ACCOUNT_PEPPER differs from the one existing passwords were sealed with: accounts are unavailable until it is restored");
    return null;
  }
  db.prepare("INSERT INTO pepper_fingerprint (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value").run(fingerprint);
  log("account_pepper", { outcome: stored ? "replaced" : "recorded" });
  return pepper;
}

export function accountsRouter(
  db: DB,
  musicEnabled: () => boolean,
  env: NodeJS.ProcessEnv = process.env,
  limits: { nameFailures: number; addressFailures: number; creations: number } = LIMITS,
): Router {
  const router = Router();
  const pepper = checkedPepper(db, pepperFrom(env));
  const nameFailures = windowCounter(15 * 60 * 1000, limits.nameFailures);
  const addressFailures = windowCounter(15 * 60 * 1000, limits.addressFailures);
  const creations = windowCounter(60 * 60 * 1000, limits.creations);
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");

  router.get("/account", (req, res) => {
    noStore(res);
    const identityId = identityFor(db, req);
    const account = identityId ? accountFor(db, identityId) : undefined;
    res.json({ available: pepper !== null, signed_in: !!account, ...(account ? { username: account.username } : {}) });
  });

  // Turns this browser's guest identity into an account in place, so its
  // papers, witnesses and rights stay with it, then rotates the cookie.
  router.post("/account/register", async (req, res) => {
    noStore(res);
    if (!pepper) {
      log("register", { outcome: "unconfigured" });
      res.status(503).json(unconfigured);
      return;
    }
    const identityId = identityFor(db, req);
    if (!identityId) {
      res.status(401).json(unauthenticated);
      return;
    }
    const address = clientAddress(req);
    if (creations.blocked(address) || addressFailures.blocked(address)) {
      log("register", { ...person(identityId), outcome: "rate_limited" });
      res.status(429).json(tooMany);
      return;
    }
    if (accountFor(db, identityId)) {
      log("register", { ...person(identityId), outcome: "already" });
      res.status(409).json({ code: "already_signed_in", error: "You're already signed in." });
      return;
    }
    const username = usernameOf(req.body?.username);
    if (!username) {
      addressFailures.hit(address);
      log("register", { ...person(identityId), outcome: "invalid" });
      res.status(400).json({ code: "invalid_username", error: "Use 3–24 letters, numbers, hyphens or underscores for your username." });
      return;
    }
    const problem = passwordProblem(req.body?.password, username.name);
    if (problem) {
      addressFailures.hit(address);
      log("register", { ...person(identityId), outcome: "invalid" });
      res.status(400).json({ code: "invalid_password", error: problem });
      return;
    }
    const passwordHash = await hashPassword(req.body.password, pepper);
    // the session may have changed while the hash ran
    if (identityFor(db, req) !== identityId) {
      res.status(401).json(unauthenticated);
      return;
    }
    const outcome = db.transaction((): "created" | "taken" | "already" => {
      if (accountFor(db, identityId)) return "already";
      if (db.prepare("SELECT 1 FROM accounts WHERE username_key = ?").get(username.key)) return "taken";
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO accounts (identity_id, username, username_key, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(identityId, username.name, username.key, passwordHash, now, now);
      return "created";
    })();
    if (outcome === "created") creations.hit(address);
    else addressFailures.hit(address);
    log("register", { ...person(identityId), outcome });
    if (outcome === "taken") {
      res.status(409).json({ code: "username_taken", error: "That username is taken. Try another." });
      return;
    }
    if (outcome === "already") {
      res.status(409).json({ code: "already_signed_in", error: "You're already signed in." });
      return;
    }
    rotateSession(db, req, res, identityId);
    res.status(201).json({ signed_in: true, username: username.name });
  });

  router.post("/account/login", async (req, res) => {
    noStore(res);
    if (!pepper) {
      log("login", { outcome: "unconfigured" });
      res.status(503).json(unconfigured);
      return;
    }
    const address = clientAddress(req);
    const username = usernameOf(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (addressFailures.blocked(address) || (username && nameFailures.blocked(username.key))) {
      log("login", { outcome: "rate_limited" });
      res.status(429).json(tooMany);
      return;
    }
    const row = username
      ? (db.prepare("SELECT identity_id, username, password_hash FROM accounts WHERE username_key = ?").get(username.key) as AccountRow | undefined)
      : undefined;
    const ok = row ? await verifyPassword(password, row.password_hash, pepper) : (await burnDecoy(password, pepper), false);
    if (!row || !ok) {
      addressFailures.hit(address);
      if (username) nameFailures.hit(username.key);
      log("login", { outcome: "invalid" });
      res.status(401).json(wrong);
      return;
    }
    const guestId = identityFor(db, req);
    const moved = guestId && guestId !== row.identity_id && !accountFor(db, guestId) ? db.transaction(() => adoptGuest(db, guestId, row.identity_id))() : 0;
    rotateSession(db, req, res, row.identity_id);
    log("login", { ...person(row.identity_id), outcome: moved ? "merged" : "signed_in", moved: moved || undefined });
    res.json({ signed_in: true, username: row.username });
  });

  router.post("/account/logout", (req, res) => {
    noStore(res);
    const identityId = identityFor(db, req);
    endSession(db, req, res);
    log("logout", { ...person(identityId), outcome: "signed_out" });
    res.json({ signed_in: false });
  });

  const signedIn = (req: Request, res: Response): string | null => {
    noStore(res);
    const identityId = identityFor(db, req);
    if (!identityId || !accountFor(db, identityId)) {
      res.status(401).json({ code: "not_signed_in", error: "Sign in to see your papers." });
      return null;
    }
    return identityId;
  };

  router.get("/account/papers", (req, res) => {
    const identityId = signedIn(req, res);
    if (identityId) res.json({ papers: ownPapers(db, identityId) });
  });

  router.get("/account/records", (req, res) => {
    const identityId = signedIn(req, res);
    if (identityId) res.json({ records: ownRecords(db, identityId, musicEnabled()) });
  });

  return router;
}

// Whether to suggest an account after a paper is saved: never to someone
// already signed in; otherwise after a guest's first Keep, and once more
// when they have left three papers. At most twice, so nothing is stored to
// remember that the offer was declined.
export function offerAccount(db: DB, identityId: string, mode: string, fresh: boolean): boolean {
  if (!fresh || accountFor(db, identityId)) return false;
  const counts = db
    .prepare("SELECT COUNT(*) AS total, SUM(mode = 'KEEP') AS kept FROM papers WHERE owner_identity_id = ?")
    .get(identityId) as { total: number; kept: number | null };
  return (mode === "KEEP" && counts.kept === 1) || counts.total === 3;
}
