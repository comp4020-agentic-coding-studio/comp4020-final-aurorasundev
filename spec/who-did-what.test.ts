import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAliasKey, who } from "../server/log.ts";

// C10: two people side by side, told apart from the server's log alone. This
// file starts its own server (temporary database, the moderation test double)
// so it can read that server's stdout; it never touches the app under test.

describe("log aliases", () => {
  it("names one identity the same way every time, two differently, and hides the id", () => {
    setAliasKey(Buffer.alloc(32, 7));
    const a = randomUUID();
    const b = randomUUID();
    expect(who(a)).toMatch(/^visitor-[0-9a-f]{6}$/);
    expect(who(a)).toBe(who(a));
    expect(who(a)).not.toBe(who(b));
    expect(who(a)).not.toContain(a.slice(0, 6));
    // another deployment's secret gives another alias
    const here = who(a);
    setAliasKey(Buffer.alloc(32, 8));
    expect(who(a)).not.toBe(here);
    expect(who(undefined)).toBeUndefined();
  });
});

const freePort = (): Promise<number> =>
  new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });

describe("the server's log tells two visitors apart", () => {
  let child: ChildProcess;
  let base = "";
  let out = "";
  const dir = mkdtempSync(join(tmpdir(), "throwaway-log-"));

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATABASE_PATH: join(dir, "log.sqlite"), MODERATION_PROVIDER: "fixture" };
    delete env.OPENAI_API_KEY;
    delete env.FLY_APP_NAME;
    child = spawn(process.execPath, [resolve(import.meta.dirname, "../server/index.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", (d) => (out += d));
    for (let i = 0; i < 150 && !out.includes("listening"); i++) await new Promise((r) => setTimeout(r, 100));
    expect(out).toContain("listening");
  }, 20_000);

  afterAll(() => {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  const session = async () => (await fetch(`${base}/api/session`, { method: "POST" })).headers.get("set-cookie")!.split(";")[0];
  const post = (cookie: string, path: string, body: Record<string, unknown>) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  const lines = (action: string) => out.split("\n").filter((l) => l.split(" ")[1] === action);
  const field = (line: string, key: string) => line.split(" ").find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1);
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("attributes each action to its person, and a refused attempt to the one who tried", async () => {
    const alice = await session();
    const bob = await session();
    await settle();
    const sessions = lines("session");
    const [aWho, bWho] = sessions.slice(-2).map((l) => field(l, "who"));
    expect(aWho).toMatch(/^visitor-/);
    expect(bWho).toMatch(/^visitor-/);
    expect(aWho).not.toBe(bWho);

    // Alice keeps a paper; Bob opens it and tries to let it go
    const content = `kept ${randomUUID()}`;
    const created = await post(alice, "/api/papers", { content, mode: "KEEP", confirmed: true, submission_key: randomUUID() });
    expect(created.status).toBe(201);
    const paper = ((await created.json()) as { paper: { id: string } }).paper.id;
    const opened = (await (await fetch(`${base}/api/papers/${paper}`, { headers: { cookie: bob } })).json()) as { read_receipt: string };
    const burned = await post(bob, `/api/papers/${paper}/burn`, { op_key: randomUUID(), confirmed: true, read_receipt: opened.read_receipt });
    expect(burned.status).toBe(403);
    await settle();

    const create = lines("create").find((l) => field(l, "paper") === paper)!;
    expect(field(create, "who")).toBe(aWho);
    const open = lines("open").find((l) => field(l, "paper") === paper)!;
    expect(field(open, "who")).toBe(bWho);
    expect(field(open, "outcome")).toBe("other");
    const refused = lines("burn").find((l) => field(l, "paper") === paper)!;
    expect(field(refused, "who")).toBe(bWho);
    expect(field(refused, "outcome")).toBe("forbidden");

    // and the paper's words never reach the log
    expect(out).not.toContain(content);
  });
});
