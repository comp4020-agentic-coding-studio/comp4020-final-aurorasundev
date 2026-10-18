import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { open, post, visitor, witness, url } from "./client.ts";

// Keepsake jobs follow the real paper lifecycle: a Release save prepares one,
// a successful burn queues its image in the same commit that clears the
// words and drawing, quarantine cancels it. Keep papers never get one.

const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

// a minimal valid 1200×500 greyscale PNG, the drawing size the server accepts
function drawing(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
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
  const raw = Buffer.alloc(1201 * 500, 0x40);
  for (let y = 0; y < 500; y++) raw[y * 1201] = 0;
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64")}`;
}

type Job = { state: string; recipe: string | null; recipe_source: string | null; lease_token: string | null };
const jobFor = (db: DB, paperId: string): Job | undefined =>
  db.prepare("SELECT state, recipe, recipe_source, lease_token FROM artifact_jobs WHERE paper_id = ?").get(paperId) as Job | undefined;
const jobCount = (db: DB): number => (db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get() as { n: number }).n;

function setup() {
  const db = quiet(() => openDb(":memory:"));
  db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now'), ('reader', 'now'), ('other', 'now')").run();
  const save = (mode: "KEEP" | "RELEASE", content = "words", art: string | null = null) => {
    const r = createPaper(db, "author", content, randomUUID(), mode, art);
    if (!r.ok) throw new Error(r.code);
    return r.value.id;
  };
  const acknowledge = (paperId: string, who: string) =>
    db.prepare("INSERT OR IGNORE INTO witnesses (paper_id, identity_id, counts, created_at) VALUES (?, ?, 1, 'now')").run(paperId, who);
  return { db, save, acknowledge };
}

describe("a save prepares a keepsake only for Release", () => {
  it("queues preparation for text, drawing-only and combined Release papers", () => {
    const { db, save } = setup();
    for (const id of [save("RELEASE", "words"), save("RELEASE", "", drawing()), save("RELEASE", "both", drawing())]) {
      expect(jobFor(db, id)).toMatchObject({ state: "PREPARE_QUEUED", recipe: null });
    }
    db.close();
  });

  it("queues nothing for a Keep paper, nor for a repeat of a saved submission", () => {
    const { db, save } = setup();
    const keep = save("KEEP");
    expect(jobFor(db, keep)).toBeUndefined();
    const key = randomUUID();
    const first = createPaper(db, "author", "once", key, "RELEASE");
    const again = createPaper(db, "author", "once", key, "RELEASE");
    expect(first.ok && again.ok && first.value.id === again.value.id).toBe(true);
    expect(jobCount(db)).toBe(1);
    db.close();
  });

  it("mode_change_under_submission_key_remains_409", () => {
    const { db } = setup();
    const key = randomUUID();
    expect(createPaper(db, "author", "same words", key, "KEEP").ok).toBe(true);
    const changed = createPaper(db, "author", "same words", key, "RELEASE");
    expect(changed.ok === false && changed.status).toBe(409);
    expect(jobCount(db)).toBe(0);
    db.close();
  });
});

describe("a burn queues the image in the same commit that clears the paper", () => {
  it("a Keep author's burn never queues an image", () => {
    const { db, save } = setup();
    const keep = save("KEEP", "both", drawing());
    expect(burnPaper(db, keep, "author", "burn-keep-1", true).outcome).toBe("destroyed");
    expect(jobFor(db, keep)).toBeUndefined();
    expect(jobCount(db)).toBe(0);
    db.close();
  });

  it("a Release burn moves the prepared job to the image queue and clears words and drawing", () => {
    const { db, save, acknowledge } = setup();
    for (const [content, art] of [["words", null], ["", drawing()], ["both", drawing()]] as const) {
      const id = save("RELEASE", content, art);
      acknowledge(id, "reader");
      expect(burnPaper(db, id, "reader", `burn-${randomUUID()}`, true).outcome).toBe("destroyed");
      expect(db.prepare("SELECT content, drawing, status FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null, status: "DESTROYED" });
      const job = jobFor(db, id)!;
      expect(job.state).toBe("IMAGE_QUEUED");
      // nothing was prepared yet, so the recipe is the neutral enum one
      expect(job.recipe_source).toBe("neutral");
      expect(Object.keys(JSON.parse(job.recipe!)).sort()).toEqual(["gesture", "material", "motif", "palette"]);
    }
    db.close();
  });

  it("creates the job at burn time for a Release paper discovery never reached", () => {
    const { db, acknowledge } = setup();
    // as if saved before keepsakes existed: no job yet
    db.prepare(
      "INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, request_digest) VALUES ('old', 'author', 'w', 'now', 'k-old', 'RELEASE', 'd')",
    ).run();
    acknowledge("old", "reader");
    expect(burnPaper(db, "old", "reader", "burn-old-1", true).outcome).toBe("destroyed");
    expect(jobFor(db, "old")).toMatchObject({ state: "IMAGE_QUEUED", recipe_source: "neutral" });
    db.close();
  });

  it("keeps a prepared recipe and drops any preparation lease", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    const recipe = JSON.stringify({ motif: "knot", material: "clay", palette: "sage", gesture: "held" });
    db.prepare("UPDATE artifact_jobs SET state = 'PREPARED', recipe = ?, recipe_source = 'prepared' WHERE paper_id = ?").run(recipe, id);
    acknowledge(id, "reader");
    burnPaper(db, id, "reader", "burn-prepared-1", true);
    expect(jobFor(db, id)).toEqual({ state: "IMAGE_QUEUED", recipe, recipe_source: "prepared", lease_token: null });

    const racing = save("RELEASE");
    db.prepare("UPDATE artifact_jobs SET state = 'PREPARING', lease_token = 'late', lease_until = 999999999999 WHERE paper_id = ?").run(racing);
    acknowledge(racing, "reader");
    burnPaper(db, racing, "reader", "burn-racing-1", true);
    expect(jobFor(db, racing)).toMatchObject({ state: "IMAGE_QUEUED", recipe_source: "neutral", lease_token: null });
    db.close();
  });

  it("lost_burn_response_reuses_one_job", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    acknowledge(id, "reader");
    const first = burnPaper(db, id, "reader", "burn-lost-1", true);
    const retry = burnPaper(db, id, "reader", "burn-lost-1", true);
    expect([first.outcome, first.fresh, retry.outcome, retry.fresh]).toEqual(["destroyed", true, "destroyed", false]);
    expect(jobCount(db)).toBe(1);
    db.close();
  });

  it("two_authorized_burners_create_one_job", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    acknowledge(id, "reader");
    acknowledge(id, "other");
    const totalBefore = (db.prepare("SELECT COUNT(*) AS n FROM papers WHERE status = 'ACTIVE'").get() as { n: number }).n;
    const a = burnPaper(db, id, "reader", "burn-a-1", true);
    const b = burnPaper(db, id, "other", "burn-b-1", true);
    expect([a.outcome, b.outcome]).toEqual(["destroyed", "paper_gone"]);
    expect(a.total).toBe(totalBefore - 1);
    expect(jobCount(db)).toBe(1);
    db.close();
  });
});

describe("quarantine cancels", () => {
  it("quarantine_cancels_without_image_job", () => {
    const { db, save } = setup();
    const id = save("RELEASE", "both", drawing());
    db.prepare("UPDATE artifact_jobs SET state = 'PREPARING', lease_token = 'late', lease_until = 999999999999 WHERE paper_id = ?").run(id);
    expect(quiet(() => quarantinePaper(db, id, "spam", "operator")).changed).toBe(true);
    expect(db.prepare("SELECT content, drawing FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null });
    expect(jobFor(db, id)).toEqual({ state: "CANCELLED", recipe: null, recipe_source: null, lease_token: null });
    // a later burn attempt finds nothing to burn and queues nothing
    expect(burnPaper(db, id, "author", "burn-after-q-1", true).outcome).toBe("paper_gone");
    expect(jobFor(db, id)!.state).toBe("CANCELLED");
    db.close();
  });
});

describe("over HTTP, nothing about keepsakes leaks", () => {
  it("leaves the paper, list, create and burn replies exactly as they were", async () => {
    const author = await visitor();
    const created = await post(author, "/api/papers", { content: "release words", mode: "RELEASE", confirmed: true, submission_key: randomUUID(), keepsake: false });
    expect(created.status).toBe(201);
    const body = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["offer_return_key", "paper", "revision", "total"]);
    const id = (body.paper as { id: string }).id;
    const reader = await visitor();
    const opened = await open(reader, id);
    expect(Object.keys(opened).sort()).toEqual(["content", "drawing", "id", "mode", "read_receipt", "version", "viewer", "witness_count"]);
    await witness(reader, id, opened.read_receipt);
    const burned = await post(reader, `/api/papers/${id}/burn`, { read_receipt: opened.read_receipt, op_key: randomUUID(), confirmed: true });
    const receipt = (await burned.json()) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(["burn_duration_ms", "destroyed_at", "effect_seed", "id", "op", "revision", "status", "total", "version"]);
    const list = (await (await fetch(url("/api/papers"))).json()) as Record<string, unknown>;
    expect(Object.keys(list).sort()).toEqual(["papers", "revision", "total"]);
    expect(JSON.stringify(list)).not.toMatch(/artifact|keepsake|recipe/);
  });
});
