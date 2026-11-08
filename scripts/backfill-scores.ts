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
//
// --replace-older (owner, 2026-11-09): also re-compose every published
// record whose stored score came from an older composer (v1 or v2), with the
// current composer and a fresh seed, replacing that score. This is the
// owner's explicit decision to retire the older music, not a silent change:
// the older composers stay in shared/music-score.ts so any score still held
// elsewhere validates and plays. Scores already on the current composer are
// never touched. Back up the database first.
import { randomInt } from "node:crypto";
import { openDb } from "../server/db.ts";
import { composeForPublication, storedScore } from "../server/artifacts/store.ts";
import { COMPOSER_VERSION } from "../shared/music-score.ts";
import { DENSITIES, ENDINGS, MATERIALS, METAPHORS, MOTIONS, PALETTES, PULSES, RELATIONS, SPACES, TIMBRES, type CreativeBriefV2 } from "../server/artifacts/types.ts";

const dry = process.argv.includes("--dry-run");
const replaceOlder = process.argv.includes("--replace-older");
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

// the composer a stored score came from, or null if there is none to read
const composerOf = (raw: string | null): string | null => storedScore(raw)?.composer_version ?? null;

const all = db
  .prepare(
    `SELECT a.id, j.brief, a.music_score FROM artifacts a JOIN artifact_jobs j ON j.id = a.job_id
     WHERE a.status = 'PUBLISHED' AND (a.music_score IS NULL OR ?) ORDER BY a.id`,
  )
  .all(replaceOlder ? 1 : 0) as { id: string; brief: string | null; music_score: string | null }[];
// unscored records, and with --replace-older those on an older composer
// (an unreadable stored score counts as older: it can't play as it is)
const rows = all.filter((r) => r.music_score === null || composerOf(r.music_score) !== COMPOSER_VERSION);

const plan: { id: string; text: string; source: "brief" | "random"; was: string | null; previous: string | null }[] = [];
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
  plan.push({ id: row.id, text, source, was: row.music_score === null ? null : (composerOf(row.music_score) ?? "unreadable"), previous: row.music_score });
}

if (dry) {
  for (const p of plan) console.log(`${p.id} outcome=would_save source=${p.source} was=${p.was ?? "none"}`);
  console.log(`dry run: ${plan.length} of ${rows.length} published records ${replaceOlder ? "unscored or on an older composer" : "unscored"}`);
  process.exit(0);
}

const apply = db.transaction(() => {
  let saved = 0;
  // each update only lands if the score is still exactly what was read
  const fill = db.prepare("UPDATE artifacts SET music_score = ? WHERE id = ? AND status = 'PUBLISHED' AND music_score IS NULL");
  const replace = db.prepare("UPDATE artifacts SET music_score = ? WHERE id = ? AND status = 'PUBLISHED' AND music_score = ?");
  for (const p of plan) saved += (p.previous === null ? fill.run(p.text, p.id) : replace.run(p.text, p.id, p.previous)).changes;
  const revision = saved
    ? (db.prepare("UPDATE gallery_state SET revision = revision + 1 WHERE id = 1 RETURNING revision").get() as { revision: number }).revision
    : null;
  return { saved, revision };
});
const { saved, revision } = apply();
for (const p of plan) console.log(`${p.id} outcome=saved source=${p.source} was=${p.was ?? "none"}`);
console.log(`saved ${saved} of ${rows.length} published records${revision ? `; gallery revision ${revision}` : ""}`);
