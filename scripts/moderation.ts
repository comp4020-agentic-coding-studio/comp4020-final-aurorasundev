// Private maintenance for reported papers. Run it where the database lives,
// in the operator's own terminal (on Fly: `fly ssh console`, then
// `node scripts/moderation.ts …` in /app). Never in CI, never against a copy
// you'd paste anywhere: `inspect` prints a paper's words and a report's note.
//
//   pnpm moderation:list
//   pnpm moderation:inspect -- <report-id>
//   pnpm moderation:resolve -- <report-id> dismiss --reason <code>
//   pnpm moderation:resolve -- <report-id> quarantine --reason <code>
//
// `resolve` doesn't change the paper itself. It leaves a job that the
// running server's review worker applies with the same quarantine used for
// automated decisions, so every connected session hears about it at once. If
// no server is running, the job waits and is applied when the server starts.
import { randomUUID } from "node:crypto";
import { openDb } from "../server/db.ts";

const DISMISS_REASONS = ["no_violation", "insufficient_evidence", "duplicate"];
const QUARANTINE_REASONS = [
  "targeted_threat",
  "targeted_abuse",
  "hate",
  "sexual_minors",
  "explicit_sexual",
  "graphic_violence",
  "self_harm_instruction",
  "harmful_instruction",
  "private_information",
  "spam",
];

const usage = (): never => {
  console.error(
    "usage: moderation list | inspect <report-id> | resolve <report-id> dismiss|quarantine --reason <code>\n" +
      `  dismiss reasons: ${DISMISS_REASONS.join(", ")}\n  quarantine reasons: ${QUARANTINE_REASONS.join(", ")}`,
  );
  process.exit(2);
};

const dbPath = process.env.DATABASE_PATH ?? "/data/throwaway.sqlite";
const args = process.argv.slice(2).filter((a) => a !== "--");
const [command, reportId] = args;
if (!command) usage();
const db = openDb(dbPath);

const age = (iso: string): string => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 120 ? `${minutes}m` : minutes < 2880 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
};

if (command === "list") {
  // ids, states and ages only: no words, no notes
  const rows = db
    .prepare(
      `SELECT r.id AS report, r.paper_id AS paper, r.reason, r.created_at, v.state, v.error_code, p.status
       FROM reports r JOIN report_reviews v ON v.id = r.review_id JOIN papers p ON p.id = r.paper_id
       ORDER BY CASE v.state WHEN 'human_review' THEN 0 WHEN 'running' THEN 1 WHEN 'retry_wait' THEN 2 WHEN 'queued' THEN 3 ELSE 4 END,
                r.created_at`,
    )
    .all() as { report: string; paper: string; reason: string; created_at: string; state: string; error_code: string | null; status: string }[];
  if (rows.length === 0) console.log("no reports");
  for (const r of rows) {
    console.log(
      [r.report, `paper=${r.paper}`, `review=${r.state}`, `paper_status=${r.status.toLowerCase()}`, `reason=${r.reason}`, `age=${age(r.created_at)}`, r.error_code ? `error=${r.error_code}` : ""]
        .filter(Boolean)
        .join("  "),
    );
  }
} else if (command === "inspect") {
  if (!reportId) usage();
  const r = db
    .prepare(
      `SELECT r.id, r.paper_id, r.reason, r.note, r.created_at, v.state, v.outcome_reason, p.status, p.content, p.mode
       FROM reports r JOIN report_reviews v ON v.id = r.review_id JOIN papers p ON p.id = r.paper_id WHERE r.id = ?`,
    )
    .get(reportId) as Record<string, string | null> | undefined;
  if (!r) {
    console.error("no such report");
    process.exit(1);
  }
  const others = (db.prepare("SELECT reason FROM reports WHERE paper_id = ? AND id != ?").all(r.paper_id, reportId) as { reason: string }[]).map(
    (o) => o.reason,
  );
  console.log("PRIVATE — do not copy this into PROCESS, logs or chat.\n");
  console.log(`report ${r.id}  reason=${r.reason}  age=${age(r.created_at!)}  review=${r.state}${r.outcome_reason ? ` (${r.outcome_reason})` : ""}`);
  console.log(`other reports on this paper: ${others.length ? others.join(", ") : "none"}`);
  console.log(`paper ${r.paper_id}  status=${r.status!.toLowerCase()}  mode=${r.mode!.toLowerCase()}\n`);
  console.log(r.status === "ACTIVE" ? `--- paper text ---\n${r.content}\n------------------` : "(the paper's text is no longer held)");
  console.log(r.note ? `--- reporter's note ---\n${r.note}\n-----------------------` : "(no note, or it has been purged)");
} else if (command === "resolve") {
  const decision = args[2];
  const flag = args.indexOf("--reason");
  const reason = flag >= 0 ? args[flag + 1] : undefined;
  if (!reportId || (decision !== "dismiss" && decision !== "quarantine") || !reason) usage();
  const allowed = decision === "dismiss" ? DISMISS_REASONS : QUARANTINE_REASONS;
  if (!allowed.includes(reason!)) {
    console.error(`unknown reason for ${decision}: ${reason}`);
    usage();
  }
  if (!db.prepare("SELECT 1 FROM reports WHERE id = ?").get(reportId)) {
    console.error("no such report");
    process.exit(1);
  }
  const id = randomUUID();
  db.prepare("INSERT INTO maintenance_jobs (id, kind, report_id, reason, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(
    id,
    decision,
    reportId,
    reason,
    new Date().toISOString(),
  );
  // the running server's worker checks for jobs every few seconds
  const deadline = Date.now() + 15_000;
  let job: { state: string; outcome: string | null } | undefined;
  while (Date.now() < deadline) {
    job = db.prepare("SELECT state, outcome FROM maintenance_jobs WHERE id = ?").get(id) as typeof job;
    if (job?.state !== "pending") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (job?.state === "pending") {
    console.log(`job ${id} queued: no running server picked it up yet; it is applied when the server next runs`);
  } else {
    console.log(`job ${id} ${job?.state}: ${job?.outcome}`);
  }
} else {
  usage();
}
db.close();
