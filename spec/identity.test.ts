import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leave, open, post, url, visitor, witness, type Visitor } from "./client.ts";

// Return keys restore rights, not history. Creates identities and papers, so
// never run against the live app.

const issue = (who: Visitor): Promise<Response> => post(who, "/api/identity/return-key", {});
const saved = (who: Visitor, issuanceId: string): Promise<Response> =>
  post(who, "/api/identity/return-key/saved", { issuance_id: issuanceId });
type Issued = { return_key: string; issuance_id: string };

async function keyState(who: Visitor): Promise<string> {
  const res = await fetch(url("/api/identity/state"), { headers: { cookie: who.cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["return_key"]);
  return body.return_key as string;
}

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
    const first = (await (await issue(who)).json()) as Issued;
    const second = (await (await issue(who)).json()) as Issued;
    expect(second.return_key).not.toBe(first.return_key);
    expect(second.issuance_id).not.toBe(first.issuance_id);
    expect((await restore(first.return_key)).res.status).toBe(400);

    expect((await saved(who, second.issuance_id)).status).toBe(200);
    const again = await issue(who);
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).not.toContain(second.return_key);
    const next = await post(who, "/api/papers", { content: "another", mode: "KEEP", confirmed: true, submission_key: randomUUID() });
    expect(((await next.json()) as { offer_return_key: boolean }).offer_return_key).toBe(false);
  });
});

describe("confirming the key that was shown", () => {
  it("refuses a confirmation for a key another tab has since replaced", async () => {
    const who = await visitor();
    await leave(who, "KEEP");
    const k1 = (await (await issue(who)).json()) as Issued; // tab A
    const k2 = (await (await issue(who)).json()) as Issued; // tab B replaces it

    // tab A presses "I have saved it" for K1, which no longer restores anything
    const stale = await saved(who, k1.issuance_id);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("key_superseded");
    expect(await keyState(who)).toBe("available");
    expect((await restore(k1.return_key)).res.status).toBe(400);

    // tab B confirms K2, which is the one that works
    expect((await saved(who, k2.issuance_id)).status).toBe(200);
    expect(await keyState(who)).toBe("saved");
    const back = await restore(k2.return_key);
    expect(back.res.status).toBe(200);
  });

  it("answers a repeated confirmation the same, and an out-of-order one with a conflict", async () => {
    const who = await visitor();
    await leave(who, "KEEP");
    const k1 = (await (await issue(who)).json()) as Issued;
    const k2 = (await (await issue(who)).json()) as Issued;
    expect((await saved(who, k2.issuance_id)).status).toBe(200);
    // the reply was lost and the same confirmation is retried
    expect((await saved(who, k2.issuance_id)).status).toBe(200);
    // the older tab's confirmation lands afterwards
    expect((await saved(who, k1.issuance_id)).status).toBe(409);
    expect((await restore(k2.return_key)).res.status).toBe(200);
  });

  it("never lets an issuance replace a key once it has been confirmed", async () => {
    const who = await visitor();
    await leave(who, "KEEP");
    const k = (await (await issue(who)).json()) as Issued;
    // confirmation and a fresh issuance from another tab race
    const [confirm, reissue] = await Promise.all([saved(who, k.issuance_id), issue(who)]);
    if (confirm.status === 200) {
      // the confirmation won: the key it confirmed must still restore
      expect(reissue.status).toBe(409);
      expect((await restore(k.return_key)).res.status).toBe(200);
    } else {
      // the issuance won: the confirmation must not have claimed success
      expect(confirm.status).toBe(409);
      expect(reissue.status).toBe(200);
    }
  });

  it("requires the issuance id", async () => {
    const who = await visitor();
    await leave(who, "KEEP");
    await issue(who);
    expect((await post(who, "/api/identity/return-key/saved", {})).status).toBe(400);
    expect(await keyState(who)).toBe("available");
  });
});

describe("finding a missed key offer again", () => {
  it("says whether a key is available without naming any paper", async () => {
    const who = await visitor();
    expect(await keyState(who)).toBe("not_needed");
    await leave(who, "RELEASE");
    expect(await keyState(who)).toBe("not_needed");
    await leave(who, "KEEP");
    // the offer was missed (closed tab, busy page): still available
    expect(await keyState(who)).toBe("available");
    const k = (await (await issue(who)).json()) as Issued;
    expect(await keyState(who)).toBe("available");
    await saved(who, k.issuance_id);
    expect(await keyState(who)).toBe("saved");
    expect((await fetch(url("/api/identity/state"))).status).toBe(401);
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

  it("slows down repeated wrong guesses, whatever forwarding header they claim", async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      // a fresh made-up client address on every guess must not reset the limit
      const res = await fetch(url("/api/identity/restore"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${i + 1}` },
        body: JSON.stringify({ return_key: `guess-${randomUUID()}` }),
      });
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
