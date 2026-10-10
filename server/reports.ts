import { randomUUID } from "node:crypto";
import { Router } from "express";
import { clientAddress, windowCounter } from "./address.ts";
import { serverSecret, type DB } from "./db.ts";
import { log } from "./log.ts";
import { checkReceipt } from "./receipt.ts";
import { MAX_RUNS } from "./reviews.ts";
import { identityFor } from "./session.ts";

export const REPORT_REASONS = [
  "threats_abuse",
  "private_information",
  "sexual_graphic",
  "harmful_instructions",
  "spam_scam",
  "something_else",
] as const;
export const MAX_NOTE_CODE_POINTS = 500;
const NOTE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// anti-abuse starting points, not identity guarantees
export const REPORTS_PER_IDENTITY_HOUR = 5;
export const REPORTS_PER_ADDRESS_HOUR = 20;

type Existing = { id: string; paper_id: string; reason: string; note: string | null; note_expires_at: string };
type Enqueued = { kind: "created" | "existing"; reportId: string; reviewId: string } | { kind: "conflict" } | { kind: "gone" };

// Stores the report and opens (or joins) the paper's review in one commit.
// A report changes nothing about the paper: no status, no count, no event.
export function enqueueReport(
  db: DB,
  paperId: string,
  identityId: string,
  reason: string,
  note: string | null,
  opKey: string,
  now = Date.now(),
): Enqueued {
  return db.transaction((): Enqueued => {
    const byOp = db
      .prepare("SELECT id, paper_id, reason, note, note_expires_at FROM reports WHERE reporter_identity_id = ? AND op_key = ?")
      .get(identityId, opKey) as Existing | undefined;
    if (byOp) {
      const same = byOp.paper_id === paperId && byOp.reason === reason && (byOp.note === note || (byOp.note === null && Date.parse(byOp.note_expires_at) <= now));
      return same ? { kind: "existing", reportId: byOp.id, reviewId: "" } : { kind: "conflict" };
    }
    // one report per identity per paper: a second just gets the first's receipt
    const byPaper = db
      .prepare("SELECT id FROM reports WHERE reporter_identity_id = ? AND paper_id = ?")
      .get(identityId, paperId) as { id: string } | undefined;
    if (byPaper) return { kind: "existing", reportId: byPaper.id, reviewId: "" };

    const paper = db.prepare("SELECT status, request_digest FROM papers WHERE id = ?").get(paperId) as
      | { status: string; request_digest: string }
      | undefined;
    if (!paper || paper.status !== "ACTIVE") return { kind: "gone" };

    const t = new Date(now).toISOString();
    let review = db
      .prepare("SELECT id, state, runs FROM report_reviews WHERE paper_id = ? AND content_digest = ?")
      .get(paperId, paper.request_digest) as { id: string; state: string; runs: number } | undefined;
    if (!review) {
      review = { id: randomUUID(), state: "queued", runs: 0 };
      db.prepare(
        "INSERT INTO report_reviews (id, paper_id, content_digest, state, next_attempt_at, created_at) VALUES (?, ?, ?, 'queued', ?, ?)",
      ).run(review.id, paperId, paper.request_digest, t, t);
    } else if (review.state === "dismissed") {
      // new context after a dismissal is looked at again, up to a limit;
      // beyond it a person decides
      const next = review.runs >= MAX_RUNS ? "human_review" : "queued";
      db.prepare("UPDATE report_reviews SET state = ?, attempts = 0, next_attempt_at = ? WHERE id = ?").run(next, t, review.id);
    }
    // queued, retry_wait, running and human_review simply gain this report

    const id = randomUUID();
    db.prepare(
      `INSERT INTO reports (id, paper_id, review_id, reporter_identity_id, reason, note, op_key, created_at, note_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, paperId, review.id, identityId, reason, note, opKey, t, new Date(now + NOTE_RETENTION_MS).toISOString());
    return { kind: "created", reportId: id, reviewId: review.id };
  })();
}

export function reportsRouter(db: DB, onEnqueued: () => void): Router {
  const router = Router();
  const perAddress = windowCounter(HOUR_MS, REPORTS_PER_ADDRESS_HOUR);

  router.post("/papers/:id/report", (req, res) => {
    res.set("Cache-Control", "no-store");
    const identityId = identityFor(db, req);
    const paperId = req.params.id;
    if (!identityId) {
      res.status(401).json({ code: "unauthenticated", error: "Your session has expired. Reload the page and try again." });
      return;
    }
    const { reason, note: rawNote, operation_key: opKey } = req.body ?? {};
    const note = typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote : null;
    if (
      typeof opKey !== "string" ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(opKey) ||
      !(REPORT_REASONS as readonly unknown[]).includes(reason) ||
      (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") ||
      (note !== null && Array.from(note).length > MAX_NOTE_CODE_POINTS)
    ) {
      res.status(400).json({ code: "invalid_report", error: "Choose a reason, and keep any note under 500 characters." });
      return;
    }
    if (!checkReceipt(serverSecret(db, "read_receipt"), req.body?.read_receipt, paperId, identityId)) {
      log("report", { identity: identityId, paper: paperId, outcome: "forbidden" });
      res.status(403).json({ code: "forbidden", error: "Open the paper before reporting it." });
      return;
    }

    // Limits count only new reports: a retry of one already received is free.
    const known = db
      .prepare("SELECT 1 FROM reports WHERE reporter_identity_id = ? AND (op_key = ? OR paper_id = ?)")
      .get(identityId, opKey, paperId);
    const address = clientAddress(req);
    if (!known) {
      const recent = (
        db
          .prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_identity_id = ? AND created_at > ?")
          .get(identityId, new Date(Date.now() - HOUR_MS).toISOString()) as { n: number }
      ).n;
      if (recent >= REPORTS_PER_IDENTITY_HOUR || perAddress.blocked(address)) {
        log("report", { identity: identityId, paper: paperId, outcome: "rate_limited" });
        res.status(429).json({ code: "rate_limited", error: "Too many reports for now. Try again later." });
        return;
      }
    }

    const result = enqueueReport(db, paperId, identityId, reason, note, opKey);
    if (result.kind === "conflict") {
      log("report", { identity: identityId, paper: paperId, outcome: "operation_conflict" });
      res.status(409).json({ code: "operation_conflict", error: "This report was already sent for something else." });
      return;
    }
    if (result.kind === "gone") {
      log("report", { identity: identityId, paper: paperId, outcome: "paper_gone" });
      res.status(410).json({ code: "paper_gone", error: "This paper is no longer here." });
      return;
    }
    if (result.kind === "created") {
      perAddress.hit(address);
      onEnqueued();
    }
    log("report", { identity: identityId, paper: paperId, report: result.reportId, outcome: result.kind === "created" ? "queued" : "repeat" });
    res.status(202).json({ report_id: result.reportId, status: "queued" });
  });

  return router;
}
