import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leave, open, post, url, visitor, witness, type Visitor } from "./client.ts";
import { openStream } from "./sse.ts";

// Letting a paper disappear: permissioned, deliberate, once. Destroys papers,
// so never run against the live app.

const burn = (who: Visitor, id: string, body: Record<string, unknown>): Promise<Response> =>
  post(who, `/api/papers/${id}/burn`, { op_key: randomUUID(), confirmed: true, ...body });

describe("who may let a paper go", () => {
  it("refuses a Keep paper to anyone but its author, and an unwitnessed Release paper to everyone", async () => {
    const author = await visitor();
    const kept = await leave(author, "KEEP");
    const released = await leave(author, "RELEASE");
    const reader = await visitor();

    const k = await open(reader, kept);
    await witness(reader, kept, k.read_receipt);
    expect((await burn(reader, kept, { read_receipt: k.read_receipt })).status).toBe(403);

    const r = await open(reader, released);
    expect((await burn(reader, released, { read_receipt: r.read_receipt })).status).toBe(403);
    const mine = await open(author, released);
    expect((await burn(author, released, { read_receipt: mine.read_receipt })).status).toBe(403);

    // all refused, so both are still here and readable
    expect((await open(reader, kept)).content).toBeTruthy();
    expect((await open(reader, released)).content).toBeTruthy();
  });

  it("needs a receipt and an explicit confirmation", async () => {
    const author = await visitor();
    const kept = await leave(author, "KEEP");
    const receipt = (await open(author, kept)).read_receipt;
    expect((await burn(author, kept, { read_receipt: undefined })).status).toBe(403);
    expect((await burn(author, kept, { read_receipt: receipt, confirmed: false })).status).toBe(403);
    expect((await burn(author, kept, { read_receipt: receipt, op_key: "x" })).status).toBe(400);
    expect((await open(author, kept)).id).toBe(kept);
  });

  it("lets a Keep author go straight to it, and a Release witness after witnessing", async () => {
    const author = await visitor();
    const kept = await leave(author, "KEEP");
    const res = await burn(author, kept, { read_receipt: (await open(author, kept)).read_receipt });
    expect(res.status).toBe(200);

    const released = await leave(author, "RELEASE");
    const reader = await visitor();
    const r = await open(reader, released);
    await witness(reader, released, r.read_receipt);
    expect((await burn(reader, released, { read_receipt: r.read_receipt })).status).toBe(200);
  });
});

describe("disappearing", () => {
  it("takes the words with it: no reopening, no witnessing, no retry that brings it back", async () => {
    const author = await visitor();
    const submission_key = randomUUID();
    const content = `gone soon ${randomUUID()}`;
    const saved = await post(author, "/api/papers", { content, mode: "KEEP", confirmed: true, submission_key });
    const { paper } = (await saved.json()) as { paper: { id: string } };
    const opened = await open(author, paper.id);

    const res = await burn(author, paper.id, { read_receipt: opened.read_receipt });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(content);

    expect((await fetch(url(`/api/papers/${paper.id}`), { headers: { cookie: author.cookie } })).status).toBe(404);
    expect((await witness(author, paper.id, opened.read_receipt)).status).toBe(410);
    const retry = await post(author, "/api/papers", { content, mode: "KEEP", confirmed: true, submission_key });
    const again = (await retry.json()) as { paper: { id: string; status: string } };
    expect(again.paper).toMatchObject({ id: paper.id, status: "destroyed" });
    expect((await fetch(url(`/api/papers/${paper.id}`))).status).toBe(404);
  });

  it("happens once when two people let it go at the same moment", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const [b, c] = [await visitor(), await visitor()];
    const [rb, rc] = [await open(b, id), await open(c, id)];
    await witness(b, id, rb.read_receipt);
    await witness(c, id, rc.read_receipt);
    const stream = await openStream(url("/api/events"));
    try {
      await stream.next("space:snapshot");
      const [x, y] = await Promise.all([
        burn(b, id, { read_receipt: rb.read_receipt }),
        burn(c, id, { read_receipt: rc.read_receipt }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 410]);
      const [winner, loser] = x.status === 200 ? [x, y] : [y, x];
      expect(((await loser.json()) as { code: string }).code).toBe("paper_gone");
      const won = (await winner.json()) as { total: number; revision: number };

      await stream.next("paper:destroyed", (d) => d.id === id, 1000);
      await new Promise((r) => setTimeout(r, 300));
      const destroyedEvents = stream.events.filter((e) => e.event === "paper:destroyed" && e.data.id === id);
      expect(destroyedEvents).toHaveLength(1);
      expect(destroyedEvents[0].data).toMatchObject({ active_total: won.total, revision: won.revision });
    } finally {
      stream.close();
    }
  });

  it("answers a retried operation with its first outcome instead of trying again", async () => {
    const author = await visitor();
    const id = await leave(author, "KEEP");
    const receipt = (await open(author, id)).read_receipt;
    const op_key = randomUUID();
    const first = (await (await burn(author, id, { read_receipt: receipt, op_key })).json()) as { total: number; revision: number };
    const again = await burn(author, id, { read_receipt: receipt, op_key });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "destroyed", total: first.total, revision: first.revision });
  });

  it("refuses an operation key reused for a different paper", async () => {
    const author = await visitor();
    const first = await leave(author, "KEEP");
    const second = await leave(author, "KEEP");
    const op_key = randomUUID();
    const firstReceipt = (await open(author, first)).read_receipt;
    expect((await burn(author, first, { read_receipt: firstReceipt, op_key })).status).toBe(200);

    const reused = await burn(author, second, { read_receipt: (await open(author, second)).read_receipt, op_key });
    expect(reused.status).toBe(409);
    expect(((await reused.json()) as { code: string }).code).toBe("operation_conflict");
    // the second paper is untouched, and the key still answers for the first paper
    expect((await open(author, second)).id).toBe(second);
    expect((await burn(author, first, { read_receipt: firstReceipt, op_key })).status).toBe(200);
  });

  it("carries the same ending facts in the reply, the retry and the event", async () => {
    const author = await visitor();
    const id = await leave(author, "KEEP");
    const receipt = (await open(author, id)).read_receipt;
    const op_key = randomUUID();
    const stream = await openStream(url("/api/events"));
    try {
      await stream.next("space:snapshot");
      const reply = (await (await burn(author, id, { read_receipt: receipt, op_key })).json()) as Record<string, unknown>;
      const retry = (await (await burn(author, id, { read_receipt: receipt, op_key })).json()) as Record<string, unknown>;
      const { data } = await stream.next("paper:destroyed", (d) => d.id === id);
      const facts = ["id", "version", "destroyed_at", "burn_duration_ms", "effect_seed", "op", "revision"] as const;
      for (const key of facts) {
        expect(reply[key], key).toBeDefined();
        expect(retry[key], key).toEqual(reply[key]);
        expect(data[key], key).toEqual(reply[key]);
      }
      expect(data.active_total).toBe(reply.total);
      expect(Number.isNaN(Date.parse(String(reply.destroyed_at)))).toBe(false);
      expect(JSON.stringify(data)).not.toMatch(/content|owner|witness/);
    } finally {
      stream.close();
    }
  });

  it("is reported to a reconnecting visitor who still held the paper", async () => {
    const author = await visitor();
    const id = await leave(author, "KEEP");
    await burn(author, id, { read_receipt: (await open(author, id)).read_receipt });
    const stream = await openStream(url(`/api/events?known=${id}`));
    try {
      const { data } = await stream.next("space:snapshot");
      expect((data.known as { id: string; status: string }[])[0]).toMatchObject({ id, status: "destroyed" });
      expect((data.window as { id: string }[]).map((w) => w.id)).not.toContain(id);
    } finally {
      stream.close();
    }
  });
});
