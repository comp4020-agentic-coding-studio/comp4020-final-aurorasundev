import { randomUUID } from "node:crypto";
import type { DB } from "../db.ts";
import { log } from "../log.ts";
import { ARTIFACT_TIMEOUTS, ArtifactError, artifactAlt, artifactTitle, parseRecipe, type ArtifactProvider } from "./provider.ts";
import { checkArtifactCapacity, readArtifactFile, recoverArtifactFile, removeArtifactFile, saveArtifactFile, sweepArtifactFiles } from "./storage.ts";
import { applyArtifactAdminJobs, discoverReleasePreparation, publishArtifact } from "./store.ts";
import type { GalleryChange, Recipe } from "./types.ts";

// Turns burned Release papers into published keepsakes, one job at a time,
// inside this server process. Jobs live in SQLite, so a restart resumes them.
//
// Before any provider request the job is leased (a random token) and the
// day's budget is reserved, in one transaction; every result is written only
// if that lease still holds and the paper is still in the state it needs.
// An image request is marked as dispatched before it leaves, so a crash
// mid-generation is found at startup as an unknown outcome and is never
// silently paid for twice.
//
// Paper words and drawings are read only to prepare a recipe while the paper
// is ACTIVE, held in memory for that one request, and never written anywhere.
// Logs carry job ids, states and codes; never an exception's message.

export const LEASE_MS = 180_000;
export const DAILY_BUDGET = { recipes: 20, images: 10, inspections: 20 };
const RECIPE_RETRY_MS = 5_000;
const MAX_RECIPE_ATTEMPTS = 2;
const RATE_LIMIT_MIN_MS = 30_000;
const INSPECTION_DELAYS_MS = [5_000, 30_000];
const MAX_INSPECTIONS = 3;
const CAPACITY_RECHECK_MS = 60_000;
const DISCOVERY_BATCH = 20;

export type ArtifactWorkerOptions = {
  artifactDir: string;
  enabled: boolean;
  onChange: (change: GalleryChange) => void;
  now?: () => number;
  pollMs?: number;
  // test-only shortening of the fixed retry waits
  delays?: { recipeRetryMs?: number; rateLimitMinMs?: number; inspectionMs?: number[]; capacityMs?: number };
};

type Job = {
  id: string;
  paper_id: string;
  public_id: string;
  state: string;
  recipe: string | null;
  prepare_attempts: number;
  image_attempts: number;
  review_attempts: number;
  file_key: string | null;
};

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createArtifactWorker(db: DB, provider: ArtifactProvider | null, options: ArtifactWorkerOptions) {
  const now = options.now ?? Date.now;
  const poll = options.pollMs ?? 1_000;
  const recipeRetry = options.delays?.recipeRetryMs ?? RECIPE_RETRY_MS;
  const rateLimitMin = options.delays?.rateLimitMinMs ?? RATE_LIMIT_MIN_MS;
  const inspectionDelays = options.delays?.inspectionMs ?? INSPECTION_DELAYS_MS;
  const capacityWait = options.delays?.capacityMs ?? CAPACITY_RECHECK_MS;
  const dir = options.artifactDir;
  const dispatching = options.enabled && provider !== null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let started = false;
  const inFlight = new Set<AbortController>();

  // field names are this module's own constants; values are always bound
  const update = (id: string, fields: Record<string, string | number | null>, lease?: string): number => {
    const keys = Object.keys(fields);
    const guard = lease === undefined ? "" : " AND lease_token = ?";
    return db
      .prepare(`UPDATE artifact_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?${guard}`)
      .run(...keys.map((k) => fields[k]), now(), id, ...(lease === undefined ? [] : [lease])).changes;
  };
  // writes only if this exact lease still holds
  const settle = (job: Job, lease: string, fields: Record<string, string | number | null>): boolean =>
    update(job.id, { ...fields, lease_token: null, lease_until: null }, lease) === 1;

  // Reserves one unit of today's budget; false if the day's cap is reached.
  function reserve(kind: keyof typeof DAILY_BUDGET): boolean {
    const day = utcDay(now());
    db.prepare("INSERT INTO artifact_budgets (day) VALUES (?) ON CONFLICT (day) DO NOTHING").run(day);
    return (
      db.prepare(`UPDATE artifact_budgets SET ${kind} = ${kind} + 1 WHERE day = ? AND ${kind} < ?`).run(day, DAILY_BUDGET[kind]).changes === 1
    );
  }
  const nextUtcDay = (): number => {
    const d = new Date(now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };

  // Claims the next due job in one of `states`, moving it to `to` under a
  // fresh lease and reserving `budget` in the same transaction. A job whose
  // budget is spent waits for the next UTC day instead.
  function claim(states: string[], to: string, budget: keyof typeof DAILY_BUDGET, extra: (job: Job) => boolean = () => true): { job: Job; lease: string } | null {
    return db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT id, paper_id, public_id, state, recipe, prepare_attempts, image_attempts, review_attempts, file_key
           FROM artifact_jobs WHERE state IN (${states.map(() => "?").join(",")}) AND next_attempt_at <= ?
           ORDER BY next_attempt_at, id LIMIT ?`,
        )
        .all(...states, now(), DISCOVERY_BATCH) as Job[];
      for (const job of rows) {
        if (!extra(job)) continue;
        if (!reserve(budget)) {
          update(job.id, { next_attempt_at: nextUtcDay(), error_code: "daily_budget" });
          log("artifact", { job: job.id, outcome: "deferred", reason: "daily_budget" });
          continue;
        }
        const lease = randomUUID();
        update(job.id, { state: to, lease_token: lease, lease_until: now() + LEASE_MS, error_code: null });
        return { job: { ...job, state: to }, lease };
      }
      return null;
    })();
  }

  async function call<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    inFlight.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timeout);
      inFlight.delete(controller);
    }
  }

  // --- startup recovery -------------------------------------------------------

  async function recover(): Promise<void> {
    const t = now();
    // a recipe that was in flight: the paper may still be here, so try again
    db.prepare(
      "UPDATE artifact_jobs SET state = 'PREPARE_QUEUED', lease_token = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE state = 'PREPARING' AND (lease_until IS NULL OR lease_until < ?)",
    ).run(t, t, t);
    // an inspection that was in flight: inspect again (counted against its cap)
    db.prepare(
      "UPDATE artifact_jobs SET state = 'REVIEW_QUEUED', lease_token = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE state = 'REVIEWING' AND (lease_until IS NULL OR lease_until < ?)",
    ).run(t, t, t);
    // an image request that was in flight: if its file was finalized, adopt
    // it and inspect; otherwise its outcome is unknown and it is not resent
    const generating = db
      .prepare("SELECT id, public_id FROM artifact_jobs WHERE state = 'GENERATING' AND (lease_until IS NULL OR lease_until < ?)")
      .all(t) as { id: string; public_id: string }[];
    for (const job of generating) {
      const fileKey = await recoverArtifactFile(dir, job.public_id);
      if (fileKey) {
        update(job.id, { state: "REVIEW_QUEUED", file_key: fileKey, lease_token: null, lease_until: null, next_attempt_at: t, error_code: null });
        log("artifact", { job: job.id, outcome: "file_recovered" });
      } else {
        update(job.id, { state: "GENERATION_UNKNOWN", lease_token: null, lease_until: null, error_code: "interrupted_after_dispatch" });
        log("artifact", { job: job.id, outcome: "generation_unknown", reason: "interrupted_after_dispatch" });
      }
    }
    await sweepArtifactFiles(db, dir);
  }

  // --- the steps --------------------------------------------------------------

  function applyAdmin(): void {
    const { changes, filesToDelete } = applyArtifactAdminJobs(db, now());
    for (const change of changes) {
      options.onChange(change);
      log("gallery", { artifact: change.type === "artifact:hidden" ? change.id : change.artifact.id, outcome: change.type, revision: change.revision });
    }
    // the hide has committed: the file goes after
    for (const fileKey of filesToDelete) void removeArtifactFile(dir, fileKey).catch(() => {});
  }

  async function inspectOne(): Promise<boolean> {
    const claimed = claim(["REVIEW_QUEUED"], "REVIEWING", "inspections");
    if (!claimed) return false;
    const { job, lease } = claimed;
    const attempt = job.review_attempts + 1;
    update(job.id, { review_attempts: attempt });
    const fail = (state: "BLOCKED" | "FAILED", code: string) => {
      if (settle(job, lease, { state, error_code: code }) && job.file_key) void removeArtifactFile(dir, job.file_key).catch(() => {});
      log("artifact", { job: job.id, outcome: state.toLowerCase(), reason: code });
    };
    let bytes: Buffer;
    try {
      bytes = await readArtifactFile(dir, job.file_key!);
    } catch {
      fail("FAILED", "file_unreadable");
      return true;
    }
    try {
      const verdict = await call(ARTIFACT_TIMEOUTS.inspection, (signal) => provider!.inspectImage(bytes, signal));
      if (verdict !== "allow") {
        fail("BLOCKED", "inspection_blocked");
        return true;
      }
      const recipe = parseRecipe(JSON.parse(job.recipe!));
      const change = publishArtifact(db, job.id, lease, now(), { title: artifactTitle(recipe), alt: artifactAlt(recipe) });
      if (change) {
        options.onChange(change);
        log("artifact", { job: job.id, artifact: change.type === "artifact:published" ? change.artifact.id : undefined, outcome: "published", revision: change.revision });
      }
    } catch (err) {
      const e = err instanceof ArtifactError ? err : new ArtifactError("worker_error", "transient");
      if (e.kind === "transient" && attempt < MAX_INSPECTIONS) {
        settle(job, lease, { state: "REVIEW_QUEUED", error_code: e.code, next_attempt_at: now() + inspectionDelays[attempt - 1] });
        log("artifact", { job: job.id, outcome: "inspection_retry", reason: e.code, attempt });
      } else {
        fail("FAILED", e.kind === "transient" ? `exhausted_${e.code}` : e.code);
      }
    }
    return true;
  }

  async function prepareOne(): Promise<boolean> {
    const claimed = claim(["PREPARE_QUEUED"], "PREPARING", "recipes");
    if (!claimed) return false;
    const { job, lease } = claimed;
    const attempt = job.prepare_attempts + 1;
    update(job.id, { prepare_attempts: attempt });
    // read the paper into memory only while it is still ACTIVE and Release
    const paper = db.prepare("SELECT content, drawing FROM papers WHERE id = ? AND status = 'ACTIVE' AND mode = 'RELEASE'").get(job.paper_id) as
      | { content: string; drawing: string | null }
      | undefined;
    if (!paper) {
      // burned or removed since the claim: the burn or quarantine moved the
      // job and dropped this lease, so there is nothing to write
      return true;
    }
    let recipe: Recipe | null = null;
    let error: ArtifactError | null = null;
    try {
      recipe = await call(ARTIFACT_TIMEOUTS.recipe, (signal) => provider!.prepareRecipe({ text: paper.content, drawing: paper.drawing }, signal));
    } catch (err) {
      error = err instanceof ArtifactError ? err : new ArtifactError("worker_error", "transient");
    }
    // persist only if still ours and the paper is still here as Release
    db.transaction(() => {
      const still = db.prepare("SELECT 1 FROM papers WHERE id = ? AND status = 'ACTIVE' AND mode = 'RELEASE'").get(job.paper_id);
      if (!still) {
        log("artifact", { job: job.id, outcome: "recipe_discarded", reason: "paper_not_active" });
        return;
      }
      if (recipe) {
        if (settle(job, lease, { state: "PREPARED", recipe: JSON.stringify(recipe), recipe_source: "prepared", error_code: null })) {
          log("artifact", { job: job.id, outcome: "prepared" });
        } else log("artifact", { job: job.id, outcome: "recipe_discarded", reason: "lease_lost" });
        return;
      }
      const retry = error!.kind === "transient" && attempt < MAX_RECIPE_ATTEMPTS;
      // no recipe: it waits for a retry, or the burn will use a neutral one
      settle(job, lease, retry
        ? { state: "PREPARE_QUEUED", error_code: error!.code, next_attempt_at: now() + recipeRetry }
        : { state: "PREPARED", error_code: error!.code });
      log("artifact", { job: job.id, outcome: retry ? "recipe_retry" : "recipe_failed", reason: error!.code });
    })();
    return true;
  }

  // The image step needs room on disk; without it jobs wait. Room is checked
  // before every image while there is some, and once a minute while full.
  let capacityOk = true;
  let capacityCheckedAt = -Infinity;
  async function imageOne(): Promise<boolean> {
    if (capacityOk || now() - capacityCheckedAt >= capacityWait) {
      capacityOk = await checkArtifactCapacity(db, dir);
      capacityCheckedAt = now();
    }
    if (!capacityOk) {
      const waiting = db
        .prepare("UPDATE artifact_jobs SET error_code = 'storage_full', next_attempt_at = ?, updated_at = ? WHERE state = 'IMAGE_QUEUED' AND next_attempt_at <= ?")
        .run(now() + capacityWait, now(), now()).changes;
      if (waiting) log("artifact", { outcome: "deferred", reason: "storage_full", count: waiting });
      return false;
    }
    const claimed = claim(["IMAGE_QUEUED"], "GENERATING", "images");
    if (!claimed) return false;
    const { job, lease } = claimed;
    // durably dispatched before the request leaves
    const attempt = job.image_attempts + 1;
    update(job.id, { image_attempts: attempt });
    let recipe: Recipe;
    try {
      recipe = parseRecipe(JSON.parse(job.recipe ?? "null"));
    } catch {
      settle(job, lease, { state: "FAILED", error_code: "recipe_invalid" });
      return true;
    }
    try {
      const image = await call(ARTIFACT_TIMEOUTS.image, (signal) => provider!.generateImage(recipe, signal));
      const fileKey = await saveArtifactFile(dir, job.public_id, image.bytes);
      if (!settle(job, lease, { state: "REVIEW_QUEUED", file_key: fileKey, next_attempt_at: now(), error_code: null })) {
        // lost the lease (shut down, or an operator acted): recovery will adopt it
        log("artifact", { job: job.id, outcome: "image_lease_lost" });
      } else log("artifact", { job: job.id, outcome: "generated" });
    } catch (err) {
      const e = err instanceof ArtifactError ? err : new ArtifactError("storage_error", "ambiguous");
      if (e.kind === "transient" && e.code === "image_rate_limited" && attempt === 1) {
        // an explicit 429 means nothing was generated: one more try, later
        settle(job, lease, { state: "IMAGE_QUEUED", error_code: e.code, next_attempt_at: now() + Math.max(rateLimitMin, e.retryAfterMs ?? 0) });
        log("artifact", { job: job.id, outcome: "image_retry", reason: e.code });
      } else if (e.kind === "ambiguous") {
        settle(job, lease, { state: "GENERATION_UNKNOWN", error_code: e.code });
        log("artifact", { job: job.id, outcome: "generation_unknown", reason: e.code });
      } else {
        settle(job, lease, { state: "FAILED", error_code: e.code });
        log("artifact", { job: job.id, outcome: "failed", reason: e.code });
        if (e.kind === "config") console.warn(`artifact provider needs an operator: ${e.code}`);
      }
    }
    return true;
  }

  // --- loop -------------------------------------------------------------------

  async function drain(): Promise<void> {
    if (!started) {
      started = true;
      await recover();
    }
    do {
      again = false;
      applyAdmin();
      while (!stopped && discoverReleasePreparation(db, now(), DISCOVERY_BATCH) === DISCOVERY_BATCH);
      if (!dispatching) continue;
      // inspection and operator actions first, then recipes, then images
      for (;;) {
        if (stopped) break;
        applyAdmin();
        if (await inspectOne()) continue;
        if (await prepareOne()) continue;
        if (await imageOne()) continue;
        break;
      }
    } while (again && !stopped);
  }

  function schedule(): void {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void wake(), poll);
    timer.unref?.();
  }

  // Runs everything due now; concurrent wakes coalesce into one more pass,
  // never a second runner.
  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = drain()
      .catch(() => log("artifact", { outcome: "worker_error" }))
      .finally(() => {
        running = null;
        schedule();
      });
    return running;
  }

  return {
    wake,
    // Stops polling, aborts provider requests and waits for the current step
    // to settle, so nothing writes to the database after this resolves.
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      for (const controller of inFlight) controller.abort();
      await running;
    },
    enabled: dispatching,
  };
}

export type ArtifactWorker = ReturnType<typeof createArtifactWorker>;
