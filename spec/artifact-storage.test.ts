import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import {
  checkArtifactCapacity,
  readArtifactFile,
  recoverArtifactFile,
  removeArtifactFile,
  saveArtifactFile,
  STORAGE_LIMITS,
  sweepArtifactFiles,
} from "../server/artifacts/storage.ts";

// Private keepsake files: bounded, validated, atomically written, and never
// addressed by anything but a server-made name.

const WEBP = readFileSync(resolve(import.meta.dirname, "fixtures/artifacts/keepsake-1024.webp"));
const dir = () => mkdtempSync(join(tmpdir(), "throwaway-artifacts-"));
const quietDb = () => {
  const log = console.log;
  console.log = () => {};
  try {
    return openDb(":memory:");
  } finally {
    console.log = log;
  }
};

describe("writing and reading", () => {
  it("writes atomically under the job's public id and reads it back", async () => {
    const d = dir();
    const id = randomUUID();
    const key = await saveArtifactFile(d, id, WEBP);
    expect(key).toBe(`${id}.webp`);
    expect((await readArtifactFile(d, key)).equals(WEBP)).toBe(true);
    // no staging file is left behind
    expect(readdirSync(d)).toEqual([key]);
  });

  it("reuses an existing finalized file instead of overwriting it", async () => {
    const d = dir();
    const id = randomUUID();
    await saveArtifactFile(d, id, WEBP);
    const other = Buffer.from(WEBP);
    expect(await saveArtifactFile(d, id, other)).toBe(`${id}.webp`);
    expect(readdirSync(d)).toHaveLength(1);
  });

  it("refuses invalid images, oversized files and names it did not make", async () => {
    const d = dir();
    await expect(saveArtifactFile(d, randomUUID(), Buffer.from("not an image"))).rejects.toThrow();
    await expect(saveArtifactFile(d, randomUUID(), Buffer.alloc(STORAGE_LIMITS.fileBytes + 1))).rejects.toThrow();
    for (const name of ["../escape.webp", "/etc/passwd", `${randomUUID()}.png`, "a.webp", `${randomUUID()}.webp/../x`]) {
      await expect(readArtifactFile(d, name), name).rejects.toThrow(/invalid artifact file key/);
      await expect(removeArtifactFile(d, name), name).rejects.toThrow(/invalid artifact file key/);
    }
    await expect(saveArtifactFile(d, "../../escape", WEBP)).rejects.toThrow(/invalid artifact file key/);
  });

  it("refuses a file that stops being valid on disk", async () => {
    const d = dir();
    const key = await saveArtifactFile(d, randomUUID(), WEBP);
    writeFileSync(join(d, key), Buffer.from("tampered"));
    await expect(readArtifactFile(d, key)).rejects.toThrow();
  });
});

describe("recovery after a crash", () => {
  it("finds a finalized file and drops a broken one", async () => {
    const d = dir();
    const good = randomUUID();
    const broken = randomUUID();
    await saveArtifactFile(d, good, WEBP);
    writeFileSync(join(d, `${broken}.webp`), WEBP.subarray(0, 100));
    expect(await recoverArtifactFile(d, good)).toBe(`${good}.webp`);
    expect(await recoverArtifactFile(d, broken)).toBeNull();
    expect(readdirSync(d)).toEqual([`${good}.webp`]);
    expect(await recoverArtifactFile(d, randomUUID())).toBeNull();
  });

  it("sweeps staging leftovers and orphans, never an unrelated file or a job's file", async () => {
    const d = dir();
    const db = quietDb();
    const kept = randomUUID();
    const orphan = randomUUID();
    await saveArtifactFile(d, kept, WEBP);
    await saveArtifactFile(d, orphan, WEBP);
    db.prepare("INSERT INTO identities (id, created_at) VALUES ('o', 'now')").run();
    db.prepare(
      "INSERT INTO papers (id, owner_identity_id, content, created_at, submission_key, mode, request_digest) VALUES ('p', 'o', '', 'now', 'k', 'RELEASE', 'd')",
    ).run();
    db.prepare(
      "INSERT INTO artifact_jobs (id, paper_id, public_id, state, file_key, not_before, next_attempt_at, created_at, updated_at) VALUES ('j', 'p', ?, 'REVIEW_QUEUED', ?, 0, 0, 0, 0)",
    ).run(kept, `${kept}.webp`);
    writeFileSync(join(d, `${randomUUID()}.webp.0a1b2c3d.partial`), "half");
    writeFileSync(join(d, "notes.txt"), "not ours");
    expect(await sweepArtifactFiles(db, d)).toBe(2);
    expect(readdirSync(d).sort()).toEqual([`${kept}.webp`, "notes.txt"].sort());
    db.close();
  });
});

describe("capacity", () => {
  it("stops at the public-object cap, the managed-byte cap and a nearly full disk", async () => {
    const d = dir();
    const db = quietDb();
    expect(await checkArtifactCapacity(db, d)).toBe(true);
    expect(await checkArtifactCapacity(db, d, { ...STORAGE_LIMITS, publicObjects: 0 })).toBe(false);
    await saveArtifactFile(d, randomUUID(), WEBP);
    // a staging file counts toward the managed bytes too
    writeFileSync(join(d, `${randomUUID()}.webp.0a1b2c3d.partial`), Buffer.alloc(5000));
    expect(await checkArtifactCapacity(db, d, { ...STORAGE_LIMITS, fileBytes: 1000, managedBytes: WEBP.length + 5000 + 999 })).toBe(false);
    expect(await checkArtifactCapacity(db, d, { ...STORAGE_LIMITS, freeDiskBytes: Number.MAX_SAFE_INTEGER })).toBe(false);
    db.close();
  });

  it("refuses a write past the managed-byte cap", async () => {
    const d = dir();
    await saveArtifactFile(d, randomUUID(), WEBP);
    await expect(saveArtifactFile(d, randomUUID(), WEBP, { ...STORAGE_LIMITS, managedBytes: WEBP.length + 10 })).rejects.toThrow(/full/);
  });
});
