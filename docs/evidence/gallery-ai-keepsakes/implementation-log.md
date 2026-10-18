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

Next: Task 2 (bind jobs to save, burn and quarantine).
