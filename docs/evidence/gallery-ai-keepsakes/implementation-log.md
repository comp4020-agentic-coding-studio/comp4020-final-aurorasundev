# Gallery and AI keepsakes: implementation log

Factual checkpoint for resuming this feature. Plan:
[plans-gallery-ai.md](../../superpowers/plans/plans-gallery-ai.md); spec:
[design](../../superpowers/specs/2026-10-18-gallery-ai-keepsakes-design.md).

Started 2026-10-18 15:11 AEDT on branch `claude/gallery-ai-keepsakes` from
`08a7e9e`. The owner asked for periodic commits and pushes during the work;
they go to this feature branch, whose pushes run CI checks but do not deploy
(only `main` deploys).

## Task 0: baseline (done)

- Worktree clean apart from the untracked plan and spec.
- Fresh disposable DB, fixture moderation, `ARTIFACTS_ENABLED=0`, port 8121:
  `pnpm check` 16 files / **124 tests passed**; `pnpm check:evidence` passed.
- Screenshots of the current space, text write, drawing write and read at
  1366×768 and 390×844 in [baseline/](baseline/).

## Task 1: job and public-object model (done, 15:25)

- Migration 9 appends six tables (`artifact_jobs`, `artifacts`,
  `gallery_state`, `artifact_budgets`, `artifact_reports`,
  `artifact_admin_jobs`); migrations 1–8 and `requestDigest` are unchanged.
  No table has a column for words or a drawing. Per-address report limits
  reuse the existing in-memory window counter, so no address is stored.
- `server/artifacts/types.ts`, `server/artifacts/store.ts` (four guarded,
  synchronous store functions; neutral recipe from the job's random public id).
- `spec/fixtures/schema-v8.sqlite` captured with the shipped code at version 8
  (six papers, two identities, one burned Release, one quarantined Release,
  one author-burned Keep).
- `spec/artifact-migration.test.ts`: 9 passed, `tsc --noEmit` clean. Note: the
  tests were written alongside the implementation, not run red first.

## Task 2: jobs bound to the paper lifecycle (done, 15:33)

- `server/papers.ts`: a fresh insert calls `queueReleasePreparation`; a
  successful conditional burn update calls `queueDestroyedRelease` before the
  revision bump. `server/quarantine.ts` calls `cancelArtifactPreparation`
  after a successful transition. All inside the existing synchronous
  transactions; no network call. Request/response JSON unchanged; an extra
  `keepsake` field in a create body is ignored.
- `spec/artifact-lifecycle.test.ts`: ran red first (8 failed, 3 passed), then
  11 passed. Two Task 1 tests updated because a save now queues on its own.
- Full suite on a fresh local DB: **144 passed**.

## Task 3: providers and private storage (done, 15:44)

- `server/artifacts/provider.ts`: real OpenAI adapter (Responses with
  `store:false` and strict schemas for the recipe and the visual policy;
  Images API `/v1/images/generations` with n=1, 1024x1024, medium, webp,
  compression 80, opaque, moderation auto; no `response_format`/`style`),
  bounded body reads, WebP header validation, safe error codes with five
  kinds (transient, config, refusal, invalid, ambiguous). Inspection runs the
  existing moderation `check` unchanged with the image as `paper_image`, then
  the visual policy. Fixture provider refused on Fly regardless of the flag.
- `server/artifacts/storage.ts`: server-named UUID files, staging + fsync +
  rename + directory fsync, recovery, startup sweep, capacity checks.
- `spec/fixtures/artifacts/keepsake-1024.webp`: a real 1024x1024 WebP (4 KB)
  drawn locally for tests; never a production seed.
- `spec/artifact-provider.test.ts` + `spec/artifact-storage.test.ts`: 23 passed.
- Official docs checked 2026-10-18: the image-generation guide lists
  `gpt-image-2.5-*` models and confirms size/quality/output_format/
  output_compression/background/moderation/n and base64 output; it does not
  name `gpt-image-2`. The spec's `gpt-image-2` default is kept unchanged
  (no silent switch); **model access is unverified**.

## Task 4: Gallery HTTP/SSE, reports, private CLI (done, 16:02)

- `server/artifacts/router.ts`: config, page (limit 1–24, UUID keyset
  cursor), one object, image (published check before and after the file read,
  `image/webp`, `no-store`, `nosniff`), SSE, reports (session, six reasons,
  op key, no note; 5/identity/hour in SQLite, 20/address/hour through the
  existing in-memory window counter). Not yet mounted in `server/index.ts`
  (Task 5).
- `server/artifacts/events.ts`: separate subscriber set, snapshot of the first
  12 in the joining tick, 20 s heartbeat, 256 KiB cap, shutdown.
- `server/artifacts/store.ts`: allowlisted `publicArtifact`, `galleryPage`,
  lease-guarded `publishArtifact`, `hideArtifact`, `reportArtifact`,
  `enqueueAdminJob`, `applyArtifactAdminJobs` (hide/dismiss/retry).
- `scripts/artifacts.ts` + `pnpm artifacts:*`: reports, jobs, hide, dismiss,
  retry (refused without `--acknowledge-possible-charge`); prints "queued".
- `spec/gallery-harness.ts` mounts the real router on an ephemeral port over
  an in-memory DB with seeded records and canaries.
  `spec/gallery.test.ts` + `spec/gallery-realtime.test.ts`: 17 passed.

## Task 5: worker, wiring, Dockerfile (done, 16:31)

- `server/artifacts/worker.ts`: one non-overlapping loop (1 s poll; wakes
  coalesce). Each provider call is preceded by one transaction that leases
  the job (random token, 180 s) and reserves the UTC-day budget (20 recipes,
  10 images, 20 inspections). Order per pass: operator actions, discovery
  (batches of 20), inspection, recipe, image. Results are written only under
  the same lease; recipes only while the paper is still ACTIVE Release.
  Recipe: at most 2 attempts, 5 s apart. Image: explicit 429 retried once
  after max(30 s, Retry-After); timeout/transport/5xx/crash become
  `GENERATION_UNKNOWN`, never resent automatically. Inspection: at most 3
  runs (now, +5 s, +30 s); blocked/failed files removed. Startup recovery
  adopts a finalized file, marks an interrupted dispatch unknown and sweeps
  staging leftovers. Storage full defers image jobs with `storage_full` and a
  60 s recheck. Paused (`ARTIFACTS_ENABLED` not 1, or no provider): no
  provider calls, operator hides still applied.
- `server/index.ts`: Gallery API mounted before the `/api` 404; `/gallery`
  and `/gallery/` serve the built page; artifact worker started and stopped
  with the server; Gallery streams closed on shutdown. Wake on paper changes
  relies on the 1 s poll (no coupling into the paper module).
- `Dockerfile`: copies `scripts/artifacts.ts`; no key or flag set.
- `spec/artifact-worker.test.ts`: 20 passed (deferred provider, fake clock).
- End to end over real HTTP (fixture provider, local server): burn reply in
  5 ms; open Gallery stream received `artifact:published` 327 ms after the
  burn; image served as `image/webp`; no paper id or canary in any reply,
  event or server log line.
- Full suite on a fresh DB: **204 passed**.
- `docker build`: **not run locally** (Docker daemon not running; not started
  without the owner). The branch push runs the CI container build.

Next: Task 6 (client Gallery state).
