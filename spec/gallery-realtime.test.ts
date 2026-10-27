import { afterEach, describe, expect, it } from "vitest";
import { broadcastGallery, closeGalleryStreams, gallerySubscriberCount } from "../server/artifacts/events.ts";
import { applyArtifactAdminJobs, enqueueAdminJob, publishArtifact } from "../server/artifacts/store.ts";
import { CANARY, gallery, sseEvents, type Harness } from "./gallery-harness.ts";

// The Gallery's live channel: a snapshot, then post-commit changes; never a
// paper event, never a source.

let h: Harness;
afterEach(async () => {
  closeGalleryStreams();
  await h?.close();
});

describe("the Gallery stream", () => {
  it("opens with a snapshot of the first page and the revision", async () => {
    h = await gallery();
    for (let i = 0; i < 14; i++) h.seed();
    const [first] = await sseEvents(`${h.base}/api/gallery/events`, 1);
    expect(first.event).toBe("gallery:snapshot");
    expect(Object.keys(first.data).sort()).toEqual(["items", "next_cursor", "revision", "total"]);
    expect((first.data.items as unknown[]).length).toBe(12);
    expect(first.data.total).toBe(14);
    expect(JSON.stringify(first)).not.toContain(CANARY.text);
  });

  it("sends a hide after it commits, once, to every open Gallery", async () => {
    h = await gallery();
    const shown = h.seed();
    const hide = () => {
      enqueueAdminJob(h.db, "hide", shown.id, "reported", Date.now());
      enqueueAdminJob(h.db, "hide", shown.id, "reported", Date.now());
      for (const change of applyArtifactAdminJobs(h.db, Date.now()).changes) broadcastGallery(change);
    };
    let opened = 0;
    const whenBothOpen = () => {
      if (++opened === 2) hide();
    };
    const [a, b] = await Promise.all([
      sseEvents(`${h.base}/api/gallery/events`, 3, 1500, whenBothOpen),
      sseEvents(`${h.base}/api/gallery/events`, 3, 1500, whenBothOpen),
    ]);
    for (const events of [a, b]) {
      expect(events.map((e) => e.event)).toEqual(["gallery:snapshot", "artifact:hidden"]);
      expect(events[1].data).toEqual({ revision: 1, total: 0, id: shown.id, version: 2 });
    }
  });

  it("sends a publication with only the public object", async () => {
    h = await gallery();
    // a job under review with its file, as the worker leaves it
    const seeded = h.seed();
    h.db.prepare("DELETE FROM artifacts WHERE id = ?").run(seeded.id);
    h.db.prepare("UPDATE artifact_jobs SET state = 'REVIEWING', lease_token = 'lease', lease_until = ? WHERE id = ?").run(Date.now() + 60_000, seeded.jobId);
    const events = await sseEvents(`${h.base}/api/gallery/events`, 2, 1500, () => {
      const change = publishArtifact(h.db, seeded.jobId, "lease", Date.now(), { title: "Knot in clay", alt: "An abstract object." });
      if (change) broadcastGallery(change);
    });
    expect(events.map((e) => e.event)).toEqual(["gallery:snapshot", "artifact:published"]);
    const { artifact, total, revision } = events[1].data as { artifact: Record<string, unknown>; total: number; revision: number };
    expect([total, revision]).toEqual([1, 1]);
    // just published: arrived recently, as a yes and never a time
    expect(Object.keys(artifact).sort()).toEqual(["alt", "height", "id", "image_url", "recent", "title", "version", "width"]);
    expect(artifact.recent).toBe(true);
    expect(JSON.stringify(events)).not.toContain(seeded.paperId);
    expect(JSON.stringify(events)).not.toContain(seeded.jobId);
  });

  it("can't publish with a stale lease, twice, or over a hide", async () => {
    h = await gallery();
    const seeded = h.seed();
    h.db.prepare("DELETE FROM artifacts WHERE id = ?").run(seeded.id);
    h.db.prepare("UPDATE artifact_jobs SET state = 'REVIEWING', lease_token = 'lease', lease_until = ? WHERE id = ?").run(Date.now() + 60_000, seeded.jobId);
    const labels = { title: "t", alt: "a" };
    expect(publishArtifact(h.db, seeded.jobId, "other-lease", Date.now(), labels)).toBeNull();
    expect(publishArtifact(h.db, seeded.jobId, "lease", Date.now(), labels)?.type).toBe("artifact:published");
    expect(publishArtifact(h.db, seeded.jobId, "lease", Date.now(), labels)).toBeNull();
    enqueueAdminJob(h.db, "hide", seeded.id, "reported", Date.now());
    applyArtifactAdminJobs(h.db, Date.now());
    // a late attempt finds the job already published and the object hidden
    h.db.prepare("UPDATE artifact_jobs SET state = 'REVIEWING', lease_token = 'again', lease_until = ? WHERE id = ?").run(Date.now() + 60_000, seeded.jobId);
    expect(publishArtifact(h.db, seeded.jobId, "again", Date.now(), labels)).toBeNull();
    expect((h.db.prepare("SELECT status FROM artifacts WHERE id = ?").get(seeded.id) as { status: string }).status).toBe("HIDDEN");
    // an expired lease can't publish either
    const expired = h.seed();
    h.db.prepare("DELETE FROM artifacts WHERE id = ?").run(expired.id);
    h.db.prepare("UPDATE artifact_jobs SET state = 'REVIEWING', lease_token = 'old', lease_until = ? WHERE id = ?").run(Date.now() - 1, expired.jobId);
    expect(publishArtifact(h.db, expired.jobId, "old", Date.now(), labels)).toBeNull();
  });

  it("closes every stream on shutdown", async () => {
    h = await gallery();
    const pending = sseEvents(`${h.base}/api/gallery/events`, 5, 1500, () => {
      expect(gallerySubscriberCount()).toBe(1);
      closeGalleryStreams();
    });
    const events = await pending;
    expect(events.map((e) => e.event)).toEqual(["gallery:snapshot"]);
    expect(gallerySubscriberCount()).toBe(0);
  });
});
