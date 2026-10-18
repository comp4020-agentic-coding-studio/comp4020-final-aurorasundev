import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { openDb, type DB } from "../server/db.ts";
import { ensureSession } from "../server/session.ts";
import { galleryRouter } from "../server/artifacts/router.ts";

// An in-process Gallery: the real router on an ephemeral port, over an
// in-memory database and a temporary artifact directory, so tests can seed
// published objects directly. It never touches the running app's data.

export const WEBP_FIXTURE = resolve(import.meta.dirname, "fixtures/artifacts/keepsake-1024.webp");
// strings that must never appear in any public reply or event
export const CANARY = { text: "CANARY-WORDS-91c2", paper: "", job: "" };

export type Harness = {
  db: DB;
  dir: string;
  base: string;
  close: () => Promise<void>;
  seed: (opts?: { status?: "PUBLISHED" | "HIDDEN"; id?: string }) => { id: string; jobId: string; paperId: string; fileKey: string };
  session: () => Promise<string>;
};

export async function gallery(options: { enabled?: boolean } = {}): Promise<Harness> {
  const log = console.log;
  console.log = () => {};
  const db = openDb(":memory:");
  console.log = log;
  const dir = mkdtempSync(join(tmpdir(), "throwaway-gallery-"));
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "16kb" }));
  app.post("/api/session", (req, res) => {
    ensureSession(db, req, res);
    res.json({ ok: true });
  });
  app.use("/api", galleryRouter(db, dir, () => options.enabled ?? false));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db.prepare("INSERT INTO identities (id, created_at) VALUES ('author', 'now')").run();

  const seed: Harness["seed"] = ({ status = "PUBLISHED", id = randomUUID() } = {}) => {
    const paperId = randomUUID();
    const jobId = randomUUID();
    const fileKey = `${id}.webp`;
    copyFileSync(WEBP_FIXTURE, join(dir, fileKey));
    // a burned Release paper whose words were cleared, as in production
    db.prepare(
      `INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, status, request_digest)
       VALUES (?, 'author', '', '2026-01-01T00:00:00.000Z', ?, 'RELEASE', 'DESTROYED', ?)`,
    ).run(paperId, randomUUID(), CANARY.text);
    db.prepare(
      `INSERT INTO artifact_jobs (id, paper_id, public_id, state, brief, brief_version, file_key, not_before, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'PUBLISHED', '{"schema_version":2,"metaphor":"thread"}', 2, ?, 0, 0, 1, 1)`,
    ).run(jobId, paperId, id, fileKey);
    db.prepare(
      `INSERT INTO artifacts (id, job_id, status, version, file_key, width, height, title, alt, published_at, updated_at)
       VALUES (?, ?, ?, 1, ?, 1024, 1024, 'Knot in clay', 'An abstract object: a loosely tied knot made of unglazed clay, resting as if just set down.', 1, 1)`,
    ).run(id, jobId, status, fileKey);
    return { id, jobId, paperId, fileKey };
  };

  const session = async (): Promise<string> => {
    const res = await fetch(`${base}/api/session`, { method: "POST" });
    return res.headers.get("set-cookie")!.split(";")[0];
  };

  return {
    db,
    dir,
    base,
    seed,
    session,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

// Reads SSE events from a stream until `count` arrive or the time runs out.
export async function sseEvents(url: string, count: number, timeoutMs = 3000, onOpen?: () => void | Promise<void>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: { event: string; data: Record<string, unknown> }[] = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body!.getReader();
    let buffer = "";
    let opened = false;
    while (events.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      if (!opened && events.length > 0) {
        opened = true;
        await onOpen?.();
      }
    }
  } catch {
    // timed out: return what arrived
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}
