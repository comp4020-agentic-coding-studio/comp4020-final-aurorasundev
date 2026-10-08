import { describe, expect, it } from "vitest";
import { leave, open, url, visitor, witness, type Opened } from "./client.ts";
import { openStream } from "./sse.ts";

// Witnessing is a deliberate act, distinct from opening. Creates papers, so
// never run against the live app.

describe("opening is not witnessing", () => {
  it("leaves the count untouched however many times a paper is opened", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const reader = await visitor();
    for (let i = 0; i < 3; i++) await open(reader, id);
    const opened = await open(await visitor(), id);
    expect(opened.witness_count).toBe(0);
    expect(opened.viewer.has_witnessed).toBe(false);
  });

  it("keeps witness counts out of the space's list", async () => {
    const res = await fetch(url("/api/papers"));
    expect(JSON.stringify(await res.json())).not.toMatch(/witness/);
  });
});

describe("I saw it", () => {
  it("counts each distinct visitor once, however many tabs or clicks", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const [b, c] = [await visitor(), await visitor()];
    const [bTab1, bTab2, cTab] = [await open(b, id), await open(b, id), await open(c, id)];

    const results = await Promise.all([
      witness(b, id, bTab1.read_receipt),
      witness(b, id, bTab2.read_receipt),
      witness(c, id, cTab.read_receipt),
      witness(c, id, cTab.read_receipt),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    const after = await open(await visitor(), id);
    expect(after.witness_count).toBe(2);
    const bAgain = await open(b, id);
    expect(bAgain.viewer.has_witnessed).toBe(true);
  });

  it("lets an author acknowledge without adding to the count", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const mine = await open(author, id);
    expect(mine.viewer).toEqual({ is_author: true, has_witnessed: false, can_burn: false });

    const res = await witness(author, id, mine.read_receipt);
    expect(res.status).toBe(200);
    const after = (await res.json()) as Opened;
    expect(after.witness_count).toBe(0);
    // a Release author who acknowledged it may destroy it like any visitor
    expect(after.viewer).toEqual({ is_author: true, has_witnessed: true, can_burn: true });
  });

  it("gives a Release reader destruction rights only after witnessing; a Keep reader never", async () => {
    const author = await visitor();
    const released = await leave(author, "RELEASE");
    const kept = await leave(author, "KEEP");
    const reader = await visitor();

    const r = await open(reader, released);
    expect(r.viewer.can_burn).toBe(false);
    const rw = (await (await witness(reader, released, r.read_receipt)).json()) as Opened;
    expect(rw.viewer.can_burn).toBe(true);

    const k = await open(reader, kept);
    const kw = (await (await witness(reader, kept, k.read_receipt)).json()) as Opened;
    expect(kw.witness_count).toBe(1);
    expect(kw.viewer.can_burn).toBe(false);

    const own = await open(author, kept);
    expect(own.viewer).toMatchObject({ is_author: true, can_burn: true });
  });

  it("refuses without a receipt for this paper and this visitor", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const other = await leave(author, "RELEASE");
    const reader = await visitor();
    const stranger = await visitor();
    const receipt = (await open(reader, id)).read_receipt;
    const otherReceipt = (await open(reader, other)).read_receipt;

    expect((await witness(reader, id, undefined)).status).toBe(403);
    expect((await witness(reader, id, "1.forged")).status).toBe(403);
    expect((await witness(reader, id, otherReceipt)).status).toBe(403);
    expect((await witness(stranger, id, receipt)).status).toBe(403);
    expect((await open(await visitor(), id)).witness_count).toBe(0);
  });

  it("tells connected visitors a paper changed, without its count or who witnessed it", async () => {
    const author = await visitor();
    const id = await leave(author, "RELEASE");
    const stream = await openStream(url("/api/events"));
    try {
      await stream.next("space:snapshot");
      const reader = await visitor();
      const opened = await open(reader, id);
      await witness(reader, id, opened.read_receipt);
      const { data } = await stream.next("paper:witnessed", (d) => d.id === id, 1000);
      expect(Object.keys(data).sort()).toEqual(["id", "revision", "version"]);
      expect(data.version).toBeGreaterThan(opened.version);
    } finally {
      stream.close();
    }
  });
});
