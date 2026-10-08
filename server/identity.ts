import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import type { DB } from "./db.ts";
import { clientAddress, windowCounter } from "./address.ts";
import { log } from "./log.ts";
import { identityFor, startSession } from "./session.ts";

// Crockford base32: no I, L, O or U, so a key read aloud or retyped survives.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BYTES = 20; // 160 bits

export function generateKey(): string {
  const bytes = randomBytes(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

export const normalizeKey = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

const digest = (key: string): string => createHash("sha256").update(normalizeKey(key)).digest("hex");

// Failed restore attempts per client address, kept in memory: enough to make
// guessing pointless (keys carry 160 bits) without locking anyone out long.
// Only failures count, so people sharing an address can still restore.
// Bounded, and keyed by the address Fly's edge reports (never a client-written
// X-Forwarded-For header, which would let a guesser pick a fresh "address"
// for every attempt).
const failures = windowCounter(15 * 60 * 1000, 10);

export const keyState = (db: DB, identityId: string): "none" | "issued" | "saved" =>
  ((db.prepare("SELECT state FROM return_keys WHERE identity_id = ?").get(identityId) as { state: "issued" | "saved" } | undefined)
    ?.state ?? "none");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const keptAPaper = (db: DB, identityId: string): boolean =>
  !!db.prepare("SELECT 1 FROM papers WHERE owner_identity_id = ? AND mode = 'KEEP'").get(identityId);

const unauthenticated = { code: "unauthenticated", error: "Your session has expired. Reload the page and try again." };

export function identityRouter(db: DB): Router {
  const router = Router();

  // Issued once a visitor has kept a paper. A key already confirmed as saved
  // is never shown again; an unconfirmed one (a lost reply, a closed tab) is
  // replaced, which also invalidates the one that was never confirmed. The
  // replacement only applies while the row is still unconfirmed, so it can't
  // race past a confirmation that commits first.
  router.post("/identity/return-key", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    if (!identityId) {
      res.status(401).json(unauthenticated);
      return;
    }
    if (!keptAPaper(db, identityId)) {
      res.status(409).json({ code: "not_needed", error: "A return key is offered after you keep a paper." });
      return;
    }
    const key = generateKey();
    const issuanceId = randomUUID();
    const written = db
      .prepare(
        `INSERT INTO return_keys (identity_id, digest, state, issued_at, issuance_id) VALUES (?, ?, 'issued', ?, ?)
         ON CONFLICT (identity_id) DO UPDATE
           SET digest = excluded.digest, issued_at = excluded.issued_at, issuance_id = excluded.issuance_id
           WHERE return_keys.state = 'issued'`,
      )
      .run(identityId, digest(key), new Date().toISOString(), issuanceId).changes;
    if (!written) {
      res.status(409).json({ code: "already_saved", error: "You already saved a return key." });
      return;
    }
    log("return_key", { identity: identityId, outcome: "issued" });
    res.json({ return_key: key, issuance_id: issuanceId });
  });

  // Confirms exactly the issuance the visitor was shown. Repeating a
  // confirmation that succeeded succeeds again; an older issuance (replaced
  // in another tab) is refused, never reported as saved.
  router.post("/identity/return-key/saved", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    if (!identityId) {
      res.status(401).json(unauthenticated);
      return;
    }
    const issuanceId = req.body?.issuance_id;
    if (typeof issuanceId !== "string" || !UUID.test(issuanceId)) {
      res.status(400).json({ code: "invalid_input", error: "Missing issuance." });
      return;
    }
    const outcome = db.transaction((): "saved" | "repeat" | "superseded" => {
      const changed = db
        .prepare(
          "UPDATE return_keys SET state = 'saved', saved_at = ? WHERE identity_id = ? AND issuance_id = ? AND state = 'issued'",
        )
        .run(new Date().toISOString(), identityId, issuanceId).changes;
      if (changed) return "saved";
      const row = db.prepare("SELECT state, issuance_id FROM return_keys WHERE identity_id = ?").get(identityId) as
        | { state: string; issuance_id: string | null }
        | undefined;
      return row?.state === "saved" && row.issuance_id === issuanceId ? "repeat" : "superseded";
    })();
    log("return_key", { identity: identityId, outcome });
    if (outcome === "superseded") {
      res.status(409).json({ code: "key_superseded", error: "This key was replaced in another tab. Generate and save a new key." });
      return;
    }
    res.json({ ok: true });
  });

  // This browser's own key situation, so a missed offer can be found again.
  // Nothing about papers: no ids, no counts, no history.
  router.get("/identity/state", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    if (!identityId) {
      res.status(401).json(unauthenticated);
      return;
    }
    const saved = keyState(db, identityId) === "saved";
    res.json({ return_key: saved ? "saved" : keptAPaper(db, identityId) ? "available" : "not_needed" });
  });

  // Maps this browser to the key's identity with a new session. It returns
  // nothing about that identity: no papers, no history, no counts.
  router.post("/identity/restore", (req, res) => {
    res.set("Cache-Control", "no-store");
    const address = clientAddress(req);
    if (failures.blocked(address)) {
      log("restore", { outcome: "rate_limited" });
      res.status(429).json({ code: "rate_limited", error: "Too many tries. Wait a few minutes and try again." });
      return;
    }
    const raw = req.body?.return_key;
    const row =
      typeof raw === "string" && normalizeKey(raw).length === 32
        ? (db.prepare("SELECT identity_id FROM return_keys WHERE digest = ?").get(digest(raw)) as { identity_id: string } | undefined)
        : undefined;
    if (!row) {
      failures.hit(address);
      log("restore", { outcome: "invalid" });
      res.status(400).json({ code: "invalid_key", error: "That key doesn't match. Check it and try again." });
      return;
    }
    startSession(db, res, row.identity_id);
    log("restore", { identity: row.identity_id, outcome: "restored" });
    res.json({ ok: true });
  });

  return router;
}
