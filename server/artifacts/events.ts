import type { Response } from "express";
import type { DB } from "../db.ts";
import { galleryPage } from "./store.ts";
import type { GalleryChange } from "./types.ts";

// The Gallery's own live channel, separate from the papers': a snapshot of
// the first page and revision, then published/hidden changes. No paper
// events, no source data. Same heartbeat and backpressure as the space.

const HEARTBEAT_MS = 20_000;
const MAX_BUFFERED_BYTES = 256 * 1024;
export const SNAPSHOT_SIZE = 12;

type Subscriber = { res: Response; heartbeat: ReturnType<typeof setInterval> };
const subscribers = new Set<Subscriber>();

function write(sub: Subscriber, event: string, data: unknown): void {
  // a reader that stops reading is dropped; it reconnects to a fresh snapshot
  if (sub.res.writableLength > MAX_BUFFERED_BYTES) {
    close(sub);
    return;
  }
  sub.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function close(sub: Subscriber): void {
  clearInterval(sub.heartbeat);
  subscribers.delete(sub);
  sub.res.end();
}

// Joins and sends the snapshot in the same synchronous tick, so no committed
// change can fall between the snapshot and the first live event.
export function subscribeGallery(db: DB, res: Response, musicEnabled = false): () => void {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true);
  const sub: Subscriber = { res, heartbeat: setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS) };
  subscribers.add(sub);
  write(sub, "gallery:snapshot", galleryPage(db, SNAPSHOT_SIZE, null, musicEnabled));
  return () => {
    clearInterval(sub.heartbeat);
    subscribers.delete(sub);
  };
}

// Only after the change has committed.
export function broadcastGallery(change: GalleryChange): void {
  const { type, ...data } = change;
  for (const sub of [...subscribers]) write(sub, type, data);
}

export const gallerySubscriberCount = (): number => subscribers.size;

export function closeGalleryStreams(): void {
  for (const sub of [...subscribers]) close(sub);
}
