import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leave, open, post, url, visitor, witness, type Visitor } from "./client.ts";

// Return keys restore rights, not history. Creates identities and papers, so
// never run against the live app.

const issue = (who: Visitor): Promise<Response> => post(who, "/api/identity/return-key", {});

async function restore(key: string): Promise<{ res: Response; who: Visitor | null }> {
  const res = await post(null, "/api/identity/restore", { return_key: key });
  const cookie = res.headers.get("set-cookie");
  return { res, who: cookie ? { cookie: cookie.split(";")[0] } : null };
}

describe("issuing a return key", () => {
  it("is offered after a Keep, not before, and never for a Release alone", async () => {
    const who = await visitor();
    expect((await issue(who)).status).toBe(409);

    const released = await post(who, "/api/papers", { content: "released", mode: "RELEASE", confirmed: true, submission_key: randomUUID() });
    expect(((await released.json()) as { offer_return_key: boolean }).offer_return_key).toBe(false);
    expect((await issue(who)).status).toBe(409);

    const kept = await post(who, "/api/papers", { content: "kept", mode: "KEEP", confirmed: true, submission_key: randomUUID() });
    expect(((await kept.json()) as { offer_return_key: boolean }).offer_return_key).toBe(true);
    const res = await issue(who);
    expect(res.status).toBe(200);
    const { return_key } = (await res.json()) as { return_key: string };
    // 32 base32 characters: 160 bits of randomness, shown in groups of four
    expect(return_key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("replaces an unconfirmed key, and never shows a saved one again", async () => {
    const who = await visitor();
    await leave(who, "KEEP");
    const first = ((await (await issue(who)).json()) as { return_key: string }).return_key;
    const second = ((await (await issue(who)).json()) as { return_key: string }).return_key;
    expect(second).not.toBe(first);
    expect((await restore(first)).res.status).toBe(400);

    expect((await post(who, "/api/identity/return-key/saved", {})).status).toBe(200);
    const again = await issue(who);
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).not.toContain(second);
    const next = await post(who, "/api/papers", { content: "another", mode: "KEEP", confirmed: true, submission_key: randomUUID() });
    expect(((await next.json()) as { offer_return_key: boolean }).offer_return_key).toBe(false);
  });
});

describe("returning with a key", () => {
  it("gives another browser the same rights and witness identity, and no history", async () => {
    const original = await visitor();
    const kept = await leave(original, "KEEP");
    const someoneElses = await leave(await visitor(), "RELEASE");
    const r = await open(original, someoneElses);
    await witness(original, someoneElses, r.read_receipt);
    const key = ((await (await issue(original)).json()) as { return_key: string }).return_key;

    // typed differently: lower case, spaces instead of dashes
    const { res, who } = await restore(key.toLowerCase().replaceAll("-", " "));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(who).not.toBeNull();

    const mine = await open(who!, kept);
    expect(mine.viewer).toMatchObject({ is_author: true, can_burn: true });
    const theirs = await open(who!, someoneElses);
    expect(theirs.viewer).toMatchObject({ is_author: false, has_witnessed: true, can_burn: true });
    expect((await witness(who!, someoneElses, theirs.read_receipt)).status).toBe(200);
    expect((await open(await visitor(), someoneElses)).witness_count).toBe(1);
  });

  it("refuses a wrong key without saying anything about anyone", async () => {
    const { res, who } = await restore("0000-0000-0000-0000-0000-0000-0000-0000");
    expect([400, 429]).toContain(res.status);
    expect(who).toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "error"]);
  });

  it("slows down repeated wrong guesses", async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await post(null, "/api/identity/restore", { return_key: `guess-${randomUUID()}` });
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
  });
});

describe("what never comes back", () => {
  it("has no endpoint that lists an identity's papers", async () => {
    const who = await visitor();
    for (const path of ["/api/identity", "/api/identity/papers", "/api/me", "/api/papers/mine"]) {
      const res = await fetch(url(path), { headers: { cookie: who.cookie } });
      expect(res.status, path).toBe(404);
    }
  });
});
