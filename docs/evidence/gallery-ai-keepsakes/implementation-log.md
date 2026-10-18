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

- CI: draft PR #1 opened so the container checks run on each push without
  deploying (the workflow deploys only `refs/heads/main`). First run on
  `ee77820`: **check passed** (container build, `pnpm check` against the
  container, secret scan); deploy skipped. This also covers the Docker
  build that could not run locally.

## Task 6: client Gallery state (done, 16:48)

- `src/lib/gallery-api.ts` (types mirrored, no server imports),
  `src/lib/gallery-state.ts` (pure reducer: snapshot replaces, deltas buffered
  during loads and replayed past the snapshot revision, version dedupe, hides
  remembered so a slower page/snapshot cannot restore them, server-cursor
  paging, 48-tile cap that never evicts the open object, open detail kept
  across a snapshot until revalidated), `src/lib/useGallery.ts` (one
  EventSource; fresh snapshot per connection; reconnect revalidates an open
  id outside the first page; report reason and op key frozen while unsettled).
- `spec/gallery-state.test.ts`: 10 passed (including 60 objects over 5 pages).

## Task 7: exhibition and separate entry (done, 17:12)

- `src/main.tsx` now lazy-loads one page by pathname (`/gallery`, `/gallery/`
  → `GalleryApp`; otherwise `App`). Built chunks: `GalleryApp` 11.5 KB,
  separate from `paper-scene` (733 KB) and `fire` (36 KB).
- `src/GalleryApp.tsx`, `src/components/ArtifactDialog.tsx`: title, the
  spec's intro, empty/paused/loading/failure copy, tiles with explicit size,
  lazy loading and async decoding, native dialog focused on itself (not the
  cross), Escape and backdrop close, focus returned to the opening tile,
  report form with the six reasons and no note.
- `server/index.ts` serves `/gallery` and `/gallery/` from the built
  `index.html` **with the space's two `/vat/` preloads removed**: without
  that, the Gallery still downloaded the 1.25 MB model and 1.75 MB texture
  (found in the browser network log, then fixed).
- `src/styles/app.css`: rules appended, all scoped to `.gallery-*` /
  `.artifact-*` (plus one phone rule under `.gallery-header`); no existing
  rule changed.
- Browser checks on the built app (fixture objects published through the
  real save → witness → burn flow): columns 3/3/3/1 at 1920×1080, 1366×768,
  1280×720, 390×844; no horizontal overflow; **no** model, texture, scene,
  Three/cannon or fire request on the Gallery; dialog takes focus, Escape
  returns focus to the tile. The space still loads its scene and model and
  never the Gallery chunk. Screenshots in [gallery/](gallery/). The tiles look
  alike because every fixture object uses the one test image.
- `spec/gallery-ui.test.ts`: 10 passed. Fixed during it: closing a detail
  reset an unsettled report; now only opening another object does.
- Full suite on a fresh DB: **224 passed**.

## Task 8: Release copy and Gallery navigation (done, 17:31)

- `WriteDialog.tsx`: only Release's supporting text changed, to the spec's
  exact copy. Same two radios, same single I understand checkbox, same
  `createPaper(text, drawing, mode, key)` call and frozen retry.
- `Header.tsx`: new `canVisitGallery` prop (separate from `busy`), shown as a
  Gallery link between Return key and About; `App.tsx` passes
  `mode.kind === "space"`. No ritual or reading shortcut to the Gallery.
- `README.md`: the spec's qualification sentence plus a short factual note,
  added to the existing safety section (no new heading).
- `spec/gallery-consent-ui.test.ts`: 4 passed; with moderation UI, drawing and
  ritual suites: 26 passed.
- Browser, built app: Release copy wraps cleanly at 1280×720 (whole form
  fits), 1366×768 and 390×844 (scrolls inside the dialog as before; submit
  reachable, 44 px; textarea 16–19 px; hints 14–15 px as before; no
  overflow). Gallery link present in the idle space and absent while
  writing. Phone header stacks About / Return key / Gallery under the
  existing ordering rule. Screenshots in [write/](write/).
- Open: header links on phone are 18 px tall, below 44 px; this is the
  existing header's size for About and Return key, left unchanged.

Next: Task 9 (ADR, runbook, docs, final verification).
