import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { acceptBrief, sourceUnavailable } from "../server/artifacts/store.ts";
import { fixtureBrief } from "../server/artifacts/provider.ts";
import { open, post, visitor, witness, url } from "./client.ts";

// A record starts at ignition: the burn transaction reads a Release paper's
// note once, just before clearing it, and hands it back in memory for one
// extraction. Nothing is prepared at save time; Keep is never read; a repeat,
// a loser of a race or a forbidden burn never gets a source.

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

const jobs = (db: DB): number => (db.prepare("SELECT COUNT(*) AS n FROM artifact_jobs").get() as { n: number }).n;
const job = (db: DB, paperId: string) =>
  db.prepare("SELECT state, brief, lease_token FROM artifact_jobs WHERE paper_id = ?").get(paperId) as
    | { state: string; brief: string | null; lease_token: string | null }
    | undefined;

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

describe("nothing happens before ignition", () => {
  it("a save, Keep or Release, makes no job and reads nothing", () => {
    const { db, save } = setup();
    save("KEEP");
    save("RELEASE", "words", drawing());
    expect(jobs(db)).toBe(0);
    db.close();
  });

  it("mode_change_under_submission_key_remains_409", () => {
    const { db } = setup();
    const key = randomUUID();
    expect(createPaper(db, "author", "same words", key, "KEEP").ok).toBe(true);
    const changed = createPaper(db, "author", "same words", key, "RELEASE");
    expect(changed.ok === false && changed.status).toBe(409);
    db.close();
  });
});

describe("the burn reads its note once, then clears it in the same commit", () => {
  it("hands back text, drawing-only and combined notes exactly, and clears them", () => {
    const { db, save, acknowledge } = setup();
    const art = drawing();
    for (const [content, d] of [["words", null], ["", art], ["both", art]] as const) {
      const id = save("RELEASE", content, d);
      acknowledge(id, "reader");
      const burned = burnPaper(db, id, "reader", randomUUID(), true);
      expect(burned.outcome).toBe("destroyed");
      expect(burned.ignition?.source).toEqual({ text: content, drawing: d });
      expect(db.prepare("SELECT content, drawing, status FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null, status: "DESTROYED" });
      expect(job(db, id)).toMatchObject({ state: "EXTRACTING", brief: null });
    }
    db.close();
  });

  it("a Keep author's burn reads nothing and makes no job", () => {
    const { db, save } = setup();
    const keep = save("KEEP", "both", drawing());
    const burned = burnPaper(db, keep, "author", randomUUID(), true);
    expect(burned.outcome).toBe("destroyed");
    expect(burned.ignition).toBeUndefined();
    expect(jobs(db)).toBe(0);
    db.close();
  });

  it("a forbidden burn reads nothing", () => {
    const { db, save } = setup();
    const id = save("RELEASE");
    // not witnessed: a Release paper can't be burned yet
    const burned = burnPaper(db, id, "reader", randomUUID(), true);
    expect([burned.outcome, burned.ignition]).toEqual(["forbidden", undefined]);
    expect(jobs(db)).toBe(0);
    db.close();
  });

  it("lost_burn_response_reuses_one_job: a retry gets the receipt but never the note", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    acknowledge(id, "reader");
    const first = burnPaper(db, id, "reader", "burn-lost-1", true);
    const retry = burnPaper(db, id, "reader", "burn-lost-1", true);
    expect([first.outcome, first.fresh, retry.outcome, retry.fresh]).toEqual(["destroyed", true, "destroyed", false]);
    expect(first.ignition).toBeDefined();
    expect(retry.ignition).toBeUndefined();
    expect(jobs(db)).toBe(1);
    db.close();
  });

  it("two_authorized_burners_create_one_job and one source", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    acknowledge(id, "reader");
    acknowledge(id, "other");
    const a = burnPaper(db, id, "reader", "burn-a-1", true);
    const b = burnPaper(db, id, "other", "burn-b-1", true);
    expect([a.outcome, b.outcome]).toEqual(["destroyed", "paper_gone"]);
    expect([!!a.ignition, !!b.ignition]).toEqual([true, false]);
    expect(jobs(db)).toBe(1);
    db.close();
  });

  it("accepts a brief only under the burn's own lease, before its deadline", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE", "an unfinished conversation");
    acknowledge(id, "reader");
    const { ignition } = burnPaper(db, id, "reader", randomUUID(), true);
    const brief = fixtureBrief("an unfinished conversation", null);
    expect(acceptBrief(db, ignition!.jobId, "not-the-lease", brief, Date.now())).toBe(false);
    expect(acceptBrief(db, ignition!.jobId, ignition!.lease, brief, ignition!.extractUntil + 1)).toBe(false);
    expect(acceptBrief(db, ignition!.jobId, ignition!.lease, brief, Date.now())).toBe(true);
    expect(job(db, id)).toMatchObject({ state: "IMAGE_QUEUED", lease_token: null });
    expect(JSON.parse(job(db, id)!.brief!)).toEqual(brief);
    // a second answer can't replace it
    expect(acceptBrief(db, ignition!.jobId, ignition!.lease, { ...brief, metaphor: "stone" }, Date.now())).toBe(false);
    db.close();
  });

  it("a failed extraction leaves no record and no brief", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE");
    acknowledge(id, "reader");
    const { ignition } = burnPaper(db, id, "reader", randomUUID(), true);
    expect(sourceUnavailable(db, ignition!.jobId, ignition!.lease, "brief_timeout", Date.now())).toBe(true);
    expect(job(db, id)).toMatchObject({ state: "SOURCE_UNAVAILABLE", brief: null });
    db.close();
  });
});

describe("quarantine", () => {
  it("quarantine_cancels_without_image_job: a quarantined paper is never burned, so never read", () => {
    const { db, save, acknowledge } = setup();
    const id = save("RELEASE", "both", drawing());
    quiet(() => quarantinePaper(db, id, "spam", "operator"));
    acknowledge(id, "reader");
    expect(burnPaper(db, id, "reader", randomUUID(), true).outcome).toBe("paper_gone");
    expect(jobs(db)).toBe(0);
    db.close();
  });
});

describe("over HTTP", () => {
  it("leaves the paper, list and create replies unchanged; a Release burn says when its fire must end", async () => {
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
    const base = ["burn_duration_ms", "destroyed_at", "effect_seed", "id", "op", "revision", "status", "total", "version"];
    // with generation running, a Release burn's fire waits at most 15 s;
    // paused, there is no extraction and the reply is exactly as before
    expect(Object.keys(receipt).filter((k) => k !== "extraction_until").sort()).toEqual(base);
    if (receipt.extraction_until !== undefined) {
      const until = Date.parse(String(receipt.extraction_until)) - Date.parse(String(receipt.destroyed_at));
      expect(until).toBe(15_000);
    }
    expect(JSON.stringify(receipt)).not.toMatch(/brief|metaphor|release words/);
    const list = (await (await fetch(url("/api/papers"))).json()) as Record<string, unknown>;
    expect(Object.keys(list).sort()).toEqual(["papers", "revision", "total"]);

    // Keep never has an extraction to wait for
    const k = (await (await post(author, "/api/papers", { content: "keep words", mode: "KEEP", confirmed: true, submission_key: randomUUID() })).json()) as {
      paper: { id: string };
    };
    const ko = await open(author, k.paper.id);
    const kb = (await (await post(author, `/api/papers/${k.paper.id}/burn`, { read_receipt: ko.read_receipt, op_key: randomUUID(), confirmed: true })).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(kb).sort()).toEqual(base);
  });
});
