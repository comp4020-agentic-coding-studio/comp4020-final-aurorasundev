import { Router } from "express";
import { clientAddress, windowCounter } from "../address.ts";
import type { DB } from "../db.ts";
import { log, person } from "../log.ts";
import { identityFor } from "../session.ts";
import { subscribeGallery } from "./events.ts";
import { readArtifactFile } from "./storage.ts";
import { ARTIFACT_REPORTS_PER_ADDRESS_HOUR, galleryPage, publishedArtifact, publishedScore, reportArtifact } from "./store.ts";
import { ARTIFACT_REPORT_REASONS } from "./types.ts";

// The public Gallery: config, pages, one object, its image, live changes and
// reports. Everything here reads published objects only; nothing reaches a
// paper, a job, a recipe or the artifact directory except a validated file of
// a currently published object.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OP_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const HOUR_MS = 60 * 60 * 1000;

export function galleryRouter(
  db: DB,
  artifactDir: string,
  generationEnabled: () => boolean,
  wake: () => void = () => {},
  // GALLERY_MUSIC_ENABLED, independent of generation: pausing image work
  // does not silence published scores, and turning music off serves none
  musicEnabled: () => boolean = () => false,
): Router {
  const router = Router();
  const perAddress = windowCounter(HOUR_MS, ARTIFACT_REPORTS_PER_ADDRESS_HOUR);

  router.get("/gallery/config", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ generation_enabled: generationEnabled(), music_enabled: musicEnabled() });
  });

  router.get("/gallery/events", (req, res) => {
    const leave = subscribeGallery(db, res, musicEnabled());
    req.on("close", leave);
  });

  router.get("/gallery", (req, res) => {
    res.set("Cache-Control", "no-store");
    const limit = req.query.limit === undefined ? 12 : Number(req.query.limit);
    const after = req.query.after;
    if (!Number.isInteger(limit) || limit < 1 || limit > 24 || (after !== undefined && (typeof after !== "string" || !UUID.test(after)))) {
      res.status(400).json({ code: "invalid_input", error: "That isn't a request this Gallery understands." });
      return;
    }
    res.json(galleryPage(db, limit, (after as string | undefined) ?? null, musicEnabled()));
  });

  router.get("/gallery/:id", (req, res) => {
    res.set("Cache-Control", "no-store");
    const found = UUID.test(req.params.id) ? publishedArtifact(db, req.params.id, musicEnabled()) : null;
    if (!found) {
      res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
      return;
    }
    const { file_key: _, ...artifact } = found;
    res.json(artifact);
  });

  // A published record's stored score, checked on every request: a hidden
  // record, a record without a valid score, or music switched off all answer
  // the same generic 404. Read-only; it never composes or starts anything.
  // (A score a visitor already downloaded can't be recalled.)
  router.get("/gallery/:id/score", (req, res) => {
    res.set("Cache-Control", "no-store");
    const found = UUID.test(req.params.id) ? publishedScore(db, req.params.id, musicEnabled()) : null;
    if (!found) {
      res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
      return;
    }
    // built field by field: the score's own allowlist, nothing else
    res.json({ artifact_id: found.artifact_id, artifact_version: found.artifact_version, score: found.score });
  });

  // Checked on every request: a hidden object's image stops being served at
  // once. (An image a visitor already downloaded can't be recalled.)
  router.get("/gallery/:id/image", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const found = UUID.test(req.params.id) ? publishedArtifact(db, req.params.id) : null;
    if (!found) {
      res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
      return;
    }
    try {
      const bytes = await readArtifactFile(artifactDir, found.file_key);
      // it may have been hidden while the file was being read
      if (!publishedArtifact(db, req.params.id)) {
        res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
        return;
      }
      res.set({ "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" }).send(bytes);
    } catch {
      log("gallery_image", { artifact: req.params.id, outcome: "unreadable" });
      res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
    }
  });

  router.post("/gallery/:id/reports", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    const artifactId = req.params.id;
    if (!identityId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    const { reason, op_key: opKey } = req.body ?? {};
    const extra = Object.keys(req.body ?? {}).filter((k) => k !== "reason" && k !== "op_key");
    if (
      !UUID.test(artifactId) ||
      typeof opKey !== "string" ||
      !OP_KEY.test(opKey) ||
      !(ARTIFACT_REPORT_REASONS as readonly unknown[]).includes(reason) ||
      extra.length > 0
    ) {
      res.status(400).json({ code: "invalid_report", error: "Choose a reason for the report." });
      return;
    }
    const address = clientAddress(req);
    // a retry of a report already received is never limited
    const known = db.prepare("SELECT 1 FROM artifact_reports WHERE reporter_identity_id = ? AND op_key = ?").get(identityId, opKey);
    if (!known && perAddress.blocked(address)) {
      log("gallery_report", { ...person(identityId), artifact: artifactId, outcome: "rate_limited" });
      res.status(429).json({ code: "rate_limited", error: "Too many reports for now. Try again later." });
      return;
    }
    const result = reportArtifact(db, artifactId, identityId, reason, opKey, Date.now());
    log("gallery_report", {
      ...person(identityId),
      artifact: artifactId,
      report: "reportId" in result ? result.reportId : undefined,
      outcome: result.kind,
    });
    if (result.kind === "missing") {
      res.status(404).json({ code: "artifact_gone", error: "This object is no longer here." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ code: "operation_conflict", error: "This report was already sent for something else." });
      return;
    }
    if (result.kind === "rate_limited") {
      res.status(429).json({ code: "rate_limited", error: "Too many reports for now. Try again later." });
      return;
    }
    if (result.kind === "created") {
      perAddress.hit(address);
      wake();
    }
    res.status(201).json({ report_id: result.reportId, status: "queued" });
  });

  return router;
}
