# 005 — Release papers leave a separate AI keepsake; the original is still deleted

Status: implemented on branch `claude/gallery-ai-keepsakes` and verified
locally with fixture providers on 2026-10-18. Not deployed. Real OpenAI image
generation and the visual-policy check have **not** been exercised; see the
release boundary below.

## Context

The owner asked for a public Gallery of abstract objects left after papers
are let go. Throwaway's core promise is that burning a paper deletes it at
once. A Gallery must therefore not keep the paper's words or drawing, must
not delay or depend on the burn, and must not become a feed, an archive, or
a way back to a paper.

## Decisions

| Question | Options considered | Decision | Cost accepted |
| --- | --- | --- | --- |
| Who becomes a keepsake? | an extra opt-in checkbox at writing; Release mode | **Release mode is the only eligibility.** The Release description says so before saving; no new control, field or confirmation | a Release author cannot have a Release paper without a keepsake; Keep never produces one, including when its author burns it |
| What does generation see? | keep the raw words/drawing in the job after the burn; generate the full image before confirming the burn; prepare a small recipe while the paper is still here | **A four-enum recipe (motif, material, palette, gesture) prepared while the paper is ACTIVE.** The image job sees only the recipe | extra states; an imperfect abstraction; the words and drawing are sent once to OpenAI for the recipe |
| What if the paper is burned before a recipe exists? | wait for the recipe; read the paper anyway | **A neutral recipe chosen from the job's own random public id**, never from the paper. A late recipe is discarded | some keepsakes say nothing about their paper |
| Does the burn wait for AI? | synchronous generation; asynchronous | **Asynchronous.** The burn transaction clears the paper and queues the job in the same commit; the existing eight-second burn path is unchanged | completion is not guaranteed in any time, and a stopped Fly machine does no work until it next starts |
| Can the public object be traced to its paper? | reuse the paper id; a separate id | **An independent random UUID**, and an allowlisted public shape with no paper, job, recipe, owner or timestamps | an observer may still infer a link from timing; absolute unlinkability is not claimed |
| What if an image request's outcome is unknown? | retry automatically; mark it unknown | **`GENERATION_UNKNOWN`, never resent automatically.** An operator retry requires acknowledging a possible extra charge | a timed-out image may need a person |
| Who removes an object? | report count thresholds; automated review of reports; operator | **An operator**, through a private CLI. Reports only queue for review | removal depends on someone reading the queue; no response time is promised |

## What is stored

New tables (migration 9): `artifact_jobs` (a private job per Release paper:
state, the four-value recipe, attempt counts, lease, a server-made file name,
a safe error code), `artifacts` (the public objects), `gallery_state` (the
Gallery's own revision), `artifact_budgets` (per-UTC-day counters),
`artifact_reports` and `artifact_admin_jobs`. None has a column for words or
a drawing. The job keeps a private link to its paper id, needed so a paper
gets at most one job; it is never exposed. Images are WebP files named by
the public id under `/data/artifacts`, read only through the image route
after a published-state check.

## Costs and limits

- **External processing.** OpenAI receives each Release paper's words and
  drawing once, for the recipe (Responses with `store: false`, which is a
  request, not a guarantee about provider retention), then only fixed
  phrases built from the recipe, then the generated image for inspection.
- **Money and quotas.** Per UTC day at most 20 recipe requests, 10 image
  requests (1024×1024, medium quality, WebP) and 20 inspection runs; every
  dispatched request counts, including failures. Over budget, jobs wait for
  the next UTC day.
- **Storage.** At most 200 public objects, 250 MiB of managed files and a
  2 MiB file, and at least 64 MiB free disk before an image request. At the
  cap new images wait; nothing published is deleted to make room.
- **Safety.** Every image passes the existing harm checks (unchanged) and a
  separate strict visual policy that blocks legible text, faces, identifiable
  places and any uncertainty. Blocked or failed images are never published
  and their files are removed. Reports need an operator.
- **Failure is visible, not hidden.** Generation can fail or be delayed; the
  original paper is still gone. With processing paused the Gallery says new
  objects are not being generated; Release still works and its jobs queue.

## Release boundary

Before any of this reaches production: a consistent backup of the live
database (and, from then on, of `/data/artifacts`); confirmation that the
account can use the configured image model (`gpt-image-2` by default; the
2026-10-18 docs list `gpt-image-2.5-*` and do not name `gpt-image-2`, so
access is unverified and the model is not switched silently); one separately
approved paid smoke test with synthetic content and a look at its result;
the owner's decision on `ARTIFACTS_ENABLED`; CI; deployment; read-only
post-deploy checks. Operating details are in
[the artifacts runbook](../artifacts-runbook.md).
