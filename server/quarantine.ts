import { activeTotal, bumpRevision, type DB } from "./db.ts";
import { broadcast } from "./events.ts";
import { log } from "./log.ts";

export type Quarantined = { changed: boolean; version?: number; revision?: number; total?: number };

// The one way a paper leaves for safety reasons, used by automated review and
// by an operator's decision alike. One conditional transition out of ACTIVE,
// with the text cleared in the same commit, so it races destruction safely:
// whichever commits first wins and the total drops once. Terminal in this
// MVP: no restore, no hidden copy for appeals.
export function quarantinePaper(db: DB, paperId: string, reason: string, source: "automated" | "operator"): Quarantined {
  const result = db.transaction((): Quarantined => {
    const row = db
      .prepare(
        `UPDATE papers SET status = 'QUARANTINED', content = '', version = version + 1, ended_at = ?, end_reason = ?
         WHERE id = ? AND status = 'ACTIVE' RETURNING version`,
      )
      .get(new Date().toISOString(), reason, paperId) as { version: number } | undefined;
    if (!row) return { changed: false };
    db.prepare(
      `UPDATE report_reviews SET state = 'quarantined', lease_until = NULL, reviewed_at = COALESCE(reviewed_at, ?)
       WHERE paper_id = ? AND state NOT IN ('quarantined', 'dismissed', 'obsolete')`,
    ).run(new Date().toISOString(), paperId);
    const revision = bumpRevision(db);
    return { changed: true, version: row.version, revision, total: activeTotal(db) };
  })();
  log("quarantine", { paper: paperId, source, reason, outcome: result.changed ? "quarantined" : "not_active", revision: result.revision });
  // after commit; no text, no reporter, no reason in the public event
  if (result.changed) {
    broadcast("paper:quarantined", { id: paperId, version: result.version, revision: result.revision, active_total: result.total });
  }
  return result;
}
