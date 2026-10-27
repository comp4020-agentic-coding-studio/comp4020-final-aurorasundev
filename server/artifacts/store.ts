import { randomBytes, randomUUID } from "node:crypto";
import { composeMusicScore, parseMusicScore, type MusicScoreV1, type PublicMusic } from "../../shared/music-score.ts";
import type { DB } from "../db.ts";
import type { CreativeBriefV2, GalleryChange, GalleryPage, PublicArtifact } from "./types.ts";

// Durable record jobs. Every function here is synchronous and makes no
// network call, so the paper lifecycle can call it inside its own
// transaction. SQLite's UNIQUE(paper_id) is what guarantees one job per paper.

// How long an ignition extraction may take. The burner's fire lasts as long
// as the extraction, but never longer than this; past it the extraction has
// failed and no record is made.
export const EXTRACT_LIMIT_MS = 15_000;

export type ReleaseSource = { text: string; drawing: string | null };

// Inside the burn transaction, after rights are checked and before the words
// and drawing are cleared: a Release paper gets its one job, and the caller
// gets the paper's source in memory for the single extraction request. A Keep
// paper, or a paper that already has a job, gets nothing. The source is never
// written anywhere by this module.
export function beginReleaseExtraction(
  db: DB,
  paperId: string,
  nowMs: number,
  burnMs: number,
): { jobId: string; lease: string; source: ReleaseSource; extractUntil: number } | null {
  const paper = db.prepare("SELECT mode, status, content, drawing FROM papers WHERE id = ?").get(paperId) as
    | { mode: string; status: string; content: string; drawing: string | null }
    | undefined;
  if (paper?.mode !== "RELEASE" || paper.status !== "ACTIVE") return null;
  const jobId = randomUUID();
  const lease = randomUUID();
  const extractUntil = nowMs + EXTRACT_LIMIT_MS;
  const inserted = db
    .prepare(
      `INSERT INTO artifact_jobs (id, paper_id, public_id, state, lease_token, lease_until, extract_until, not_before,
         next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'EXTRACTING', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (paper_id) DO NOTHING`,
    )
    .run(jobId, paperId, randomUUID(), lease, extractUntil, extractUntil, nowMs + burnMs, nowMs, nowMs, nowMs).changes;
  if (!inserted) return null;
  return { jobId, lease, source: { text: paper.content, drawing: paper.drawing }, extractUntil };
}

// Inside a successful quarantine: no record, and a late brief can't land.
export function cancelArtifactJob(db: DB, paperId: string, nowMs: number): void {
  db.prepare(
    `UPDATE artifact_jobs SET state = 'CANCELLED', brief = NULL, lease_token = NULL, lease_until = NULL,
       error_code = 'quarantined', updated_at = ?
     WHERE paper_id = ? AND state IN ('EXTRACTING', 'IMAGE_QUEUED')`,
  ).run(nowMs, paperId);
}

// Where a burn's extraction stands, for the fire that waits on it. Public
// shape only: settled or not, and when it gives up. Never the brief.
export function extractionStatus(db: DB, paperId: string): { settled: boolean; until: number } | null {
  const row = db.prepare("SELECT state, extract_until FROM artifact_jobs WHERE paper_id = ?").get(paperId) as
    | { state: string; extract_until: number | null }
    | undefined;
  if (!row) return null;
  return { settled: row.state !== "EXTRACTING", until: row.extract_until ?? 0 };
}

// A validated brief for this job's own note, accepted only under the lease
// its burn took and only while the extraction is still open. From here the
// job holds the brief alone. Returns whether it was accepted.
export function acceptBrief(db: DB, jobId: string, lease: string, brief: CreativeBriefV2, nowMs: number): boolean {
  return (
    db
      .prepare(
        `UPDATE artifact_jobs SET state = 'IMAGE_QUEUED', brief = ?, brief_version = 2, lease_token = NULL,
           lease_until = NULL, next_attempt_at = ?, error_code = NULL, updated_at = ?
         WHERE id = ? AND state = 'EXTRACTING' AND lease_token = ? AND extract_until >= ?`,
      )
      .run(JSON.stringify(brief), nowMs, nowMs, jobId, lease, nowMs).changes === 1
  );
}

// The extraction could not produce a brief (refused, malformed, timed out,
// over budget, or the process restarted and lost the note). The burn stands;
// no record is made, and nothing unrelated is made in its place.
export function sourceUnavailable(db: DB, jobId: string, lease: string | null, code: string, nowMs: number): boolean {
  return (
    db
      .prepare(
        `UPDATE artifact_jobs SET state = 'SOURCE_UNAVAILABLE', lease_token = NULL, lease_until = NULL, error_code = ?,
           updated_at = ?
         WHERE id = ? AND state = 'EXTRACTING' AND (? IS NULL OR lease_token = ?)`,
      )
      .run(code, nowMs, jobId, lease, lease).changes === 1
  );
}

// --- the public collection ---------------------------------------------------

export const galleryRevision = (db: DB): number =>
  (db.prepare("SELECT revision FROM gallery_state WHERE id = 1").get() as { revision: number }).revision;
const bumpGalleryRevision = (db: DB): number =>
  (db.prepare("UPDATE gallery_state SET revision = revision + 1 WHERE id = 1 RETURNING revision").get() as { revision: number }).revision;
export const galleryTotal = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE status = 'PUBLISHED'").get() as { n: number }).n;

type ArtifactRow = { id: string; version: number; title: string; alt: string; music_score: string | null; published_at: number };
const ROW = "id, version, title, alt, music_score, published_at";

// How long a record counts as arrived recently (owner, 2026-10-27: so someone
// who just released a note can find what it left). Public only as a yes, never
// as a time, and it changes no order.
export const RECENT_MS = 24 * 60 * 60 * 1000;

// A stored score, read strictly; anything unreadable or unsupported is null.
export function storedScore(raw: string | null): MusicScoreV1 | null {
  if (raw === null) return null;
  try {
    return parseMusicScore(JSON.parse(raw));
  } catch {
    return null;
  }
}

// What a visitor may know about a record's sound: no stored score means an
// image-only record (no field at all); a stored score is ready only while
// music is enabled and the score is valid, otherwise it is unavailable.
function publicMusic(raw: string | null, musicEnabled: boolean): PublicMusic | undefined {
  if (raw === null) return undefined;
  return musicEnabled && storedScore(raw) ? { status: "ready", score_version: 1, duration_ms: 24000 } : { status: "unavailable" };
}

// The only shape a public object ever has: an allowlist, built field by field.
export const publicArtifact = (row: ArtifactRow, musicEnabled = false, nowMs = Date.now()): PublicArtifact => {
  const artifact: PublicArtifact = {
    id: row.id,
    version: row.version,
    image_url: `/api/gallery/${row.id}/image`,
    width: 1024,
    height: 1024,
    title: row.title,
    alt: row.alt,
  };
  const music = publicMusic(row.music_score, musicEnabled);
  if (music) artifact.music = music;
  if (nowMs - row.published_at < RECENT_MS) artifact.recent = true;
  return artifact;
};

// One page in random-UUID order (an unordered collection, not a feed).
export function galleryPage(db: DB, limit: number, after: string | null, musicEnabled = false): GalleryPage {
  const read = db.transaction((): GalleryPage => {
    const rows = db
      .prepare(
        `SELECT ${ROW} FROM artifacts
         WHERE status = 'PUBLISHED' AND id > ? ORDER BY id LIMIT ?`,
      )
      .all(after ?? "", limit + 1) as ArtifactRow[];
    const items = rows.slice(0, limit).map((row) => publicArtifact(row, musicEnabled));
    return {
      revision: galleryRevision(db),
      items,
      next_cursor: rows.length > limit ? items[items.length - 1].id : null,
      total: galleryTotal(db),
    };
  });
  return read();
}

export function publishedArtifact(db: DB, id: string, musicEnabled = false): (PublicArtifact & { file_key: string }) | null {
  const row = db.prepare(`SELECT ${ROW}, file_key FROM artifacts WHERE id = ? AND status = 'PUBLISHED'`).get(id) as
    | (ArtifactRow & { file_key: string })
    | undefined;
  return row ? { ...publicArtifact(row, musicEnabled), file_key: row.file_key } : null;
}

// A currently published record's score, only while music is enabled and the
// stored score is valid. Never the brief, the job or the paper.
export function publishedScore(db: DB, id: string, musicEnabled: boolean): { artifact_id: string; artifact_version: number; score: MusicScoreV1 } | null {
  if (!musicEnabled) return null;
  const row = db.prepare("SELECT id, version, music_score FROM artifacts WHERE id = ? AND status = 'PUBLISHED'").get(id) as
    | { id: string; version: number; music_score: string | null }
    | undefined;
  const score = row ? storedScore(row.music_score) : null;
  return row && score ? { artifact_id: row.id, artifact_version: row.version, score } : null;
}

// The score for a record about to be published: the job's validated brief
// and four fresh random bytes as its seed (never derived from a paper, its
// owner or a return key). Null if it can't be made; an image is never held
// back for its music, and no replacement sound is made.
export function composeForPublication(brief: CreativeBriefV2): string | null {
  try {
    const text = JSON.stringify(composeMusicScore(brief, randomBytes(4).toString("hex")));
    return storedScore(text) ? text : null;
  } catch {
    return null;
  }
}

// Publishes a job's inspected image as one public object, if the job still
// holds this lease and is being reviewed. The object takes the job's
// independent public id, so a repeat can never make a second one. With music
// enabled, its score is composed from the job's brief and saved in the same
// transaction, so image and score become visible together; a repeat can't
// recompose it.
export function publishArtifact(
  db: DB,
  jobId: string,
  leaseToken: string,
  nowMs: number,
  labels: { title: string; alt: string },
  music: { enabled: boolean; brief: CreativeBriefV2 | null } = { enabled: false, brief: null },
): GalleryChange | null {
  return db.transaction((): GalleryChange | null => {
    const job = db
      .prepare(
        "SELECT public_id, file_key FROM artifact_jobs WHERE id = ? AND state = 'REVIEWING' AND lease_token = ? AND lease_until > ? AND not_before <= ?",
      )
      .get(jobId, leaseToken, nowMs, nowMs) as { public_id: string; file_key: string | null } | undefined;
    if (!job?.file_key) return null;
    const score = music.enabled && music.brief ? composeForPublication(music.brief) : null;
    const inserted = db
      .prepare(
        `INSERT INTO artifacts (id, job_id, status, version, file_key, width, height, title, alt, music_score, published_at, updated_at)
         VALUES (?, ?, 'PUBLISHED', 1, ?, 1024, 1024, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(job.public_id, jobId, job.file_key, labels.title, labels.alt, score, nowMs, nowMs).changes;
    db.prepare(
      "UPDATE artifact_jobs SET state = 'PUBLISHED', lease_token = NULL, lease_until = NULL, error_code = NULL, updated_at = ? WHERE id = ?",
    ).run(nowMs, jobId);
    if (!inserted) return null;
    const revision = bumpGalleryRevision(db);
    const row = db.prepare(`SELECT ${ROW} FROM artifacts WHERE id = ?`).get(job.public_id) as ArtifactRow;
    return { type: "artifact:published", revision, total: galleryTotal(db), artifact: publicArtifact(row, music.enabled) };
  })();
}

// Hides a published object: its version and the Gallery revision move once,
// its reports are resolved, and its file can then be removed. A repeat is a
// harmless no-op. Returns the change and the file to unlink after commit.
export function hideArtifact(db: DB, id: string, reason: string, nowMs: number): { change: GalleryChange; fileKey: string } | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        `UPDATE artifacts SET status = 'HIDDEN', version = version + 1, hide_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'PUBLISHED' RETURNING version, file_key`,
      )
      .get(reason, nowMs, id) as { version: number; file_key: string } | undefined;
    if (!row) return null;
    db.prepare("UPDATE artifact_reports SET status = 'resolved', resolved_at = ? WHERE artifact_id = ? AND status = 'queued'").run(nowMs, id);
    const revision = bumpGalleryRevision(db);
    const change: GalleryChange = { type: "artifact:hidden", revision, total: galleryTotal(db), id, version: row.version };
    return { change, fileKey: row.file_key };
  })();
}

// --- public reports ----------------------------------------------------------

export const ARTIFACT_REPORTS_PER_IDENTITY_HOUR = 5;
export const ARTIFACT_REPORTS_PER_ADDRESS_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

export type ReportResult =
  | { kind: "created" | "existing"; reportId: string }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "rate_limited" };

// A report only joins the private review queue: it changes no visibility,
// no revision and no total. The same (identity, op key, object, reason)
// answers with the same receipt.
export function reportArtifact(db: DB, artifactId: string, identityId: string, reason: string, opKey: string, nowMs: number): ReportResult {
  return db.transaction((): ReportResult => {
    const byKey = db
      .prepare("SELECT id, artifact_id, reason FROM artifact_reports WHERE reporter_identity_id = ? AND op_key = ?")
      .get(identityId, opKey) as { id: string; artifact_id: string; reason: string } | undefined;
    if (byKey) {
      return byKey.artifact_id === artifactId && byKey.reason === reason ? { kind: "existing", reportId: byKey.id } : { kind: "conflict" };
    }
    if (!db.prepare("SELECT 1 FROM artifacts WHERE id = ? AND status = 'PUBLISHED'").get(artifactId)) return { kind: "missing" };
    // one report per visitor per object; another key for the same object conflicts
    if (db.prepare("SELECT 1 FROM artifact_reports WHERE reporter_identity_id = ? AND artifact_id = ?").get(identityId, artifactId)) {
      return { kind: "conflict" };
    }
    const recent = (
      db
        .prepare("SELECT COUNT(*) AS n FROM artifact_reports WHERE reporter_identity_id = ? AND created_at > ?")
        .get(identityId, nowMs - HOUR_MS) as { n: number }
    ).n;
    if (recent >= ARTIFACT_REPORTS_PER_IDENTITY_HOUR) return { kind: "rate_limited" };
    const reportId = randomUUID();
    db.prepare(
      `INSERT INTO artifact_reports (id, artifact_id, reporter_identity_id, reason, op_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(reportId, artifactId, identityId, reason, opKey, nowMs);
    return { kind: "created", reportId };
  })();
}

// --- private operator actions ------------------------------------------------

export type AdminKind = "hide" | "dismiss" | "retry";

// The CLI only enqueues; the running worker applies, so a hide is broadcast
// to open Gallery sessions after it commits.
export function enqueueAdminJob(db: DB, kind: AdminKind, targetId: string, reason: string | null, nowMs: number): string {
  const id = randomUUID();
  db.prepare("INSERT INTO artifact_admin_jobs (id, kind, target_id, reason, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(
    id,
    kind,
    targetId,
    reason,
    nowMs,
  );
  return id;
}

// Applies every pending operator action in order. Hides commit before their
// files are unlinked by the caller. Returns the public changes to broadcast.
export function applyArtifactAdminJobs(db: DB, nowMs: number): { changes: GalleryChange[]; filesToDelete: string[] } {
  const changes: GalleryChange[] = [];
  const filesToDelete: string[] = [];
  const pending = db.prepare("SELECT id, kind, target_id, reason FROM artifact_admin_jobs WHERE state = 'pending' ORDER BY created_at, id").all() as {
    id: string;
    kind: AdminKind;
    target_id: string;
    reason: string | null;
  }[];
  for (const job of pending) {
    const finish = (state: "done" | "skipped", outcome: string) =>
      db.prepare("UPDATE artifact_admin_jobs SET state = ?, outcome = ?, done_at = ? WHERE id = ?").run(state, outcome, nowMs, job.id);
    if (job.kind === "hide") {
      const hidden = hideArtifact(db, job.target_id, job.reason ?? "operator", nowMs);
      if (hidden) {
        changes.push(hidden.change);
        filesToDelete.push(hidden.fileKey);
      }
      finish(hidden ? "done" : "skipped", hidden ? "hidden" : "not_published");
    } else if (job.kind === "dismiss") {
      const changed = db
        .prepare("UPDATE artifact_reports SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'queued'")
        .run(nowMs, job.target_id).changes;
      finish(changed ? "done" : "skipped", changed ? "dismissed" : "not_queued");
    } else {
      // only an uncertain generation, and only because an operator accepted
      // that it may be charged again
      const changed = db
        .prepare(
          `UPDATE artifact_jobs SET state = 'IMAGE_QUEUED', image_attempts = 0, error_code = NULL, next_attempt_at = ?, updated_at = ?
           WHERE id = ? AND state = 'GENERATION_UNKNOWN'`,
        )
        .run(nowMs, nowMs, job.target_id).changes;
      finish(changed ? "done" : "skipped", changed ? "requeued" : "not_unknown");
    }
  }
  return { changes, filesToDelete };
}
