import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Account passwords (ADR 009). Stored as scrypt(password, per-account salt),
// then HMAC-SHA256 with a pepper that lives in a Fly secret, never in the
// database: a copied database file alone gives nothing to guess against.
//
// OWASP's scrypt baseline is N=2^17 (128 MiB a hash); this machine has
// 256 MB in total, so it uses OWASP's listed equivalent N=2^14, r=8, p=5
// (16 MiB), and at most two hashes run at once. The parameters are written
// into each stored value, so they can be raised later without a migration.

export const PARAMS = { N: 2 ** 14, r: 8, p: 5 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAXMEM = 32 * 1024 * 1024;
const FORMAT = "scrypt1";
const MAX_CONCURRENT = 2;

// Local runs and CI have no Fly secret: a fixed development pepper keeps
// accounts testable there. On Fly a missing pepper switches accounts off
// rather than falling back to something an attacker could read in this repo.
const DEV_PEPPER = "throwaway-development-pepper-not-for-production";

export function pepperFrom(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = env.ACCOUNT_PEPPER;
  if (secret && secret.length >= 16) return Buffer.from(secret, "utf8");
  return env.FLY_APP_NAME ? null : Buffer.from(DEV_PEPPER, "utf8");
}

// What the database keeps to notice a changed pepper: an HMAC of a fixed
// label under it. Not the pepper, and nothing it can be read back from.
export const pepperFingerprint = (pepper: Buffer): string =>
  createHmac("sha256", pepper).update("throwaway-account-pepper-fingerprint-v1").digest("base64url");

export const accountsConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => pepperFrom(env) !== null;

let running = 0;
const waiting: (() => void)[] = [];
export const hashesRunning = (): number => running;

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const derive = (password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> =>
  limited(
    () =>
      new Promise((ok, fail) =>
        scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { ...params, maxmem: MAXMEM }, (err, key) => (err ? fail(err) : ok(key))),
      ),
  );

const seal = (pepper: Buffer, key: Buffer): Buffer => createHmac("sha256", pepper).update(key).digest();

export async function hashPassword(password: string, pepper: Buffer): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const mac = seal(pepper, await derive(password, salt, PARAMS));
  return [FORMAT, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), mac.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string, pepper: Buffer): Promise<boolean> {
  const [format, n, r, p, salt, mac] = stored.split("$");
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (format !== FORMAT || !salt || !mac || !Object.values(params).every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(mac, "base64url");
  const given = seal(pepper, await derive(password, Buffer.from(salt, "base64url"), params));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Recovery codes (ADR 009 revision): 20 random characters from an alphabet
// without look-alikes (no 0/O, 1/I/L), shown as five groups of four. 100
// bits of randomness, so unlike a password it needs no slow hash: an HMAC
// under the pepper is enough, and a copied database alone gives nothing to
// test guesses against. Typed codes are read loosely: case, spaces and
// dashes don't matter.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_LENGTH = 20;

export function newRecoveryCode(): string {
  const chars: string[] = [];
  while (chars.length < RECOVERY_LENGTH) {
    for (const byte of randomBytes(32)) {
      // 31 symbols: reject the bytes that would bias the draw
      if (byte < 248 && chars.length < RECOVERY_LENGTH) chars.push(RECOVERY_ALPHABET[byte % 31]);
    }
  }
  return chars.join("").match(/.{4}/g)!.join("-");
}

export const normalRecoveryCode = (typed: unknown): string | null => {
  if (typeof typed !== "string") return null;
  const code = typed.toUpperCase().replace(/[\s-]/g, "");
  return code.length === RECOVERY_LENGTH && [...code].every((c) => RECOVERY_ALPHABET.includes(c)) ? code : null;
};

export const hashRecoveryCode = (code: string, pepper: Buffer): string =>
  createHmac("sha256", pepper).update("throwaway-recovery-v1:" + code.replace(/-/g, "")).digest("base64url");

export function recoveryMatches(typed: unknown, stored: string | null, pepper: Buffer): boolean {
  const code = normalRecoveryCode(typed);
  if (!code || !stored) return false;
  const given = Buffer.from(hashRecoveryCode(code, pepper));
  const expected = Buffer.from(stored);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Spent on a login for a name that has no account, so a wrong name takes as
// long as a wrong password and the answer can't tell them apart.
let decoy: string | null = null;
export async function burnDecoy(password: string, pepper: Buffer): Promise<void> {
  decoy ??= await hashPassword("decoy-password-for-timing", pepper);
  await verifyPassword(password, decoy, pepper);
}
