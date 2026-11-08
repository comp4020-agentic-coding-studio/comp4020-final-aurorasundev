import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { eventsRouter, STREAM_LIMITS, type StreamLimits } from "../server/events.ts";
import { url } from "./client.ts";
import { openStream, type Stream } from "./sse.ts";

// Live connections are capped, in total and per address. Over a cap the
// request is answered 503 with Retry-After and no stream opens; a closed
// stream frees its slot. The caps run on an in-process server (the real
// events router over an in-memory database) so they can be small; the last
// block checks the running app still opens and frees streams.

const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

async function world(limits: StreamLimits) {
  const db = quiet(() => openDb(":memory:"));
  const server = express().use("/api", eventsRouter(db, limits)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const streams: Stream[] = [];
  const open = async (): Promise<Stream> => {
    const stream = await quiet(() => openStream(new URL("/api/events", base)));
    await stream.next("space:snapshot");
    streams.push(stream);
    return stream;
  };
  const refused = () => quiet(() => fetch(`${base}/api/events`, { headers: { accept: "text/event-stream" } }));
  const close = async () => {
    quiet(() => streams.forEach((s) => s.close()));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  return { open, refused, close };
}

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("live connections are capped", () => {
  it("defaults to 500 in total and 60 per address", () => {
    expect(STREAM_LIMITS).toEqual({ total: 500, perAddress: 60 });
  });

  it("answers 503 with Retry-After over the per-address cap, and opens no stream", async () => {
    const w = await world({ total: 100, perAddress: 2 });
    try {
      await w.open();
      await w.open();
      const res = await w.refused();
      expect(res.status).toBe(503);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await res.json()).toEqual({ code: "too_many_streams", error: "The space is busy right now. Try again in a moment." });
    } finally {
      await w.close();
    }
  });

  it("answers 503 over the total cap", async () => {
    const w = await world({ total: 1, perAddress: 100 });
    try {
      await w.open();
      expect((await w.refused()).status).toBe(503);
    } finally {
      await w.close();
    }
  });

  it("frees a slot when a stream closes, so the next one opens", async () => {
    const w = await world({ total: 100, perAddress: 1 });
    try {
      const first = await w.open();
      expect((await w.refused()).status).toBe(503);
      quiet(() => first.close());
      await settle();
      await w.open();
    } finally {
      await w.close();
    }
  });
});

describe("the running app", () => {
  // 80 streams in all from one address: more than its cap of 60 unless each
  // closed one gives its slot back
  it("opens and frees many streams from one address in turn", async () => {
    for (let i = 0; i < 4; i++) {
      const opened = await Promise.all(Array.from({ length: 20 }, () => openStream(url("/api/events"))));
      await Promise.all(opened.map((s) => s.next("space:snapshot")));
      opened.forEach((s) => s.close());
      await settle(300);
    }
  });
});
