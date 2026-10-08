import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

export const requestDigest = (content: string, mode: string): string =>
  createHash("sha256").update(`${mode}\u0000${content}`).digest("hex");

// Each entry runs once, in order, inside a transaction; PRAGMA user_version
// records how many have run. Append only: never edit one that has shipped.
const MIGRATIONS: ((db: DB) => void)[] = [
  // 1: the Week 9 schema, as it was first deployed
  (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES identities(id),
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        owner_identity_id TEXT NOT NULL REFERENCES identities(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        submission_key TEXT NOT NULL,
        UNIQUE (owner_identity_id, submission_key)
      );
    `),

  // 2: lifecycle and the shared revision. Papers saved before anyone could
  // choose are backfilled as KEEP, the conservative choice: it gives no
  // stranger a right to destroy them that their author never granted.
  (db) => {
    db.exec(`
      ALTER TABLE papers ADD COLUMN mode TEXT NOT NULL DEFAULT 'KEEP'
        CHECK (mode IN ('KEEP', 'RELEASE'));
      ALTER TABLE papers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DESTROYED', 'QUARANTINED'));
      ALTER TABLE papers ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE papers ADD COLUMN request_digest TEXT;
      ALTER TABLE papers ADD COLUMN ended_at TEXT;
      CREATE INDEX papers_status ON papers (status);
      CREATE TABLE shared_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL
      );
      INSERT INTO shared_state (id, revision) VALUES (1, 0);
    `);
    const rows = db.prepare("SELECT id, content, mode FROM papers").all() as {
      id: string;
      content: string;
      mode: string;
    }[];
    const set = db.prepare("UPDATE papers SET request_digest = ? WHERE id = ?");
    for (const row of rows) set.run(requestDigest(row.content, row.mode), row.id);
  },

  // 3: witnessing, and the key that signs read receipts. One row per
  // (paper, identity), so tabs and repeats count once; `counts` is 0 for the
  // paper's author, whose acknowledgement grants eligibility but no tally.
  (db) => {
    db.exec(`
      CREATE TABLE witnesses (
        paper_id TEXT NOT NULL REFERENCES papers(id),
        identity_id TEXT NOT NULL REFERENCES identities(id),
        counts INTEGER NOT NULL CHECK (counts IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (paper_id, identity_id)
      );
      CREATE TABLE server_secrets (
        name TEXT PRIMARY KEY,
        value BLOB NOT NULL
      );
    `);
    db.prepare("INSERT INTO server_secrets (name, value) VALUES ('read_receipt', ?)").run(randomBytes(32));
  },

  // 4: destruction outcomes by operation key, so a retry whose reply was lost
  // gets the same answer instead of a second attempt. No paper text here.
  (db) =>
    db.exec(`
      CREATE TABLE burn_operations (
        identity_id TEXT NOT NULL REFERENCES identities(id),
        op_key TEXT NOT NULL,
        paper_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        revision INTEGER,
        total INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (identity_id, op_key)
      );
    `),

  // 5: one return key per anonymous identity, stored only as a digest. An
  // issued key not yet confirmed as saved may be replaced by a new one.
  (db) =>
    db.exec(`
      CREATE TABLE return_keys (
        identity_id TEXT PRIMARY KEY REFERENCES identities(id),
        digest TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('issued', 'saved')),
        issued_at TEXT NOT NULL,
        saved_at TEXT
      );
    `),

  // 6: RESERVED for the return-key issuance binding (track C). This no-op
  // only keeps the list contiguous on a branch without it; it was never
  // shipped and is replaced by the real migration 6 when the branches merge.
  () => {},

  // 7: reports and their review. Reports are private; a review is one job per
  // paper and content digest, so a burst of reports costs one recheck. No copy
  // of a paper's text is kept here: the worker reads it from the paper while
  // it is still ACTIVE. Notes are purged after 30 days. maintenance_jobs hands
  // an operator's decision from the private CLI to the running server, whose
  // worker applies it so live sessions hear about it. A quarantined paper keeps
  // only its id, times and a policy reason code.
  (db) =>
    db.exec(`
      ALTER TABLE papers ADD COLUMN end_reason TEXT;
      CREATE TABLE report_reviews (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL REFERENCES papers(id),
        content_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN
          ('queued', 'running', 'retry_wait', 'human_review', 'dismissed', 'quarantined', 'obsolete')),
        attempts INTEGER NOT NULL DEFAULT 0,
        runs INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_until TEXT,
        provider TEXT,
        model TEXT,
        policy_version TEXT,
        outcome_reason TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        UNIQUE (paper_id, content_digest)
      );
      CREATE INDEX report_reviews_due ON report_reviews (state, next_attempt_at);
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL REFERENCES papers(id),
        review_id TEXT NOT NULL REFERENCES report_reviews(id),
        reporter_identity_id TEXT NOT NULL REFERENCES identities(id),
        reason TEXT NOT NULL CHECK (reason IN ('threats_abuse', 'private_information', 'sexual_graphic',
          'harmful_instructions', 'spam_scam', 'something_else')),
        note TEXT,
        op_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        note_expires_at TEXT NOT NULL,
        UNIQUE (reporter_identity_id, paper_id),
        UNIQUE (reporter_identity_id, op_key)
      );
      CREATE INDEX reports_reporter_time ON reports (reporter_identity_id, created_at);
      CREATE TABLE maintenance_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('dismiss', 'quarantine')),
        report_id TEXT NOT NULL REFERENCES reports(id),
        reason TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'skipped')),
        outcome TEXT,
        created_at TEXT NOT NULL,
        done_at TEXT
      );
    `),
];

export const serverSecret = (db: DB, name: string): Buffer =>
  (db.prepare("SELECT value FROM server_secrets WHERE name = ?").get(name) as { value: Buffer }).value;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      MIGRATIONS[i](db);
      db.pragma(`user_version = ${i + 1}`);
    })();
    console.log(`migrated database to version ${i + 1}`);
  }
}

export const currentRevision = (db: DB): number =>
  (db.prepare("SELECT revision FROM shared_state WHERE id = 1").get() as { revision: number }).revision;

// Called inside the transaction that makes a shared change, so the revision
// and the change commit (or roll back) together.
export const bumpRevision = (db: DB): number =>
  (db.prepare("UPDATE shared_state SET revision = revision + 1 WHERE id = 1 RETURNING revision").get() as {
    revision: number;
  }).revision;

export const activeTotal = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM papers WHERE status = 'ACTIVE'").get() as { n: number }).n;
