import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { activeTotal, bumpRevision, currentRevision, requestDigest, serverSecret, type DB } from "./db.ts";
import { broadcast } from "./events.ts";
import { keyState } from "./identity.ts";
import { log } from "./log.ts";
import type { Payload, Verdict } from "./moderation.ts";
import { checkReceipt, issueReceipt } from "./receipt.ts";
import { identityFor } from "./session.ts";

export const MAX_CODE_POINTS = 2000;
export const WINDOW_SIZE = 12;
const MAX_SAMPLE = 24;
const MAX_EXCLUDE = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A comma-separated list of paper ids, or null if it isn't one (too many,
// malformed, or sent more than once).
function parseIdList(raw: unknown): string[] | null {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") return null;
  const ids = raw.split(",");
  if (ids.length > MAX_EXCLUDE || !ids.every((id) => UUID.test(id))) return null;
  return [...new Set(ids)];
}

export type Mode = "KEEP" | "RELEASE";
type Failure = { ok: false; status: number; code: string; error: string };
type Result<T> = { ok: true; value: T } | Failure;
const fail = (status: number, code: string, error: string): Failure => ({ ok: false, status, code, error });

export type Created = { id: string; version: number; status: string; revision: number; total: number; fresh: boolean };

type Submission = { content: string; submissionKey: string; mode: Mode; digest: string };

export function validateSubmission(content: unknown, submissionKey: unknown, modeInput: unknown): Result<Submission> {
  if (typeof content !== "string" || content.trim() === "") {
    return fail(400, "invalid_input", "Write something before throwing it.");
  }
  if (Array.from(content).length > MAX_CODE_POINTS) {
    return fail(400, "invalid_input", `Keep it under ${MAX_CODE_POINTS} characters.`);
  }
  if (typeof submissionKey !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(submissionKey)) {
    return fail(400, "invalid_input", "Missing submission key.");
  }
  if (modeInput !== "KEEP" && modeInput !== "RELEASE") {
    return fail(400, "invalid_input", "Choose how to leave it.");
  }
  return { ok: true, value: { content, submissionKey, mode: modeInput, digest: requestDigest(content, modeInput) } };
}

// A submission this identity already made under this key, if any. Compared by
// digest, not text: destruction clears the text, and a retry of a destroyed
// paper must still be recognised, never saved again.
function priorSubmission(db: DB, ownerId: string, submission: Submission): Result<Created> | null {
  const prior = db
    .prepare("SELECT id, version, status, request_digest FROM papers WHERE owner_identity_id = ? AND submission_key = ?")
    .get(ownerId, submission.submissionKey) as { id: string; version: number; status: string; request_digest: string } | undefined;
  if (!prior) return null;
  if (prior.request_digest !== submission.digest) {
    return fail(409, "submission_conflict", "This submission was already saved with different words or a different choice.");
  }
  const { request_digest: _, ...paper } = prior;
  return { ok: true, value: { ...paper, revision: currentRevision(db), total: activeTotal(db), fresh: false } };
}

// Saves a submission that has already passed its safety check (or a retry of
// one already saved). The check runs before this, outside any transaction.
export function createPaper(
  db: DB,
  ownerId: string,
  content: unknown,
  submissionKey: unknown,
  modeInput: unknown,
): Result<Created> {
  const valid = validateSubmission(content, submissionKey, modeInput);
  if (!valid.ok) return valid;
  const { mode, digest } = valid.value;

  return db.transaction((): Result<Created> => {
    const prior = priorSubmission(db, ownerId, valid.value);
    if (prior) return prior;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, request_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ownerId, valid.value.content, new Date().toISOString(), valid.value.submissionKey, mode, digest);
    const revision = bumpRevision(db);
    return { ok: true, value: { id, version: 1, status: "ACTIVE", revision, total: activeTotal(db), fresh: true } };
  })();
}

export const countPapers = activeTotal;

type PaperRow = { id: string; owner_identity_id: string; content: string; mode: Mode; status: string; version: number };

const paperRow = (db: DB, id: string): PaperRow | undefined =>
  db.prepare("SELECT id, owner_identity_id, content, mode, status, version FROM papers WHERE id = ?").get(id) as
    | PaperRow
    | undefined;

const witnessCount = (db: DB, paperId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM witnesses WHERE paper_id = ? AND counts = 1").get(paperId) as { n: number }).n;

const hasAcknowledged = (db: DB, paperId: string, identityId: string): boolean =>
  !!db.prepare("SELECT 1 FROM witnesses WHERE paper_id = ? AND identity_id = ?").get(paperId, identityId);

// What this viewer may do with this paper. Keep: only its author may destroy
// it, with no need to witness first. Release: anyone who has acknowledged it,
// the author included, but the author gains nothing beyond any visitor.
export function viewerState(db: DB, paper: PaperRow, identityId: string | undefined) {
  const isAuthor = !!identityId && paper.owner_identity_id === identityId;
  const witnessed = !!identityId && hasAcknowledged(db, paper.id, identityId);
  const canBurn = !!identityId && (paper.mode === "KEEP" ? isAuthor : witnessed);
  return { is_author: isAuthor, has_witnessed: witnessed, can_burn: canBurn };
}

const publicPaper = (db: DB, paper: PaperRow, identityId: string | undefined) => ({
  id: paper.id,
  mode: paper.mode.toLowerCase(),
  version: paper.version,
  witness_count: witnessCount(db, paper.id),
  viewer: viewerState(db, paper, identityId),
});

export function witnessPaper(db: DB, paperId: string, identityId: string) {
  return db.transaction(() => {
    const paper = paperRow(db, paperId);
    if (!paper || paper.status !== "ACTIVE") return { ok: false as const };
    const counts = paper.owner_identity_id === identityId ? 0 : 1;
    const inserted = db
      .prepare("INSERT OR IGNORE INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, ?, ?, ?)")
      .run(paperId, identityId, counts, new Date().toISOString()).changes;
    let revision: number | undefined;
    if (inserted) {
      db.prepare("UPDATE papers SET version = version + 1 WHERE id = ?").run(paperId);
      revision = bumpRevision(db);
    }
    return { ok: true as const, paper: paperRow(db, paperId)!, fresh: inserted > 0, revision, counted: counts === 1 };
  })();
}

type BurnOutcome = "destroyed" | "paper_gone" | "forbidden" | "op_conflict";
export type Burned = { outcome: BurnOutcome; revision: number | null; total: number | null; fresh: boolean; version?: number };

// How a confirmed destruction is shown. The duration is a tuning starting
// point for every page's ending; the seed lets each page vary its flames and
// ash the same way without any page sending another its animation. Both are
// derived from what is already stored, not a record of the animation.
export const BURN_DURATION_MS = 4800;
const effectSeed = (paperId: string, endedAt: string): string =>
  createHash("sha256").update(`${paperId}\u0000${endedAt}`).digest("hex").slice(0, 16);

export function ending(db: DB, paperId: string) {
  const row = db.prepare("SELECT version, ended_at FROM papers WHERE id = ?").get(paperId) as
    | { version: number; ended_at: string | null }
    | undefined;
  const destroyedAt = row?.ended_at ?? new Date(0).toISOString();
  return {
    version: row?.version ?? 0,
    destroyed_at: destroyedAt,
    burn_duration_ms: BURN_DURATION_MS,
    effect_seed: effectSeed(paperId, destroyedAt),
  };
}

// One conditional transition out of ACTIVE, with the text cleared in the same
// commit. Two people destroying at once get one transition: the second finds
// it no longer ACTIVE. Rights are checked here, not trusted from the client.
export function burnPaper(db: DB, paperId: string, identityId: string, opKey: string, confirmed: boolean): Burned {
  return db.transaction((): Burned => {
    const prior = db
      .prepare("SELECT paper_id, outcome, revision, total FROM burn_operations WHERE identity_id = ? AND op_key = ?")
      .get(identityId, opKey) as
      | { paper_id: string; outcome: BurnOutcome; revision: number | null; total: number | null }
      | undefined;
    // An operation key names one paper: reusing it for another must not hand
    // back the first paper's success.
    if (prior && prior.paper_id !== paperId) return { outcome: "op_conflict", revision: null, total: null, fresh: false };
    if (prior) return { outcome: prior.outcome, revision: prior.revision, total: prior.total, fresh: false };

    const record = (outcome: BurnOutcome, revision: number | null = null, total: number | null = null): Burned => {
      db.prepare(
        `INSERT INTO burn_operations (identity_id, op_key, paper_id, outcome, revision, total, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(identityId, opKey, paperId, outcome, revision, total, new Date().toISOString());
      return { outcome, revision, total, fresh: outcome === "destroyed" };
    };

    const paper = paperRow(db, paperId);
    if (!paper || paper.status !== "ACTIVE") return record("paper_gone");
    if (!confirmed || !viewerState(db, paper, identityId).can_burn) return { outcome: "forbidden", revision: null, total: null, fresh: false };

    const changed = db
      .prepare(
        `UPDATE papers SET status = 'DESTROYED', content = '', version = version + 1, ended_at = ?
         WHERE id = ? AND status = 'ACTIVE'`,
      )
      .run(new Date().toISOString(), paperId).changes;
    if (changed !== 1) return record("paper_gone");
    const revision = bumpRevision(db);
    const result = record("destroyed", revision, activeTotal(db));
    return { ...result, version: paper.version + 1 };
  })();
}

const REFUSALS = {
  rejected: "This paper cannot enter the space as written. Please revise it.",
  review: "This paper needs clarification before it can enter the space. Please revise it.",
  unavailable: "This paper could not be checked. Please try again.",
};

function moderationRefusal(verdict: Exclude<Verdict, { kind: "allow" }>) {
  if (verdict.kind === "reject") {
    return { status: 422, logReason: verdict.reason, body: { code: "moderation_rejected", error: REFUSALS.rejected, reason: verdict.reason } };
  }
  if (verdict.kind === "review") {
    return { status: 422, logReason: verdict.reason, body: { code: "moderation_review_required", error: REFUSALS.review, reason: verdict.reason } };
  }
  return { status: 503, logReason: verdict.error.code, body: { code: "moderation_unavailable", error: REFUSALS.unavailable } };
}

export function papersRouter(db: DB, checkContent: (payload: Payload) => Promise<Verdict>): Router {
  const router = Router();

  // A random handful of what is here, for the first view and for exploring.
  // `exclude` (the papers already on screen, and a few just seen) steers it
  // toward new encounters; nothing about age, author or attention does. Ids
  // only: a version would hint at how often a paper has been witnessed.
  router.get("/papers", (req, res) => {
    res.set("Cache-Control", "no-store");
    const limit = req.query.limit === undefined ? WINDOW_SIZE : Number(req.query.limit);
    const exclude = parseIdList(req.query.exclude);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SAMPLE || exclude === null) {
      res.status(400).json({ code: "invalid_input", error: "That isn't a request this space understands." });
      return;
    }
    const read = db.transaction(() => ({
      papers: db
        .prepare(
          `SELECT id FROM papers
           WHERE status = 'ACTIVE' AND id NOT IN (SELECT value FROM json_each(?))
           ORDER BY random() LIMIT ?`,
        )
        .all(JSON.stringify(exclude), limit) as { id: string }[],
      total: activeTotal(db),
      revision: currentRevision(db),
    }));
    res.json(read());
  });

  // Opening is not witnessing: this never records anything. It returns the
  // words, this viewer's own state and a receipt proving they were fetched.
  router.get("/papers/:id", (req, res) => {
    res.set("Cache-Control", "no-store");
    const paper = paperRow(db, req.params.id);
    if (!paper || paper.status !== "ACTIVE") {
      res.status(404).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    const identityId = identityFor(db, req);
    res.json({
      ...publicPaper(db, paper, identityId),
      content: paper.content,
      read_receipt: identityId ? issueReceipt(serverSecret(db, "read_receipt"), paper.id, identityId) : null,
    });
  });

  router.post("/papers/:id/witness", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    const paperId = req.params.id;
    if (!identityId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    if (!checkReceipt(serverSecret(db, "read_receipt"), req.body?.read_receipt, paperId, identityId)) {
      log("witness", { identity: identityId, paper: paperId, outcome: "forbidden" });
      res.status(403).json({ code: "forbidden", error: "Open the paper before witnessing it." });
      return;
    }
    const result = witnessPaper(db, paperId, identityId);
    if (!result.ok) {
      log("witness", { identity: identityId, paper: paperId, outcome: "paper_gone" });
      res.status(410).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    const { paper, fresh, revision, counted } = result;
    log("witness", { identity: identityId, paper: paperId, outcome: fresh ? (counted ? "counted" : "author") : "repeat", revision });
    if (fresh) broadcast("paper:witnessed", { id: paperId, version: paper.version, revision });
    res.json(publicPaper(db, paper, identityId));
  });

  router.post("/papers/:id/burn", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    const paperId = req.params.id;
    const opKey = req.body?.op_key;
    if (!identityId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    if (typeof opKey !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(opKey)) {
      res.status(400).json({ code: "invalid_input", error: "Missing operation key." });
      return;
    }
    if (!checkReceipt(serverSecret(db, "read_receipt"), req.body?.read_receipt, paperId, identityId)) {
      log("burn", { identity: identityId, paper: paperId, outcome: "forbidden_receipt" });
      res.status(403).json({ code: "forbidden", error: "Open the paper before letting it go." });
      return;
    }
    const result = burnPaper(db, paperId, identityId, opKey, req.body?.confirmed === true);
    log("burn", {
      identity: identityId,
      paper: paperId,
      outcome: result.fresh ? "destroyed" : result.outcome === "destroyed" ? "retry" : result.outcome,
      revision: result.revision ?? undefined,
    });
    if (result.outcome === "forbidden") {
      res.status(403).json({ code: "forbidden", error: "You can't let this paper go." });
      return;
    }
    if (result.outcome === "op_conflict") {
      res.status(409).json({ code: "operation_conflict", error: "That request was already used for another paper." });
      return;
    }
    if (result.outcome === "paper_gone") {
      res.status(410).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    const facts = ending(db, paperId);
    if (result.fresh) {
      broadcast("paper:destroyed", { id: paperId, ...facts, revision: result.revision, active_total: result.total, op: opKey });
    }
    res.json({ id: paperId, status: "destroyed", ...facts, revision: result.revision, total: result.total, op: opKey });
  });

  // Checks still running, by identity and submission key, so a double click
  // or a retry during a slow check waits for the same answer instead of
  // paying for a second one. One instance, so memory is enough.
  const inFlight = new Map<string, { digest: string; verdict: Promise<Verdict> }>();

  router.post("/papers", async (req, res) => {
    const ownerId = identityFor(db, req);
    if (!ownerId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    const key = req.body?.submission_key;
    if (req.body?.confirmed !== true) {
      res.status(400).json({ code: "invalid_input", error: "Confirm that you understand before throwing it." });
      return;
    }
    const valid = validateSubmission(req.body?.content, key, req.body?.mode);
    if (!valid.ok) {
      log("create", { identity: ownerId, outcome: valid.code });
      res.status(valid.status).json({ code: valid.code, error: valid.error });
      return;
    }
    const submission = valid.value;

    // A retry of a saved submission answers with its current state and never
    // reaches the provider, even while the provider is down.
    if (!priorSubmission(db, ownerId, submission)) {
      const flightKey = `${ownerId}:${submission.submissionKey}`;
      let flight = inFlight.get(flightKey);
      if (flight && flight.digest !== submission.digest) {
        log("create", { identity: ownerId, outcome: "submission_conflict" });
        res.status(409).json({ code: "submission_conflict", error: "This submission is already being saved with different words or a different choice." });
        return;
      }
      if (!flight) {
        flight = {
          digest: submission.digest,
          verdict: checkContent({ paper_text: submission.content, report_reason: null, report_note: null }).finally(() =>
            inFlight.delete(flightKey),
          ),
        };
        inFlight.set(flightKey, flight);
      }
      const verdict = await flight.verdict;
      if (verdict.kind !== "allow") {
        const refusal = moderationRefusal(verdict);
        log("create", { identity: ownerId, outcome: refusal.body.code, reason: refusal.logReason });
        res.status(refusal.status).json(refusal.body);
        return;
      }
      // the session may have ended while the check ran
      if (identityFor(db, req) !== ownerId) {
        res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
        return;
      }
    }

    const result = createPaper(db, ownerId, submission.content, key, submission.mode);
    if (!result.ok) {
      log("create", { identity: ownerId, outcome: result.code });
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    const { id, version, status, revision, total, fresh } = result.value;
    log("create", { identity: ownerId, paper: id, outcome: fresh ? "created" : "retry", revision });
    if (fresh) broadcast("paper:created", { id, version, revision, active_total: total, op: key });
    // After a Keep, offer a return key until one has been confirmed saved.
    const offerReturnKey = req.body.mode === "KEEP" && keyState(db, ownerId) !== "saved";
    res.status(201).json({ paper: { id, version, status: status.toLowerCase() }, total, revision, offer_return_key: offerReturnKey });
  });

  return router;
}
