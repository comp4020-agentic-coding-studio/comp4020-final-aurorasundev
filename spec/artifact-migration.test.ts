import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, requestDigest, type DB } from "../server/db.ts";
import { beginReleaseExtraction, EXTRACT_LIMIT_MS } from "../server/artifacts/store.ts";

// Migration 9 against a real version-8 database captured from the shipped
// code (spec/fixtures/schema-v8.sqlite): six papers by two identities, one
// Release burned, one Release quarantined, one Keep burned by its author.

const FIXTURE = resolve(import.meta.dirname, "fixtures/schema-v8.sqlite");
type Paper = { id: string; owner_identity_id: string; content: string; drawing: string | null; mode: string; status: string; request_digest: string };

function freshCopy(): string {
  const path = join(mkdtempSync(join(tmpdir(), "throwaway-v8-")), "db.sqlite");
  copyFileSync(FIXTURE, path);
  return path;
}

const papers = (db: DB): Paper[] =>
  db.prepare("SELECT id, owner_identity_id, content, drawing, mode, status, request_digest FROM papers ORDER BY id").all() as Paper[];
const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

describe("migration 9 on a shipped version-8 database", () => {
  it("keeps every paper, identity and exact request digest", () => {
    const path = freshCopy();
    const v8 = new Database(path, { readonly: true });
    expect(v8.pragma("user_version", { simple: true })).toBe(8);
    const before = papers(v8);
    v8.close();
    const raw = quiet(() => openDb(path));
    expect(raw.pragma("user_version", { simple: true })).toBe(9);
    const rows = papers(raw);
    expect(rows).toEqual(before);
    expect(rows).toHaveLength(6);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM identities").get() as { n: number }).n).toBe(2);
    for (const row of rows.filter((r) => r.status === "ACTIVE")) {
      expect(row.request_digest).toBe(requestDigest(row.content, row.mode, row.drawing));
    }
    raw.close();
  });

  it("changes nothing when opened again", () => {
    const path = freshCopy();
    const first = quiet(() => openDb(path));
    const snapshot = JSON.stringify(papers(first));
    const tables = first.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
    first.close();
    const second = quiet(() => openDb(path));
    expect(second.pragma("user_version", { simple: true })).toBe(9);
    expect(JSON.stringify(papers(second))).toBe(snapshot);
    expect(second.prepare("SELECT name FROM sqlite_master ORDER BY name").all()).toEqual(tables);
    second.close();
  });

  it("adds no opt-in flag and no column that could hold a paper's words or drawing", () => {
    const db = quiet(() => openDb(freshCopy()));
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns("papers")).not.toContain("keepsake_opt_in");
    for (const table of ["artifact_jobs", "artifacts", "artifact_reports", "artifact_admin_jobs", "artifact_budgets", "gallery_state"]) {
      const names = columns(table);
      expect(names.length, table).toBeGreaterThan(0);
      for (const name of names) expect(name, `${table}.${name}`).not.toMatch(/content|drawing|text|body/);
    }
    db.close();
  });
});

describe("no record is made except at a fresh Release burn", () => {
  it("leaves every paper that already existed without a job, ended or not", () => {
    const db = quiet(() => openDb(freshCopy()));
    // nothing is backfilled: a record needs its note at ignition, and an
    // ended paper's note is gone
    expect(db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get()).toEqual({ n: 0 });
    db.close();
  });

  it("starts one extraction only for an ACTIVE Release paper, once", () => {
    const db = quiet(() => openDb(freshCopy()));
    const byStatus = papers(db);
    const activeRelease = byStatus.find((p) => p.mode === "RELEASE" && p.status === "ACTIVE")!;
    const activeKeep = byStatus.find((p) => p.mode === "KEEP" && p.status === "ACTIVE")!;
    for (const ended of byStatus.filter((p) => p.status !== "ACTIVE")) {
      expect(beginReleaseExtraction(db, ended.id, 1, 4800), ended.id).toBeNull();
    }
    expect(beginReleaseExtraction(db, activeKeep.id, 1, 4800)).toBeNull();
    const first = beginReleaseExtraction(db, activeRelease.id, 1, 4800);
    expect(first?.source).toEqual({ text: activeRelease.content, drawing: activeRelease.drawing });
    expect(beginReleaseExtraction(db, activeRelease.id, 2, 4800)).toBeNull();
    // SQLite itself refuses a second job for one paper, not only this module
    expect(() =>
      db
        .prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, not_before, next_attempt_at, created_at, updated_at) VALUES ('x', ?, 'y', 'EXTRACTING', 0, 0, 0, 0)")
        .run(activeRelease.id),
    ).toThrow(/UNIQUE/);
    // the job itself holds no source
    const job = db.prepare("SELECT * FROM artifact_jobs").get() as Record<string, unknown>;
    expect(JSON.stringify(job)).not.toContain("fixture release");
    expect(job).toMatchObject({ state: "EXTRACTING", brief: null, extract_until: 1 + EXTRACT_LIMIT_MS, not_before: 1 + 4800 });
    db.close();
  });
});
