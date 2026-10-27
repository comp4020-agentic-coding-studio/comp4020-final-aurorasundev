import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureArtifactProvider, newFixtureControl } from "../server/artifacts/provider.ts";
import { applyArtifactAdminJobs, enqueueAdminJob, galleryPage, publishArtifact, publishedScore } from "../server/artifacts/store.ts";
import type { CreativeBriefV2, GalleryChange } from "../server/artifacts/types.ts";
import { createArtifactWorker } from "../server/artifacts/worker.ts";
import { openDb, type DB } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { composeMusicScore, parseMusicScore } from "../shared/music-score.ts";
import { CANARY, gallery, type Harness } from "./gallery-harness.ts";
import { url } from "./client.ts";

// Record music on the server (ADR 006): a score is composed from the job's
// stored brief and saved in the same transaction that publishes an inspected
// image, only with GALLERY_MUSIC_ENABLED; it is served only for a currently
// published record, through an allowlisted shape; migration 10 keeps a
// shipped version-9 database intact.

const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

const BRIEF: CreativeBriefV2 = {
  schema_version: 2,
  metaphor: "vessel",
  relation: "opening",
  motion: "unfolding",
  space: "distant",
  material: "frosted_glass",
  palette: "cobalt_paper",
  music: { timbre: "soft_glass", pulse: "none", density: "layered", ending: "open" },
};

// the worker in-process with the fixture provider and a test clock
function world(music: boolean) {
  const logged: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  const db = openDb(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "throwaway-music-"));
  let clock = Date.now();
  const control = newFixtureControl();
  const changes: GalleryChange[] = [];
  const worker = createArtifactWorker(db, fixtureArtifactProvider(control), {
    artifactDir: dir,
    enabled: true,
    musicEnabled: music,
    onChange: (c) => changes.push(c),
    now: () => clock,
    pollMs: 60_000,
  });
  db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now')").run();
  const save = (mode: "KEEP" | "RELEASE", content = `words ${CANARY.text}`) => {
    const r = createPaper(db, "author", content, randomUUID(), mode, null);
    if (!r.ok) throw new Error(r.code);
    return r.value.id;
  };
  const burn = async (paperId: string, who = "reader") => {
    db.prepare("INSERT OR IGNORE INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, 'reader', 1, 'now')").run(paperId);
    const result = burnPaper(db, paperId, who, randomUUID(), true);
    if (result.ignition) await worker.extract({ ...result.ignition, extractUntil: Date.now() + 15_000 });
    return result;
  };
  const publishAll = async () => {
    await worker.wake();
    clock += 10_000;
    await worker.wake();
  };
  const scores = () => db.prepare("SELECT id, music_score FROM artifacts").all() as { id: string; music_score: string | null }[];
  return {
    db,
    control,
    changes,
    logged,
    save,
    burn,
    publishAll,
    scores,
    async done() {
      await worker.stop();
      console.log = log;
      db.close();
    },
  };
}

describe("a score is saved with publication", () => {
  it("a fresh Release record gets one valid score from its own brief, with no extra provider call", async () => {
    const w = world(true);
    const id = w.save("RELEASE", `I kept the door open for too long. ${CANARY.text}`);
    await w.burn(id);
    await w.publishAll();
    const [row] = w.scores();
    const score = parseMusicScore(JSON.parse(row.music_score!));
    expect(score).not.toBeNull();
    // composed from the stored brief: its music choices carried over
    const brief = JSON.parse((w.db.prepare("SELECT brief FROM artifact_jobs").get() as { brief: string }).brief) as CreativeBriefV2;
    expect(score!.timbre).toBe(brief.music.timbre);
    expect(score!.ending).toBe(brief.music.ending);
    // and reproducible from that brief and its stored seed
    expect(composeMusicScore(brief, score!.seed)).toEqual(score);
    // music made no request of its own
    expect(w.control.calls).toEqual({ brief: 1, image: 1, inspection: 1 });
    // the event carries the small descriptor, never the score
    const change = w.changes[0] as Extract<GalleryChange, { type: "artifact:published" }>;
    expect(change.artifact.music).toEqual({ status: "ready", score_version: 1, duration_ms: 24000 });
    expect(JSON.stringify(w.changes)).not.toMatch(/notes|seed|midi|timbre/);
    // the log says a score was saved, and nothing about it or the note
    expect(w.logged.join("\n")).toMatch(/outcome=published .*music=score_saved/);
    expect(w.logged.join("\n")).not.toMatch(new RegExp(`${score!.seed}|midi|${CANARY.text}`));
    expect(row.music_score).not.toContain(CANARY.text);
    await w.done();
  });

  it("each record gets its own random seed", async () => {
    const w = world(true);
    for (let i = 0; i < 3; i++) await w.burn(w.save("RELEASE", "same words"));
    await w.publishAll();
    const seeds = w.scores().map((r) => JSON.parse(r.music_score!).seed);
    expect(seeds).toHaveLength(3);
    expect(new Set(seeds).size).toBe(3);
    await w.done();
  });

  it("never for a Keep paper, a lost extraction, a blocked image, or with music off", async () => {
    const off = world(false);
    await off.burn(off.save("RELEASE"));
    await off.publishAll();
    expect(off.scores()).toEqual([{ id: expect.any(String), music_score: null }]);
    const change = off.changes[0] as Extract<GalleryChange, { type: "artifact:published" }>;
    expect(change.artifact).not.toHaveProperty("music");
    expect(off.logged.join("\n")).toMatch(/music=off/);
    await off.done();

    const w = world(true);
    const keep = w.save("KEEP");
    expect((await w.burn(keep, "author")).ignition).toBeUndefined();
    w.control.brief.push(() => Promise.reject(new Error("refused")));
    await w.burn(w.save("RELEASE"));
    w.control.inspection.push(async () => "inspection_face");
    await w.burn(w.save("RELEASE"));
    await w.publishAll();
    expect(w.scores()).toEqual([]);
    await w.done();
  });

  it("a repeat publication can't recompose or replace a saved score", () => {
    const db = quiet(() => openDb(":memory:"));
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now')").run();
    db.prepare(
      `INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status) VALUES ('p', 'author', '', 'now', 'k', 'RELEASE', 'DESTROYED')`,
    ).run();
    const lease = "lease";
    const reviewing = () =>
      db
        .prepare(
          `INSERT OR REPLACE INTO artifact_jobs (id, paper_id, public_id, state, brief, brief_version, file_key, lease_token, lease_until, not_before, next_attempt_at, created_at, updated_at)
           VALUES ('j', 'p', ?, 'REVIEWING', ?, 2, 'f.webp', ?, ?, 0, 0, 0, 0)`,
        )
        .run("11111111-1111-4111-8111-111111111111", JSON.stringify(BRIEF), lease, Date.now() + 60_000);
    reviewing();
    const labels = { title: "t", alt: "a" };
    expect(publishArtifact(db, "j", lease, Date.now(), labels, { enabled: true, brief: BRIEF })?.type).toBe("artifact:published");
    const first = (db.prepare("SELECT music_score FROM artifacts").get() as { music_score: string }).music_score;
    reviewing();
    expect(publishArtifact(db, "j", lease, Date.now(), labels, { enabled: true, brief: BRIEF })).toBeNull();
    expect((db.prepare("SELECT music_score FROM artifacts").get() as { music_score: string }).music_score).toBe(first);
    db.close();
  });
});

describe("GET /api/gallery/:id/score", () => {
  let h: Harness;
  afterEach(async () => h?.close());
  const get = (path: string) => fetch(`${h.base}${path}`);
  const scoreText = JSON.stringify(composeMusicScore(BRIEF, "0badf00d"));

  it("serves a published record's score through an allowlisted shape, uncached", async () => {
    h = await gallery({ music: true });
    const seeded = h.seed({ score: scoreText });
    const res = await get(`/api/gallery/${seeded.id}/score`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["artifact_id", "artifact_version", "score"]);
    expect(body).toEqual({ artifact_id: seeded.id, artifact_version: 1, score: JSON.parse(scoreText) });
    const text = JSON.stringify(body);
    for (const secret of [seeded.paperId, seeded.jobId, seeded.fileKey, CANARY.text]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/metaphor|relation|palette|material|brief|prompt|paper|owner/);
  });

  it("the record's public shape carries a small descriptor, never the score", async () => {
    h = await gallery({ music: true });
    const withScore = h.seed({ score: scoreText });
    const legacy = h.seed();
    const page = (await (await get("/api/gallery")).json()) as { items: Record<string, unknown>[] };
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(withScore.id)!.music).toEqual({ status: "ready", score_version: 1, duration_ms: 24000 });
    expect(byId.get(legacy.id)).not.toHaveProperty("music");
    expect(await (await get(`/api/gallery/${withScore.id}`)).json()).toMatchObject({ music: { status: "ready" } });
    expect(JSON.stringify(page)).not.toMatch(/notes|seed|midi/);
  });

  it("returns the generic 404 for a hidden, legacy, invalid, unknown or malformed record", async () => {
    h = await gallery({ music: true });
    const hidden = h.seed({ status: "HIDDEN", score: scoreText });
    const legacy = h.seed();
    const tampered = h.seed({ score: JSON.stringify({ ...JSON.parse(scoreText), composer_version: "throwaway-score-v9" }) });
    const garbage = h.seed({ score: "not json" });
    for (const id of [hidden.id, legacy.id, tampered.id, garbage.id, randomUUID(), "not-a-uuid", "..%2F..%2Fetc"]) {
      const res = await get(`/api/gallery/${id}/score`);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ code: "artifact_gone", error: "This object is no longer here." });
    }
    // an unusable stored score shows as unavailable, never as ready
    const page = (await (await get("/api/gallery")).json()) as { items: { id: string; music?: unknown }[] };
    expect(page.items.find((i) => i.id === tampered.id)!.music).toEqual({ status: "unavailable" });
  });

  it("stops serving a record's score as soon as it is hidden", async () => {
    h = await gallery({ music: true });
    const seeded = h.seed({ score: scoreText });
    expect((await get(`/api/gallery/${seeded.id}/score`)).status).toBe(200);
    enqueueAdminJob(h.db, "hide", seeded.id, "reported", Date.now());
    applyArtifactAdminJobs(h.db, Date.now());
    expect((await get(`/api/gallery/${seeded.id}/score`)).status).toBe(404);
  });

  it("with music off, serves no score, marks stored ones unavailable and keeps them", async () => {
    h = await gallery({ music: false, enabled: true });
    const seeded = h.seed({ score: scoreText });
    expect(await (await get("/api/gallery/config")).json()).toEqual({ generation_enabled: true, music_enabled: false });
    expect((await get(`/api/gallery/${seeded.id}/score`)).status).toBe(404);
    expect(await (await get(`/api/gallery/${seeded.id}`)).json()).toMatchObject({ music: { status: "unavailable" } });
    expect((h.db.prepare("SELECT music_score FROM artifacts WHERE id = ?").get(seeded.id) as { music_score: string }).music_score).toBe(scoreText);
  });

  it("music is independent of generation", async () => {
    h = await gallery({ music: true, enabled: false });
    const seeded = h.seed({ score: scoreText });
    expect(await (await get("/api/gallery/config")).json()).toEqual({ generation_enabled: false, music_enabled: true });
    expect((await get(`/api/gallery/${seeded.id}/score`)).status).toBe(200);
  });
});

describe("the running app", () => {
  it("says whether music is available, and has no score for an unknown record", async () => {
    const config = (await (await fetch(url("/api/gallery/config"))).json()) as Record<string, unknown>;
    expect(Object.keys(config).sort()).toEqual(["generation_enabled", "music_enabled"]);
    expect(typeof config.music_enabled).toBe("boolean");
    const res = await fetch(url(`/api/gallery/${randomUUID()}/score`));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("migration 10 on a shipped version-9 database", () => {
  // spec/fixtures/schema-v9.sqlite: the v8 fixture migrated by the shipped
  // migration 9, with one published record, one hidden record and its
  // resolved report and operator hide, one lost extraction and a budget day
  const FIXTURE = resolve(import.meta.dirname, "fixtures/schema-v9.sqlite");
  const freshCopy = () => {
    const path = join(mkdtempSync(join(tmpdir(), "throwaway-v9-")), "db.sqlite");
    copyFileSync(FIXTURE, path);
    return path;
  };
  const TABLES = ["identities", "papers", "witnesses", "artifact_jobs", "artifacts", "artifact_reports", "artifact_admin_jobs", "artifact_budgets", "gallery_state", "burn_operations", "return_keys"];
  const dump = (db: DB | Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));

  it("keeps every row and adds only a null music_score, so old records stay image-only", async () => {
    const path = freshCopy();
    const v9 = new Database(path, { readonly: true });
    expect(v9.pragma("user_version", { simple: true })).toBe(9);
    const before = dump(v9);
    v9.close();
    expect((before.artifacts as unknown[]).length).toBe(2);
    const db = quiet(() => openDb(path));
    expect(db.pragma("user_version", { simple: true })).toBe(10);
    const after = dump(db);
    const strip = (rows: unknown[]) => rows.map((r) => (({ music_score, ...rest }) => (expect(music_score).toBeNull(), rest))(r as { music_score: unknown }));
    expect(strip(after.artifacts as unknown[])).toEqual(before.artifacts);
    for (const t of TABLES.filter((t) => t !== "artifacts")) expect(after[t], t).toEqual(before[t]);
    // no backfill: nothing composed a score for a legacy record
    expect(db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE music_score IS NOT NULL").get()).toEqual({ n: 0 });
    db.close();
    // opened again, nothing moves
    const again = quiet(() => openDb(path));
    expect(again.pragma("user_version", { simple: true })).toBe(10);
    expect(dump(again)).toEqual(after);
    again.close();
  });

  it("a legacy record is served as image-only and has no score", () => {
    const migrated = quiet(() => openDb(freshCopy()));
    const page = galleryPage(migrated, 12, null, true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("music");
    expect(publishedScore(migrated, page.items[0].id, true)).toBeNull();
    migrated.close();
  });
});
