import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { activeTotal, currentRevision, type DB } from "./db.ts";
import { log } from "./log.ts";

const HEARTBEAT_MS = 20_000;
// A client that stops reading gets dropped rather than buffered without bound;
// it reconnects and catches up from a fresh snapshot.
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_KNOWN_IDS = 32;
const MAX_WINDOW = 24;

type Subscriber = { id: string; res: Response };
const subscribers = new Set<Subscriber>();

function write(sub: Subscriber, event: string, data: unknown): void {
  if (sub.res.writableLength > MAX_BUFFERED_BYTES) {
    sub.res.end();
    return;
  }
  sub.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Called only after the transaction that made the change has committed.
// Payloads never carry paper text, owners or witness counts.
export function broadcast(event: string, data: Record<string, unknown>): void {
  for (const sub of subscribers) write(sub, event, data);
}

export const subscriberCount = (): number => subscribers.size;

type Known = { id: string; status: "active" | "destroyed" | "quarantined" | "missing"; version: number };

// The snapshot is read synchronously, in the same tick the subscriber joins,
// so no committed change can fall between it and the first live event.
export function snapshot(db: DB, knownIds: string[], limit: number) {
  const known: Known[] = knownIds.map((id) => {
    const row = db.prepare("SELECT status, version FROM papers WHERE id = ?").get(id) as
      | { status: string; version: number }
      | undefined;
    if (!row) return { id, status: "missing", version: 0 };
    return { id, status: row.status.toLowerCase() as Known["status"], version: row.version };
  });
  const window = db
    .prepare(
      `SELECT id, version FROM papers
       WHERE status = 'ACTIVE' AND id NOT IN (SELECT value FROM json_each(?))
       ORDER BY random() LIMIT ?`,
    )
    .all(JSON.stringify(knownIds), limit) as { id: string; version: number }[];
  return { revision: currentRevision(db), active_total: activeTotal(db), window, known };
}

const parseIds = (raw: unknown): string[] =>
  typeof raw === "string" && raw
    ? [...new Set(raw.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)))].slice(0, MAX_KNOWN_IDS)
    : [];

export function eventsRouter(db: DB): Router {
  const router = Router();

  router.get("/events", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), MAX_WINDOW);
    const knownIds = parseIds(req.query.known);

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const sub: Subscriber = { id: randomUUID(), res };
    subscribers.add(sub);
    write(sub, "space:snapshot", snapshot(db, knownIds, limit));
    log("connect", { conn: sub.id, outcome: "ok", subscribers: subscribers.size });

    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(sub);
      log("disconnect", { conn: sub.id, subscribers: subscribers.size });
    });
  });

  return router;
}

export function closeAllStreams(): void {
  for (const sub of subscribers) sub.res.end();
  subscribers.clear();
}
