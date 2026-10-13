import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FIXTURE } from "./moderation-fixtures.ts";
import { requestDigest, openDb } from "../server/db.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { open, post, total, visitor } from "./client.ts";

// A paper can carry a drawing beside or instead of its words. The drawing is
// a PNG of a fixed sheet size, checked like the words, immutable once saved
// and cleared when the paper ends.

const WIDTH = 1200;
const HEIGHT = 500;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

// A greyscale PNG with one dark stripe (a mark on the sheet), optionally
// carrying a fixture marker for the test provider.
function png({ width = WIDTH, height = HEIGHT, marker }: { width?: number; height?: number; marker?: string } = {}): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height, 0xf0);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    if (y > height / 2 - 3 && y < height / 2 + 3) raw.fill(0x29, y * (width + 1) + 1, (y + 1) * (width + 1));
  }
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(marker ? [chunk("tEXt", Buffer.from(`fixture\u0000${marker}`, "latin1"))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return `data:image/png;base64,${Buffer.concat(parts).toString("base64")}`;
}

const save = (who: Awaited<ReturnType<typeof visitor>>, body: Record<string, unknown>) =>
  post(who, "/api/papers", { mode: "RELEASE", confirmed: true, submission_key: randomUUID(), content: "", ...body });

describe("drawing on a paper", () => {
  it("saves a drawing with no words, and a stranger opens exactly that drawing", async () => {
    const author = await visitor();
    const drawing = png();
    const res = await save(author, { drawing });
    expect(res.status).toBe(201);
    const { paper } = (await res.json()) as { paper: { id: string } };
    const opened = await open(await visitor(), paper.id);
    expect((opened as unknown as { drawing: string }).drawing).toBe(drawing);
    expect(opened.content).toBe("");
  });

  it("saves words and a drawing together", async () => {
    const author = await visitor();
    const drawing = png();
    const res = await save(author, { content: "a line, and a picture", drawing });
    expect(res.status).toBe(201);
    const { paper } = (await res.json()) as { paper: { id: string } };
    const opened = (await open(await visitor(), paper.id)) as unknown as { content: string; drawing: string };
    expect(opened).toMatchObject({ content: "a line, and a picture", drawing });
  });

  it("still refuses a paper with neither words nor a drawing", async () => {
    const before = await total();
    const res = await save(await visitor(), { content: "   " });
    expect(res.status).toBe(400);
    expect(await total()).toBe(before);
  });

  it("refuses anything that isn't a PNG of the sheet's size", async () => {
    const author = await visitor();
    const before = await total();
    for (const drawing of [
      png({ width: 600 }),
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      "data:image/png;base64,not-base64!",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      `data:image/png;base64,${Buffer.from("plain text pretending").toString("base64")}`,
      42,
    ]) {
      expect((await save(author, { content: "words", drawing })).status, String(drawing).slice(0, 30)).toBe(400);
    }
    expect(await total()).toBe(before);
  });

  it("treats a different drawing under the same key as a different submission", async () => {
    const author = await visitor();
    const key = randomUUID();
    expect((await save(author, { content: "same words", drawing: png(), submission_key: key })).status).toBe(201);
    expect((await save(author, { content: "same words", drawing: png({ marker: "other" }), submission_key: key })).status).toBe(409);
    expect((await save(author, { content: "same words", submission_key: key })).status).toBe(409);
  });

  it("checks the drawing, not only the words: a drawing that fails keeps the paper out", async () => {
    const before = await total();
    const gate = await save(await visitor(), { content: "harmless words", drawing: png({ marker: FIXTURE.hardGate }) });
    expect(gate.status).toBe(422);
    const policy = await save(await visitor(), { drawing: png({ marker: FIXTURE.rejectPrivate }) });
    expect(policy.status).toBe(422);
    expect(await total()).toBe(before);
  });

  it("clears the drawing in the same commit that destroys or quarantines the paper", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO identities (id, created_at) VALUES (?, ?)").run("owner", "now");
    const ids = ["k1", "k2"].map((k) => {
      const result = createPaper(db, "owner", "", `drawing-${k}`, "KEEP", png());
      if (!result.ok) throw new Error(result.code);
      return result.value.id;
    });
    expect(burnPaper(db, ids[0], "owner", "burn-key-1", true).outcome).toBe("destroyed");
    expect(quarantinePaper(db, ids[1], "private_information", "operator").changed).toBe(true);
    for (const id of ids) {
      expect(db.prepare("SELECT content, drawing FROM papers WHERE id = ?").get(id)).toEqual({ content: "", drawing: null });
    }
    db.close();
  });

  it("keeps the digests of papers saved before drawings existed", () => {
    expect(requestDigest("words", "KEEP", null)).toBe(requestDigest("words", "KEEP"));
    expect(requestDigest("words", "KEEP", png())).not.toBe(requestDigest("words", "KEEP"));
  });
});
