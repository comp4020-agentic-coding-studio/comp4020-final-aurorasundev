import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, inject, it } from "vitest";
import { openStream, type Stream } from "./sse.ts";

// The shared space, live: what one visitor saves reaches everyone already
// connected, without a reload. Creates papers, so never run against the live app.
const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

const open: Stream[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function stream(query = ""): Promise<Stream> {
  const s = await openStream(url(`/api/events${query}`));
  open.push(s);
  return s;
}

async function newSession(): Promise<string> {
  const res = await fetch(url("/api/session"), { method: "POST" });
  return res.headers.get("set-cookie")!.split(";")[0];
}

const throwPaper = (cookie: string, body: Record<string, unknown>): Promise<Response> =>
  fetch(url("/api/papers"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

describe("live arrivals", () => {
  it("opens with a snapshot of the active pool, without words, owners or witness counts", async () => {
    const s = await stream("?limit=5");
    const { data } = await s.next("space:snapshot");
    expect(typeof data.revision).toBe("number");
    expect(typeof data.active_total).toBe("number");
    const window = data.window as Record<string, unknown>[];
    expect(window.length).toBeLessThanOrEqual(5);
    for (const item of window) expect(Object.keys(item).sort()).toEqual(["id", "version"]);
  });

  it("delivers a saved paper to three other connected visitors within a second", async () => {
    const watchers = await Promise.all([stream(), stream(), stream()]);
    const snapshots = await Promise.all(watchers.map((w) => w.next("space:snapshot")));
    const cookie = await newSession();
    const sentAt = performance.now();
    const res = await throwPaper(cookie, { content: "arriving now", submission_key: randomUUID(), mode: "RELEASE" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { paper: { id: string }; total: number; revision: number };

    for (const [i, w] of watchers.entries()) {
      const { data, at } = await w.next("paper:created", (d) => d.id === body.paper.id, 1000);
      expect(at - sentAt).toBeLessThan(1000);
      expect(data.active_total).toBe(body.total);
      expect(data.revision).toBe(body.revision);
      expect(data.revision as number).toBeGreaterThan(snapshots[i].data.revision as number);
      expect(JSON.stringify(data)).not.toContain("arriving now");
      expect(data).not.toHaveProperty("witness_count");
    }
  });

  it("broadcasts nothing for a refused save or a retried one", async () => {
    const w = await stream();
    await w.next("space:snapshot");
    const cookie = await newSession();
    expect((await throwPaper(cookie, { content: "   ", submission_key: randomUUID() })).status).toBe(400);
    expect((await throwPaper(cookie, { content: "x", submission_key: randomUUID(), mode: "BURN" })).status).toBe(400);

    const submission_key = randomUUID();
    const first = (await (await throwPaper(cookie, { content: "once only", submission_key })).json()) as {
      paper: { id: string };
    };
    await w.next("paper:created", (d) => d.id === first.paper.id);
    const retry = await throwPaper(cookie, { content: "once only", submission_key });
    expect(retry.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));
    // other spec files save papers in parallel, so only this paper's events count
    const mine = w.events.filter((e) => e.event === "paper:created" && e.data.id === first.paper.id);
    expect(mine).toHaveLength(1);
    expect(w.events.some((e) => JSON.stringify(e.data).includes("once only"))).toBe(false);
  });
});

describe("reconnecting", () => {
  it("reconciles the ids a visitor already has and refills the rest of the window", async () => {
    const cookie = await newSession();
    const res = await throwPaper(cookie, { content: "still here", submission_key: randomUUID() });
    const { paper } = (await res.json()) as { paper: { id: string } };
    const missing = randomUUID();

    const s = await stream(`?limit=4&known=${paper.id},${missing}`);
    const { data } = await s.next("space:snapshot");
    const known = data.known as { id: string; status: string }[];
    expect(known).toContainEqual({ id: paper.id, status: "active", version: 1 });
    expect(known.find((k) => k.id === missing)?.status).toBe("missing");
    const window = data.window as { id: string }[];
    expect(window.map((w) => w.id)).not.toContain(paper.id);
    expect(window.length).toBeLessThanOrEqual(4);
  });
});
