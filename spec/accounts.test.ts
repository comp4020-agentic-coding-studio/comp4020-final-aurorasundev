import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { accountsRouter } from "../server/accounts.ts";
import { openDb, type DB } from "../server/db.ts";
import { papersRouter } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { ensureSession } from "../server/session.ts";
import { leave, open, post, url, visitor } from "./client.ts";
import { CANARY, gallery } from "./gallery-harness.ts";
import { openStream } from "./sse.ts";

// Optional accounts (ADR 009): a username and password attached to an
// anonymous identity, so a person can find their own papers again. Nothing
// about an account is public.
//
// Most checks run on an in-process server (the real accounts and papers
// routers over a fresh in-memory database), so each test starts with its own
// abuse limits; every spec shares one address (localhost) on the app under
// test. The last block checks the running app end to end. Creates
// identities and papers, so never run against the live app.

const PASSWORD = "a long enough passphrase";
const name = (): string => `u${randomUUID().slice(0, 8)}`;
const quiet = <T>(run: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
};

type Limits = Parameters<typeof accountsRouter>[3];

async function world(options: { env?: NodeJS.ProcessEnv; limits?: Limits } = {}) {
  const db = quiet(() => openDb(":memory:"));
  const server = express()
    .use(express.json({ limit: "512kb" }))
    .post("/api/session", (req, res) => {
      ensureSession(db, req, res);
      res.json({ ok: true });
    })
    .use("/api", papersRouter(db, async () => ({ kind: "allow" })))
    .use("/api", accountsRouter(db, () => false, options.env ?? {}, options.limits))
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // a browser: one cookie jar
  const browser = async () => {
    let cookie = (await fetch(`${base}/api/session`, { method: "POST" })).headers.get("set-cookie")!.split(";")[0];
    const take = (res: Response) => {
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    };
    const send = async (path: string, body?: unknown) =>
      take(
        await fetch(`${base}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const json = async <T = Record<string, unknown>>(path: string, body?: unknown) => (await (await send(path, body)).json()) as T;
    return {
      send,
      json,
      get cookie() {
        return cookie;
      },
      register: (username = name(), password = PASSWORD) => send("/api/account/register", { username, password }),
      login: (username: string, password = PASSWORD) => send("/api/account/login", { username, password }),
      logout: () => send("/api/account/logout", {}),
      leave: async (mode: "KEEP" | "RELEASE", content = `paper ${randomUUID()}`) => {
        const res = await send("/api/papers", { content, mode, confirmed: true, submission_key: randomUUID() });
        return (await res.json()) as { paper: { id: string }; offer_account: boolean };
      },
      open: (id: string) => json<{ read_receipt: string; witness_count: number; viewer: Record<string, boolean> }>(`/api/papers/${id}`),
      witness: (id: string, receipt: string) => send(`/api/papers/${id}/witness`, { read_receipt: receipt }),
      burn: (id: string, receipt: string) => send(`/api/papers/${id}/burn`, { op_key: randomUUID(), confirmed: true, read_receipt: receipt }),
      papers: async () => (await json<{ papers: Record<string, unknown>[] }>("/api/account/papers")).papers,
    };
  };
  return { db, base, browser, close: () => new Promise((r) => server.close(r)) };
}

const accountsIn = (db: DB) => (db.prepare("SELECT identity_id FROM accounts").all() as { identity_id: string }[]).map((r) => r.identity_id);

describe("creating an account", () => {
  it("turns this guest into an account in place, keeping its papers and rights", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      const kept = (await b.leave("KEEP")).paper.id;
      const username = name();
      const res = await b.register(username);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ signed_in: true, username });
      expect(await b.json("/api/account")).toEqual({ available: true, signed_in: true, username });
      expect((await b.papers()).map((p) => p.id)).toEqual([kept]);
      expect((await b.burn(kept, (await b.open(kept)).read_receipt)).status).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("issues a new cookie, so the one held before can't act as the account", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      const before = b.cookie;
      await b.register();
      expect(b.cookie).not.toBe(before);
      const stale = await fetch(`${w.base}/api/account/papers`, { headers: { cookie: before } });
      expect(stale.status).toBe(401);
    } finally {
      await w.close();
    }
  });

  it("refuses a taken username whatever its case, and a second account for one person", async () => {
    const w = await world();
    try {
      const username = name();
      expect((await (await w.browser()).register(username)).status).toBe(201);
      const second = await (await w.browser()).register(username.toUpperCase());
      expect(second.status).toBe(409);
      expect(((await second.json()) as { code: string }).code).toBe("username_taken");
      const signedIn = await w.browser();
      await signedIn.register();
      const again = await signedIn.register();
      expect(again.status).toBe(409);
      expect(((await again.json()) as { code: string }).code).toBe("already_signed_in");
    } finally {
      await w.close();
    }
  });

  it("refuses usernames and passwords outside the rules, with plain reasons", async () => {
    const w = await world();
    try {
      for (const username of ["ab", "has space", "x".repeat(25), "semi;colon", ""]) {
        const res = await (await w.browser()).register(username);
        expect(res.status, username).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe("invalid_username");
      }
      const username = name();
      for (const password of ["short", "x".repeat(129), username]) {
        const res = await (await w.browser()).register(username, password);
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe("invalid_password");
      }
      expect(accountsIn(w.db)).toEqual([]);
    } finally {
      await w.close();
    }
  });

  it("caps how many accounts one address can create", async () => {
    const w = await world({ limits: { nameFailures: 10, addressFailures: 50, creations: 2 } });
    try {
      expect((await (await w.browser()).register()).status).toBe(201);
      expect((await (await w.browser()).register()).status).toBe(201);
      expect((await (await w.browser()).register()).status).toBe(429);
    } finally {
      await w.close();
    }
  });
});

describe("signing in", () => {
  it("gives another browser the same rights and the same private list", async () => {
    const w = await world();
    try {
      const first = await w.browser();
      const kept = (await first.leave("KEEP")).paper.id;
      const username = name();
      await first.register(username);
      const elsewhere = await w.browser();
      const res = await elsewhere.login(username);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ signed_in: true, username });
      expect((await elsewhere.papers()).map((p) => p.id)).toEqual([kept]);
      expect((await elsewhere.open(kept)).viewer).toMatchObject({ is_author: true, can_burn: true });
      expect((await first.papers()).map((p) => p.id)).toEqual([kept]);
    } finally {
      await w.close();
    }
  });

  it("answers a wrong password and an unknown name the same way, and signs nobody in", async () => {
    const w = await world();
    try {
      const username = name();
      await (await w.browser()).register(username);
      const a = await w.browser();
      const wrongPassword = await a.login(username, "not the password at all");
      const unknown = await (await w.browser()).login(name());
      expect([wrongPassword.status, unknown.status]).toEqual([401, 401]);
      expect(await wrongPassword.json()).toEqual(await unknown.json());
      expect(wrongPassword.headers.get("set-cookie")).toBeNull();
      expect(await a.json("/api/account")).toEqual({ available: true, signed_in: false });
    } finally {
      await w.close();
    }
  });

  it("moves what a guest left in this browser to the account, and the account's own witness stops counting", async () => {
    const w = await world();
    try {
      const account = await w.browser();
      const username = name();
      await account.register(username);
      const guest = await w.browser();
      const left = (await guest.leave("RELEASE")).paper.id;
      expect((await account.witness(left, (await account.open(left)).read_receipt)).status).toBe(200);
      expect((await guest.open(left)).witness_count).toBe(1);
      expect((await guest.login(username)).status).toBe(200);
      expect((await guest.papers()).map((p) => p.id)).toContain(left);
      expect((await guest.open(left)).viewer.is_author).toBe(true);
      expect((await (await w.browser()).open(left)).witness_count).toBe(0);
    } finally {
      await w.close();
    }
  });

  it("locks a username after ten wrong passwords, whichever address they come from", async () => {
    const w = await world();
    try {
      const username = name();
      await (await w.browser()).register(username);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await (await w.browser()).login(username, `wrong guess ${i}`)).status);
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses[10]).toBe(429);
      // even the right password waits now
      expect((await (await w.browser()).login(username)).status).toBe(429);
    } finally {
      await w.close();
    }
  });
});

describe("signing out", () => {
  it("ends this browser's session: the next visit is a new guest without the account's rights", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      const kept = (await b.leave("KEEP")).paper.id;
      await b.register();
      const signedIn = b.cookie;
      const res = await b.logout();
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toMatch(/tw_session=;/);
      expect((await fetch(`${w.base}/api/account/papers`, { headers: { cookie: signedIn } })).status).toBe(401);
      const next = await w.browser();
      expect(await next.json("/api/account")).toEqual({ available: true, signed_in: false });
      const opened = await next.open(kept);
      expect(opened.viewer).toMatchObject({ is_author: false, can_burn: false });
      expect((await next.burn(kept, opened.read_receipt)).status).toBe(403);
    } finally {
      await w.close();
    }
  });
});

describe("your papers", () => {
  it("are only for a signed-in person and list only their own papers, with no counts", async () => {
    const w = await world();
    try {
      const guest = await w.browser();
      expect((await guest.send("/api/account/papers")).status).toBe(401);
      expect((await guest.send("/api/account/records")).status).toBe(401);
      const b = await w.browser();
      await b.register();
      const mine = (await b.leave("KEEP", `mine ${randomUUID()}`)).paper.id;
      const theirs = (await guest.leave("KEEP")).paper.id;
      const papers = await b.papers();
      expect(papers.map((p) => p.id)).toEqual([mine]);
      expect(papers.map((p) => p.id)).not.toContain(theirs);
      expect(Object.keys(papers[0]).sort()).toEqual(["created_at", "excerpt", "has_drawing", "id", "mode"]);
      expect(papers[0]).toMatchObject({ mode: "keep", has_drawing: false });
      expect(String(papers[0].excerpt)).toMatch(/^mine /);
    } finally {
      await w.close();
    }
  });

  it("shorten a long paper to an excerpt", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      await b.register();
      await b.leave("KEEP", "a".repeat(300));
      const [paper] = await b.papers();
      expect([...String(paper.excerpt)]).toHaveLength(81);
      expect(String(paper.excerpt).endsWith("…")).toBe(true);
    } finally {
      await w.close();
    }
  });

  it("drop a paper once it is burned or removed for safety", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      await b.register();
      const burned = (await b.leave("KEEP")).paper.id;
      const removed = (await b.leave("KEEP")).paper.id;
      expect(await b.papers()).toHaveLength(2);
      expect((await b.burn(burned, (await b.open(burned)).read_receipt)).status).toBe(200);
      quiet(() => quarantinePaper(w.db, removed, "spam", "operator"));
      expect(await b.papers()).toEqual([]);
    } finally {
      await w.close();
    }
  });

  it("never carry a password, a hash or a pepper in any reply", async () => {
    const w = await world();
    try {
      const b = await w.browser();
      const username = name();
      const replies = [
        await (await b.register(username)).text(),
        await (await b.send("/api/account")).text(),
        await (await (await w.browser()).login(username)).text(),
        await (await b.send("/api/account/papers")).text(),
        await (await b.send("/api/account/records")).text(),
      ];
      for (const body of replies) expect(body).not.toMatch(/password|scrypt|pepper|hash/i);
    } finally {
      await w.close();
    }
  });
});

describe("what your papers became", () => {
  it("lists only this account's published records, in exactly the public Gallery shape", async () => {
    const h = await gallery();
    const w = await world();
    try {
      const own = h.seed();
      const other = h.seed();
      const hidden = h.seed({ status: "HIDDEN" });
      const b = await w.browser();
      await b.register();
      const [account] = accountsIn(w.db);
      w.db.prepare("INSERT INTO identities (id, created_at) VALUES ('someone', 'now')").run();
      // the seeded records (and their burned papers), copied into this world
      for (const table of ["papers", "artifact_jobs", "artifacts"] as const) {
        for (const row of h.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
          if (table === "papers") row.owner_identity_id = row.id === own.paperId || row.id === hidden.paperId ? account : "someone";
          const keys = Object.keys(row);
          w.db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
        }
      }
      const { records } = await b.json<{ records: Record<string, unknown>[] }>("/api/account/records");
      expect(records.map((r) => r.id)).toEqual([own.id]);
      const pub = (await (await fetch(`${h.base}/api/gallery?limit=12`)).json()) as { items: Record<string, unknown>[] };
      expect(records[0]).toEqual(pub.items.find((i) => i.id === own.id));
      const text = JSON.stringify(records);
      for (const secret of [own.paperId, own.jobId, other.id, hidden.id, CANARY.text]) expect(text).not.toContain(secret);
    } finally {
      await w.close();
      await h.close();
    }
  });
});

describe("suggesting an account", () => {
  it("after a guest's first Keep and at their third paper, and never to someone signed in", async () => {
    const w = await world();
    try {
      const guest = await w.browser();
      expect((await guest.leave("RELEASE")).offer_account).toBe(false);
      expect((await guest.leave("KEEP")).offer_account).toBe(true);
      expect((await guest.leave("RELEASE")).offer_account).toBe(true);
      expect((await guest.leave("KEEP")).offer_account).toBe(false);
      const b = await w.browser();
      await b.register();
      for (let i = 0; i < 3; i++) expect((await b.leave("KEEP")).offer_account).toBe(false);
    } finally {
      await w.close();
    }
  });
});

describe("when no pepper is configured on Fly", () => {
  it("switches accounts off honestly, and guests are unaffected", async () => {
    const w = await world({ env: { FLY_APP_NAME: "app" } });
    try {
      const b = await w.browser();
      expect(await b.json("/api/account")).toEqual({ available: false, signed_in: false });
      for (const res of [await b.register(), await b.login("someone")]) {
        expect(res.status).toBe(503);
        expect(((await res.json()) as { code: string }).code).toBe("accounts_unconfigured");
      }
      expect((await b.leave("KEEP")).paper.id).toBeTruthy();
    } finally {
      await w.close();
    }
  });
});

describe("the running app", () => {
  it("signs up, signs out and signs back in end to end, privately and uncached", async () => {
    const guest = await visitor();
    const kept = await leave(guest, "KEEP");
    const state = await fetch(url("/api/account"), { headers: { cookie: guest.cookie } });
    expect(state.headers.get("cache-control")).toBe("no-store");
    expect(await state.json()).toEqual({ available: true, signed_in: false });

    const username = name();
    const created = await post(guest, "/api/account/register", { username, password: PASSWORD });
    expect(created.status).toBe(201);
    const account = { cookie: created.headers.get("set-cookie")!.split(";")[0] };
    const papers = await fetch(url("/api/account/papers"), { headers: { cookie: account.cookie } });
    expect(papers.headers.get("cache-control")).toBe("no-store");
    expect(((await papers.json()) as { papers: { id: string }[] }).papers.map((p) => p.id)).toEqual([kept]);

    expect((await post(account, "/api/account/logout", {})).status).toBe(200);
    const back = await post(await visitor(), "/api/account/login", { username, password: PASSWORD });
    expect(back.status).toBe(200);
    const elsewhere = { cookie: back.headers.get("set-cookie")!.split(";")[0] };
    expect((await open(elsewhere, kept)).viewer).toMatchObject({ is_author: true, can_burn: true });
  });

  it("keeps account details out of the shared space's events", async () => {
    const stream = await openStream(url("/api/events"));
    try {
      await stream.next("space:snapshot");
      const guest = await visitor();
      await leave(guest, "KEEP");
      const username = name();
      const created = await post(guest, "/api/account/register", { username, password: PASSWORD });
      expect(created.status).toBe(201);
      await new Promise((r) => setTimeout(r, 200));
      expect(JSON.stringify(stream.events)).not.toMatch(new RegExp(`${username}|username|account|password`, "i"));
    } finally {
      stream.close();
    }
  });
});
