import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { ArtifactError, ARTIFACT_FIXTURE, fixtureArtifactProvider, fixtureBrief, newFixtureControl, type FixtureControl, type GeneratedImage } from "../server/artifacts/provider.ts";
import { enqueueAdminJob } from "../server/artifacts/store.ts";
import type { CreativeBriefV2, GalleryChange } from "../server/artifacts/types.ts";
import { createArtifactWorker, DAILY_BUDGET, MAX_EXTRACTIONS } from "../server/artifacts/worker.ts";

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
  // a test clock (fixed time of day for budget tests); burns are restamped to it
  const today = new Date();
  let clock = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 2, 3, 0, 0);
  const control: FixtureControl = options.control ?? newFixtureControl();
  const provider = fixtureArtifactProvider(control);
  const changes: GalleryChange[] = [];
  const settled: string[] = [];
  const worker = createArtifactWorker(db, provider, {
    artifactDir: dir,
    enabled: options.enabled ?? true,
    onChange: (c) => changes.push(c),
    onSettled: (id) => settled.push(id),
    now: () => clock,
    pollMs: 60_000,
    delays: { rateLimitMinMs: 30_000, inspectionMs: [5_000, 30_000], capacityMs: 60_000 },
  });
  if (!options.db) db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now')").run();
  const save = (mode: "KEEP" | "RELEASE", content = `words ${CANARY}`, drawing: string | null = null) => {
    const r = createPaper(db, "author", content, randomUUID(), mode, drawing);
    if (!r.ok) throw new Error(r.code);
    return r.value.id;
  };
  // A burn as the route does it: commit, then hand a fresh Release note to
  // the worker. Returns the extraction promise (undefined for no ignition).
  // `deadlineMs` shortens the extraction's real-time limit for a timeout test
  const burn = (paperId: string, opKey = randomUUID(), deadlineMs?: number) => {
    db.prepare("INSERT OR IGNORE INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, 'reader', 1, 'now')").run(paperId);
    const result = burnPaper(db, paperId, "reader", opKey, true);
    if (!result.ignition) return { result, extracting: undefined };
    const shift = clock - Date.now();
    db.prepare("UPDATE artifact_jobs SET extract_until = extract_until + ?, not_before = not_before + ?, next_attempt_at = ? WHERE id = ?").run(
      shift,
      shift,
      clock,
      result.ignition.jobId,
    );
    const ignition = { ...result.ignition, extractUntil: deadlineMs === undefined ? result.ignition.extractUntil + shift : clock + deadlineMs };
    return { result, extracting: worker.extract(ignition) };
  };
  // burn, let the extraction settle, then let the fire's time pass
  const burnAndSettle = async (paperId: string) => {
    const { extracting } = burn(paperId);
    await extracting;
    clock += 4_800;
  };
  const job = (paperId: string) =>
    db.prepare("SELECT id, public_id, state, brief, error_code, image_attempts, review_attempts, file_key FROM artifact_jobs WHERE paper_id = ?").get(paperId) as {
      id: string;
      public_id: string;
      state: string;
      brief: string | null;
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
    settled,
    worker,
    logged,
    save,
    burn,
    burnAndSettle,
    job,
    restore,
    now: () => clock,
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
  it("release_to_private_file_to_inspected_public_object: extracted at ignition, published after the fire", async () => {
    const w = world();
    const id = w.save("RELEASE", `I never finished that conversation with her. ${CANARY}`);
    expect(w.control.calls.brief).toBe(0);
    const { result, extracting } = w.burn(id);
    expect(result.outcome).toBe("destroyed");
    // the paper was cleared in the burn's own commit, before any extraction
    expect(w.db.prepare("SELECT content, drawing FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null });
    await extracting;
    expect(w.control.seen.brief).toEqual([{ text: `I never finished that conversation with her. ${CANARY}`, drawing: null }]);
    expect(w.job(id).state).toBe("IMAGE_QUEUED");
    expect(w.settled).toEqual([id]);
    // generation may run during the fire, but nothing is published before it ends
    await w.worker.wake();
    expect(w.job(id).state).toBe("REVIEW_QUEUED");
    expect(w.changes).toEqual([]);
    w.advance(4_800);
    await w.worker.wake();
    expect(w.job(id).state).toBe("PUBLISHED");
    const change = w.changes[0] as Extract<GalleryChange, { type: "artifact:published" }>;
    expect(change).toMatchObject({ type: "artifact:published", revision: 1, total: 1 });
    expect(change.artifact.title).toBe("An unfinished thread");
    expect(w.control.calls).toEqual({ brief: 1, image: 1, inspection: 1 });
    // the image request saw the brief alone
    expect(JSON.stringify(w.control.seen.image)).not.toContain(CANARY);
    // and the note reached no table, file, log or event
    expect(allText(w)).not.toContain(CANARY);
    expect(allText(w)).not.toContain("conversation");
    await w.done();
  });

  it("two different notes become two different records", async () => {
    const w = world();
    const a = w.save("RELEASE", "I never finished that conversation.");
    const b = w.save("RELEASE", "Everyone expected me to be perfect.");
    await w.burnAndSettle(a);
    await w.burnAndSettle(b);
    await w.worker.wake();
    const titles = w.changes.map((c) => (c as Extract<GalleryChange, { type: "artifact:published" }>).artifact.title);
    expect(new Set(titles).size).toBe(2);
    expect(JSON.parse(w.job(a).brief!).metaphor).not.toBe(JSON.parse(w.job(b).brief!).metaphor);
    await w.done();
  });

  it("a drawing-only note is extracted with its drawing", async () => {
    const w = world();
    const art = drawing();
    const id = w.save("RELEASE", "", art);
    await w.burnAndSettle(id);
    expect(w.control.seen.brief).toEqual([{ text: "", drawing: art }]);
    await w.worker.wake();
    expect(w.job(id).state).toBe("PUBLISHED");
    await w.done();
  });

  it("never reads a Keep paper, even when its author burns it", async () => {
    const w = world();
    const keep = w.save("KEEP");
    expect(burnPaper(w.db, keep, "author", randomUUID(), true).ignition).toBeUndefined();
    await w.worker.wake();
    expect(w.control.calls).toEqual({ brief: 0, image: 0, inspection: 0 });
    await w.done();
  });
});

describe("the extraction at ignition", () => {
  it("a failed or timed-out extraction makes no record and nothing in its place", async () => {
    const w = world();
    const failing = w.save("RELEASE", `words ${ARTIFACT_FIXTURE.briefFails}`);
    await w.burnAndSettle(failing);
    expect(w.job(failing)).toMatchObject({ state: "SOURCE_UNAVAILABLE", error_code: "brief_provider_error", brief: null });
    // a slow one: its deadline aborts it (shortened here from 15 s)
    const slow = w.save("RELEASE");
    w.control.brief.push(
      (signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new ArtifactError("brief_timeout", "transient")))),
    );
    await w.burn(slow, randomUUID(), 30).extracting;
    expect(w.job(slow).state).toBe("SOURCE_UNAVAILABLE");
    await w.worker.wake();
    expect(w.control.calls.image).toBe(0);
    expect(w.changes).toEqual([]);
    expect(w.settled).toEqual([failing, slow]);
    await w.done();
  });

  it("a brief that arrives after its deadline is refused", async () => {
    const w = world();
    const id = w.save("RELEASE");
    const held = deferred<CreativeBriefV2>();
    w.control.brief.push(() => held.promise);
    const { extracting } = w.burn(id);
    // the deadline passes on the worker's clock before the answer arrives
    w.advance(15_001);
    held.resolve(fixtureBrief("late", null));
    await extracting;
    expect(w.job(id)).toMatchObject({ state: "SOURCE_UNAVAILABLE", brief: null });
    await w.done();
  });

  it("a restart while extracting loses the note honestly: no record, and the fire is released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "throwaway-restart-"));
    const path = join(dir, "db.sqlite");
    const reopen = () => {
      const l = console.log;
      console.log = () => {};
      const d = openDb(path);
      console.log = l;
      return d;
    };
    const first = world({ db: reopen(), dir });
    first.db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now')").run();
    const id = first.save("RELEASE");
    first.control.brief.push(() => new Promise(() => {}));
    void first.burn(id).extracting;
    expect(first.job(id).state).toBe("EXTRACTING");
    // the process dies; the database is reopened by a new one
    first.restore();
    first.db.close();
    const second = world({ db: reopen(), dir: join(dir, "artifacts") });
    await second.worker.wake();
    expect(second.job(id)).toMatchObject({ state: "SOURCE_UNAVAILABLE", error_code: "source_lost_on_restart" });
    expect(second.settled).toEqual([id]);
    expect(second.control.calls.brief).toBe(0);
    await second.done();
  });

  it("with processing paused, a burn reads nothing and makes no job", async () => {
    const w = world({ enabled: false });
    const id = w.save("RELEASE");
    w.db.prepare("INSERT INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, 'reader', 1, 'now')").run(id);
    // the route passes extract=false when the worker is paused
    expect(burnPaper(w.db, id, "reader", randomUUID(), true, w.worker.enabled).ignition).toBeUndefined();
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get()).toEqual({ n: 0 });
    await w.done();
  });

  it("limits extractions in flight and per day, without retrying a lost note", async () => {
    const w = world();
    const held: ReturnType<typeof deferred<CreativeBriefV2>>[] = [];
    const ids = Array.from({ length: MAX_EXTRACTIONS + 1 }, () => w.save("RELEASE"));
    for (let i = 0; i < MAX_EXTRACTIONS; i++) {
      const d = deferred<CreativeBriefV2>();
      held.push(d);
      w.control.brief.push(() => d.promise);
    }
    const running = ids.map((id) => w.burn(id).extracting);
    await running[MAX_EXTRACTIONS];
    expect(w.job(ids[MAX_EXTRACTIONS])).toMatchObject({ state: "SOURCE_UNAVAILABLE", error_code: "extraction_capacity" });
    for (const d of held) d.resolve(fixtureBrief("x", null));
    await Promise.all(running);
    expect(w.control.calls.brief).toBe(MAX_EXTRACTIONS);
    // the daily cap
    w.db.prepare("UPDATE artifact_budgets SET briefs = ?").run(DAILY_BUDGET.briefs);
    const over = w.save("RELEASE");
    await w.burn(over).extracting;
    expect(w.job(over)).toMatchObject({ state: "SOURCE_UNAVAILABLE", error_code: "daily_budget" });
    await w.done();
  });
});

describe("images that may have been generated", () => {
  it("marks a timeout or lost connection unknown and never resends it", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
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
    await w.burnAndSettle(id);
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
    expect(w.job(id).state).toBe("FAILED");
    await w.done();
  });

  it("crash_after_dispatch_does_not_regenerate", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    await w.worker.stop();
    // as if the process died after the image request left; a new process starts
    w.db.prepare("UPDATE artifact_jobs SET state = 'GENERATING', image_attempts = 1, lease_token = 'dead', lease_until = 0 WHERE paper_id = ?").run(id);
    const next = world({ db: w.db, dir: w.dir });
    await next.worker.wake();
    expect(next.job(id)).toMatchObject({ state: "GENERATION_UNKNOWN", error_code: "interrupted_after_dispatch" });
    expect(next.control.calls.image).toBe(0);
    await next.done();
    w.restore();
  });

  it("finalized_file_resumes_inspection", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    await w.worker.stop();
    const job = w.job(id);
    // the file was finalized but the process died before the job heard
    w.db.prepare("UPDATE artifact_jobs SET state = 'GENERATING', image_attempts = 1, lease_token = 'dead', lease_until = 0, not_before = 0 WHERE id = ?").run(job.id);
    writeFileSync(join(w.dir, `${job.public_id}.webp`), WEBP);
    writeFileSync(join(w.dir, `${randomUUID()}.webp.0a1b2c3d.partial`), "half");
    const next = world({ db: w.db, dir: w.dir });
    await next.worker.wake();
    expect(next.job(id).state).toBe("PUBLISHED");
    expect(next.control.calls).toEqual({ brief: 0, image: 0, inspection: 1 });
    expect(readdirSync(w.dir)).toEqual([`${job.public_id}.webp`]);
    await next.done();
    w.restore();
  });

  // A quick restart: the old process's lease has not expired yet. Before the
  // fix, startup skipped such jobs and nothing ever revisited them.
  for (const enabled of [true, false]) {
    it(`a restart before the lease expires still recovers orphaned work (${enabled ? "enabled" : "paused"})`, async () => {
      const w = world();
      const lost = w.save("RELEASE");
      const kept = w.save("RELEASE");
      const reviewed = w.save("RELEASE");
      for (const id of [lost, kept, reviewed]) await w.burnAndSettle(id);
      await w.worker.stop();
      const future = w.now() + 120_000;
      const set = (id: string, state: string) =>
        w.db.prepare("UPDATE artifact_jobs SET state = ?, image_attempts = 1, lease_token = 'old-process', lease_until = ?, not_before = 0 WHERE paper_id = ?").run(state, future, id);
      set(lost, "GENERATING");
      set(kept, "GENERATING");
      set(reviewed, "REVIEWING");
      writeFileSync(join(w.dir, `${w.job(kept).public_id}.webp`), WEBP);
      writeFileSync(join(w.dir, `${w.job(reviewed).public_id}.webp`), WEBP);
      w.db.prepare("UPDATE artifact_jobs SET file_key = ? WHERE paper_id = ?").run(`${w.job(reviewed).public_id}.webp`, reviewed);
      const next = world({ db: w.db, dir: w.dir, enabled });
      await next.worker.wake();
      // and past the old lease's expiry, nothing is left stranded
      next.advance(200_000);
      await next.worker.wake();
      // a dispatched image with no file is unknown, never resent
      expect(next.job(lost)).toMatchObject({ state: "GENERATION_UNKNOWN", error_code: "interrupted_after_dispatch" });
      expect(next.control.calls.image).toBe(0);
      if (enabled) {
        // a finalized file is adopted and inspected; a lost review is redone
        expect(next.job(kept).state).toBe("PUBLISHED");
        expect(next.job(reviewed).state).toBe("PUBLISHED");
      } else {
        expect(next.job(kept).state).toBe("REVIEW_QUEUED");
        expect(next.job(reviewed).state).toBe("REVIEW_QUEUED");
      }
      for (const id of [lost, kept, reviewed]) expect(["GENERATING", "REVIEWING"]).not.toContain(next.job(id).state);
      await next.done();
      w.restore();
    });
  }

  it("an operator retry of an unknown generation sends exactly one more", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
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
    await w.burnAndSettle(id);
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
    await w.burnAndSettle(id);
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
    await w.done();
  });

  it("expired_lease_result_cannot_publish", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    const held = deferred<"allow" | "blocked">();
    w.control.inspection.push(() => held.promise);
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(id).state).toBe("REVIEWING"));
    w.db.prepare("UPDATE artifact_jobs SET lease_token = 'someone-else' WHERE paper_id = ?").run(id);
    held.resolve("allow");
    await running;
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 0 });
    await w.done();
  });
});

describe("limits", () => {
  it("reserves the daily image budget before dispatch and resumes on the next UTC day", async () => {
    const w = world();
    const ids: string[] = [];
    for (let i = 0; i < DAILY_BUDGET.images + 2; i++) {
      const id = w.save("RELEASE");
      await w.burn(id).extracting;
      ids.push(id);
    }
    w.advance(4_800);
    await w.worker.wake();
    expect(w.control.calls.image).toBe(DAILY_BUDGET.images);
    const waiting = ids.filter((id) => w.job(id).state === "IMAGE_QUEUED");
    expect(waiting).toHaveLength(2);
    for (const id of waiting) expect(w.job(id).error_code).toBe("daily_budget");
    w.advance(24 * 60 * 60 * 1000);
    await w.worker.wake();
    for (const id of ids) expect(w.job(id).state).toBe("PUBLISHED");
    await w.done();
  });

  it("waits with a safe reason when storage is full, and starts no image", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    for (let i = 0; i < 200; i++) {
      const pid = randomUUID();
      w.db.prepare("INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status, request_digest) VALUES (?, 'author', '', 'now', ?, 'RELEASE', 'DESTROYED', 'd')").run(`p${i}`, `k${i}`);
      w.db.prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, not_before, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, 'PUBLISHED', 0, 0, 0, 0)").run(`j${i}`, `p${i}`, pid);
      w.db.prepare("INSERT INTO artifacts (id, job_id, status, file_key, width, height, title, alt, published_at, updated_at) VALUES (?, ?, 'PUBLISHED', ?, 1024, 1024, 't', 'a', 0, 0)").run(pid, `j${i}`, `${pid}.webp`);
    }
    await w.worker.wake();
    expect(w.job(id)).toMatchObject({ state: "IMAGE_QUEUED", error_code: "storage_full" });
    expect(w.control.calls.image).toBe(0);
    await w.done();
  });

  it("applies a hide within a second while an unrelated image request is still held", async () => {
    const w = world();
    const shown = w.save("RELEASE");
    await w.burnAndSettle(shown);
    await w.worker.wake();
    const published = w.changes[0] as Extract<GalleryChange, { type: "artifact:published" }>;
    const pid = published.artifact.id;
    const slow = w.save("RELEASE");
    await w.burnAndSettle(slow);
    const held = deferred<GeneratedImage>();
    w.control.image.push(() => held.promise);
    const running = w.worker.wake();
    await vi.waitFor(() => expect(w.job(slow).state).toBe("GENERATING"));
    enqueueAdminJob(w.db, "hide", pid, "reported", Date.now());
    void w.worker.wake();
    // the generation is still unresolved while we check
    await vi.waitFor(
      () => expect(w.db.prepare("SELECT status, version FROM artifacts WHERE id = ?").get(pid)).toEqual({ status: "HIDDEN", version: 2 }),
      { timeout: 1_200 },
    );
    expect(w.job(slow).state).toBe("GENERATING");
    const hides = w.changes.filter((c) => c.type === "artifact:hidden");
    expect(hides).toEqual([{ type: "artifact:hidden", revision: published.revision + 1, total: 0, id: pid, version: 2 }]);
    await vi.waitFor(() => expect(existsSync(join(w.dir, `${pid}.webp`))).toBe(false));
    // the late result goes on to publish its own record and cannot undo the hide
    held.resolve({ bytes: WEBP, width: 1024, height: 1024 });
    await running;
    await w.worker.wake();
    expect(w.db.prepare("SELECT status FROM artifacts WHERE id = ?").get(pid)).toEqual({ status: "HIDDEN" });
    expect(w.job(slow).state).toBe("PUBLISHED");
    await w.done();
  });

  it("with processing paused, still applies an operator hide", async () => {
    const w = world({ enabled: false });
    const pid = randomUUID();
    w.db.prepare("INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status, request_digest) VALUES ('old-paper', 'author', '', 'now', 'k-old', 'RELEASE', 'DESTROYED', 'd')").run();
    w.db.prepare("INSERT INTO artifact_jobs (id, paper_id, public_id, state, not_before, next_attempt_at, created_at, updated_at) VALUES ('old', 'old-paper', ?, 'PUBLISHED', 0, 0, 0, 0)").run(pid);
    writeFileSync(join(w.dir, `${pid}.webp`), WEBP);
    w.db.prepare("INSERT INTO artifacts (id, job_id, status, file_key, width, height, title, alt, published_at, updated_at) VALUES (?, 'old', 'PUBLISHED', ?, 1024, 1024, 't', 'a', 0, 0)").run(pid, `${pid}.webp`);
    enqueueAdminJob(w.db, "hide", pid, "reported", Date.now());
    await w.worker.wake();
    expect(w.control.calls).toEqual({ brief: 0, image: 0, inspection: 0 });
    expect(w.changes.map((c) => c.type)).toEqual(["artifact:hidden"]);
    await vi.waitFor(() => expect(existsSync(join(w.dir, `${pid}.webp`))).toBe(false));
    await w.done();
  });
});

describe("shutdown and repeats", () => {
  it("lost_burn_reply_does_not_duplicate_object", async () => {
    const w = world();
    const id = w.save("RELEASE");
    const key = randomUUID();
    await w.burn(id, key).extracting;
    w.advance(4_800);
    await w.worker.wake();
    const retry = w.burn(id, key);
    expect(retry.extracting).toBeUndefined();
    await w.worker.wake();
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 1 });
    expect(w.control.calls).toEqual({ brief: 1, image: 1, inspection: 1 });
    await w.done();
  });

  it("aborts pending requests on stop, and nothing writes to the closed database", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    let aborted = false;
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
    expect(w.job(id).state).toBe("GENERATION_UNKNOWN");
    w.db.close();
    await expect(w.worker.wake()).resolves.toBeUndefined();
    w.restore();
  });

  it("a concurrent wake never starts a second runner", async () => {
    const w = world();
    const id = w.save("RELEASE");
    await w.burnAndSettle(id);
    const held = deferred<GeneratedImage>();
    w.control.image.push(() => held.promise);
    const a = w.worker.wake();
    const b = w.worker.wake();
    expect(b).toBe(a);
    held.resolve({ bytes: WEBP, width: 1024, height: 1024 });
    await a;
    expect(w.control.calls.image).toBe(1);
    await w.done();
  });
});
