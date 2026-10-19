# Gallery and keepsake operations

How Release keepsakes run, how to switch them on, and what an operator does.
Decisions and costs are in [ADR 005](adr/005-release-keepsakes.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARTIFACTS_ENABLED` | unset (paused) | `1` lets a Release burn hand its note to one brief request and the worker send image requests. Anything else pauses: a burn reads nothing and makes no job, the Gallery still serves published records, reports and operator actions still work |
| `ARTIFACT_PROVIDER` | `openai` | `fixture` is a local/CI test double; the server refuses to start with it on Fly, whatever `ARTIFACTS_ENABLED` says |
| `OPENAI_API_KEY` | — | the same server-side key moderation uses. Without it there is no provider and generation stays paused |
| `ARTIFACT_IMAGE_MODEL` | `gpt-image-2` | Images API model. Not switched automatically on an access error |
| `ARTIFACT_BRIEF_MODEL` | `gpt-4.1-mini-2025-04-14` | Responses model for the creative brief and the visual-policy check |
| `ARTIFACT_DIR` | `artifacts/` beside the database (`/data/artifacts` on Fly) | private image files; never served statically |

`GET /api/gallery/config` answers `{ generation_enabled }`: true only when
enabled **and** a provider is configured. It reports processing, not
eligibility.

## What the worker does

A Release burn starts its own extraction: after the burn commits and
replies, the note read inside that transaction goes to one brief request
(at most 4 at once), and the result settles the job and tells open rooms
(`paper:extraction_settled`) so the held fire can end. Then one loop inside
the server process, polled every second: operator actions, inspection, then
images, one request at a time. Each request is preceded by a single
transaction that leases the job (180 s, random token) and reserves today's
budget; each result is written only under that lease.

| Step | Limit | Failure |
| --- | --- | --- |
| Brief (at ignition) | until 15 s after the burn; one attempt | `SOURCE_UNAVAILABLE` with `brief_timeout`, `brief_refusal`, `brief_malformed`, `at_capacity`, `daily_budget` or `source_lost_on_restart`. No record and no fallback |
| Image | 120 s | explicit 429: one retry after max(30 s, Retry-After). Timeout, lost connection, 5xx or a crash after dispatch: `GENERATION_UNKNOWN`, never resent automatically. 401/403: `FAILED` with `provider_auth`. Refusal: `FAILED` |
| Inspection | 30 s per request; 3 runs (now, +5 s, +30 s) | blocked or uncertain: `BLOCKED` with an `inspection_*` reason code (below); exhausted: `FAILED`; file removed either way |

Daily caps (UTC): 20 briefs, 10 images, 20 inspection runs. Every dispatched
request counts. A job over budget waits with `error_code=daily_budget` until
the next UTC day. A job without storage room waits with `storage_full` and is
rechecked each minute. On startup, before it claims anything, the worker
treats every job still in `EXTRACTING`, `GENERATING` or `REVIEWING` as
orphaned by the previous process, whatever its lease says (Fly runs one
process; a lease only guards this process's own concurrent steps). It marks
a lost extraction `SOURCE_UNAVAILABLE`, adopts a finalized image whose job
state was lost, marks an interrupted dispatch `GENERATION_UNKNOWN` (never
resent), requeues an interrupted inspection, and removes abandoned staging
files.

Operator actions run on their own one-second tick, not behind the image
loop: a hide commits, bumps the version and Gallery revision once, is
broadcast, then its file is unlinked, within about a second even while an
image request is still waiting (up to 120 s). A late result from that
request is still bound to its own job and lease and cannot undo a hide.

The Fly machine stops when idle. Queued jobs persist and resume when the app
next runs; nothing here wakes it. A queue is not a completion time.

## Operator commands

Run them where the database lives (on Fly: `fly ssh console`, then in `/app`
use `node scripts/artifacts.ts …`; locally `pnpm artifacts:… -- …` with
`DATABASE_PATH` set). They print ids, states, reasons and ages: never words,
drawings, briefs or provider responses. Every action is **queued**; the
running server applies it within about a second and tells open Gallery pages.

```sh
pnpm artifacts:reports                       # reports, open ones first
pnpm artifacts:jobs                          # the 50 most recent jobs and their states
pnpm artifacts:hide -- <artifact-id> --reason <code>
pnpm artifacts:dismiss -- <report-id>
pnpm artifacts:retry -- <job-id> --acknowledge-possible-charge
```

- **hide**: reasons `legible_text`, `face`, `identifiable_place`, `harmful`,
  `private_information`, `reported`, `other`. The object stops being served at
  once, its version and the Gallery revision move once, open pages remove it
  (orbit, grid and record view), its reports are resolved, then its file is deleted. A
  repeat is harmless. An image someone already downloaded cannot be recalled.
- **dismiss**: resolves one report; visibility is unchanged.
- **retry**: only for `GENERATION_UNKNOWN`, and only with the flag, because
  the first request may already have produced (and been charged for) an
  image. It sends exactly one more image request.

### Why an image was blocked

A `BLOCKED` job's `error_code` (shown as `error=` by `pnpm artifacts:jobs`
and as `reason` in the worker log) says which check kept the image private.
These are fixed codes: no provider text, category scores or note content is
stored. The file is already gone and the job is never regenerated.

| Code | Meaning |
| --- | --- |
| `inspection_harm` | the existing harm screen (category gate or content policy) rejected the image |
| `inspection_harm_review` | the content policy could not clear it (its review/uncertain outcome) |
| `inspection_text` | the visual check saw legible text, letters or numbers |
| `inspection_face` | the visual check saw a human or animal face |
| `inspection_place` | the visual check saw an identifiable real place |
| `inspection_uncertain` | no flag was raised, but the visual check was not certain |
| `inspection_refused` | the visual check declined to look; a refusal never allows |
| `inspection_blocked` | blocked for no single reason above (e.g. a bare block decision); also the fallback for anything unexpected |

When the visual check raises several flags, the first of text, face, place,
uncertain is stored. A run of one code (say `inspection_text`) is a hint to
revisit the style preset, not to loosen the check.

Reports never hide anything on their own, and nothing promises a review
time. Read the queue regularly while the Gallery is public.

## Switching generation on (a release step, not routine)

1. Back up the live database consistently, and from now on include
   `/data/artifacts` in backups.
2. Confirm the account can use `ARTIFACT_IMAGE_MODEL` and that billing is set.
3. With the owner's approval, run **one** paid smoke test on synthetic
   content (not a real paper): a Release paper, burned, should publish one
   object. Look at the image and the inspection result.
4. Set `ARTIFACTS_ENABLED=1` as a Fly secret only after that, with the
   owner's decision. Watch `pnpm artifacts:jobs` for `provider_auth`,
   `daily_budget`, `storage_full` and `generation_unknown`.

To roll back, unset `ARTIFACTS_ENABLED` (or set it to `0`): provider calls
stop and new burns read nothing, everything else continues, and jobs that
already have a brief wait. Hiding objects works
while paused.

## Planned Web Audio music extension — not implemented

The selected [music design](../design/gallery-records-2026-10-18/music-design.md)
and [ADR 006](adr/006-browser-synthesised-record-music.md) replace the old
separate music-service/MP3 proposal. Do not configure a music-service key,
audio endpoint or music quota for this design.

The future implementation reuses the existing `CreativeBriefV2` from the
ignition request. A bounded local composer saves one score and fixed seed
atomically with accepted-image publication; browser Web Audio renders it
only after a visitor clicks Play. Playback/Resume/Replay make no AI request.
Existing image budgets, source deletion, unknown-outcome handling and the
4.8–15-second fire stay unchanged.

Proposed configuration, **not supported by the current application yet**:

| Variable | Default | Planned effect |
| --- | --- | --- |
| `GALLERY_MUSIC_ENABLED` | `0` | `1` permits score creation for fresh published images and gated serving of valid stored scores; independent of `ARTIFACTS_ENABLED` |

A later implementation appends the next migration after v9 for nullable
`artifacts.music_score`; legacy objects remain image-only and there is no
automatic backfill. Include the database in the existing consistent backup;
there are no new audio files to back up. `GET /api/gallery/:id/score` will be
publication-gated/no-store, and the existing hide event will stop playback.
Already downloaded data cannot be recalled.

Before enabling music in a later release: verify strict score validation,
repeatable composition, all three timbres/endings with real-browser
listening, explicit-start/pause/resume/replay/volume, A→B and hide-during-render
races, reconnect/background stop, no-WebGL/reduced-motion access and real
phone render cost. Existing image Gallery tests must still pass. No
additional paid music smoke test or account permission is required for
local synthesis; any real OpenAI image/brief evaluation remains a separate
authorized check.

Planned rollback is `GALLERY_MUSIC_ENABLED=0` followed by the normal restart:
stored scores/images remain, new snapshots/config show no sound, and
reconnecting clients stop local playback. Pausing AI generation alone does
not revoke stored music. This documentation pass performs none of these
configuration, migration or release actions.
