import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leave, open, post, url, visitor, type Visitor } from "./client.ts";
import { FIXTURE } from "./moderation-fixtures.ts";
import { openStream } from "./sse.ts";

// Every new paper is checked before it can enter the space. Runs against an
// app using the fixture provider (see moderation-fixtures.ts); never against
// the live app.

const save = (who: Visitor, content: string, submission_key = randomUUID(), mode = "RELEASE"): Promise<Response> =>
  post(who, "/api/papers", { content, mode, confirmed: true, submission_key });

// a refused save must not reach anyone's stream
async function noCreation(op: string, during: () => Promise<void>): Promise<void> {
  const stream = await openStream(url("/api/events"));
  await stream.next("space:snapshot");
  await during();
  await new Promise((r) => setTimeout(r, 300));
  expect(stream.events.some((e) => e.event === "paper:created" && e.data.op === op)).toBe(false);
  stream.close();
}

describe("what may enter the space", () => {
  it("lets ordinary grief, anger, profanity and first-person disclosure in", async () => {
    const who = await visitor();
    for (const text of [
      "I miss her every single day and I don't know what to do with it.",
      "I am so fucking angry at myself for how I treated him.",
      "When I was twelve someone hurt me. I never told anyone until now.",
    ]) {
      expect((await save(who, text)).status).toBe(201);
    }
  });

  it("does not block a paper only because broad distress or violence flags are raised", async () => {
    const res = await save(await visitor(), `I keep thinking about hurting myself. ${FIXTURE.broadFlag}`);
    expect(res.status).toBe(201);
  });

  it("rejects a hard-gate category outright, with no paper and no event", async () => {
    const who = await visitor();
    const key = randomUUID();
    await noCreation(key, async () => {
      const res = await save(who, `${FIXTURE.hardGate} some threat`, key);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        code: "moderation_rejected",
        error: "This paper cannot enter the space as written. Please revise it.",
        reason: "targeted_threat",
      });
    });
  });

  it("rejects clear private information, threats and spam from the contextual check", async () => {
    const who = await visitor();
    for (const [marker, reason] of [
      [FIXTURE.rejectPrivate, "private_information"],
      [FIXTURE.rejectThreat, "targeted_threat"],
      [FIXTURE.rejectSpam, "spam"],
    ]) {
      const res = await save(who, `text ${marker}`);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "moderation_rejected", reason });
    }
  });

  it("keeps an unclear paper out of the pool and lets the writer revise it under the same key", async () => {
    const who = await visitor();
    const key = randomUUID();
    await noCreation(key, async () => {
      const res = await save(who, `maybe about someone ${FIXTURE.review}`, key);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        code: "moderation_review_required",
        error: "This paper needs clarification before it can enter the space. Please revise it.",
        reason: "uncertain",
      });
    });
    // nothing was saved under that key, so the revised draft can use it
    expect((await save(who, "revised, about me only", key)).status).toBe(201);
  });

  it("fails closed when the check is unavailable, refused, malformed or the wrong policy", async () => {
    const who = await visitor();
    for (const marker of [FIXTURE.unavailable, FIXTURE.refusal, FIXTURE.malformed, FIXTURE.wrongVersion]) {
      const key = randomUUID();
      await noCreation(key, async () => {
        const res = await save(who, `text ${marker}`, key);
        expect(res.status, marker).toBe(503);
        expect(await res.json()).toEqual({ code: "moderation_unavailable", error: "This paper could not be checked. Please try again." });
      });
    }
  });
});

describe("retries and repeats", () => {
  it("answers a retry of a saved paper without checking it again, even after it is gone", async () => {
    const who = await visitor();
    const key = randomUUID();
    const content = `kept once ${randomUUID()} ${FIXTURE.onceThenDown}`;
    const first = await save(who, content, key, "KEEP");
    expect(first.status).toBe(201);
    const { paper } = (await first.json()) as { paper: { id: string } };

    // the provider is now "down" for this text, yet the retry still answers
    const retry = await save(who, content, key, "KEEP");
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as { paper: { id: string } }).paper.id).toBe(paper.id);

    const receipt = (await open(who, paper.id)).read_receipt;
    expect((await post(who, `/api/papers/${paper.id}/burn`, { read_receipt: receipt, op_key: randomUUID(), confirmed: true })).status).toBe(200);
    const afterBurn = await save(who, content, key, "KEEP");
    expect(afterBurn.status).toBe(201);
    expect(((await afterBurn.json()) as { paper: { id: string; status: string } }).paper).toMatchObject({ id: paper.id, status: "destroyed" });
  });

  it("checks a double-sent submission once and saves it once", async () => {
    const who = await visitor();
    const key = randomUUID();
    const content = `slow to check ${randomUUID()} ${FIXTURE.slow}`;
    const stream = await openStream(url("/api/events"));
    await stream.next("space:snapshot");
    const [a, b] = await Promise.all([save(who, content, key), save(who, content, key)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const ids = await Promise.all([a, b].map(async (r) => ((await r.json()) as { paper: { id: string } }).paper.id));
    expect(ids[0]).toBe(ids[1]);
    await new Promise((r) => setTimeout(r, 300));
    expect(stream.events.filter((e) => e.event === "paper:created" && e.data.op === key)).toHaveLength(1);
    stream.close();
  });

  it("refuses different words under a key whose check is still running", async () => {
    const who = await visitor();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      save(who, `first ${FIXTURE.slow}`, key),
      new Promise<Response>((r) => setTimeout(() => r(save(who, "something else", key)), 200)),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
  });
});

describe("what never leaves the server", () => {
  it("keeps paper text out of lists and events", async () => {
    const who = await visitor();
    const marker = `private-words-${randomUUID()}`;
    const stream = await openStream(url("/api/events"));
    await stream.next("space:snapshot");
    const id = await leave(who, "RELEASE", marker);
    await stream.next("paper:created", (d) => d.id === id);
    const list = await (await fetch(url("/api/papers"))).text();
    expect(list).not.toContain(marker);
    expect(JSON.stringify(stream.events)).not.toContain(marker);
    stream.close();
  });
});
