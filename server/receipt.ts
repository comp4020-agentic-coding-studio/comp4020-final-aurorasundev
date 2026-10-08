import { createHmac, timingSafeEqual } from "node:crypto";

// Proof that this identity fetched this paper's words, so witnessing,
// destroying and reporting can't be done to an unopened paper. It proves the
// text was retrieved, not that anyone finished reading it. It isn't tied to
// the paper's version: another visitor witnessing must not invalidate it.
const TTL_MS = 6 * 60 * 60 * 1000;

const sign = (secret: Buffer, payload: string): string => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueReceipt(secret: Buffer, paperId: string, identityId: string, now = Date.now()): string {
  const expires = now + TTL_MS;
  const payload = `${paperId}.${identityId}.${expires}`;
  return `${expires}.${sign(secret, payload)}`;
}

export function checkReceipt(secret: Buffer, receipt: unknown, paperId: string, identityId: string, now = Date.now()): boolean {
  if (typeof receipt !== "string") return false;
  const [expiresRaw, mac] = receipt.split(".");
  const expires = Number(expiresRaw);
  if (!mac || !Number.isFinite(expires) || expires < now) return false;
  const expected = Buffer.from(sign(secret, `${paperId}.${identityId}.${expires}`));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
