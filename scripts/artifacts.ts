// Private maintenance for the Gallery. Run it where the database lives, in
// the operator's own terminal (on Fly: `fly ssh console`, then
// `node scripts/artifacts.ts …` in /app). There is no HTTP route for any of
// this.
//
//   pnpm artifacts:reports
//   pnpm artifacts:hide -- <artifact-id> --reason <code>
//   pnpm artifacts:dismiss -- <report-id>
//   pnpm artifacts:retry -- <job-id> --acknowledge-possible-charge
//   pnpm artifacts:jobs
//
// Commands only queue an action. The running server's artifact worker
// applies it (and tells open Gallery pages about a hide) within a second or
// so; if no server is running, it waits and is applied at the next start.
// Output is ids, states, reasons and ages: never a paper's words or drawing,
// a recipe or a provider response.
import { openDb } from "../server/db.ts";
import { enqueueAdminJob } from "../server/artifacts/store.ts";

const HIDE_REASONS = ["legible_text", "face", "identifiable_place", "harmful", "private_information", "reported", "other"];

const usage = (): never => {
  console.error(
    "usage: artifacts reports | jobs | hide <artifact-id> --reason <code> | dismiss <report-id> | retry <job-id> --acknowledge-possible-charge\n" +
      `  hide reasons: ${HIDE_REASONS.join(", ")}`,
  );
  process.exit(2);
};

const dbPath = process.env.DATABASE_PATH ?? "/data/throwaway.sqlite";
const args = process.argv.slice(2).filter((a) => a !== "--");
const [command, target] = args;
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
if (!command) usage();
const db = openDb(dbPath);

const age = (ms: number): string => {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  return minutes < 120 ? `${minutes}m` : minutes < 2880 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
};

if (command === "reports") {
  const rows = db
    .prepare(
      `SELECT r.id, r.artifact_id, r.reason, r.status, r.created_at, a.status AS artifact_status
       FROM artifact_reports r JOIN artifacts a ON a.id = r.artifact_id
       ORDER BY CASE r.status WHEN 'queued' THEN 0 ELSE 1 END, r.created_at`,
    )
    .all() as { id: string; artifact_id: string; reason: string; status: string; created_at: number; artifact_status: string }[];
  if (rows.length === 0) console.log("no reports");
  for (const r of rows) {
    console.log(`${r.id}  artifact=${r.artifact_id}  artifact_status=${r.artifact_status.toLowerCase()}  report=${r.status}  reason=${r.reason}  age=${age(r.created_at)}`);
  }
} else if (command === "jobs") {
  const rows = db
    .prepare("SELECT id, state, recipe_source, error_code, image_attempts, review_attempts, updated_at FROM artifact_jobs ORDER BY updated_at DESC LIMIT 50")
    .all() as { id: string; state: string; recipe_source: string | null; error_code: string | null; image_attempts: number; review_attempts: number; updated_at: number }[];
  if (rows.length === 0) console.log("no jobs");
  for (const j of rows) {
    console.log(
      [j.id, j.state.toLowerCase(), j.recipe_source ? `recipe=${j.recipe_source}` : "", `images=${j.image_attempts}`, `reviews=${j.review_attempts}`, j.error_code ? `error=${j.error_code}` : "", `age=${age(j.updated_at)}`]
        .filter(Boolean)
        .join("  "),
    );
  }
} else if (command === "hide") {
  const reason = flag("--reason");
  if (!target || !reason || !HIDE_REASONS.includes(reason)) usage();
  if (!db.prepare("SELECT 1 FROM artifacts WHERE id = ?").get(target)) {
    console.error("no such artifact");
    process.exit(1);
  }
  console.log(`queued hide ${enqueueAdminJob(db, "hide", target!, reason!, Date.now())}: the running server applies it`);
} else if (command === "dismiss") {
  if (!target) usage();
  if (!db.prepare("SELECT 1 FROM artifact_reports WHERE id = ?").get(target)) {
    console.error("no such report");
    process.exit(1);
  }
  console.log(`queued dismiss ${enqueueAdminJob(db, "dismiss", target!, null, Date.now())}: the running server applies it`);
} else if (command === "retry") {
  if (!target) usage();
  if (!args.includes("--acknowledge-possible-charge")) {
    console.error(
      "refused: this generation's outcome is unknown, so it may already have been generated and charged.\n" +
        "Retrying sends a new paid image request. Add --acknowledge-possible-charge to accept that.",
    );
    process.exit(1);
  }
  const job = db.prepare("SELECT state FROM artifact_jobs WHERE id = ?").get(target) as { state: string } | undefined;
  if (job?.state !== "GENERATION_UNKNOWN") {
    console.error("only a job whose generation is unknown can be retried");
    process.exit(1);
  }
  console.log(`queued retry ${enqueueAdminJob(db, "retry", target!, null, Date.now())}: the running server applies it`);
} else {
  usage();
}
db.close();
