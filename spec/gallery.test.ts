import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyArtifactAdminJobs, enqueueAdminJob, galleryRevision } from "../server/artifacts/store.ts";
import { currentRevision } from "../server/db.ts";
import { CANARY, gallery, WEBP_FIXTURE, type Harness } from "./gallery-harness.ts";

// The public Gallery over HTTP: exactly what it exposes, how it pages, how
// images are gated, and what a report can and cannot do.

let h: Harness;
afterEach(async () => h?.close());

const get = (path: string, init?: RequestInit) => fetch(`${h.base}${path}`, init);
const PUBLIC_KEYS = ["alt", "height", "id", "image_url", "title", "version", "width"];

function assertNoPrivate(body: unknown, seeds: { paperId: string; jobId: string; fileKey: string }[]) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(CANARY.text);
  for (const s of seeds) {
    expect(text).not.toContain(s.paperId);
    expect(text).not.toContain(s.jobId);
    expect(text).not.toContain(s.fileKey);
  }
  expect(text).not.toMatch(/recipe|motif|palette|gesture|prompt|owner|digest|paper_id|job_id|file_key/);
}

describe("reading the Gallery", () => {
  it("reports whether generation is running, and nothing else", async () => {
    h = await gallery({ enabled: false });
    expect(await (await get("/api/gallery/config")).json()).toEqual({ generation_enabled: false, music_enabled: false });
    await h.close();
    h = await gallery({ enabled: true });
    expect(await (await get("/api/gallery/config")).json()).toEqual({ generation_enabled: true, music_enabled: false });
  });

  it("lists only published objects through the allowlisted shape", async () => {
    h = await gallery();
    const shown = [h.seed(), h.seed()];
    const hidden = h.seed({ status: "HIDDEN" });
    const res = await get("/api/gallery");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const page = (await res.json()) as { revision: number; items: Record<string, unknown>[]; next_cursor: string | null; total: number };
    expect(Object.keys(page).sort()).toEqual(["items", "next_cursor", "revision", "total"]);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id).sort()).toEqual(shown.map((s) => s.id).sort());
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(PUBLIC_KEYS);
      expect(item).toMatchObject({ width: 1024, height: 1024, image_url: `/api/gallery/${item.id}/image` });
    }
    assertNoPrivate(page, [...shown, hidden]);
  });

  it("pages by id with a cursor, covering every object once", async () => {
    h = await gallery();
    const ids = Array.from({ length: 30 }, () => h.seed().id).sort();
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page = (await (await get(`/api/gallery?limit=12${after ? `&after=${after}` : ""}`)).json()) as {
        items: { id: string }[];
        next_cursor: string | null;
      };
      seen.push(...page.items.map((x) => x.id));
      after = page.next_cursor;
      if (!after) break;
    }
    expect(seen).toEqual(ids);
  });

  it("rejects bad limits and cursors", async () => {
    h = await gallery();
    for (const query of ["limit=0", "limit=25", "limit=abc", "limit=1.5", "after=not-a-uuid", "after=../../x"]) {
      expect((await get(`/api/gallery?${query}`)).status, query).toBe(400);
    }
    expect((await get("/api/gallery?limit=24")).status).toBe(200);
    expect((await get("/api/gallery?limit=1")).status).toBe(200);
  });

  it("opens one published object and 404s hidden, missing and malformed ids", async () => {
    h = await gallery();
    const shown = h.seed();
    const hidden = h.seed({ status: "HIDDEN" });
    const one = await (await get(`/api/gallery/${shown.id}`)).json();
    expect(Object.keys(one).sort()).toEqual(PUBLIC_KEYS);
    assertNoPrivate(one, [shown]);
    for (const id of [hidden.id, randomUUID(), "nope", "..%2F..%2Fetc"]) {
      expect((await get(`/api/gallery/${id}`)).status, id).toBe(404);
    }
  });
});

describe("arrived recently", () => {
  it("says yes for a record from the last day, and never a time", async () => {
    h = await gallery();
    const fresh = h.seed();
    const old = h.seed();
    h.db.prepare("UPDATE artifacts SET published_at = ? WHERE id = ?").run(Date.now() - 60_000, fresh.id);
    h.db.prepare("UPDATE artifacts SET published_at = ? WHERE id = ?").run(Date.now() - 25 * 60 * 60 * 1000, old.id);
    const page = (await (await get("/api/gallery")).json()) as { items: Record<string, unknown>[] };
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(fresh.id)!.recent).toBe(true);
    expect(Object.keys(byId.get(fresh.id)!).sort()).toEqual([...PUBLIC_KEYS, "recent"].sort());
    expect(Object.keys(byId.get(old.id)!).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(page)).not.toMatch(/published|_at"|time|date/);
    // the order is the same unordered one either way
    expect(page.items.map((i) => i.id)).toEqual([fresh.id, old.id].sort());
    const one = await (await get(`/api/gallery/${fresh.id}`)).json();
    expect(one.recent).toBe(true);
  });
});

describe("serving images", () => {
  it("serves a published object's WebP, uncached, and nothing else", async () => {
    h = await gallery();
    const shown = h.seed();
    const res = await get(`/api/gallery/${shown.id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(WEBP_FIXTURE))).toBe(true);
    for (const path of [
      `/api/gallery/${randomUUID()}/image`,
      `/api/gallery/..%2F${shown.fileKey}/image`,
      `/api/gallery/${shown.fileKey}/image`,
      `/api/artifacts/${shown.fileKey}`,
      `/artifacts/${shown.fileKey}`,
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("hide_open_artifact_blocks_future_image_reads", async () => {
    h = await gallery();
    const shown = h.seed();
    const paperRevision = currentRevision(h.db);
    const galleryBefore = galleryRevision(h.db);
    expect((await get(`/api/gallery/${shown.id}/image`)).status).toBe(200);
    enqueueAdminJob(h.db, "hide", shown.id, "reported", Date.now());
    enqueueAdminJob(h.db, "hide", shown.id, "reported", Date.now());
    const { changes, filesToDelete } = applyArtifactAdminJobs(h.db, Date.now());
    // two hide commands, one change
    expect(changes).toEqual([{ type: "artifact:hidden", revision: galleryBefore + 1, total: 0, id: shown.id, version: 2 }]);
    expect(filesToDelete).toEqual([shown.fileKey]);
    expect(galleryRevision(h.db)).toBe(galleryBefore + 1);
    expect(currentRevision(h.db)).toBe(paperRevision);
    // the image stops at once, even while the file still exists
    expect(existsSync(join(h.dir, shown.fileKey))).toBe(true);
    expect((await get(`/api/gallery/${shown.id}/image`)).status).toBe(404);
    expect((await get(`/api/gallery/${shown.id}`)).status).toBe(404);
    expect(((await (await get("/api/gallery")).json()) as { total: number }).total).toBe(0);
  });
});

describe("reporting an object", () => {
  const report = (cookie: string | null, id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    get(`/api/gallery/${id}/reports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(body),
    });

  it("needs a session, a known reason and an op key; no free-text note", async () => {
    h = await gallery();
    const shown = h.seed();
    const cookie = await h.session();
    expect((await report(null, shown.id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(401);
    for (const body of [
      { reason: "not-a-reason", op_key: randomUUID() },
      { reason: "spam_scam" },
      { reason: "spam_scam", op_key: "short" },
      { reason: "spam_scam", op_key: randomUUID(), note: "free text" },
    ]) {
      expect((await report(cookie, shown.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await report(cookie, randomUUID(), { reason: "spam_scam", op_key: randomUUID() })).status).toBe(404);
    expect((await report(cookie, "not-a-uuid", { reason: "spam_scam", op_key: randomUUID() })).status).toBe(400);
  });

  it("answers a repeat with the same receipt; a changed reuse conflicts; one report per object", async () => {
    h = await gallery();
    const [a, b] = [h.seed(), h.seed()];
    const cookie = await h.session();
    const key = randomUUID();
    const first = await report(cookie, a.id, { reason: "spam_scam", op_key: key });
    expect(first.status).toBe(201);
    const receipt = (await first.json()) as { report_id: string; status: string };
    expect(receipt.status).toBe("queued");
    const again = await report(cookie, a.id, { reason: "spam_scam", op_key: key });
    expect([again.status, await again.json()]).toEqual([201, receipt]);
    expect((await report(cookie, a.id, { reason: "something_else", op_key: key })).status).toBe(409);
    expect((await report(cookie, b.id, { reason: "spam_scam", op_key: key })).status).toBe(409);
    expect((await report(cookie, a.id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(409);
  });

  it("limits each visitor to five an hour, and changes nothing public", async () => {
    h = await gallery();
    const objects = Array.from({ length: 6 }, () => h.seed());
    const cookie = await h.session();
    const revision = galleryRevision(h.db);
    for (const o of objects.slice(0, 5)) expect((await report(cookie, o.id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(201);
    expect((await report(cookie, objects[5].id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(429);
    const page = (await (await get("/api/gallery?limit=24")).json()) as { total: number; revision: number };
    expect([page.total, page.revision, galleryRevision(h.db)]).toEqual([6, revision, revision]);
    for (const o of objects) expect((await get(`/api/gallery/${o.id}/image`)).status).toBe(200);
  });

  it("limits one address to twenty an hour across visitors", async () => {
    h = await gallery();
    const objects = Array.from({ length: 21 }, () => h.seed());
    let sent = 0;
    for (let v = 0; v < 5 && sent < 20; v++) {
      const cookie = await h.session();
      for (let i = 0; i < 4; i++) {
        expect((await report(cookie, objects[sent].id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(201);
        sent++;
      }
    }
    expect((await report(await h.session(), objects[20].id, { reason: "spam_scam", op_key: randomUUID() })).status).toBe(429);
  });

  it("is resolved by a hide; a dismiss resolves only that report", async () => {
    h = await gallery();
    const [a, b] = [h.seed(), h.seed()];
    const ids: string[] = [];
    for (const target of [a, a, b]) {
      const res = await report(await h.session(), target.id, { reason: "threats_abuse", op_key: randomUUID() });
      ids.push(((await res.json()) as { report_id: string }).report_id);
    }
    enqueueAdminJob(h.db, "dismiss", ids[2], null, Date.now());
    enqueueAdminJob(h.db, "hide", a.id, "reported", Date.now());
    applyArtifactAdminJobs(h.db, Date.now());
    const status = (id: string) => (h.db.prepare("SELECT status FROM artifact_reports WHERE id = ?").get(id) as { status: string }).status;
    expect(ids.map(status)).toEqual(["resolved", "resolved", "dismissed"]);
    expect((await get(`/api/gallery/${b.id}`)).status).toBe(200);
  });
});
