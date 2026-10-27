import express from "express";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { broadcastGallery, closeGalleryStreams } from "./artifacts/events.ts";
import { artifactProviderFromEnv } from "./artifacts/provider.ts";
import { galleryRouter } from "./artifacts/router.ts";
import { createArtifactWorker } from "./artifacts/worker.ts";
import { openDb, serverSecret } from "./db.ts";
import { broadcast, closeAllStreams, eventsRouter } from "./events.ts";
import { identityRouter } from "./identity.ts";
import { log, person, setAliasKey } from "./log.ts";
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
// log aliases (`who=visitor-…`) are keyed off a server secret, never stored
setAliasKey(serverSecret(db, "read_receipt"));
// Refuses to start with the test double on Fly; without a key, publication
// fails closed ("could not be checked") rather than passing anything.
const provider = providerFromEnv();
// The test double answers instantly, so its retries needn't wait minutes.
const worker = createReviewWorker(db, provider, provider?.name === "fixture" ? { retryDelaysMs: [50, 100, 200] } : {});
// Release records: paused unless ARTIFACTS_ENABLED=1 and a provider is
// configured. Paused, a Release burn still burns normally but makes no
// record (its note is not kept to process later); operator hides still
// apply. The fixture provider is refused on Fly, as moderation's is.
const artifactDir = process.env.ARTIFACT_DIR ?? resolve(dirname(dbPath), "artifacts");
const artifactProvider = artifactProviderFromEnv();
// Record music (ADR 006): off unless GALLERY_MUSIC_ENABLED=1, independent of
// ARTIFACTS_ENABLED. On, a fresh publication also saves a locally composed
// score and published scores are served; off, none are made or served and
// stored ones are kept. No provider, key or request of its own.
const musicEnabled = process.env.GALLERY_MUSIC_ENABLED === "1";
const artifactWorker = createArtifactWorker(db, artifactProvider, {
  artifactDir,
  enabled: process.env.ARTIFACTS_ENABLED === "1",
  musicEnabled,
  onChange: broadcastGallery,
  // the burn's fire may end: the paper's id only, never its record
  onSettled: (paperId) => broadcast("paper:extraction_settled", { id: paperId }),
});
const readmeHtml = renderReadmePage(resolve(root, "README.md"));
const dist = resolve(root, "dist");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "512kb" }));

app.post("/api/session", (req, res) => {
  const { identityId, fresh } = ensureSession(db, req, res);
  log("session", { ...person(identityId), outcome: fresh ? "new" : "resumed" });
  res.json({ ok: true });
});
app.get("/api/safety", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ provider: provider?.name ?? null, reports: true });
});
app.use(
  "/api",
  papersRouter(db, (payload) => check(provider, payload), artifactWorker.enabled ? (ignition) => void artifactWorker.extract(ignition) : null),
);
app.use("/api", galleryRouter(db, artifactDir, () => artifactWorker.enabled, () => void artifactWorker.wake(), () => musicEnabled));
app.use("/api", reportsRouter(db, () => void worker.wake()));
app.use("/api", eventsRouter(db));
app.use("/api", identityRouter(db));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

// The Gallery is a page of the same client build, opened without the room:
// the space's preloads of the crumple model are dropped from its HTML, and
// only the Gallery preloads its display face (the room never loads it).
const GALLERY_FONT_PRELOAD = '<link rel="preload" as="font" type="font/woff2" href="/fonts/gloock-latin-400.woff2" crossorigin />';
const galleryHtml = existsSync(resolve(dist, "index.html"))
  ? readFileSync(resolve(dist, "index.html"), "utf8")
      .replace(/^\s*<link rel="preload"[^>]*\/vat\/[^>]*>\n/gm, "")
      .replace("</head>", `    ${GALLERY_FONT_PRELOAD}\n  </head>`)
  : null;
app.get(/^\/gallery\/?$/, (_req, res, next) => {
  if (!galleryHtml) return next();
  res.set("Cache-Control", "no-cache").type("html").send(galleryHtml);
});

app.get("/readme/", (_req, res) => {
  res.type("html").send(readmeHtml);
});
const docs = resolve(root, "docs");
if (existsSync(docs)) app.use("/readme/docs", express.static(docs));

// Compress fixed assets once at startup. SSE is deliberately uncompressed
// so its changes are flushed immediately; private API replies are not cached.
const gzipped = new Map<string, Buffer>();
for (const [folder, extensions] of [["assets", [".js", ".css"]], ["vat/geo", [".fbx"]]] as const) {
  const directory = resolve(dist, folder);
  if (!existsSync(directory)) continue;
  for (const name of readdirSync(directory)) {
    if ((extensions as readonly string[]).includes(extname(name))) {
      gzipped.set(`/${folder}/${name}`, gzipSync(readFileSync(resolve(directory, name)), { level: 9 }));
    }
  }
}
app.get(/^\/(?:assets|vat\/geo)\/[^/]+$/, (req, res, next) => {
  const body = gzipped.get(req.path);
  if (!body) return next();
  res.vary("Accept-Encoding");
  if (!req.acceptsEncodings("gzip")) return next();
  res.type(extname(req.path) === ".fbx" ? "application/octet-stream" : extname(req.path));
  res.set("Content-Encoding", "gzip");
  cacheHeaders(res, resolve(dist, `.${req.path}`));
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
  void artifactWorker.wake();
  if (!artifactWorker.enabled) console.log("keepsake generation is paused: Release burns queue, nothing is sent to the image provider");
});

// Open event streams would otherwise hold server.close() open forever.
const shutdown = (): void => {
  closeAllStreams();
  closeGalleryStreams();
  server.close(() => {
    void Promise.all([worker.stop(), artifactWorker.stop()]).finally(() => {
      db.close();
      process.exit(0);
    });
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
