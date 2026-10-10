import express from "express";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { openDb } from "./db.ts";
import { closeAllStreams, eventsRouter } from "./events.ts";
import { identityRouter } from "./identity.ts";
import { check, providerFromEnv } from "./moderation.ts";
import { papersRouter } from "./papers.ts";
import { renderReadmePage } from "./readme.ts";
import { reportsRouter } from "./reports.ts";
import { createReviewWorker } from "./reviews.ts";
import { ensureSession } from "./session.ts";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DATABASE_PATH ?? "/data/throwaway.sqlite";

const db = openDb(dbPath);
// Refuses to start with the test double on Fly; without a key, publication
// fails closed ("could not be checked") rather than passing anything.
const provider = providerFromEnv();
// The test double answers instantly, so its retries needn't wait minutes.
const worker = createReviewWorker(db, provider, provider?.name === "fixture" ? { retryDelaysMs: [50, 100, 200] } : {});
const readmeHtml = renderReadmePage(resolve(root, "README.md"));
const dist = resolve(root, "dist");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));

app.post("/api/session", (req, res) => {
  ensureSession(db, req, res);
  res.json({ ok: true });
});
app.get("/api/safety", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ provider: provider?.name ?? null, reports: true });
});
app.use("/api", papersRouter(db, (payload) => check(provider, payload)));
app.use("/api", reportsRouter(db, () => void worker.wake()));
app.use("/api", eventsRouter(db));
app.use("/api", identityRouter(db));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.get("/readme/", (_req, res) => {
  res.type("html").send(readmeHtml);
});
const docs = resolve(root, "docs");
if (existsSync(docs)) app.use("/readme/docs", express.static(docs));

// The paper's crumple model (.fbx) is 1.25 MB raw and about 140 KB gzipped,
// but Fly's edge only compresses known text types, so it went out raw on
// every first visit. It is gzipped once here at startup and sent encoded to
// any browser that accepts gzip. (The .exr beside it is already compressed.)
const vatDir = resolve(dist, "vat/geo");
const gzipped = new Map<string, Buffer>();
if (existsSync(vatDir)) {
  for (const name of readdirSync(vatDir)) {
    if (extname(name) === ".fbx") gzipped.set(`/vat/geo/${name}`, gzipSync(readFileSync(resolve(vatDir, name)), { level: 9 }));
  }
}
app.get("/vat/geo/:file", (req, res, next) => {
  const body = gzipped.get(req.path);
  if (!body || !req.acceptsEncodings("gzip")) return next();
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "gzip",
    Vary: "Accept-Encoding",
    "Cache-Control": "public, max-age=604800",
  });
  res.send(body);
});

// Vite's hashed bundles never change under one name, so browsers keep them
// for a year; the crumple model is the demo's fixed asset, kept a week. The
// page and other public files (textures) are revalidated on each visit.
function cacheHeaders(res: express.Response, path: string): void {
  if (path.includes("/assets/")) res.set("Cache-Control", "public, max-age=31536000, immutable");
  else if (path.includes("/vat/")) res.set("Cache-Control", "public, max-age=604800");
  else res.set("Cache-Control", "no-cache");
}

if (existsSync(dist)) {
  app.use(express.static(dist, { index: "index.html", setHeaders: cacheHeaders }));
} else {
  app.get("/", (_req, res) => {
    res.type("html").send("<!doctype html><title>Throwaway</title><p>Client not built: run pnpm build, or use pnpm dev.</p>");
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: "Bad request." });
    return;
  }
  console.error("request failed", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`throwaway listening on 0.0.0.0:${port}, db ${dbPath}`);
  // picks up reviews and operator decisions left from before a restart
  void worker.wake();
});

// Open event streams would otherwise hold server.close() open forever.
const shutdown = (): void => {
  closeAllStreams();
  server.close(() => {
    void worker.stop().finally(() => {
      db.close();
      process.exit(0);
    });
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
