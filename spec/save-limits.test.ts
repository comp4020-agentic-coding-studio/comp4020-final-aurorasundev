import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import type { Payload, Verdict } from "../server/moderation.ts";
import { papersRouter, SAVE_LIMITS, saveLimitsFromEnv, type SaveLimits } from "../server/papers.ts";
import { ensureSession } from "../server/session.ts";
import { post, visitor } from "./client.ts";

// Saving a paper costs a moderation request, so saves are limited per
// identity and per address. Only papers actually saved count, and an
// over-limit request is refused before the check is asked.
//
// Most checks run on an in-process server (the real papers router over a
// fresh in-memory database) so each starts with its own limits and can count
// the checks it is asked for; every spec shares one address on the app under
// test. The last block checks the running app end to end.

const quiet = async <T>(run: () => Promise<T> | T): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
  }
};

async function world(limits: SaveLimits) {
  const db = await quiet(() => openDb(":memory:"));
  const checked: string[] = [];
  const check = async (payload: Payload): Promise<Verdict> => {
    checked.push(payload.paper_text ?? "");
    return payload.paper_text?.includes("refuse me")
      ? { kind: "reject", reason: "spam", stage: "policy" }
      : { kind: "allow" };
  };
  const server = express()
    .use(express.json({ limit: "512kb" }))
    .post("/api/session", (req, res) => {
      ensureSession(db, req, res);
      res.json({ ok: true });
    })
    .use("/api", papersRouter(db, check, null, limits))
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = async () => {
    const cookie = (await fetch(`${base}/api/session`, { method: "POST" })).headers.get("set-cookie")!.split(";")[0];
    return (content = `paper ${randomUUID()}`, submission_key = randomUUID()) =>
      quiet(() =>
        fetch(`${base}/api/papers`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ content, mode: "KEEP", confirmed: true, submission_key }),
        }),
      );
  };
  return { browser, checked, close: () => new Promise((r) => server.close(r)) };
}

describe("saving papers is limited", () => {
  it("defaults to 10 an hour per identity and 30 per address, overridable by env", () => {
    expect(SAVE_LIMITS).toEqual({ perIdentityHour: 10, perAddressHour: 30 });
    expect(saveLimitsFromEnv({})).toEqual(SAVE_LIMITS);
    expect(saveLimitsFromEnv({ SAVES_PER_IDENTITY_HOUR: "3", SAVES_PER_ADDRESS_HOUR: "7" })).toEqual({ perIdentityHour: 3, perAddressHour: 7 });
    expect(saveLimitsFromEnv({ SAVES_PER_IDENTITY_HOUR: "nope" }).perIdentityHour).toBe(10);
  });

  it("refuses an identity's next new paper once it has saved its share, without asking the check", async () => {
    const w = await world({ perIdentityHour: 2, perAddressHour: 100 });
    try {
      const save = await w.browser();
      const key = randomUUID();
      expect((await save("first", key)).status).toBe(201);
      expect((await save()).status).toBe(201);
      const before = w.checked.length;
      const refused = await save();
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ code: "rate_limited", error: "Too many papers for now. Try again later." });
      expect(w.checked.length).toBe(before);
      // a retry of a paper already saved is not a new paper: it still answers
      expect((await save("first", key)).status).toBe(201);
      // another identity has its own share
      expect((await (await w.browser())()).status).toBe(201);
    } finally {
      await w.close();
    }
  });

  it("counts only papers saved: a refusal and a retry are free", async () => {
    const w = await world({ perIdentityHour: 2, perAddressHour: 100 });
    try {
      const save = await w.browser();
      for (let i = 0; i < 3; i++) expect((await save("please refuse me")).status).toBe(422);
      const key = randomUUID();
      expect((await save("kept", key)).status).toBe(201);
      for (let i = 0; i < 3; i++) expect((await save("kept", key)).status).toBe(201);
      expect((await save()).status).toBe(201);
      expect((await save()).status).toBe(429);
    } finally {
      await w.close();
    }
  });

  it("caps one address across fresh identities, and parallel saves can't slip past", async () => {
    const w = await world({ perIdentityHour: 100, perAddressHour: 3 });
    try {
      const browsers = await Promise.all(Array.from({ length: 6 }, () => w.browser()));
      const statuses = (await Promise.all(browsers.map((save) => save()))).map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 429, 429, 429]);
      expect(w.checked.length).toBe(3);
    } finally {
      await w.close();
    }
  });
});

describe("the running app", () => {
  it("refuses an identity's eleventh new paper in an hour with 429, and still answers a retry", async () => {
    const who = await visitor();
    const body = (submission_key = randomUUID()) => ({ content: `paper ${randomUUID()}`, mode: "KEEP", confirmed: true, submission_key });
    const first = body();
    expect((await post(who, "/api/papers", first)).status).toBe(201);
    for (let i = 1; i < 10; i++) expect((await post(who, "/api/papers", body())).status).toBe(201);
    const refused = await post(who, "/api/papers", body());
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { code: string }).code).toBe("rate_limited");
    expect((await post(who, "/api/papers", first)).status).toBe(201);
    // someone else at the same address carries on
    expect((await post(await visitor(), "/api/papers", body())).status).toBe(201);
  });
});
