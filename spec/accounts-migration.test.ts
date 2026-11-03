import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";

// Migration 11 on a shipped version-10 database: accounts arrive, return
// keys go, and every paper, identity, session and record stays put.

const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

// The v9 fixture, taken to version 10 by the shipped migration (one added
// nullable column), with a saved return key and a live session in it.
function version10(): string {
  const path = join(mkdtempSync(join(tmpdir(), "throwaway-v10-")), "db.sqlite");
  copyFileSync(resolve(import.meta.dirname, "fixtures/schema-v9.sqlite"), path);
  const db = new Database(path);
  db.exec("ALTER TABLE artifacts ADD COLUMN music_score TEXT");
  db.pragma("user_version = 10");
  const owner = (db.prepare("SELECT owner_identity_id AS id FROM papers LIMIT 1").get() as { id: string }).id;
  db.prepare("INSERT INTO return_keys (identity_id, digest, state, issued_at, saved_at, issuance_id) VALUES (?, 'digest', 'saved', 'now', 'now', 'x')").run(owner);
  db.prepare("INSERT INTO sessions (token_hash, identity_id, expires_at) VALUES ('token', ?, '2099-01-01T00:00:00.000Z')").run(owner);
  db.close();
  return path;
}

const TABLES = ["identities", "sessions", "papers", "witnesses", "burn_operations", "artifact_jobs", "artifacts", "artifact_reports", "artifact_admin_jobs", "artifact_budgets", "gallery_state"];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const tables = (db: Database.Database) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);

describe("migration 11", () => {
  it("adds accounts, drops return keys, and leaves every other row exactly as it was", () => {
    const path = version10();
    const v10 = new Database(path, { readonly: true });
    const before = dump(v10);
    expect(tables(v10)).toContain("return_keys");
    v10.close();
    expect((before.papers as unknown[]).length).toBe(6);
    expect((before.sessions as unknown[]).length).toBe(1);

    const db = quiet(() => openDb(path));
    expect(db.pragma("user_version", { simple: true })).toBe(11);
    expect(tables(db)).toContain("accounts");
    expect(tables(db)).not.toContain("return_keys");
    expect(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({ n: 0 });
    expect(dump(db)).toEqual(before);
    db.close();

    const again = quiet(() => openDb(path));
    expect(again.pragma("user_version", { simple: true })).toBe(11);
    expect(dump(again)).toEqual(before);
    again.close();
  });
});
