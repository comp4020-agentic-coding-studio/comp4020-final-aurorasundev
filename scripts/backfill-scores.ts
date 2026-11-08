// One-off maintenance (owner, 2026-10-27): give the records published before
// music was enabled a score. Each record's own stored creative brief (the
// one its ignition request produced) goes through the same composer and
// validator as a fresh publication, with four fresh random bytes as its
// seed: no model request, and no paper words (they were deleted at the
// burn). Only published records with no score are touched; an existing
// score is never replaced. A record whose brief can't be read gets a random
// brief instead, so it still sounds. The Gallery revision moves once, so
// open pages pick the change up when they next reconcile.
//
// Run where the database lives (on Fly: `fly ssh console`, then
// `node scripts/backfill-scores.ts` in /app). Back up the database first.
// Add --dry-run to see what would change. Output is ids and outcomes only.
import { randomInt } from "node:crypto";
import { openDb } from "../server/db.ts";
import { composeForPublication, storedScore } from "../server/artifacts/store.ts";
import { DENSITIES, ENDINGS, MATERIALS, METAPHORS, MOTIONS, PALETTES, PULSES, RELATIONS, SPACES, TIMBRES, type CreativeBriefV2 } from "../server/artifacts/types.ts";

const dry = process.argv.includes("--dry-run");
const db = openDb(process.env.DATABASE_PATH ?? "/data/throwaway.sqlite");

const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)];
const randomBrief = (): CreativeBriefV2 => ({
  schema_version: 2,
  metaphor: pick(METAPHORS),
  relation: pick(RELATIONS),
  motion: pick(MOTIONS),
  space: pick(SPACES),
  material: pick(MATERIALS),
  palette: pick(PALETTES),
  music: { timbre: pick(TIMBRES), pulse: pick(PULSES), density: pick(DENSITIES), ending: pick(ENDINGS) },
});

const rows = db
  .prepare(
    `SELECT a.id, j.brief FROM artifacts a JOIN artifact_jobs j ON j.id = a.job_id
     WHERE a.status = 'PUBLISHED' AND a.music_score IS NULL ORDER BY a.id`,
  )
  .all() as { id: string; brief: string | null }[];

const plan: { id: string; text: string; source: "brief" | "random" }[] = [];
for (const row of rows) {
  let brief: CreativeBriefV2 | null = null;
  try {
    brief = row.brief ? (JSON.parse(row.brief) as CreativeBriefV2) : null;
  } catch {
    brief = null;
  }
  let text = brief ? composeForPublication(brief) : null;
  let source: "brief" | "random" = "brief";
  if (!text) {
    text = composeForPublication(randomBrief());
    source = "random";
  }
  if (!text || !storedScore(text)) {
    console.log(`${row.id} outcome=compose_failed`);
    continue;
  }
  plan.push({ id: row.id, text, source });
}

if (dry) {
  for (const p of plan) console.log(`${p.id} outcome=would_save source=${p.source}`);
  console.log(`dry run: ${plan.length} of ${rows.length} unscored published records`);
  process.exit(0);
}

const apply = db.transaction(() => {
  let saved = 0;
  const set = db.prepare("UPDATE artifacts SET music_score = ? WHERE id = ? AND status = 'PUBLISHED' AND music_score IS NULL");
  for (const p of plan) saved += set.run(p.text, p.id).changes;
  const revision = saved
    ? (db.prepare("UPDATE gallery_state SET revision = revision + 1 WHERE id = 1 RETURNING revision").get() as { revision: number }).revision
    : null;
  return { saved, revision };
});
const { saved, revision } = apply();
for (const p of plan) console.log(`${p.id} outcome=saved source=${p.source}`);
console.log(`saved ${saved} of ${rows.length} unscored published records${revision ? `; gallery revision ${revision}` : ""}`);
