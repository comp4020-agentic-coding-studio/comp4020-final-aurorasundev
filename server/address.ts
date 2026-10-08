import type { Request } from "express";

// The client's address for anti-abuse limits only; never logged. On Fly the
// edge proxy sets Fly-Client-IP itself, replacing anything a client sent, so
// it is trusted there. Elsewhere (local, CI) the socket's peer is used: an
// X-Forwarded-For header is whatever the client chose to write, so it is not.
export function clientAddress(req: Request): string {
  if (process.env.FLY_APP_NAME) {
    const fly = req.headers["fly-client-ip"];
    if (typeof fly === "string" && fly) return fly;
  }
  return req.socket.remoteAddress ?? "unknown";
}

// A fixed-window counter per key that forgets old windows and caps how many
// keys it holds, so an address flood can't grow memory without bound.
export function windowCounter(windowMs: number, limit: number, maxKeys = 10_000) {
  const hits = new Map<string, { count: number; since: number }>();
  return {
    blocked(key: string, now = Date.now()): boolean {
      const entry = hits.get(key);
      if (entry && now - entry.since > windowMs) hits.delete(key);
      return (hits.get(key)?.count ?? 0) >= limit;
    },
    hit(key: string, now = Date.now()): void {
      const entry = hits.get(key);
      if (entry) {
        entry.count++;
        return;
      }
      if (hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.since > windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value!);
      }
      hits.set(key, { count: 1, since: now });
    },
  };
}
