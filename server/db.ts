import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = `
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
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
