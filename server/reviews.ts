import type { DB } from "./db.ts";
import { log } from "./log.ts";
import { check, POLICY_VERSION, type Payload, type Provider } from "./moderation.ts";
import { quarantinePaper } from "./quarantine.ts";

// Reviews reported papers in the background, inside this one server process:
// no queue service, no second machine. Jobs live in SQLite, so a restart
// resumes them; a job whose lease ran out (the process died mid-check) is
// picked up again. One job at a time is plenty for this instance.
//
// A report is never proof. Only a clear automated violation or an operator's
// decision quarantines a paper, never the number of reports.

export const LEASE_MS = 30_000;
export const MAX_ATTEMPTS = 3;
// automated decisions per paper before further reports go to a person, so a
// stream of reports can't buy unlimited paid rechecks
export const MAX_RUNS = 3;

export type WorkerOptions = { retryDelaysMs?: number[]; intervalMs?: number; now?: () => number };

type ReviewRow = { id: string; paper_id: string; content_digest: string; attempts: number; runs: number };
type ReportRow = { reason: string; note: string | null };

const iso = (ms: number): string => new Date(ms).toISOString();

export function createReviewWorker(db: DB, provider: Provider | null, options: WorkerOptions = {}) {
  const delays = options.retryDelaysMs ?? [5_000, 30_000, 120_000];
  const interval = options.intervalMs ?? 5_000;
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  const set = (id: string, fields: Record<string, string | number | null>): void => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE report_reviews SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  };

  function housekeeping(): void {
    const t = iso(now());
    const purged = db.prepare("UPDATE reports SET note = NULL WHERE note IS NOT NULL AND note_expires_at < ?").run(t).changes;
    if (purged) log("report_notes", { outcome: "purged", count: purged });
    const recovered = db
      .prepare("UPDATE report_reviews SET state = 'retry_wait', lease_until = NULL, next_attempt_at = ? WHERE state = 'running' AND lease_until < ?")
      .run(t, t).changes;
    if (recovered) log("review", { outcome: "lease_recovered", count: recovered });
  }

  // Operator decisions written by the private CLI, applied here so the
  // resulting event reaches this process's live sessions.
  function applyMaintenance(): void {
    const jobs = db
      .prepare("SELECT id, kind, report_id, reason FROM maintenance_jobs WHERE state = 'pending' ORDER BY created_at")
      .all() as { id: string; kind: "dismiss" | "quarantine"; report_id: string; reason: string }[];
    for (const job of jobs) {
      const report = db.prepare("SELECT paper_id, review_id FROM reports WHERE id = ?").get(job.report_id) as
        | { paper_id: string; review_id: string }
        | undefined;
      let outcome = "missing_report";
      if (report && job.kind === "quarantine") {
        outcome = quarantinePaper(db, report.paper_id, job.reason, "operator").changed ? "quarantined" : "not_active";
        if (outcome === "quarantined") set(report.review_id, { outcome_reason: job.reason, provider: "operator" });
      } else if (report) {
        const changed = db
          .prepare(
            `UPDATE report_reviews SET state = 'dismissed', outcome_reason = ?, provider = 'operator', reviewed_at = ?, lease_until = NULL
             WHERE id = ? AND state NOT IN ('quarantined', 'obsolete')`,
          )
          .run(job.reason, iso(now()), report.review_id).changes;
        outcome = changed ? "dismissed" : "not_open";
      }
      db.prepare("UPDATE maintenance_jobs SET state = ?, outcome = ?, done_at = ? WHERE id = ?").run(
        outcome === "quarantined" || outcome === "dismissed" ? "done" : "skipped",
        outcome,
        iso(now()),
        job.id,
      );
      log("operator_decision", { job: job.id, report: job.report_id, kind: job.kind, outcome });
    }
  }

  function claim(): ReviewRow | null {
    return db.transaction((): ReviewRow | null => {
      const t = iso(now());
      const row = db
        .prepare(
          `SELECT id, paper_id, content_digest, attempts, runs FROM report_reviews
           WHERE state IN ('queued', 'retry_wait') AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1`,
        )
        .get(t) as ReviewRow | undefined;
      if (!row) return null;
      set(row.id, { state: "running", lease_until: iso(now() + LEASE_MS), attempts: row.attempts + 1 });
      return { ...row, attempts: row.attempts + 1 };
    })();
  }

  // Still ours and still worth deciding: the lease is held and the paper is
  // ACTIVE with the same words. Otherwise a late result changes nothing.
  function stillCurrent(job: ReviewRow): boolean {
    const review = db.prepare("SELECT state FROM report_reviews WHERE id = ?").get(job.id) as { state: string } | undefined;
    const paper = db.prepare("SELECT status, request_digest FROM papers WHERE id = ?").get(job.paper_id) as
      | { status: string; request_digest: string }
      | undefined;
    if (review?.state !== "running") return false;
    if (paper?.status !== "ACTIVE" || paper.request_digest !== job.content_digest) {
      set(job.id, { state: "obsolete", lease_until: null, reviewed_at: iso(now()) });
      log("review", { review: job.id, paper: job.paper_id, outcome: "obsolete" });
      return false;
    }
    return true;
  }

  const countReports = (reviewId: string): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM reports WHERE review_id = ?").get(reviewId) as { n: number }).n;

  async function decide(job: ReviewRow): Promise<void> {
    if (!stillCurrent(job)) return;
    if (job.runs >= MAX_RUNS) {
      set(job.id, { state: "human_review", lease_until: null, outcome_reason: "review_limit", reviewed_at: iso(now()) });
      return;
    }
    const paper = db.prepare("SELECT content FROM papers WHERE id = ?").get(job.paper_id) as { content: string };
    const reports = db.prepare("SELECT reason, note FROM reports WHERE review_id = ? ORDER BY created_at").all(job.id) as ReportRow[];
    const reasons = [...new Set(reports.map((r) => r.reason))];
    const notes = reports.map((r) => r.note).filter((n): n is string => !!n);
    // Several reporters who disagree, or add context nobody can check, go to a
    // person: the loudest allegation isn't chosen.
    const conflicting = reports.length > 1 && reasons.length > 1 && notes.length > 0;
    if (conflicting || notes.length > 1) {
      set(job.id, { state: "human_review", lease_until: null, outcome_reason: conflicting ? "conflicting_reports" : "multiple_report_notes", reviewed_at: iso(now()) });
      log("review", { review: job.id, paper: job.paper_id, outcome: "human_review", reason: "report_context" });
      return;
    }
    const payload: Payload = {
      paper_text: paper.content,
      report_reason: reasons.join(","),
      report_note: notes.length === 1 ? notes[0] : null,
    };

    const verdict = await check(provider, payload);
    applyMaintenance();
    if (!stillCurrent(job)) return;
    // Context can change while the provider is answering. A late accusation
    // must receive the same human routing as one present before the check.
    if (countReports(job.id) > reports.length) {
      const latest = db.prepare("SELECT reason, note FROM reports WHERE review_id = ?").all(job.id) as ReportRow[];
      const latestNotes = latest.filter((r) => !!r.note);
      const latestConflict = new Set(latest.map((r) => r.reason)).size > 1 && latestNotes.length > 0;
      if (latestConflict || latestNotes.length > 1) {
        set(job.id, { state: "human_review", lease_until: null, runs: job.runs + (verdict.kind === "unavailable" ? 0 : 1),
          outcome_reason: latestConflict ? "conflicting_reports" : "multiple_report_notes", reviewed_at: iso(now()) });
        return;
      }
    }
    const meta = { provider: provider?.name ?? "none", model: provider?.model ?? null, policy_version: POLICY_VERSION, reviewed_at: iso(now()) };

    if (verdict.kind === "unavailable") {
      const { error } = verdict;
      if (error.kind === "config" || job.attempts >= MAX_ATTEMPTS) {
        set(job.id, { ...meta, state: "human_review", lease_until: null, error_code: error.kind === "config" ? error.code : `exhausted_${error.code}` });
        log("review", { review: job.id, paper: job.paper_id, outcome: "human_review", error: error.code, attempts: job.attempts });
        if (error.kind === "config") console.warn(`moderation provider needs an operator: ${error.code}`);
        return;
      }
      const wait = Math.max(delays[Math.min(job.attempts - 1, delays.length - 1)], Math.min(error.retryAfterMs ?? 0, 120_000));
      set(job.id, { state: "retry_wait", lease_until: null, error_code: error.code, next_attempt_at: iso(now() + wait) });
      log("review", { review: job.id, paper: job.paper_id, outcome: "retry_wait", error: error.code, attempts: job.attempts });
      return;
    }

    set(job.id, { ...meta, runs: job.runs + 1, error_code: null });
    if (verdict.kind === "reject") {
      set(job.id, { outcome_reason: verdict.reason });
      const q = quarantinePaper(db, job.paper_id, verdict.reason, "automated");
      if (!q.changed) set(job.id, { state: "obsolete", lease_until: null });
      log("review", { review: job.id, paper: job.paper_id, outcome: q.changed ? "quarantined" : "obsolete", reason: verdict.reason });
    } else if (verdict.kind === "review") {
      const reason = verdict.reason;
      set(job.id, { state: "human_review", lease_until: null, outcome_reason: reason });
      log("review", { review: job.id, paper: job.paper_id, outcome: "human_review", reason });
    } else if (countReports(job.id) > reports.length) {
      // reported again while this check ran: look again with the new report
      set(job.id, { state: job.runs + 1 >= MAX_RUNS ? "human_review" : "queued", lease_until: null, attempts: 0, next_attempt_at: iso(now()) });
      log("review", { review: job.id, paper: job.paper_id, outcome: "requeued" });
    } else {
      set(job.id, { state: "dismissed", lease_until: null, outcome_reason: "none" });
      log("review", { review: job.id, paper: job.paper_id, outcome: "dismissed" });
    }
  }

  function schedule(): void {
    if (stopped) return;
    clearTimeout(timer);
    const next = db
      .prepare("SELECT MIN(next_attempt_at) AS t FROM report_reviews WHERE state IN ('queued', 'retry_wait')")
      .get() as { t: string | null };
    const due = next.t ? Math.max(0, Date.parse(next.t) - now()) : interval;
    timer = setTimeout(() => void wake(), Math.min(due, interval));
    timer.unref?.();
  }

  async function drain(): Promise<void> {
    do {
      again = false;
      housekeeping();
      applyMaintenance();
      for (let job = claim(); job && !stopped; job = claim()) {
        try {
          await decide(job);
        } catch {
          const row = db.prepare("SELECT state FROM report_reviews WHERE id = ?").get(job.id) as { state: string } | undefined;
          if (row?.state === "running") {
            const exhausted = job.attempts >= MAX_ATTEMPTS;
            set(job.id, { state: exhausted ? "human_review" : "retry_wait", lease_until: null,
              error_code: exhausted ? "exhausted_worker_error" : "worker_error",
              next_attempt_at: iso(now() + delays[Math.min(job.attempts - 1, delays.length - 1)]) });
          }
          // Exception messages may contain private text; log identifiers only.
          log("review", { review: job.id, paper: job.paper_id, outcome: "worker_error", attempts: job.attempts });
        }
      }
    } while (again && !stopped);
  }

  // Runs everything due now; concurrent wakes coalesce into one more pass.
  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = drain().finally(() => {
      running = null;
      schedule();
    });
    return running;
  }

  return {
    wake,
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}

export type ReviewWorker = ReturnType<typeof createReviewWorker>;
