import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, requestDigest, type DB } from "../server/db.ts";
import { createPaper } from "../server/papers.ts";
import {
  cancelArtifactPreparation,
  discoverReleasePreparation,
  queueDestroyedRelease,
  queueReleasePreparation,
} from "../server/artifacts/store.ts";

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

describe("which papers can become keepsakes", () => {
  it("release_mode_is_the_only_eligibility", () => {
    const db = quiet(() => openDb(":memory:"));
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('o', 'now')").run();
    const save = (mode: string, key: string) => {
      const r = createPaper(db, "o", "words", key, mode);
      if (!r.ok) throw new Error(r.code);
      return r.value.id;
    };
    const keep = save("KEEP", "key-keep-1");
    const release = save("RELEASE", "key-release-1");
    expect(queueReleasePreparation(db, keep, 1)).toBe(false);
    expect(queueReleasePreparation(db, release, 1)).toBe(true);
    // a Keep paper burned by its author never queues an image
    db.prepare("UPDATE papers SET status = 'DESTROYED', content = '' WHERE id = ?").run(keep);
    expect(queueDestroyedRelease(db, keep, 2)).toBe(false);
    expect(db.prepare("SELECT paper_id FROM artifact_jobs").all()).toEqual([{ paper_id: release }]);
    db.close();
  });

  it("existing_active_release_is_discovered", () => {
    const db = quiet(() => openDb(freshCopy()));
    const activeRelease = papers(db).filter((p) => p.mode === "RELEASE" && p.status === "ACTIVE").map((p) => p.id).sort();
    expect(activeRelease).toHaveLength(2);
    expect(discoverReleasePreparation(db, 1)).toBe(2);
    expect(discoverReleasePreparation(db, 2)).toBe(0);
    const jobs = db.prepare("SELECT paper_id, state, recipe FROM artifact_jobs ORDER BY paper_id").all();
    expect(jobs).toEqual(activeRelease.map((paper_id) => ({ paper_id, state: "PREPARE_QUEUED", recipe: null })));
    db.close();
  });

  it("discovers in bounded batches", () => {
    const db = quiet(() => openDb(":memory:"));
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('o', 'now')").run();
    for (let i = 0; i < 45; i++) {
      // as if saved before keepsakes existed: no job created at save time
      db.prepare(
        "INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, request_digest) VALUES (?, 'o', 'w', 'now', ?, 'RELEASE', 'd')",
      ).run(`p-${i}`, `k-${i}`);
    }
    expect([discoverReleasePreparation(db, 1), discoverReleasePreparation(db, 1), discoverReleasePreparation(db, 1)]).toEqual([20, 20, 5]);
    db.close();
  });

  it("ended_papers_are_not_backfilled", () => {
    const db = quiet(() => openDb(freshCopy()));
    discoverReleasePreparation(db, 1);
    const ended = papers(db).filter((p) => p.status !== "ACTIVE").map((p) => p.id);
    expect(ended).toHaveLength(3);
    for (const id of ended) {
      expect(queueReleasePreparation(db, id, 2)).toBe(false);
      expect(db.prepare("SELECT 1 FROM artifact_jobs WHERE paper_id = ?").get(id)).toBeUndefined();
    }
    db.close();
  });

  it("one_job_per_paper", () => {
    const db = quiet(() => openDb(":memory:"));
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('o', 'now')").run();
    const r = createPaper(db, "o", "words", "key-one-1", "RELEASE");
    if (!r.ok) throw new Error(r.code);
    const id = r.value.id;
    expect(queueReleasePreparation(db, id, 1)).toBe(true);
    expect(queueReleasePreparation(db, id, 2)).toBe(false);
    // SQLite itself refuses a second row, not only this module
    expect(() =>
      db.prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, next_attempt_at, created_at, updated_at) VALUES ('x', ?, 'y', 'PREPARE_QUEUED', 0, 0, 0)").run(id),
    ).toThrow(/UNIQUE/);
    db.prepare("UPDATE papers SET status = 'DESTROYED', content = '' WHERE id = ?").run(id);
    expect(queueDestroyedRelease(db, id, 3)).toBe(true);
    expect(queueDestroyedRelease(db, id, 4)).toBe(false);
    const job = db.prepare("SELECT state, recipe_source FROM artifact_jobs WHERE paper_id = ?").get(id);
    expect(job).toEqual({ state: "IMAGE_QUEUED", recipe_source: "neutral" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("cancels preparation and refuses to queue an image afterwards", () => {
    const db = quiet(() => openDb(":memory:"));
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('o', 'now')").run();
    const r = createPaper(db, "o", "words", "key-cancel-1", "RELEASE");
    if (!r.ok) throw new Error(r.code);
    queueReleasePreparation(db, r.value.id, 1);
    cancelArtifactPreparation(db, r.value.id, 2);
    expect(db.prepare("SELECT state FROM artifact_jobs").get()).toEqual({ state: "CANCELLED" });
    db.close();
  });
});
