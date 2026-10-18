import { randomUUID } from "node:crypto";
import type { DB } from "../db.ts";
import { log } from "../log.ts";
import type { Ignition } from "../papers.ts";
import { ARTIFACT_TIMEOUTS, ArtifactError, artifactAlt, artifactTitle, parseBrief, type ArtifactProvider } from "./provider.ts";
import { checkArtifactCapacity, readArtifactFile, recoverArtifactFile, removeArtifactFile, saveArtifactFile, sweepArtifactFiles } from "./storage.ts";
import { acceptBrief, applyArtifactAdminJobs, publishArtifact, sourceUnavailable } from "./store.ts";
import type { CreativeBriefV2, GalleryChange } from "./types.ts";

// Turns burned Release papers into published records.
//
// The note is read once, at ignition: the burn hands its source to
// `extract()` in memory, and one bounded request turns it into a creative
// brief while the fire burns. Only the brief is ever stored. If that request
// fails, times out (15 s) or the process restarts mid-request, the record is
// simply not made: the deleted note is never re-read and nothing unrelated
// is made in its place.
//
// From the brief, one loop inside this process works one job at a time:
// operator actions, inspection, then images. Before any provider request the
// job is leased (a random token) and the day's budget is reserved, in one
// transaction; every result is written only if that lease still holds. An
// image request is marked as dispatched before it leaves, so a crash
// mid-generation is found at startup as an unknown outcome and is never
// silently paid for twice. An image is not published before its fire could
// have ended.
//
// Logs carry job ids, states and codes; never an exception's message.

export const LEASE_MS = 180_000;
export const DAILY_BUDGET = { briefs: 20, images: 10, inspections: 20 };
// extractions in flight at once; more burns than this lose their record
export const MAX_EXTRACTIONS = 4;
const RATE_LIMIT_MIN_MS = 30_000;
const INSPECTION_DELAYS_MS = [5_000, 30_000];
const MAX_INSPECTIONS = 3;
const CAPACITY_RECHECK_MS = 60_000;
const CLAIM_BATCH = 20;

export type ArtifactWorkerOptions = {
  artifactDir: string;
  enabled: boolean;
  onChange: (change: GalleryChange) => void;
  // a burn's extraction has settled, so its fire may end (paper id only)
  onSettled?: (paperId: string) => void;
  now?: () => number;
  pollMs?: number;
  // test-only shortening of the fixed retry waits
  delays?: { rateLimitMinMs?: number; inspectionMs?: number[]; capacityMs?: number };
};

type Job = {
  id: string;
  paper_id: string;
  public_id: string;
  state: string;
  brief: string | null;
  image_attempts: number;
  review_attempts: number;
  file_key: string | null;
};

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createArtifactWorker(db: DB, provider: ArtifactProvider | null, options: ArtifactWorkerOptions) {
  const now = options.now ?? Date.now;
  const poll = options.pollMs ?? 1_000;
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
          `SELECT id, paper_id, public_id, state, brief, image_attempts, review_attempts, file_key
           FROM artifact_jobs WHERE state IN (${states.map(() => "?").join(",")}) AND next_attempt_at <= ?
             AND (state <> 'REVIEW_QUEUED' OR not_before <= ?)
           ORDER BY next_attempt_at, id LIMIT ?`,
        )
        .all(...states, now(), now(), CLAIM_BATCH) as Job[];
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
    // an extraction that was in flight when the process stopped: its note
    // existed only in that request, and the paper is gone, so no record
    const lost = db.prepare("SELECT id, paper_id FROM artifact_jobs WHERE state = 'EXTRACTING'").all() as { id: string; paper_id: string }[];
    for (const job of lost) {
      if (sourceUnavailable(db, job.id, null, "source_lost_on_restart", t)) {
        options.onSettled?.(job.paper_id);
        log("artifact", { job: job.id, outcome: "source_unavailable", reason: "source_lost_on_restart" });
      }
    }
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
    // the last step before publishing waits until the fire could have ended,
    // so a record never appears before its paper has finished burning
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
      const brief = parseBrief(JSON.parse(job.brief!));
      const change = publishArtifact(db, job.id, lease, now(), { title: artifactTitle(brief), alt: artifactAlt(brief) });
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

  // --- ignition extraction (driven by the burn, not the loop) -------------------

  let extracting = 0;
  // One bounded request from a fresh Release burn's note, held only in this
  // closure. The brief is accepted only under the burn's lease and before its
  // deadline; anything else leaves the job SOURCE_UNAVAILABLE.
  async function extract(ignition: Ignition): Promise<void> {
    const { jobId, lease, paperId, extractUntil } = ignition;
    let source: Ignition["source"] | null = ignition.source;
    const settle = (code: string | null, brief?: CreativeBriefV2) => {
      const accepted = brief ? acceptBrief(db, jobId, lease, brief, now()) : false;
      if (!accepted) sourceUnavailable(db, jobId, lease, code ?? "brief_too_late", now());
      log("artifact", { job: jobId, outcome: accepted ? "brief_accepted" : "source_unavailable", reason: accepted ? undefined : (code ?? "brief_too_late") });
      options.onSettled?.(paperId);
      if (accepted) void wake();
    };
    if (stopped) return settle("shutting_down");
    if (!dispatching) return settle("generation_paused");
    if (extracting >= MAX_EXTRACTIONS) return settle("extraction_capacity");
    if (!reserve("briefs")) return settle("daily_budget");
    extracting++;
    const controller = new AbortController();
    inFlight.add(controller);
    const timeout = setTimeout(() => controller.abort(), Math.max(0, extractUntil - now()));
    try {
      const brief = await provider!.extractBrief(source, controller.signal);
      source = null;
      settle(null, brief);
    } catch (err) {
      source = null;
      const e = err instanceof ArtifactError ? err : new ArtifactError("brief_worker_error", "transient");
      settle(controller.signal.aborted ? (stopped ? "shutting_down" : "brief_timeout") : e.code);
      if (e.kind === "config") console.warn(`artifact provider needs an operator: ${e.code}`);
    } finally {
      clearTimeout(timeout);
      inFlight.delete(controller);
      extracting--;
    }
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
    let brief: CreativeBriefV2;
    try {
      brief = parseBrief(JSON.parse(job.brief ?? "null"));
    } catch {
      settle(job, lease, { state: "FAILED", error_code: "brief_invalid" });
      return true;
    }
    try {
      const image = await call(ARTIFACT_TIMEOUTS.image, (signal) => provider!.generateImage(brief, signal));
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
      if (!dispatching) continue;
      // inspection and operator actions first, then images
      for (;;) {
        if (stopped) break;
        applyAdmin();
        if (await inspectOne()) continue;
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
    extract,
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
