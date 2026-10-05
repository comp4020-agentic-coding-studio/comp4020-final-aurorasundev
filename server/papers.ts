import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { DB } from "./db.ts";
import { identityFor } from "./session.ts";

export const MAX_CODE_POINTS = 2000;
export const WINDOW_SIZE = 12;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function createPaper(
  db: DB,
  ownerId: string,
  content: unknown,
  submissionKey: unknown,
): Result<{ id: string; total: number }> {
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, status: 400, error: "Write something before throwing it." };
  }
  if (Array.from(content).length > MAX_CODE_POINTS) {
    return { ok: false, status: 400, error: `Keep it under ${MAX_CODE_POINTS} characters.` };
  }
  if (typeof submissionKey !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(submissionKey)) {
    return { ok: false, status: 400, error: "Missing submission key." };
  }

  return db.transaction((): Result<{ id: string; total: number }> => {
    const prior = db
      .prepare("SELECT id, content FROM papers WHERE owner_identity_id = ? AND submission_key = ?")
      .get(ownerId, submissionKey) as { id: string; content: string } | undefined;
    if (prior) {
      if (prior.content !== content) {
        return { ok: false, status: 409, error: "This submission was already saved with different text." };
      }
      return { ok: true, value: { id: prior.id, total: countPapers(db) } };
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key) VALUES (?, ?, ?, ?, ?)",
    ).run(id, ownerId, content, new Date().toISOString(), submissionKey);
    return { ok: true, value: { id, total: countPapers(db) } };
  })();
}

export const countPapers = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM papers").get() as { n: number }).n;

export function papersRouter(db: DB): Router {
  const router = Router();

  router.get("/papers", (_req, res) => {
    const papers = db
      .prepare("SELECT id FROM papers ORDER BY random() LIMIT ?")
      .all(WINDOW_SIZE) as { id: string }[];
    res.json({ papers, total: countPapers(db) });
  });

  router.get("/papers/:id", (req, res) => {
    const row = db.prepare("SELECT id, content FROM papers WHERE id = ?").get(req.params.id) as
      | { id: string; content: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "This paper is not here." });
      return;
    }
    res.json(row);
  });

  router.post("/papers", (req, res) => {
    const ownerId = identityFor(db, req);
    if (!ownerId) {
      res.status(401).json({ error: "Your session has expired. Reload the page and try again." });
      return;
    }
    const result = createPaper(db, ownerId, req.body?.content, req.body?.submission_key);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    console.log(`paper created ${result.value.id}`);
    res.status(201).json({ paper: { id: result.value.id }, total: result.value.total });
  });

  return router;
}
