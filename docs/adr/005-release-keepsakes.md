# 005 — Release papers leave a separate AI keepsake; the original is still deleted

Status: implemented and deployed. The 2026-10-18 design moved extraction
to ignition and set the record exhibition's visual direction. The
[2026-10-20 preflight](../evidence/gallery-generation-preflight-2026-10-20.md)
exercised real image generation and inspection in an isolated database.
The [Gallery release](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/actions/runs/39380817085)
followed. The dated revisions below record subsequent changes.

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
| What does generation see? | keep the raw words/drawing in the job after the burn; prepare a recipe at save time; read the note at ignition | **Revised 2026-10-18 (design A): the burn transaction reads the note once, in memory, just before clearing it.** After the commit and the burn reply, one bounded Responses request turns it into a strict `CreativeBriefV2` (metaphor, relation, motion, space, material, palette and a small musical vocabulary). Only the brief is stored; the image job sees only phrases built from it | the note exists briefly in application memory and one in-flight request after its row is cleared; a restart during that request loses it |
| What if no brief is produced? | a neutral fallback from the job's public id; retry from a stored copy | **No record.** Timeout (15 s from the burn), refusal, a malformed answer, capacity (4 in flight), the daily budget or a restart marks the job `SOURCE_UNAVAILABLE`. The earlier neutral fallback is removed: an image that says nothing about its note is not made | some released papers leave no record |
| Does the burn wait for AI? | synchronous generation; asynchronous; let the fire follow extraction | **The reply never waits.** The fire on screen holds while extraction runs and ends when the server says it settled (`paper:extraction_settled`), at the latest 15 s after the burn; never before its normal 4.8 s. Image generation and inspection stay asynchronous, and nothing is published before the burn's normal ending | spectators see a longer fire for released papers; a stopped Fly machine does no work until it next starts |
| Can the public object be traced to its paper? | reuse the paper id; a separate id | **An independent random UUID**, and an allowlisted public shape with no paper, job, brief, owner or timestamps | an observer may still infer a link from timing; absolute unlinkability is not claimed |
| What if an image request's outcome is unknown? | retry automatically; mark it unknown | **`GENERATION_UNKNOWN`, never resent automatically.** An operator retry requires acknowledging a possible extra charge | a timed-out image may need a person |
| Who removes an object? | report count thresholds; automated review of reports; operator | **An operator**, through a private CLI. Reports only queue for review | removal depends on someone reading the queue; no response time is promised |
| What does a restart do to in-flight work? | trust leases; wait for them to expire | **Revised 2026-10-19: startup owns everything.** One process runs on Fly, so any job found mid-request at startup is orphaned regardless of its lease and is settled at once (see the runbook). Operator actions run on a separate tick so a hide never waits behind a slow image request | a second concurrent process would need a real ownership scheme; none is run |

### Revision 2026-10-27: paper tags

The owner asked for a small hint so someone who just released a note can
find what it left. A public object may now carry `recent: true` when it
was published in the last 24 hours (absent otherwise). It is a yes, never a
time, and it changes no order: pages stay in random-UUID order. The cost is
a slightly sharper timing hint than before, for a day. In the browser, a pale
paper tag above the record's name reads "Arrived recently" or "New to you",
and the opened record reads "Not heard yet" above its player. Both come from
that one flag and from this browser's own `localStorage` list of records it
has opened and played, which is never sent anywhere. A first visit marks
everything already in view as known, so it doesn't tag everything. Tags live
only in HTML, never on the WebGL cards. There are no counts, no badges and no
"latest" view.

## What is stored

New tables (migration 9): `artifact_jobs` (a private job per Release paper:
state, the validated creative brief, attempt counts, lease, a server-made file name,
a safe error code), `artifacts` (the public objects), `gallery_state` (the
Gallery's own revision), `artifact_budgets` (per-UTC-day counters),
`artifact_reports` and `artifact_admin_jobs`. None has a column for words or
a drawing. The job keeps a private link to its paper id, needed so a paper
gets at most one job; it is never exposed. Images are WebP files named by
the public id under `/data/artifacts`, read only through the image route
after a published-state check.

## Costs and limits

- **External processing.** OpenAI receives each Release paper's words and
  drawing once, at ignition, for the brief (Responses with `store: false`,
  which is a request, not a guarantee about provider retention), then only
  fixed phrases built from the brief, then the generated image for
  inspection. The note is never written to a job, file, log or retry queue;
  JavaScript memory and the provider give no instant-erasure guarantee.
- **Money and quotas.** Per UTC day at most 20 brief requests, 10 image
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
  records are not being made, and a burn reads nothing and queues nothing.
- **Sound.** A published image may also have a stored score based on the
  same brief. Web Audio plays it in the visitor's browser. The owner
  enabled music on 2026-10-27. See [ADR 006](006-browser-synthesised-record-music.md)
  for the score and playback contract.

### Revision 2026-10-30: rebirth reversal

The owner reframed the Gallery's emotional direction from matching a note's
tone to answering it with its opposite (destruction → rebirth). See
[ADR 008](008-rebirth-reversal.md). This does not change source deletion,
extraction timing, the brief schema version or any stored record's shape;
only the ignition instruction's guidance and the palette/timbre vocabulary
available to new extractions change.

### Revision 2026-11-03: your own records

A signed-in person can now see the records their own released papers
became, in a panel only they can open ([ADR 009](009-optional-accounts.md)).
The public object is unchanged: the same allowlisted shape, an independent
id and no link back. The panel is built from the private link the database
already held (paper → job → record) and returns it only to that owner, in
the same public shape. Everyone else still meets every record anonymously.

## Release boundary

For a change to the live generation path, check the configured provider,
use synthetic content in an isolated paid preflight when authorised,
and verify the results before enabling the change. Back up the live
database and `/data/artifacts` for relevant data changes. See
[the artifacts runbook](../artifacts-runbook.md) for the feature switches
and release checks.
