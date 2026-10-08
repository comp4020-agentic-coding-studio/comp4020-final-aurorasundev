import Database from "better-sqlite3";
import { createHash } from "node:crypto";
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
];

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
