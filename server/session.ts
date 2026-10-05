import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { DB } from "./db.ts";

export const COOKIE = "tw_session";
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

function readCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function identityFor(db: DB, req: Request): string | undefined {
  const token = readCookie(req);
  if (!token) return undefined;
  const row = db
    .prepare("SELECT identity_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(hash(token), new Date().toISOString()) as { identity_id: string } | undefined;
  return row?.identity_id;
}

export function ensureSession(db: DB, req: Request, res: Response): string {
  const existing = identityFor(db, req);
  if (existing) return existing;

  const token = randomBytes(32).toString("base64url");
  const identityId = randomUUID();
  const now = new Date();
  db.transaction(() => {
    db.prepare("INSERT INTO identities (id, created_at) VALUES (?, ?)").run(identityId, now.toISOString());
    db.prepare("INSERT INTO sessions (token_hash, identity_id, expires_at) VALUES (?, ?, ?)").run(
      hash(token),
      identityId,
      new Date(now.getTime() + MAX_AGE_MS).toISOString(),
    );
  })();

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
  return identityId;
}
