import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { DB } from "../db.ts";
import { MAX_IMAGE_BYTES, validateWebp } from "./provider.ts";

// Private keepsake files: server-named `<uuid>.webp` in one directory that is
// never served statically. Writes go to a staging name in the same directory,
// are fsynced, then renamed, so a crash leaves either nothing or a whole file.

export const STORAGE_LIMITS = {
  fileBytes: MAX_IMAGE_BYTES,
  managedBytes: 250 * 1024 * 1024,
  publicObjects: 200,
  freeDiskBytes: 64 * 1024 * 1024,
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FINAL = new RegExp(`^${UUID}\\.webp$`);
const STAGING = new RegExp(`^${UUID}\\.webp\\.[0-9a-f]{8}\\.partial$`);

// Only names this module created can be read, written or removed.
function pathFor(dir: string, fileKey: string): string {
  if (!FINAL.test(fileKey)) throw new Error("invalid artifact file key");
  return join(dir, fileKey);
}

// Every file this module manages, staging included, and their total size.
async function managed(dir: string): Promise<{ bytes: number; names: string[] }> {
  await mkdir(dir, { recursive: true });
  let bytes = 0;
  const names: string[] = [];
  for (const name of await readdir(dir)) {
    if (!FINAL.test(name) && !STAGING.test(name)) continue;
    names.push(name);
    bytes += (await stat(join(dir, name))).size;
  }
  return { bytes, names };
}

// Room for one more image: under the public-object cap, under the managed
// byte cap with a full file to spare, and the disk itself not nearly full.
export async function checkArtifactCapacity(db: DB, dir: string, limits = STORAGE_LIMITS): Promise<boolean> {
  const published = (db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE status = 'PUBLISHED'").get() as { n: number }).n;
  if (published >= limits.publicObjects) return false;
  const { bytes } = await managed(dir);
  if (bytes + limits.fileBytes > limits.managedBytes) return false;
  const disk = await statfs(dir);
  return disk.bavail * disk.bsize >= limits.freeDiskBytes;
}

// Atomically writes a validated image as `<publicId>.webp`. An existing valid
// file of that name is reused as it is; it is never overwritten.
export async function saveArtifactFile(dir: string, publicId: string, bytes: Buffer, limits = STORAGE_LIMITS): Promise<string> {
  const fileKey = `${publicId}.webp`;
  const target = pathFor(dir, fileKey);
  if (bytes.length > limits.fileBytes || !validateWebp(bytes)) throw new Error("invalid artifact image");
  const existing = await recoverArtifactFile(dir, publicId);
  if (existing) return existing;
  const { bytes: used } = await managed(dir);
  if (used + bytes.length > limits.managedBytes) throw new Error("artifact storage full");
  const staging = `${target}.${randomUUID().slice(0, 8)}.partial`;
  const handle = await open(staging, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { force: true });
    throw err;
  }
  // the rename itself is durable once the directory is synced
  const directory = await open(dir, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return fileKey;
}

// Reads a finalized file, refusing anything not a valid image or too large.
export async function readArtifactFile(dir: string, fileKey: string): Promise<Buffer> {
  const handle = await open(pathFor(dir, fileKey), "r");
  try {
    const { size } = await handle.stat();
    if (size > STORAGE_LIMITS.fileBytes) throw new Error("artifact file too large");
    const bytes = Buffer.alloc(size);
    await handle.read(bytes, 0, size, 0);
    if (!validateWebp(bytes)) throw new Error("artifact file invalid");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function removeArtifactFile(dir: string, fileKey: string): Promise<void> {
  await rm(pathFor(dir, fileKey), { force: true });
}

// After a crash: a finalized, valid file for this job's public id, if one was
// written before the database heard about it. A partial or invalid file is
// removed and not reported.
export async function recoverArtifactFile(dir: string, publicId: string): Promise<string | null> {
  const fileKey = `${publicId}.webp`;
  const path = pathFor(dir, fileKey);
  try {
    await readArtifactFile(dir, fileKey);
    return fileKey;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") await rm(path, { force: true });
    return null;
  }
}

// Staging files left by a crash, and finalized files no job or object names,
// are removed. Call it only when no write can be in progress (the worker runs
// it once at startup, before its loop). Returns how many were removed.
export async function sweepArtifactFiles(db: DB, dir: string): Promise<number> {
  const known = new Set(
    (
      db
        .prepare(
          `SELECT file_key FROM artifact_jobs WHERE file_key IS NOT NULL
           UNION SELECT file_key FROM artifacts WHERE status = 'PUBLISHED'`,
        )
        .all() as { file_key: string }[]
    ).map((r) => r.file_key),
  );
  // a job mid-generation may be about to adopt its file: keep those too
  const pending = new Set(
    (
      db.prepare("SELECT public_id FROM artifact_jobs WHERE state IN ('GENERATING', 'GENERATION_UNKNOWN', 'REVIEW_QUEUED', 'REVIEWING')").all() as {
        public_id: string;
      }[]
    ).map((r) => `${r.public_id}.webp`),
  );
  let removed = 0;
  for (const name of (await managed(dir)).names) {
    if (STAGING.test(name) || (!known.has(name) && !pending.has(name))) {
      await rm(join(dir, name), { force: true });
      removed++;
    }
  }
  return removed;
}
