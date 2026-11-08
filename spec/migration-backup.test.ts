import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKUPS_KEPT, openDb, SCHEMA_VERSION } from "../server/db.ts";

// Before migrating a database that holds data, the server writes a
// consistent copy beside it and keeps only the newest few; if the copy
// fails, nothing is migrated and startup stops.

const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

function version9(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "throwaway-backup-"));
  const path = join(dir, "throwaway.sqlite");
  copyFileSync(resolve(import.meta.dirname, "fixtures/schema-v9.sqlite"), path);
  return { dir, path };
}
const backups = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".bak")).sort();
const version = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return db.pragma("user_version", { simple: true });
  } finally {
    db.close();
  }
};

afterEach(() => vi.useRealTimers());

describe("the backup before a migration", () => {
  it("copies the database at its old version beside it, then migrates", () => {
    const { dir, path } = version9();
    const papers = (db: Database.Database) => db.prepare("SELECT * FROM papers ORDER BY id").all();
    const before = new Database(path, { readonly: true });
    const original = papers(before);
    before.close();

    quiet(() => openDb(path)).close();
    const [backup, ...rest] = backups(dir);
    expect(rest).toEqual([]);
    expect(backup).toMatch(/^throwaway\.sqlite\.pre-v9-\d{8}T\d{9}Z\.bak$/);
    expect(version(path)).toBe(SCHEMA_VERSION);
    const copy = new Database(join(dir, backup), { readonly: true });
    expect(copy.pragma("user_version", { simple: true })).toBe(9);
    expect(papers(copy)).toEqual(original);
    copy.close();

    // already current: no further backup
    quiet(() => openDb(path)).close();
    expect(backups(dir)).toEqual([backup]);
  });

  it("keeps only the newest few backups", () => {
    const { dir, path } = version9();
    const old = ["20240101T000000000Z", "20250101T000000000Z", "20260101T000000000Z"].map((t) => `throwaway.sqlite.pre-v8-${t}.bak`);
    for (const name of old) writeFileSync(join(dir, name), "old");
    writeFileSync(join(dir, "unrelated.bak"), "not ours");
    quiet(() => openDb(path)).close();
    const kept = backups(dir).filter((n) => n.startsWith("throwaway.sqlite."));
    expect(kept).toHaveLength(BACKUPS_KEPT);
    expect(kept).not.toContain(old[0]);
    expect(kept).toEqual(expect.arrayContaining(old.slice(1)));
    expect(backups(dir)).toContain("unrelated.bak");
  });

  it("migrates nothing and refuses to start when the backup can't be written", () => {
    const { dir, path } = version9();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T02:15:00.123Z"));
    // VACUUM INTO refuses to overwrite an existing file
    writeFileSync(join(dir, "throwaway.sqlite.pre-v9-20261109T021500123Z.bak"), "in the way");
    expect(() => quiet(() => openDb(path))).toThrow(/backup before migrating from version 9 failed/);
    expect(version(path)).toBe(9);
  });

  it("needs no backup for a new, empty database", () => {
    const dir = mkdtempSync(join(tmpdir(), "throwaway-new-"));
    quiet(() => openDb(join(dir, "throwaway.sqlite"))).close();
    expect(backups(dir)).toEqual([]);
  });
});
