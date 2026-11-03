import { describe, expect, it } from "vitest";
import { accountsConfigured, hashesRunning, hashPassword, PARAMS, pepperFrom, verifyPassword } from "../server/password.ts";

// Password storage (ADR 009): scrypt with a per-account salt, sealed with a
// pepper held outside the database, sized for a 256 MB machine.

const pepper = Buffer.from("a pepper of at least sixteen chars");

describe("password storage", () => {
  it("stores its parameters, a salt and a sealed key, never the password", async () => {
    const stored = await hashPassword("correct horse battery", pepper);
    expect(stored).toMatch(/^scrypt1\$16384\$8\$5\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain("correct horse battery");
    expect(PARAMS).toEqual({ N: 16384, r: 8, p: 5 });
    expect(await hashPassword("correct horse battery", pepper)).not.toBe(stored);
  });

  it("accepts the right password and refuses a wrong one or another pepper", async () => {
    const stored = await hashPassword("correct horse battery", pepper);
    expect(await verifyPassword("correct horse battery", stored, pepper)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored, pepper)).toBe(false);
    expect(await verifyPassword("correct horse battery", stored, Buffer.from("another pepper, also sixteen+"))).toBe(false);
    expect(await verifyPassword("correct horse battery", "not-a-stored-value", pepper)).toBe(false);
  });

  it("runs at most two hashes at once, so a burst of sign-ins can't exhaust memory", async () => {
    let peak = 0;
    const watch = setInterval(() => (peak = Math.max(peak, hashesRunning())), 1);
    await Promise.all(Array.from({ length: 6 }, (_, i) => hashPassword(`password number ${i}`, pepper)));
    clearInterval(watch);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(hashesRunning()).toBe(0);
  });

  it("uses a development pepper locally, and switches accounts off on Fly without a configured one", () => {
    expect(accountsConfigured({})).toBe(true);
    expect(accountsConfigured({ FLY_APP_NAME: "app" })).toBe(false);
    expect(accountsConfigured({ FLY_APP_NAME: "app", ACCOUNT_PEPPER: "short" })).toBe(false);
    expect(accountsConfigured({ FLY_APP_NAME: "app", ACCOUNT_PEPPER: "x".repeat(32) })).toBe(true);
    expect(pepperFrom({ FLY_APP_NAME: "app", ACCOUNT_PEPPER: "y".repeat(32) })?.toString()).toBe("y".repeat(32));
  });
});
