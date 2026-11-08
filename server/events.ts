import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { clientAddress } from "./address.ts";
import { activeTotal, currentRevision, type DB } from "./db.ts";
import { log, person } from "./log.ts";
import { identityFor } from "./session.ts";

const HEARTBEAT_MS = 20_000;
// A client that stops reading gets dropped rather than buffered without bound;
// it reconnects and catches up from a fresh snapshot.
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_KNOWN_IDS = 48;
// the client window reaches 25 on a wide screen (src/lib/space-window.ts)
const MAX_WINDOW = 32;

// Each open stream holds a socket and a timer on a 256 MB machine, so they
// are capped. Over a cap the request is answered 503 with Retry-After and no
// stream opens; the client backs off and reconnects (src/lib/useLiveSpace.ts).
// - total 500: each stream costs a few tens of KB, so 500 stays well inside
//   the machine's memory while being many times the class's real audience.
// - per address 60: generous, because a whole class may share one campus NAT
//   address and a person may have a few tabs open; it stops one machine from
//   taking every slot.
export const STREAM_LIMITS = { total: 500, perAddress: 60 };
export type StreamLimits = typeof STREAM_LIMITS;
const RETRY_AFTER_S = 15;

type Subscriber = { id: string; res: Response; address: string };
const subscribers = new Set<Subscriber>();
const perAddress = new Map<string, number>();

// Frees a stream's slot; safe to call more than once.
function leave(sub: Subscriber): boolean {
  if (!subscribers.delete(sub)) return false;
  const left = (perAddress.get(sub.address) ?? 1) - 1;
  if (left > 0) perAddress.set(sub.address, left);
  else perAddress.delete(sub.address);
  return true;
}

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

export function eventsRouter(db: DB, limits: StreamLimits = STREAM_LIMITS): Router {
  const router = Router();

  router.get("/events", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), MAX_WINDOW);
    const knownIds = parseIds(req.query.known);
    // who is watching, for the logs only: the stream itself is the same for
    // everyone and carries no one's identity
    const viewer = person(identityFor(db, req));
    const address = clientAddress(req);

    const full = subscribers.size >= limits.total ? "total" : (perAddress.get(address) ?? 0) >= limits.perAddress ? "address" : null;
    if (full) {
      log("connect", { ...viewer, outcome: "too_many_streams", limit: full, subscribers: subscribers.size });
      res
        .status(503)
        .set({ "Retry-After": String(RETRY_AFTER_S), "Cache-Control": "no-store" })
        .json({ code: "too_many_streams", error: "The space is busy right now. Try again in a moment." });
      return;
    }

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const sub: Subscriber = { id: randomUUID(), res, address };
    subscribers.add(sub);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    write(sub, "space:snapshot", snapshot(db, knownIds, limit));
    log("connect", { ...viewer, conn: sub.id, outcome: "ok", subscribers: subscribers.size });

    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    // the client going away, a dropped slow reader (res.end) or a socket
    // error: whichever comes first frees the slot, once
    const done = (): void => {
      clearInterval(heartbeat);
      if (leave(sub)) log("disconnect", { ...viewer, conn: sub.id, subscribers: subscribers.size });
    };
    req.on("close", done);
    res.on("close", done);
    res.on("error", done);
  });

  return router;
}

export function closeAllStreams(): void {
  for (const sub of subscribers) sub.res.end();
  subscribers.clear();
  perAddress.clear();
}
