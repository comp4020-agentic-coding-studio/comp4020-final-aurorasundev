import { randomUUID } from "node:crypto";
import { Router } from "express";
import { activeTotal, bumpRevision, currentRevision, requestDigest, serverSecret, type DB } from "./db.ts";
import { broadcast } from "./events.ts";
import { log } from "./log.ts";
import { checkReceipt, issueReceipt } from "./receipt.ts";
import { identityFor } from "./session.ts";

export const MAX_CODE_POINTS = 2000;
export const WINDOW_SIZE = 12;

export type Mode = "KEEP" | "RELEASE";
type Failure = { ok: false; status: number; code: string; error: string };
type Result<T> = { ok: true; value: T } | Failure;
const fail = (status: number, code: string, error: string): Failure => ({ ok: false, status, code, error });

export type Created = { id: string; version: number; status: string; revision: number; total: number; fresh: boolean };

export function createPaper(
  db: DB,
  ownerId: string,
  content: unknown,
  submissionKey: unknown,
  modeInput: unknown,
): Result<Created> {
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
  const mode: Mode = modeInput;
  const digest = requestDigest(content, mode);

  return db.transaction((): Result<Created> => {
    // Compared by digest, not text: destruction clears the text, and a retry
    // of a destroyed paper must still be recognised, never saved again.
    const prior = db
      .prepare("SELECT id, version, status, request_digest FROM papers WHERE owner_identity_id = ? AND submission_key = ?")
      .get(ownerId, submissionKey) as { id: string; version: number; status: string; request_digest: string } | undefined;
    if (prior) {
      if (prior.request_digest !== digest) {
        return fail(409, "submission_conflict", "This submission was already saved with different words or a different choice.");
      }
      return {
        ok: true,
        value: { ...prior, revision: currentRevision(db), total: activeTotal(db), fresh: false },
      };
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, request_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ownerId, content, new Date().toISOString(), submissionKey, mode, digest);
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

type BurnOutcome = "destroyed" | "paper_gone" | "forbidden";
export type Burned = { outcome: BurnOutcome; revision: number | null; total: number | null; fresh: boolean; version?: number };

// One conditional transition out of ACTIVE, with the text cleared in the same
// commit. Two people destroying at once get one transition: the second finds
// it no longer ACTIVE. Rights are checked here, not trusted from the client.
export function burnPaper(db: DB, paperId: string, identityId: string, opKey: string, confirmed: boolean): Burned {
  return db.transaction((): Burned => {
    const prior = db
      .prepare("SELECT outcome, revision, total FROM burn_operations WHERE identity_id = ? AND op_key = ?")
      .get(identityId, opKey) as { outcome: BurnOutcome; revision: number | null; total: number | null } | undefined;
    if (prior) return { ...prior, fresh: false };

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

export function papersRouter(db: DB): Router {
  const router = Router();

  router.get("/papers", (_req, res) => {
    const papers = db
      .prepare("SELECT id FROM papers WHERE status = 'ACTIVE' ORDER BY random() LIMIT ?")
      .all(WINDOW_SIZE) as { id: string }[];
    res.set("Cache-Control", "no-store").json({ papers, total: activeTotal(db), revision: currentRevision(db) });
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
    if (result.outcome === "paper_gone") {
      res.status(410).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    if (result.fresh) {
      broadcast("paper:destroyed", { id: paperId, version: result.version, revision: result.revision, active_total: result.total, op: opKey });
    }
    res.json({ id: paperId, status: "destroyed", revision: result.revision, total: result.total });
  });

  router.post("/papers", (req, res) => {
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
    const result = createPaper(db, ownerId, req.body?.content, key, req.body?.mode);
    if (!result.ok) {
      log("create", { identity: ownerId, outcome: result.code });
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    const { id, version, status, revision, total, fresh } = result.value;
    log("create", { identity: ownerId, paper: id, outcome: fresh ? "created" : "retry", revision });
    if (fresh) broadcast("paper:created", { id, version, revision, active_total: total, op: key });
    res.status(201).json({ paper: { id, version, status: status.toLowerCase() }, total, revision });
  });

  return router;
}
