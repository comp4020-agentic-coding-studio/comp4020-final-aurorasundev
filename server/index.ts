import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "./db.ts";
import { papersRouter } from "./papers.ts";
import { renderReadmePage } from "./readme.ts";
import { ensureSession } from "./session.ts";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DATABASE_PATH ?? "/data/throwaway.sqlite";

const db = openDb(dbPath);
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
app.use("/api", papersRouter(db));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.get("/readme/", (_req, res) => {
  res.type("html").send(readmeHtml);
});
const docs = resolve(root, "docs");
if (existsSync(docs)) app.use("/readme/docs", express.static(docs));

if (existsSync(dist)) {
  app.use(express.static(dist, { index: "index.html" }));
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
});

const shutdown = (): void => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
