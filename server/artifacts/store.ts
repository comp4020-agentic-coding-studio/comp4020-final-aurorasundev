import { randomUUID } from "node:crypto";
import type { DB } from "../db.ts";
import { GESTURES, MATERIALS, MOTIFS, PALETTES, PREPARATION_STATES, type Recipe } from "./types.ts";

// Durable keepsake records. Every function here is synchronous and makes no
// network call, so the paper lifecycle can call it inside its own
// transaction. Each rechecks the paper's mode and status itself; SQLite's
// UNIQUE(paper_id) is what guarantees one job per paper.

type PaperFacts = { mode: string; status: string };
const paperFacts = (db: DB, paperId: string): PaperFacts | undefined =>
  db.prepare("SELECT mode, status FROM papers WHERE id = ?").get(paperId) as PaperFacts | undefined;

// A recipe chosen from the job's own random public id, never from the paper:
// used when a paper is burned before (or without) a prepared recipe.
export function neutralRecipe(publicId: string): Recipe {
  const hex = publicId.replace(/-/g, "");
  const pick = <T>(values: readonly T[], at: number): T => values[parseInt(hex.slice(at, at + 4), 16) % values.length];
  return { motif: pick(MOTIFS, 0), material: pick(MATERIALS, 4), palette: pick(PALETTES, 8), gesture: pick(GESTURES, 12) };
}

const insertJob = (db: DB, paperId: string, state: string, nowMs: number, recipe: Recipe | null = null): boolean => {
  const publicId = randomUUID();
  const chosen = state === "IMAGE_QUEUED" ? (recipe ?? neutralRecipe(publicId)) : null;
  return (
    db
      .prepare(
        `INSERT INTO artifact_jobs (id, paper_id, public_id, state, recipe, recipe_source, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (paper_id) DO NOTHING`,
      )
      .run(randomUUID(), paperId, publicId, state, chosen && JSON.stringify(chosen), chosen && "neutral", nowMs, nowMs, nowMs)
      .changes === 1
  );
};

// After an allowed Release save: a job that will prepare a recipe while the
// paper is still here. Keep papers, and anything not ACTIVE, get nothing.
export function queueReleasePreparation(db: DB, paperId: string, nowMs: number): boolean {
  const paper = paperFacts(db, paperId);
  if (paper?.mode !== "RELEASE" || paper.status !== "ACTIVE") return false;
  return insertJob(db, paperId, "PREPARE_QUEUED", nowMs);
}

// Inside a successful burn of a Release paper, after its words and drawing
// were cleared: the job moves to the image queue with its prepared recipe,
// or a neutral one if none is ready. Any preparation lease is invalidated so
// a late recipe cannot land. Returns whether this call queued the image.
export function queueDestroyedRelease(db: DB, paperId: string, nowMs: number): boolean {
  const paper = paperFacts(db, paperId);
  if (paper?.mode !== "RELEASE" || paper.status !== "DESTROYED") return false;
  if (insertJob(db, paperId, "IMAGE_QUEUED", nowMs)) return true;
  const job = db.prepare("SELECT public_id, state, recipe FROM artifact_jobs WHERE paper_id = ?").get(paperId) as {
    public_id: string;
    state: string;
    recipe: string | null;
  };
  if (!(PREPARATION_STATES as readonly string[]).includes(job.state)) return false;
  const prepared = job.state === "PREPARED" && job.recipe !== null;
  db.prepare(
    `UPDATE artifact_jobs SET state = 'IMAGE_QUEUED', recipe = ?, recipe_source = ?, lease_token = NULL,
       lease_until = NULL, next_attempt_at = ?, error_code = NULL, updated_at = ?
     WHERE paper_id = ?`,
  ).run(prepared ? job.recipe : JSON.stringify(neutralRecipe(job.public_id)), prepared ? "prepared" : "neutral", nowMs, nowMs, paperId);
  return true;
}

// Inside a successful quarantine: no keepsake, and any late preparation
// result is refused because its lease is gone.
export function cancelArtifactPreparation(db: DB, paperId: string, nowMs: number): void {
  db.prepare(
    `UPDATE artifact_jobs SET state = 'CANCELLED', recipe = NULL, lease_token = NULL, lease_until = NULL,
       error_code = 'quarantined', updated_at = ?
     WHERE paper_id = ? AND state IN ('PREPARE_QUEUED', 'PREPARING', 'PREPARED', 'IMAGE_QUEUED')`,
  ).run(nowMs, paperId);
}

// Papers that were already ACTIVE Release papers before keepsakes existed
// get their preparation job, a bounded batch at a time. Ended papers are
// never reconstructed.
export function discoverReleasePreparation(db: DB, nowMs: number, limit = 20): number {
  const rows = db
    .prepare(
      `SELECT id FROM papers
       WHERE mode = 'RELEASE' AND status = 'ACTIVE' AND id NOT IN (SELECT paper_id FROM artifact_jobs)
       LIMIT ?`,
    )
    .all(limit) as { id: string }[];
  let queued = 0;
  for (const { id } of rows) if (queueReleasePreparation(db, id, nowMs)) queued++;
  return queued;
}
