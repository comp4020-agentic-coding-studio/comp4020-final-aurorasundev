# Throwaway Gallery and AI Keepsakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended by that workflow) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For this handoff, use **one continuous native Claude session** with executing-plans; do not spawn parallel agents merely to fill time. If those skills are unavailable in Claude, follow this checklist directly.

**Goal:** Build an anonymous public Gallery: choosing the existing Release mode automatically makes a successfully burned paper produce a safety-checked AI keepsake; Keep never does.

**Architecture:** Prepare a finite visual recipe while a Release paper is ACTIVE. The existing burn transaction immediately clears its words/drawing and queues a recipe-only image job; a serial SQLite-backed worker generates, inspects and publishes an independent image. A separate Gallery page uses HTTP and its own SSE channel without loading the Three.js room.

**Tech Stack:** Existing Node 24.21.0, pnpm 11.9.0, React 19, Vite, TypeScript, Express 5, better-sqlite3, native fetch/EventSource/dialog, Vitest and local browser testing. OpenAI Responses for constrained recipes/inspection, Images API for 1024×1024 WebP; persistent local files on the existing Fly volume. Add no runtime dependency unless a demonstrated requirement cannot be met with the existing stack.

**Spec:** [Product decisions, exact copy, limits and contracts](../specs/2026-10-18-gallery-ai-keepsakes-design.md). Read both documents. This spec supersedes the old Gallery exclusion in CLAUDE.md only for the explicitly requested Gallery/keepsake extension. It is not authorization to redesign the paper scene.

## Global Constraints

- **No new Gallery opt-in checkbox, consent field, optional disclosure panel or second confirmation.** Existing immutable `papers.mode === 'RELEASE'` is the sole eligibility rule. Put the explanation in the existing Release description.
- Every successful Release destruction creates exactly one durable image job, even if AI processing is paused or capped. Existing ACTIVE Release papers qualify; previously ended papers and all Keep papers do not.
- Preserve submission bodies/digests, frozen submission retries, deliberate witnessing, burn rights, operation keys, immediate clearing, final reading, quarantine precedence and the existing paper SSE contract.
- Never retain original text/drawings in artifact jobs, new tables, files, prompts for post-burn generation, errors or logs. `store:false` is not a promise of zero retention by an external provider; document that processing accurately.
- Public objects expose only the allowlisted DTO. No original body, source ID, owner, source timestamp, raw recipe, prompt, personal archive or paper recovery link.
- `ARTIFACTS_ENABLED=0` by default. Local/CI fixtures never call paid services and must be refused on Fly. Do not inspect or print mise.local.toml, keys, cookies, return keys or provider error bodies.
- Respect exact model, budget, timeout and storage limits in the spec. Do not silently switch providers/models, weaken safety, drop queued Release jobs or publish fixture output in production.
- Keep Node direct type stripping and `erasableSyntaxOnly`; append migration 9, never rewrite shipped migrations 1–8. No React Router, Redis, Supabase, extra Fly machine or infrastructure change.
- Preserve the current header/count placement, drawings, paper material, furnace, physics and camera. No likes, comments, profiles, feed, search, ranking, personal history or generated 3D models.
- All tests use a disposable local database and artifact directory. **Never point APP_URL at the live Fly app.** No production migration, main push, deployment, secret change or paid image call in this implementation run.
- Keep unrelated work and the user's reflections untouched. Small feature-scoped commits are permitted in the future Claude implementation; this planning task does not make those commits.

## Review Focus

1. A Keep author burns a paper, versus anyone authorized burning a Release paper: zero Keep jobs; exactly one Release job with no new UI option. Prove in Tasks 1, 2 and 8.
2. Two burners, an HTTP reply lost after commit, or a retry after restart: one destruction, one job and one public object. Prove in Tasks 2 and 5.
3. A recipe response arrives after burning/quarantine: original data stays cleared; the late lease cannot persist source-derived work or undo cancellation. Prove in Tasks 2, 3 and 5.
4. An image request times out or the process dies after dispatch: no automatic second paid request; a finalized file recovers without regeneration. Prove in Tasks 3 and 5.
5. An operator hides a currently opened image while another client paginates/reconnects: grid/detail clear, image URL stops serving, no source data or stale event restores it. Prove in Tasks 4, 6 and 9.

---

## Continuous execution contract for Claude

This is a complete feature, approximately **3–5 hours**, not a one-hour cosmetic patch. Aim for at least **60 minutes of useful uninterrupted implementation**, then continue until the deliverables and checks are complete. A plan cannot guarantee a tool session's duration or available permissions.

- Record the actual start time. Work through Tasks 0–9 in order; do not stop after scaffolding, a demo screenshot, the first green test or one phase.
- After each task, update its checkboxes and `docs/evidence/gallery-ai-keepsakes/implementation-log.md`: actual elapsed time, changed files, exact verification result and next unchecked step. Keep progress factual, not a reflection written in the owner's voice.
- Resume from that checkpoint after context compaction. Do not restart finished work or rerun unchanged passing checks to consume time.
- Missing API access is expected: implement the real adapter against recorded/mocked response shapes and use the explicit fixture provider locally. Mark real provider access/quality **unverified** and continue all independent work.
- A missing browser tool or Docker daemon blocks that specific check, not the whole feature. Record the limitation and continue tests, review and remaining documentation.
- Use the existing approved permission mechanism for required local operations. Never change global permission settings or use a permission-bypass flag to manufacture an unattended run.
- Do not sleep to reach an hour. If all scoped work finishes sooner, perform the remaining restart, quota, reconnect, keyboard and viewport checks below; report actual time honestly if all real work is exhausted.
- Final status must distinguish `LOCAL_VERIFIED_PROVIDER_UNVERIFIED`, fully verified local work with separately authorized real-provider evidence, and an actual named blocker. Do not claim a deployment.

## Files and ownership boundaries

| File | Responsibility |
| --- | --- |
| `server/db.ts` | Append migration 9 and indexes; preserve prior schema/data/digests |
| `server/artifacts/types.ts` (new) | Recipe, job states, public DTOs, event/config types |
| `server/artifacts/store.ts` (new) | Eligibility, durable transitions/leases/budgets, publication, reports and private decisions |
| `server/artifacts/provider.ts` (new) | Real OpenAI adapter, strict validation, safe error classification, fixture adapter |
| `server/artifacts/storage.ts` (new) | Bounded WebP validation, capacity, atomic files and recovery |
| `server/artifacts/events.ts` (new) | Separate Gallery subscribers, snapshots, post-commit broadcasts and shutdown |
| `server/artifacts/router.ts` (new) | Public Gallery/config/image/report routes |
| `server/artifacts/worker.ts` (new) | One durable serial preparation/render/inspection/maintenance loop |
| `server/papers.ts`, `server/quarantine.ts` | Small synchronous calls inside existing lifecycle transactions |
| `server/index.ts` | Routes before API fallthrough, worker startup/shutdown, built `/gallery/` fallback |
| `scripts/artifacts.ts` (new), `package.json`, `Dockerfile` | Private report/removal/retry CLI and shipping it in the image |
| `src/lib/gallery-api.ts`, `src/lib/useGallery.ts` (new) | Typed HTTP calls, isolated live collection/recovery state |
| `src/GalleryApp.tsx`, `src/components/ArtifactDialog.tsx` (new) | Exhibition, empty/error states, detail/report dialog |
| `src/main.tsx`, `src/App.tsx`, `src/components/Header.tsx` | Two-page lazy entry and safe navigation, preserving existing space behavior |
| `src/components/WriteDialog.tsx`, `src/styles/app.css` | Release explanation and scoped responsive Gallery styling |
| `spec/artifact-*.test.ts`, `spec/gallery*.test.ts` (new) | Meaningful migration, lifecycle, adapter, recovery, HTTP and UI tests |
| `docs/adr/005-release-keepsakes.md`, `docs/artifacts-runbook.md` (new) | Decisions, costs, operator commands, provider activation and rollback |
| `docs/evidence/gallery-ai-keepsakes/` (new) | Local screenshots, verification record and resumable checkpoint |
| `README.md`, `CLAUDE.md`, `PROCESS.md` | Minimal factual rules/evidence updates, preserving the owner's existing prose |

All new source paths above are planned files, not claims that these modules already exist. Do not split every helper into its own file or refactor adjacent paper code.

## Local verification setup

Use the existing running-app harness. Before changes, establish a fresh baseline; after changes, use the same commands with artifact fixtures enabled. Choose an unused local port if 8080 is occupied; do not stop an unrelated server. The Vite proxy assumes 8080, so browser QA can use the built app on the chosen backend port.

Create a private temporary directory outside the repo, then build. In one terminal, run the backend with `OPENAI_API_KEY` unset, `MODERATION_PROVIDER=fixture`, `DATABASE_PATH=<temp>/throwaway.sqlite`, `PORT=<local-port>`, `ARTIFACT_DIR=<temp>/artifacts`. Use `ARTIFACTS_ENABLED=0` for the baseline. After the artifact provider is implemented, set `ARTIFACT_PROVIDER=fixture ARTIFACTS_ENABLED=1` for feature QA. The test process uses `APP_URL=http://127.0.0.1:<local-port>`.

Commands: `pnpm build`, `APP_URL=<local-url> pnpm check`, `pnpm check:evidence`. Targeted examples below use `pnpm exec vitest run spec/<file>.test.ts`; they also need APP_URL set because global setup checks a running app. Measure the current count; do not copy the old reported 115 tests.

After rebuilding assets, restart the server before browser QA: it caches compressed assets at startup. Use fresh disposable data for the final full suite. Use fake time/deferred providers for timeout tests rather than waiting real minutes or days. Do not add paid calls to CI.

### Task 0: Establish the actual baseline and checkpoint

**Files:** Read the current app, schema, moderation/review worker, reports/events, tests, Dockerfile and this spec; create only the evidence checkpoint initially.

**Consumes:** Current checkout, currently inspected source baseline `08a7e9e` (recheck it).
**Produces:** Recorded starting commit/status, measured checks, screenshots and a safe local test environment.

- [ ] Record branch, HEAD and dirty paths. Read applicable AGENTS.md and CLAUDE.md; preserve unrelated changes. Use an isolated feature branch/worktree under the available project workflow; name a new branch `claude/gallery-ai-keepsakes` only if it does not already contain unrelated work. If the worktree starts from Git HEAD, copy these two currently untracked planning documents into the same relative paths there; do not copy credentials or unrelated files.
- [ ] Run the local baseline build/check with fixtures and a fresh DB; record actual results. If pre-existing failures occur, identify them and continue independent feature work without reporting the baseline as green.
- [ ] Capture current `/`, text-write, drawing-write and read at 1366×768 and 390×844. These establish the current layout; old reference images guide materials only.
- [ ] Create the resumable implementation log with start time, baseline and next task. Do not invent screenshots or a new planning commit merely to fill a task.

### Task 1: Add the private job/public object model

**Files:** Modify `server/db.ts`; create `server/artifacts/types.ts`, `server/artifacts/store.ts`, `spec/artifact-migration.test.ts`.

**Consumes:** Existing `DB`, immutable mode and version-8 schema.
**Produces:** Migration 9; exact shared types below; guarded store functions used by later tasks.

`Recipe` has exactly `motif`, `material`, `palette`, `gesture` with the enum sets in the spec. `PublicArtifact` and `GalleryPage` use the spec's exact field names. `GalleryChange` is either `{type:'artifact:published', revision, total, artifact:PublicArtifact}` or `{type:'artifact:hidden', revision, total, id, version}`. Types containing Node Buffer never become client runtime imports.

Store exports: `queueReleasePreparation(db, paperId, nowMs): boolean`, `queueDestroyedRelease(db, paperId, nowMs): boolean`, `cancelArtifactPreparation(db, paperId, nowMs): void`, `discoverReleasePreparation(db, nowMs, limit=20): number`. They perform no network calls and can run inside the caller's transaction. Each rechecks the required paper mode/status; uniqueness is enforced by SQLite, not only JavaScript.

- [ ] Add migration tests: reopening a real version-8 fixture preserves every existing paper/identity and exact `request_digest`; migration reruns do nothing. Capture the old migration result before implementation rather than setting user_version=8 on an empty/current schema.
- [ ] Add tests `release_mode_is_the_only_eligibility`, `existing_active_release_is_discovered`, `ended_papers_are_not_backfilled`, and `one_job_per_paper`. Assert both Keep and ended rows are excluded and no `keepsake_opt_in` column/request flag exists.
- [ ] Run `spec/artifact-migration.test.ts` and confirm these tests fail for the missing feature.
- [ ] Append the six tables and indexes in the spec. Enforce job/public-ID uniqueness, report uniqueness and allowed states. Do not add source body/drawing columns. Keep existing digest code unchanged.
- [ ] Implement the four guarded store exports. Bounded discovery queues metadata for ACTIVE Release rows only; successful burn uses the independent random public UUID for a finite neutral recipe when no prepared one exists. Cancellation invalidates any preparation lease.
- [ ] Run the new migration tests plus `pnpm typecheck`. Record results and commit only these files: `feat: add durable release keepsake records`.

### Task 2: Bind jobs to real paper transitions

**Files:** Modify `server/papers.ts`, `server/quarantine.ts`; extend `server/artifacts/store.ts`; create `spec/artifact-lifecycle.test.ts`.

**Consumes:** Task 1 store helpers and existing create/burn/quarantine transactions.
**Produces:** Atomic Release preparation/queueing and quarantine cancellation with unchanged paper HTTP contracts.

- [ ] Write failing tests for: Release save queues metadata; Keep save does not; a Keep author burn never queues an image; Release burn without prior discovery creates one job. Test text, drawing-only and combined papers.
- [ ] Add `lost_burn_response_reuses_one_job`, `two_authorized_burners_create_one_job`, `quarantine_cancels_without_image_job` and `mode_change_under_submission_key_remains_409`. Assert paper total drops once and originals are empty/NULL in the same committed state as the job transition.
- [ ] Run the lifecycle tests and observe missing hooks. Then call preparation only for a fresh allowed Release insertion, queueing only after a successful conditional burn update, and cancellation only after successful quarantine. All calls remain inside their existing synchronous transactions.
- [ ] Preserve `createPaper`, `validateSubmission`, `requestDigest`, frontend `createPaper` arguments, burn receipts and request/response JSON. Ignore or reject a supplied artifact override according to current extra-field policy; it must never change mode-derived eligibility.
- [ ] Verify no external call appears in these transactions and no artifact fields leak into `/api/papers`, `/api/events` or a create/burn receipt. Run lifecycle, burn, invariants and drawing suites. Commit `feat: queue keepsakes automatically for burned release papers`.

### Task 3: Implement bounded real and fixture providers and private files

**Files:** Create `server/artifacts/provider.ts`, `server/artifacts/storage.ts`, `spec/artifact-provider.test.ts`, `spec/artifact-storage.test.ts`; add a clearly named offline WebP fixture under `spec/fixtures/artifacts/` if needed.

**Consumes:** Recipe enums and existing `check`/real moderation provider. Existing moderation `Payload` accepts `{paper_text, paper_image, report_reason, report_note}`; pass the generated WebP as `paper_image`, with empty text and null report fields.
**Produces:** `ArtifactProvider` with `prepareRecipe(source:{text:string,drawing:string|null}, signal):Promise<Recipe>`, `generateImage(recipe, signal):Promise<{bytes:Buffer,width:1024,height:1024}>`, `inspectImage(image, signal):Promise<'allow'|'blocked'>`; safe typed errors classify transient, configuration, refusal, invalid output and ambiguous generation. `artifactProviderFromEnv(env, fetchImpl?)` returns a real/fixture provider or null without exposing secrets.

Storage exports: `checkArtifactCapacity(db, dir):Promise<boolean>`, `saveArtifactFile(dir, publicId, bytes):Promise<string>`, `readArtifactFile(dir, fileKey):Promise<Buffer>`, `removeArtifactFile(dir, fileKey):Promise<void>`, `recoverArtifactFile(dir, publicId):Promise<string|null>`. Filenames are server-created UUID `.webp` values, never arbitrary paths.

- [ ] Write failing adapter tests for exact recipe schema, unknown keys, free-text injection, refusal, incomplete Responses output, image request parameters and omitted legacy parameters. Assert generation receives only server-owned phrases plus enums, including after source removal.
- [ ] Write network stubs for 401/403, explicit 429, malformed/oversized base64, timeout after dispatch and ambiguous 5xx. Assert safe error codes only; no raw response body or source marker in logs. Preserve the distinction between an unknown image result and a safely retryable pre-generation failure.
- [ ] Implement native fetch with the spec's models/timeouts, Responses `store:false` and Images API `n=1`, 1024×1024, medium, WebP, compression 80, opaque, moderation auto. Verify current official API parameters before coding; no account access is implied by the docs.
- [ ] Use existing real harmful-content checks, followed by a separate strict visual inspection rejecting legible text, faces, identifiable places or uncertainty. Blocked/uncertain results never publish. Keep the core paper-moderation prompt unchanged; do not add a fake automatic allow when a provider is missing.
- [ ] Implement fixtures that deterministically prepare, generate, reject or fail through injected responses; produce a valid 1024×1024 WebP, not an invalid header-only placeholder. Refuse `ARTIFACT_PROVIDER=fixture` when FLY_APP_NAME is set, even when ARTIFACTS_ENABLED=0. Store fixture art in test assets, never production seeds.
- [ ] Test storage caps: 2 MiB decoded file, 250 MiB managed bytes including staging, 200 public objects, 64 MiB minimum free disk. Validate expected dimensions and WebP chunk bounds; reject animated/unexpected formats and traversal. Use bounded reads; do not fetch model-returned URLs or use unrestricted static serving.
- [ ] Implement atomic same-directory temp write, fsync and rename. An existing finalized file is reusable after validation; stale partial files cannot become public. Ensure temp cleanup cannot delete an unrelated file.
- [ ] Run adapter/storage tests and typecheck. Commit `feat: add inspected image provider and private artifact storage`. Record real provider access and visual quality as unverified unless separately authorized and tested.

### Task 4: Build the Gallery HTTP/SSE and private reporting surface

**Files:** Create `server/artifacts/router.ts`, `server/artifacts/events.ts`, `scripts/artifacts.ts`, `spec/gallery.test.ts`, `spec/gallery-realtime.test.ts`; extend `server/artifacts/store.ts`; add package CLI scripts.

**Consumes:** Task 1 DTOs, Task 3 safe file reads and current anonymous-session/address/report conventions.
**Produces:** `galleryRouter(db, artifactDir, wake:()=>void):Router`, `broadcastGallery(change:GalleryChange):void`, `closeGalleryStreams():void`; `publishArtifact(db, jobId, leaseToken, nowMs):GalleryChange|null` and `applyArtifactAdminJobs(db, nowMs):{changes:GalleryChange[],filesToDelete:string[]}`. Router routes are relative to `/api` and exactly match spec §5.

- [ ] Write HTTP tests against a mounted local router and seeded *private fixture records*: config/list/detail/image/report status codes, limit validation 1–24, malformed UUID/cursor 400, hidden/missing 404, keyset pagination and exact DTO allowlists. Use canary source strings/IDs and assert they never appear in JSON or SSE.
- [ ] Test image permission gating on every new request, `Content-Type:image/webp`, `Cache-Control:no-store`, traversal rejection and no public path to the artifact directory. Do not promise to recall an image a visitor already downloaded.
- [ ] Add report tests: anonymous session required, six existing reason enums, no free-text note, identical op-key retry returns the same receipt, changed payload/key target conflicts, one report per identity/object, 5 reports/identity/hour and 20/address/hour. Reuse existing address hashing/trust behavior, not a new raw-IP store. Report creation alone changes no visibility, Gallery revision or paper total.
- [ ] Implement Gallery reports as a private operator review queue in this version. No report-count auto-hide or promise of instantaneous human review. CLI `reports` lists safe IDs/reasons; `hide <id> --reason <code>` and `dismiss <report-id>` enqueue maintenance. Hide resolves associated reports; dismiss only resolves that report. Preserve operation idempotency.
- [ ] Implement SSE `gallery:snapshot` plus `artifact:published`/`artifact:hidden`, independent revision, first-page payload and post-commit emission. Register subscriber and read its initial snapshot in the same synchronous tick. Use 20-second heartbeat and 256 KiB pending-output cap; no compression, cache or paper events.
- [ ] Test `hide_open_artifact_blocks_future_image_reads`: committed hide increments object version and Gallery revision once, changes no paper revision/count, sends one live hide; unlink follows state protection. Multiple hide commands are harmless. A concurrent publication cannot restore a hidden object.
- [ ] Add private CLI `retry <job-id> --acknowledge-possible-charge` for GENERATION_UNKNOWN only; without the flag refuse the action. Commands enqueue actions and print **queued**, not **applied**. No public admin or regenerate HTTP endpoint.
- [ ] Run Gallery HTTP/SSE tests and typecheck. Commit `feat: expose anonymous gallery and private artifact review`.

### Task 5: Connect the durable serial worker and recover safely

**Files:** Create `server/artifacts/worker.ts`, `spec/artifact-worker.test.ts`; extend store/CLI as needed; modify `server/index.ts`, `Dockerfile`.

**Consumes:** Provider/storage, eligible jobs, guarded publication, Gallery broadcasting and queued operator decisions.
**Produces:** `createArtifactWorker(db, provider, options):{wake():Promise<void>,stop():Promise<void>}`. Required options include `artifactDir`, `enabled`, `onChange:(change:GalleryChange)=>void`; inject `now`, fetch/provider and scheduling delays for deterministic tests. Keep production constants as specified, not an open-ended configuration framework.

- [ ] Write failing happy-path test `release_to_private_file_to_inspected_public_object`: prepare while ACTIVE, burn/purge, generate from recipe only, inspect, publish one object and emit only after commit. Repeat with immediate burn and a neutral recipe. Include normal and drawing-only sources.
- [ ] Add deferred-provider tests `late_recipe_cannot_overwrite_burn_fallback` and `late_recipe_after_quarantine_is_discarded`. On each completion, compare state, lease token and eligible paper state in a transaction. Keep source reads inside the pre-burn preparation step; never reread a destroyed body for retries.
- [ ] Implement one non-overlapping loop with a 1,000 ms due poll, bounded discovery batches of 20 and 180-second random-token leases. Prioritize operator actions and inspection. A concurrent wake only schedules work, never a second runner; requests never wait for model generation.
- [ ] Reserve UTC budgets transactionally before dispatch: 20 recipes, 10 images, 20 inspection runs/day. Reserve failures count; time advancing to next UTC day releases deferred work. Exhausted budget/storage leaves all eligible jobs queued with safe reasons, deferring capacity checks for 60 seconds, not silently discarded. A paused worker still applies operator hides/dismissals but dispatches no artifact-provider calls; existing private files wait for inspection.
- [ ] Implement recipe maximum two attempts with five-second retry while ACTIVE; otherwise retain the finite neutral fallback for burn. For images, honor the spec's one explicit-429 retry and mark ambiguous timeout/transport/crash/5xx GENERATION_UNKNOWN, with no automatic second image call. Track dispatch durably before calling the provider.
- [ ] Prove `crash_after_dispatch_does_not_regenerate`, `finalized_file_resumes_inspection`, `expired_lease_result_cannot_publish` and `lost_burn_reply_does_not_duplicate_object`. Recovery of a finalized file must match the job's independent UUID. New processes never run against the same disposable DB concurrently during this test.
- [ ] Implement at most three inspection runs in total: first immediately, second after 5 seconds, third after 30 seconds. A terminal blocked/failed image remains unavailable and its file is removed. Never regenerate merely because inspection failed.
- [ ] Apply queued private commands even with generation paused. Hide first protects DB visibility and emits; then unlink. Shutdown stops pollers, aborts provider requests, drains safe completion and closes both SSE groups before DB close. Test a pending provider request cannot later write to a closed DB.
- [ ] Wire routes before `/api` fallthrough and wake worker at startup/after paper changes. Use a small callback or periodic polling rather than coupling the core paper module to provider logic. Fixture intervals may be shorter only under explicit test configuration.
- [ ] Update Dockerfile to copy the private artifact CLI; `server/` is already copied recursively. Set no production key or enabled flag in the image. Run worker tests, typecheck and `docker build` with the existing project workflow when available; document a missing daemon rather than claiming the image passed.
- [ ] Commit `feat: process and recover release keepsakes asynchronously`.

### Task 6: Implement client Gallery state without live/pagination races

**Files:** Create `src/lib/gallery-api.ts`, `src/lib/useGallery.ts`, `spec/gallery-state.test.ts`.

**Consumes:** Public DTOs and exact HTTP/SSE contract; use type-only imports or a client-safe type alias, not server runtime imports.
**Produces:** Typed functions `getGalleryPage(after?:string,signal?:AbortSignal):Promise<GalleryPage>`, `getArtifact(id,signal?):Promise<PublicArtifact>`, `getGalleryConfig(signal?):Promise<{generation_enabled:boolean}>`, `reportArtifact(id,reason,opKey):Promise<{report_id:string,status:'queued'}>`; `useGallery()` exposes items, total, loading/error/reconnecting, next cursor/loadMore, selected object/open/close and report state.

- [ ] Write failing reducer/hook tests for duplicated arrivals, stale versions, a publish/hide during HTTP page loading, late responses from an aborted prior visit, and pagination after live insertion. Deduplicate by public ID/version and keep the server page cursor independent of live sorted tiles.
- [ ] Implement one EventSource lifecycle, clean disposal and buffered deltas while fetching. On revision gaps or reconnect, obtain a fresh snapshot; do not replay historical arrivals. Never infer source-paper state from Gallery events.
- [ ] Test `reconnect_revalidates_open_detail_outside_first_page`: re-fetch its ID; close and clear its image if hidden/missing. Live hide removes both grid and detail; a slower page response cannot restore it. Retain already-safe content during transient reconnect without suppressing received hide events.
- [ ] Keep at most 48 tile entries, preserving the open item when retiring another tile. Allow loading additional pages using the server cursor and dedup them against live inserts. Test this behavior with at least 60 seeded objects.
- [ ] Freeze a report's reason and op-key after an ambiguous send and reuse both on retry; no new key from closing/reopening the report form. Do not treat a network error as proof that no report was saved.
- [ ] Run Gallery state tests/typecheck. Commit `feat: reconcile live gallery objects and reports`.

### Task 7: Build the exhibition and isolate its entry bundle

**Files:** Create `src/GalleryApp.tsx`, `src/components/ArtifactDialog.tsx`, `spec/gallery-ui.test.ts`; modify `src/main.tsx`, `src/styles/app.css`, `server/index.ts`.

**Consumes:** Task 6 client state and existing tokens/native dialog behavior.
**Produces:** `/gallery/`, including direct navigation/refresh, responsive gallery/detail/report surfaces, without loading the room.

- [ ] Add component tests using the existing jsdom/React act pattern. Check loading, honest empty state, retryable failure, image alt/dimensions, detail close, Escape/focus return and live removal. Show no fixture art or fake total in the real empty state. Use getGalleryConfig to show the paused-processing message when generation_enabled is false; never disable Release or existing Gallery browsing.
- [ ] Replace the eager main-entry import of App with pathname-based lazy imports: `/gallery` and `/gallery/` render GalleryApp; `/` renders App. Gallery modules must not import PaperField, room, cannon or fire code. Serve the built index for both Gallery paths; retain `/readme/` and API 404 behavior.
- [ ] Build the spec's quiet exhibition: title **The Gallery**, exact original-deletion explanation, maximum width 1,200 px, 3 columns ≥1,024 px / 2 at 600–1,023 px / 1 below 600 px, 48 px desktop and 20 px phone gutters. Square images, lazy loading, async decoding, generic captions and no card chrome, timestamps, ranking or animation library.
- [ ] Build the native detail/report dialog with a plain cross and accessible Close label. Initially focus the dialog, preserving a keyboard focus indication when the user navigates; do not recreate the earlier initial black-ring bug with autofocus on the cross. No source/recover link, text transcription or prompt is shown.
- [ ] Test direct `/gallery/` refresh using the built Express server. Inspect browser network: no room model/FBX, Three/cannon or fire assets on Gallery entry; `/` still initializes its scene normally. Use network requests and built output rather than a speculative performance claim.
- [ ] Compare actual renders at 1920×1080, 1366×768, 1280×720 and 390×844. Verify keyboard/44 px controls, reduced motion, image loading/failure and no horizontal overflow. Save actual screenshots; do not use generated images as proof of implementation.
- [ ] Run Gallery UI/state tests, build and typecheck. Commit `feat: add the responsive anonymous gallery`.

### Task 8: Explain Release and add safe Gallery navigation

**Files:** Modify `src/components/WriteDialog.tsx`, `src/components/Header.tsx`, `src/App.tsx`, `src/styles/app.css`; extend `spec/gallery-ui.test.ts` or create `spec/gallery-consent-ui.test.ts`.

**Consumes:** Existing Keep/Release/I understand controls and current mode state.
**Produces:** Clear Release copy and a Gallery link available only from the idle space, with no new consent state or request field.

- [ ] Add failing tests `release_copy_explains_automatic_public_keepsake` and `gallery_does_not_add_another_checkbox`. Assert the original two mode radios and single I understand checkbox remain; API call arguments and frozen retry payload remain unchanged. Existing unchecked-I-understand feedback must still work.
- [ ] Replace only Release's supporting copy with the exact spec §2 copy. Do not add an expandable panel, toggle, request flag, Keep keepsake promise or additional confirmation. Put the processing/failure qualification in the existing safety/About explanation without duplicating a large block in the form.
- [ ] Add Gallery navigation to Header with an explicit `canVisitGallery` prop computed as `mode.kind === 'space'`. Do not repurpose the existing `busy` prop, which currently means ritual and controls Return key. Test reading, writing, return-key and ritual states cannot navigate through the new link and lose an active flow.
- [ ] Preserve the furnace ash dwell, Back action and cleanup; do not add an early Gallery escape inside the ritual. Returning to the idle space exposes the link. Gallery itself offers Back to the space and About.
- [ ] Recheck text and drawing-write at 1280×720 and 390×844 after the longer Release explanation. Use fluid spacing and accessible text size, preserve drawings and existing form validation. Add no unrelated scene/material changes.
- [ ] Run consent/navigation UI tests, moderation UI, drawing and ritual suites. Commit `feat: explain release keepsakes without another opt-in`.

### Task 9: Verify the complete feature and leave a factual handoff

**Files:** Create `docs/adr/005-release-keepsakes.md`, `docs/artifacts-runbook.md`; update the evidence checkpoint and add relevant screenshots. Make minimal scoped updates to README.md, CLAUDE.md and PROCESS.md.

**Consumes:** Completed Tasks 0–8.
**Produces:** Verified local feature, recoverable operating instructions and explicit unverified release gates.

- [ ] Write the ADR: Release-derived eligibility versus an extra checkbox; post-burn raw-content queue versus finite pre-burn recipe; image generation independent of burn success; immediate-burn neutral fallback; private/public ID separation and limits of timing anonymity; no automatic re-charge on unknown results. State costs: extra provider processing, imperfect abstraction, queue delays, moderation/operational work, storage limits and possible generation failure.
- [ ] Document exact environment variables/defaults, private CLI examples, quota reset, ambiguous-charge recovery, output rejection, storage-full handling, fixture refusal, Fly auto-stop and why a queue is not a completion-time guarantee. Publication checks are automated; Gallery reports in this version require the operator queue. Do not imply staffed review or a guaranteed response time.
- [ ] Update CLAUDE.md's allowed routes and Gallery scope narrowly; document this runtime OpenAI image adapter separately from its existing static-asset generation guidance. Explain Release-to-Gallery and Keep exclusion in README without turning the Definition of Good into a feature catalogue. Add only a short factual evidence link to PROCESS; do not write reflections.
- [ ] On a newly built and restarted local app with a fresh disposable DB and fixture artifacts, run `pnpm check`, `pnpm build`, `pnpm check:evidence`; record real counts, commands and results. Run `git diff --check`. Repeat only if a subsequent change or failure justifies it. Include the required Docker build result from Task 5.
- [ ] Perform the local multi-session acceptance matrix below. Use injected clock/provider controls for restart/timeout scenarios; no public test-only route in production. Any helper fixture server or runner remains under spec/test tooling and is explicitly disabled on Fly.
- [ ] Review the final diff for source-body retention, unsafe logging, source/public IDs, missing state guards, secret/fixture leakage, broad unrelated edits and accidental permission/infra changes. Verify all five Review Focus cases have evidence, not only test names.
- [ ] Commit scoped final documentation/evidence after the checks. Leave unrelated files unstaged. Do not push main or deploy: main pushes automatically deploy this repo. Report branch/commit, local checks, actual elapsed time, unfinished blockers and exact next release steps.

## Acceptance matrix: useful remaining work, not filler

| Journey/failure | Required observable result |
| --- | --- |
| Text Release / drawing-only Release / combined Release | Author makes the existing Release choice; source becomes immutable; burning clears originals, automatically queues one job and eventually publishes one inspected independent object |
| Keep author destroys their paper | Normal burn works; no preparation, image request, job or Gallery object |
| Immediate Release burn before recipe completes | Neutral finite recipe; late response discarded; no original in subsequent requests/files |
| Active pre-feature Release / already ended paper | Active paper is eligible; ended paper is not reconstructed or backfilled |
| Two burners or lost HTTP reply | One committed burn/job/object and one decrement; retries keep the original operation key |
| Quarantine during recipe request | Cancelled job, source cleared, no image generation/publication; no fire for removal |
| Provider off, 401/403, quota full, disk full | Burning still succeeds; automatic job remains queued or safely failed with a truthful operator reason; no unsafe/public fallback |
| Image timeout/crash after dispatch | GENERATION_UNKNOWN; no automatic second charge; manual retry requires explicit private acknowledgement |
| Crash after finalized file write | Valid file resumes inspection; no new image request |
| Inspection reject/uncertain/unavailable | Object never public; bounded retries only for transient failures; private files eventually removed |
| Gallery A and B open, one object publishes | Both see it without reload within about one second **of publication commit**, independent of AI generation duration |
| Gallery hide while detail/page load is open | New image requests 404; both clients remove image/detail; late HTTP/SSE cannot restore it; reports alone never hide it |
| Disconnect/reconnect, pagination and >48 loaded candidates | Fresh snapshot/version reconciliation, selected-ID revalidation, no duplicate images or historical arrival replay, bounded tile memory |
| Open Gallery directly on phone/desktop | Responsive exhibition, keyboard-safe detail/report; no room/Three/fire/model downloads |
| Existing space/write/read/furnace/return key | Existing scene, drawings, rights, witnessing, immediate original clearing and realtime behavior remain intact |

## Definition of finished and release boundary

Local implementation is finished only when the real adapter exists, fixture-backed end-to-end work and required checks pass, no original survives in the new pipeline, reporting/removal/recovery are usable, documentation is accurate and limitations are named. A fixture image proves wiring, not AI quality or real account/model access.

A later authorized release needs: a consistent backup of the live SQLite database and artifact directory; confirmation of model access/billing; at most one separately approved paid synthetic image smoke test; a review of its appearance/inspection; the approved production feature flag; CI/container checks; deployment and post-deploy read-only smoke checks. Keep source-data privacy rules and existing course Fly limits unchanged. Do not treat the presence of OPENAI_API_KEY as permission for paid experimentation.

## Visual and API references

- Use [the current design spec's material references](../specs/2026-10-18-gallery-ai-keepsakes-design.md#6-gallery-experience-and-references), especially [space](../../../reference-images/01-space-desktop.png), [write](../../../reference-images/02-write-desktop.png) and [mobile write](../../../reference-images/08-write-mobile.png), for paper/background tone only. Current baseline screenshots control the newer layout. These links are relative and remain valid when this repository structure is moved intact.
- The room continues to use the existing [paper-crumple-demo](https://github.com/item-develop/paper-crumple-demo); do not replace or remodel it for the Gallery.
- Official [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate), [image generation guide](https://developers.openai.com/api/docs/guides/image-generation), and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) ground adapter parameters. The architecture, consent-by-Release rule and operating limits are this project's decisions.
