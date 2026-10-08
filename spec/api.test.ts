import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createPaper } from "../server/papers.ts";

// The paper contract, checked over HTTP against the running app. These create
// papers, so run them against a throwaway database, never the live app.
const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

async function newSession(): Promise<string> {
  const res = await fetch(url("/api/session"), { method: "POST" });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie");
  expect(cookie, "POST /api/session sets a session cookie").toBeTruthy();
  return cookie!.split(";")[0];
}

const key = (): string => randomUUID();

// Every save names its mode and carries the author's confirmation, unless a
// test is checking what happens without them.
async function throwPaper(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url("/api/papers"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mode: "KEEP", confirmed: true, ...body }),
  });
}

async function total(): Promise<number> {
  const res = await fetch(url("/api/papers"));
  return ((await res.json()) as { total: number }).total;
}

describe("a stranger leaves a paper and someone else reads it", () => {
  it("returns exactly what was written, to a different session", async () => {
    const content = "我一直带着这个念头。\n\nI kept this — for years… «really».\n  indented line\t";
    const a = await newSession();
    const res = await throwPaper(a, { content, submission_key: key() });
    expect(res.status).toBe(201);
    const { paper } = (await res.json()) as { paper: { id: string } };

    const b = await newSession();
    expect(b).not.toBe(a);
    const read = await fetch(url(`/api/papers/${paper.id}`), { headers: { cookie: b } });
    expect(read.status).toBe(200);
    const opened = (await read.json()) as Record<string, unknown>;
    expect(opened.id).toBe(paper.id);
    expect(opened.content).toBe(content);
    expect(JSON.stringify(opened)).not.toMatch(/owner/);

    const anonymous = await fetch(url(`/api/papers/${paper.id}`));
    expect(anonymous.status).toBe(200);
  });

  it("answers 404 for a paper that is not there", async () => {
    const res = await fetch(url(`/api/papers/${randomUUID()}`));
    expect(res.status).toBe(404);
  });
});

describe("what gets written", () => {
  it("rejects blank and over-long papers without changing the count", async () => {
    const cookie = await newSession();
    const before = await total();
    for (const content of ["", "   \n\t  ", "a".repeat(2001), "念".repeat(2001)]) {
      const res = await throwPaper(cookie, { content, submission_key: key() });
      expect(res.status, JSON.stringify(content.slice(0, 10))).toBe(400);
    }
    expect(await total()).toBe(before);
  });

  it("counts characters as code points, so 2,000 emoji or CJK fit", async () => {
    const cookie = await newSession();
    for (const content of ["念".repeat(2000), "🙂".repeat(2000)]) {
      const res = await throwPaper(cookie, { content, submission_key: key() });
      expect(res.status).toBe(201);
    }
  });

  it("needs a session, and ignores an owner the client claims", async () => {
    const noSession = await throwPaper("", { content: "hello", submission_key: key() });
    expect(noSession.status).toBe(401);

    const cookie = await newSession();
    const res = await throwPaper(cookie, {
      content: "mine",
      submission_key: key(),
      owner_identity_id: "someone-else",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("someone-else");
  });
});

describe("how it is left", () => {
  it("needs an intentional mode and the author's confirmation", async () => {
    const cookie = await newSession();
    const before = await total();
    for (const body of [
      { content: "no mode", submission_key: key(), mode: undefined },
      { content: "made-up mode", submission_key: key(), mode: "BURN" },
      { content: "unconfirmed", submission_key: key(), confirmed: false },
      { content: "unconfirmed", submission_key: key(), confirmed: undefined },
    ]) {
      const res = await throwPaper(cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("invalid_input");
    }
    expect(await total()).toBe(before);
  });

  it("can't be edited or have its mode changed once saved", async () => {
    const cookie = await newSession();
    const submission_key = key();
    const res = await throwPaper(cookie, { content: "as it was", submission_key, mode: "KEEP" });
    const { paper } = (await res.json()) as { paper: { id: string } };
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const attempt = await fetch(url(`/api/papers/${paper.id}`), {
        method,
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ content: "rewritten", mode: "RELEASE" }),
      });
      expect(attempt.status, method).toBeGreaterThanOrEqual(400);
    }
    const sameKeyOtherMode = await throwPaper(cookie, { content: "as it was", submission_key, mode: "RELEASE" });
    expect(sameKeyOtherMode.status).toBe(409);
    const read = (await (await fetch(url(`/api/papers/${paper.id}`))).json()) as { content: string; mode: string };
    expect(read).toMatchObject({ content: "as it was", mode: "keep" });
  });
});

describe("sessions", () => {
  it("keeps the same anonymous session when the cookie comes back", async () => {
    const cookie = await newSession();
    const again = await fetch(url("/api/session"), { method: "POST", headers: { cookie } });
    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie"), "a valid session is reused, not replaced").toBeNull();
  });

  it("sets an HttpOnly, SameSite cookie", async () => {
    const res = await fetch(url("/api/session"), { method: "POST" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe("the space", () => {
  it("shows a bounded random window with no words or authors in it", async () => {
    const cookie = await newSession();
    const before = await total();
    const created = await throwPaper(cookie, { content: "counted", submission_key: key() });
    const { total: after } = (await created.json()) as { total: number };
    expect(after).toBe(before + 1);

    const res = await fetch(url("/api/papers"));
    const body = (await res.json()) as { papers: Record<string, unknown>[]; total: number };
    expect(body.total).toBe(after);
    expect(body.papers.length).toBeLessThanOrEqual(12);
    expect(body.papers.length).toBe(Math.min(12, body.total));
    for (const paper of body.papers) expect(Object.keys(paper)).toEqual(["id"]);
  });

  it("samples elsewhere in the space when told what is already on screen", async () => {
    const cookie = await newSession();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await throwPaper(cookie, { content: `explore ${i}`, submission_key: key() });
      ids.push(((await res.json()) as { paper: { id: string } }).paper.id);
    }
    const res = await fetch(url(`/api/papers?limit=24&exclude=${ids.join(",")}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: { id: string }[] };
    expect(body.papers.length).toBeLessThanOrEqual(24);
    for (const paper of body.papers) {
      expect(ids).not.toContain(paper.id);
      expect(Object.keys(paper)).toEqual(["id"]);
    }
  });

  it("refuses an unbounded or malformed sample request", async () => {
    const many = Array.from({ length: 33 }, () => randomUUID()).join(",");
    for (const query of [`exclude=${many}`, "exclude=not-an-id", "limit=0", "limit=25", "limit=abc", "exclude=a&exclude=b"]) {
      expect((await fetch(url(`/api/papers?${query}`))).status, query).toBe(400);
    }
    expect((await fetch(url(`/api/papers?exclude=${Array.from({ length: 32 }, () => randomUUID()).join(",")}`))).status).toBe(200);
  });

  it("treats a retried submission as the same paper", async () => {
    const cookie = await newSession();
    const submission_key = key();
    const first = (await (await throwPaper(cookie, { content: "once", submission_key })).json()) as {
      paper: { id: string };
      total: number;
    };
    const retry = await throwPaper(cookie, { content: "once", submission_key });
    expect(retry.status).toBe(201);
    const second = (await retry.json()) as { paper: { id: string }; total: number };
    expect(second.paper.id).toBe(first.paper.id);
    expect(second.total).toBe(first.total);

    const changed = await throwPaper(cookie, { content: "different words", submission_key });
    expect(changed.status).toBe(409);
  });
});

describe("persistence", () => {
  it("keeps a paper when the database is closed and opened again", () => {
    const path = join(mkdtempSync(join(tmpdir(), "throwaway-")), "papers.sqlite");
    const first = openDb(path);
    first.prepare("INSERT INTO identities (id, created_at) VALUES (?, ?)").run("owner", "now");
    const result = createPaper(first, "owner", "still here\n还在", "persist-key-1", "RELEASE");
    expect(result.ok).toBe(true);
    first.close();

    const second = openDb(path);
    const id = result.ok ? result.value.id : "";
    expect(second.prepare("SELECT content FROM papers WHERE id = ?").get(id)).toEqual({
      content: "still here\n还在",
    });
    second.close();
  });
});
