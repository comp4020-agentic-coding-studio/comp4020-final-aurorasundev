import { randomUUID } from "node:crypto";
import { Router } from "express";
import { activeTotal, bumpRevision, currentRevision, requestDigest, type DB } from "./db.ts";
import { broadcast } from "./events.ts";
import { log } from "./log.ts";
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
  modeInput: unknown = "KEEP",
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

export function papersRouter(db: DB): Router {
  const router = Router();

  router.get("/papers", (_req, res) => {
    const papers = db
      .prepare("SELECT id FROM papers WHERE status = 'ACTIVE' ORDER BY random() LIMIT ?")
      .all(WINDOW_SIZE) as { id: string }[];
    res.set("Cache-Control", "no-store").json({ papers, total: activeTotal(db), revision: currentRevision(db) });
  });

  router.get("/papers/:id", (req, res) => {
    res.set("Cache-Control", "no-store");
    const row = db.prepare("SELECT id, content FROM papers WHERE id = ? AND status = 'ACTIVE'").get(req.params.id) as
      | { id: string; content: string }
      | undefined;
    if (!row) {
      res.status(404).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    res.json(row);
  });

  router.post("/papers", (req, res) => {
    const ownerId = identityFor(db, req);
    if (!ownerId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    const key = req.body?.submission_key;
    const result = createPaper(db, ownerId, req.body?.content, key, req.body?.mode ?? "KEEP");
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
