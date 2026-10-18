import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { ArtifactError, ARTIFACT_FIXTURE, fixtureArtifactProvider, type FixtureControl, type GeneratedImage } from "../server/artifacts/provider.ts";
import { enqueueAdminJob } from "../server/artifacts/store.ts";
import type { GalleryChange, Recipe } from "../server/artifacts/types.ts";
import { createArtifactWorker, DAILY_BUDGET } from "../server/artifacts/worker.ts";

// The keepsake worker end to end, in-process, with a fixture provider whose
// answers a test can hold back, and a clock it controls. No network.

const WEBP = readFileSync(resolve(import.meta.dirname, "fixtures/artifacts/keepsake-1024.webp"));
const CANARY = "CANARY-PRIVATE-WORDS-5e1d";

// a valid 1200×500 PNG drawing, as the write sheet sends
function drawing(): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1200, 0);
  header.writeUInt32BE(500, 4);
  header[8] = 8;
  const raw = Buffer.alloc(1201 * 500, 0x30);
  for (let y = 0; y < 500; y++) raw[y * 1201] = 0;
  const png = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))];
  return `data:image/png;base64,${Buffer.concat(png).toString("base64")}`;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function world(options: { enabled?: boolean; dir?: string; db?: DB; control?: FixtureControl } = {}) {
  const log = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  const db = options.db ?? openDb(":memory:");
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "throwaway-worker-"));
  // ahead of the real clock, which stamps jobs made by the paper lifecycle,
  // so those are always due; the time of day is fixed for budget tests
  const today = new Date();
  let clock = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 2, 3, 0, 0);
  const control: FixtureControl = options.control ?? { calls: { recipe: 0, image: 0, inspection: 0 }, recipe: [], image: [], inspection: [] };
  const provider = fixtureArtifactProvider(control);
  const changes: GalleryChange[] = [];
  const worker = createArtifactWorker(db, provider, {
    artifactDir: dir,
    enabled: options.enabled ?? true,
    onChange: (c) => changes.push(c),
    now: () => clock,
    pollMs: 60_000,
    delays: { recipeRetryMs: 5_000, rateLimitMinMs: 30_000, inspectionMs: [5_000, 30_000], capacityMs: 60_000 },
  });
  if (!options.db) db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now')").run();
  const save = (mode: "KEEP" | "RELEASE", content = `words ${CANARY}`, drawing: string | null = null) => {
    const r = createPaper(db, "author", content, randomUUID(), mode, drawing);
    if (!r.ok) throw new Error(r.code);
    return r.value.id;
  };
  const burn = (paperId: string) => {
    db.prepare("INSERT OR IGNORE INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, 'reader', 1, 'now')").run(paperId);
    return burnPaper(db, paperId, "reader", randomUUID(), true);
  };
  const job = (paperId: string) =>
    db.prepare("SELECT id, public_id, state, recipe, recipe_source, error_code, image_attempts, review_attempts, file_key FROM artifact_jobs WHERE paper_id = ?").get(paperId) as {
      id: string;
      public_id: string;
      state: string;
      recipe: string | null;
      recipe_source: string | null;
      error_code: string | null;
      image_attempts: number;
      review_attempts: number;
      file_key: string | null;
    };
  const restore = () => {
    console.log = log;
  };
  return {
    db,
    dir,
    control,
    changes,
    worker,
    logged,
    save,
    burn,
    job,
    restore,
    advance: (ms: number) => {
      clock += ms;
    },
    async done() {
      await worker.stop();
      restore();
    },
  };
}

const allText = (w: ReturnType<typeof world>): string => {
  const tables = ["artifact_jobs", "artifacts", "artifact_reports", "artifact_admin_jobs", "artifact_budgets", "gallery_state"];
  const rows = tables.map((t) => JSON.stringify(w.db.prepare(`SELECT * FROM ${t}`).all())).join("\n");
  const files = readdirSync(w.dir).join("\n");
  return `${rows}\n${files}\n${w.logged.join("\n")}\n${JSON.stringify(w.changes)}`;
};

describe("the happy path", () => {
  it("release_to_private_file_to_inspected_public_object", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "PREPARED", recipe_source: "prepared" });
    expect(w.control.calls).toEqual({ recipe: 1, image: 0, inspection: 0 });
    expect(w.changes).toEqual([]);
    w.burn(id);
    expect(w.db.prepare("SELECT content, drawing FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null });
    await w.worker.wake();
    const job = w.job(id);
    expect(job.state).toBe("PUBLISHED");
    expect(w.control.calls).toEqual({ recipe: 1, image: 1, inspection: 1 });
    expect(w.changes).toHaveLength(1);
    const change = w.changes[0] as Extract<GalleryChange, { type: "artifact:published" }>;
    expect(change).toMatchObject({ type: "artifact:published", revision: 1, total: 1 });
    expect(change.artifact.id).toBe(job.public_id);
    expect(change.artifact.title).toBe("Vessel in paper");
    expect(readdirSync(w.dir)).toEqual([`${job.public_id}.webp`]);
    // the words never reach any new table, file, log or event
    expect(allText(w)).not.toContain(CANARY);
    await w.done();
  });

  it("publishes from a neutral recipe when the paper is burned before any recipe, and for drawing-only papers", async () => {
    const w = world();
    const immediate = w.save("RELEASE");
    w.burn(immediate);
    const drawn = w.save("RELEASE", "", drawing());
    await w.worker.wake();
    expect(w.job(immediate)).toMatchObject({ state: "PUBLISHED", recipe_source: "neutral" });
    // the drawing-only paper is still here: it only has its recipe
    expect(w.job(drawn).state).toBe("PREPARED");
    w.burn(drawn);
    await w.worker.wake();
    expect(w.job(drawn)).toMatchObject({ state: "PUBLISHED", recipe_source: "prepared" });
    // the neutral one asked for no recipe at all
    expect(w.control.calls.recipe).toBe(1);
    expect(w.changes.map((c) => c.type)).toEqual(["artifact:published", "artifact:published"]);
    await w.done();
  });

  it("never touches Keep papers, even when their author burns them", async () => {
    const w = world();
    const keep = w.save("KEEP");
    expect(burnPaper(w.db, keep, "author", randomUUID(), true).outcome).toBe("destroyed");
    await w.worker.wake();
    expect(w.control.calls).toEqual({ recipe: 0, image: 0, inspection: 0 });
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get()).toEqual({ n: 0 });
    await w.done();
  });
});

describe("late recipes", () => {
  it("late_recipe_cannot_overwrite_burn_fallback", async () => {
    const w = world();
    const id = w.save("RELEASE");
    const held = deferred<Recipe>();
    w.control.recipe.push(() => held.promise);
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(id).state).toBe("PREPARING"));
    w.burn(id);
    expect(w.job(id)).toMatchObject({ state: "IMAGE_QUEUED", recipe_source: "neutral" });
    const neutral = w.job(id).recipe;
    held.resolve({ motif: "stone", material: "glass", palette: "ochre", gesture: "scattered" });
    await running;
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "PUBLISHED", recipe_source: "neutral", recipe: neutral });
    expect(w.logged.join("\n")).toContain("recipe_discarded");
    await w.done();
  });

  it("late_recipe_after_quarantine_is_discarded", async () => {
    const w = world();
    const id = w.save("RELEASE");
    const held = deferred<Recipe>();
    w.control.recipe.push(() => held.promise);
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(id).state).toBe("PREPARING"));
    quarantinePaper(w.db, id, "spam", "operator");
    held.resolve({ motif: "stone", material: "glass", palette: "ochre", gesture: "scattered" });
    await running;
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "CANCELLED", recipe: null });
    expect(w.control.calls.image).toBe(0);
    expect(w.changes).toEqual([]);
    await w.done();
  });

  it("retries a failed recipe once after five seconds, then leaves the neutral path", async () => {
    const w = world();
    const id = w.save("RELEASE", `words ${ARTIFACT_FIXTURE.recipeFails}`);
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "PREPARE_QUEUED", error_code: "recipe_provider_error" });
    w.advance(4_999);
    await w.worker.wake();
    expect(w.control.calls.recipe).toBe(1);
    w.advance(1);
    await w.worker.wake();
    expect(w.control.calls.recipe).toBe(2);
    expect(w.job(id)).toMatchObject({ state: "PREPARED", recipe: null });
    w.advance(60_000);
    await w.worker.wake();
    expect(w.control.calls.recipe).toBe(2);
    w.burn(id);
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "PUBLISHED", recipe_source: "neutral" });
    await w.done();
  });
});

describe("images that may have been generated", () => {
  it("marks a timeout or lost connection unknown and never resends it", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    w.control.image.push(() => Promise.reject(new ArtifactError("image_timeout", "ambiguous")));
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "GENERATION_UNKNOWN", image_attempts: 1, error_code: "image_timeout" });
    w.advance(24 * 60 * 60 * 1000);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(1);
    await w.done();
  });

  it("retries an explicit 429 once, no sooner than 30 s or Retry-After", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    w.control.image.push(() => Promise.reject(new ArtifactError("image_rate_limited", "transient", 45_000)));
    w.control.image.push(() => Promise.reject(new ArtifactError("image_rate_limited", "transient", 1_000)));
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "IMAGE_QUEUED", error_code: "image_rate_limited" });
    w.advance(44_999);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(1);
    w.advance(1);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(2);
    // a second 429 is not retried again
    expect(w.job(id).state).toBe("FAILED");
    await w.done();
  });

  it("crash_after_dispatch_does_not_regenerate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "throwaway-crash-"));
    const path = join(dir, "db.sqlite");
    const first = world({ db: (() => { const l = console.log; console.log = () => {}; const d = openDb(path); console.log = l; return d; })(), dir });
    first.db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now')").run();
    const id = first.save("RELEASE");
    first.burn(id);
    const held = deferred<GeneratedImage>();
    first.control.image.push(() => held.promise);
    void first.worker.wake();
    await vi.waitFor(() => expect(first.job(id)).toMatchObject({ state: "GENERATING", image_attempts: 1 }));
    // the process dies: no stop(), the database is simply reopened elsewhere
    first.restore();
    first.db.close();
    held.reject(new Error("process gone"));

    const db = (() => { const l = console.log; console.log = () => {}; const d = openDb(path); console.log = l; return d; })();
    const second = world({ db, dir: join(dir, "artifacts-2") });
    second.advance(10 * 60 * 1000);
    await second.worker.wake();
    expect(second.job(id)).toMatchObject({ state: "GENERATION_UNKNOWN", error_code: "interrupted_after_dispatch" });
    expect(second.control.calls.image).toBe(0);
    await second.done();
  });

  it("finalized_file_resumes_inspection", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    const job = w.job(id);
    // as if the process died after the file was written but before the
    // job heard about it
    w.db.prepare("UPDATE artifact_jobs SET state = 'GENERATING', image_attempts = 1, lease_token = 'dead', lease_until = 0 WHERE id = ?").run(job.id);
    writeFileSync(join(w.dir, `${job.public_id}.webp`), WEBP);
    writeFileSync(join(w.dir, `${randomUUID()}.webp.0a1b2c3d.partial`), "half");
    await w.worker.wake();
    expect(w.job(id).state).toBe("PUBLISHED");
    expect(w.control.calls).toEqual({ recipe: 0, image: 0, inspection: 1 });
    // the abandoned staging file was swept
    expect(readdirSync(w.dir)).toEqual([`${job.public_id}.webp`]);
    await w.done();
  });

  it("an operator retry of an unknown generation needs explicit acknowledgement and sends exactly one more", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    w.control.image.push(() => Promise.reject(new ArtifactError("image_transport", "ambiguous")));
    await w.worker.wake();
    expect(w.job(id).state).toBe("GENERATION_UNKNOWN");
    enqueueAdminJob(w.db, "retry", w.job(id).id, null, Date.now());
    await w.worker.wake();
    expect(w.job(id).state).toBe("PUBLISHED");
    expect(w.control.calls.image).toBe(2);
    await w.done();
  });
});

describe("inspection", () => {
  it("keeps a blocked image private, removes its file and never regenerates", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    w.control.inspection.push(() => Promise.resolve("blocked"));
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "BLOCKED", error_code: "inspection_blocked" });
    expect(readdirSync(w.dir)).toEqual([]);
    expect(w.control.calls.image).toBe(1);
    expect(w.changes).toEqual([]);
    await w.done();
  });

  it("tries a transient inspection failure three times in all: now, after 5 s, after 30 s", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    for (let i = 0; i < 3; i++) w.control.inspection.push(() => Promise.reject(new ArtifactError("inspection_timeout", "transient")));
    await w.worker.wake();
    expect(w.control.calls.inspection).toBe(1);
    w.advance(5_000);
    await w.worker.wake();
    expect(w.control.calls.inspection).toBe(2);
    w.advance(29_999);
    await w.worker.wake();
    expect(w.control.calls.inspection).toBe(2);
    w.advance(1);
    await w.worker.wake();
    expect(w.control.calls.inspection).toBe(3);
    expect(w.job(id)).toMatchObject({ state: "FAILED", error_code: "exhausted_inspection_timeout" });
    expect(readdirSync(w.dir)).toEqual([]);
    expect(w.control.calls.image).toBe(1);
    await w.done();
  });

  it("expired_lease_result_cannot_publish", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    const held = deferred<"allow" | "blocked">();
    w.control.inspection.push(() => held.promise);
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(id).state).toBe("REVIEWING"));
    // the lease is taken over (as recovery would after expiry)
    w.db.prepare("UPDATE artifact_jobs SET lease_token = 'someone-else' WHERE paper_id = ?").run(id);
    held.resolve("allow");
    await running;
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 0 });
    expect(w.changes).toEqual([]);
    await w.done();
  });
});

describe("limits", () => {
  it("reserves the daily budgets before dispatch and resumes on the next UTC day", async () => {
    const w = world();
    const ids = Array.from({ length: DAILY_BUDGET.images + 2 }, () => {
      const id = w.save("RELEASE");
      w.burn(id);
      return id;
    });
    await w.worker.wake();
    expect(w.control.calls.image).toBe(DAILY_BUDGET.images);
    const waiting = ids.filter((id) => w.job(id).state === "IMAGE_QUEUED");
    expect(waiting).toHaveLength(2);
    for (const id of waiting) expect(w.job(id).error_code).toBe("daily_budget");
    // nothing more today, everything still queued
    w.advance(60 * 60 * 1000);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(DAILY_BUDGET.images);
    w.advance(24 * 60 * 60 * 1000);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(DAILY_BUDGET.images + 2);
    for (const id of ids) expect(w.job(id).state).toBe("PUBLISHED");
    await w.done();
  });

  it("waits with a safe reason when storage is full, and starts no image", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    // fill the public-object cap
    for (let i = 0; i < 200; i++) {
      const pid = randomUUID();
      w.db.prepare("INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status, request_digest) VALUES (?, 'author', '', 'now', ?, 'RELEASE', 'DESTROYED', 'd')").run(`p${i}`, `k${i}`);
      w.db.prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, 'PUBLISHED', 0, 0, 0)").run(`j${i}`, `p${i}`, pid);
      w.db.prepare("INSERT INTO artifacts (id, job_id, status, file_key, width, height, title, alt, published_at, updated_at) VALUES (?, ?, 'PUBLISHED', ?, 1024, 1024, 't', 'a', 0, 0)").run(pid, `j${i}`, `${pid}.webp`);
    }
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "IMAGE_QUEUED", error_code: "storage_full" });
    expect(w.control.calls.image).toBe(0);
    await w.done();
  });

  it("with processing paused, keeps every job queued but still applies an operator hide", async () => {
    const w = world({ enabled: false });
    const id = w.save("RELEASE");
    w.burn(id);
    // an already published object from earlier
    const pid = randomUUID();
    w.db.prepare("INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status, request_digest) VALUES ('old-paper', 'author', '', 'now', 'k-old', 'RELEASE', 'DESTROYED', 'd')").run();
    w.db.prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, next_attempt_at, created_at, updated_at) VALUES ('old', 'old-paper', ?, 'PUBLISHED', 0, 0, 0)").run(pid);
    writeFileSync(join(w.dir, `${pid}.webp`), WEBP);
    w.db.prepare("INSERT INTO artifacts (id, job_id, status, file_key, width, height, title, alt, published_at, updated_at) VALUES (?, 'old', 'PUBLISHED', ?, 1024, 1024, 't', 'a', 0, 0)").run(pid, `${pid}.webp`);
    enqueueAdminJob(w.db, "hide", pid, "reported", Date.now());
    await w.worker.wake();
    expect(w.control.calls).toEqual({ recipe: 0, image: 0, inspection: 0 });
    expect(w.job(id).state).toBe("IMAGE_QUEUED");
    expect(w.changes.map((c) => c.type)).toEqual(["artifact:hidden"]);
    await vi.waitFor(() => expect(existsSync(join(w.dir, `${pid}.webp`))).toBe(false));
    await w.done();
  });
});

describe("shutdown and repeats", () => {
  it("lost_burn_reply_does_not_duplicate_object", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.db.prepare("INSERT INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, 'reader', 1, 'now')").run(id);
    const key = randomUUID();
    burnPaper(w.db, id, "reader", key, true);
    await w.worker.wake();
    burnPaper(w.db, id, "reader", key, true);
    await w.worker.wake();
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 1 });
    expect(w.control.calls.image).toBe(1);
    await w.done();
  });

  it("aborts a pending request on stop, and nothing writes to the closed database", async () => {
    const w = world();
    const id = w.save("RELEASE");
    w.burn(id);
    let aborted = false;
    // a request that only ends when it is aborted, as a real one would
    w.control.image.push(
      (signal) =>
        new Promise<GeneratedImage>((_r, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new ArtifactError("image_timeout", "ambiguous"));
          });
        }),
    );
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(id).state).toBe("GENERATING"));
    await w.worker.stop();
    await running;
    expect(aborted).toBe(true);
    // the aborted request settled before stop() resolved
    expect(w.job(id).state).toBe("GENERATION_UNKNOWN");
    w.db.close();
    // a later wake is a no-op on a stopped worker
    await expect(w.worker.wake()).resolves.toBeUndefined();
    w.restore();
  });

  it("a concurrent wake never starts a second runner", async () => {
    const w = world();
    const id = w.save("RELEASE");
    const held = deferred<Recipe>();
    w.control.recipe.push(() => held.promise);
    const a = w.worker.wake();
    const b = w.worker.wake();
    expect(b).toBe(a);
    held.resolve({ motif: "seed", material: "clay", palette: "slate", gesture: "balanced" });
    await a;
    expect(w.control.calls.recipe).toBe(1);
    void id;
    await w.done();
  });
});
