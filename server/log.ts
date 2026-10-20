import { createHmac } from "node:crypto";

// One line per action: time, action, then ids and outcomes. Callers pass ids,
// revisions and outcomes only — never paper text, drafts, cookies, return
// keys or credentials.
export function log(action: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  const parts = [new Date().toISOString(), action];
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) parts.push(`${key}=${value}`);
  console.log(parts.join(" "));
}

// A person in the logs. `who` is a short stable alias for an identity
// ("visitor-3f9a2c"), keyed by a server secret so an alias read off a log
// can't be turned back into the identity or a cookie; the full identity id
// stays beside it for joining with the database. Set once at startup.
let aliasKey: Buffer | null = null;
export function setAliasKey(secret: Buffer): void {
  aliasKey = createHmac("sha256", secret).update("log-alias-v1").digest();
}
export function who(identityId: string | undefined): string | undefined {
  if (!identityId || !aliasKey) return undefined;
  return `visitor-${createHmac("sha256", aliasKey).update(identityId).digest("hex").slice(0, 6)}`;
}
// The pair every per-person line carries.
export const person = (identityId: string | undefined) => ({ who: who(identityId), identity: identityId });
