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

`GET /api/gallery/config` answers `{ generation_enabled, music_enabled }`:
`generation_enabled` is true only when enabled **and** a provider is
configured. It reports processing, not eligibility. `music_enabled` is
below (record music).

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

## Record music (Web Audio) — implemented, off by default

The [music design](../design/gallery-records-2026-10-18/music-design.md) and
[ADR 006](adr/006-browser-synthesised-record-music.md) are implemented behind
`GALLERY_MUSIC_ENABLED`, which is **off** unless set to `1`. There is no
music-service key, audio endpoint, audio file, music quota or extra model
request: the score is composed locally on the server, and the sound is
synthesized in the visitor's browser only after they press Play.

| Variable | Default | Effect |
| --- | --- | --- |
| `GALLERY_MUSIC_ENABLED` | unset (off) | `1`: a freshly published image also saves a score, and published valid scores are served. Anything else: no new scores, `/score` answers 404 for every record, descriptors read `unavailable`, stored scores are kept. Independent of `ARTIFACTS_ENABLED` |

`GET /api/gallery/config` answers `{ generation_enabled, music_enabled }`;
the Gallery reads it again on every reconnect and shows the no-sound copy
when music is off.

### What is stored, and when

- Migration 10 adds the nullable `artifacts.music_score` (JSON text, at most
  16 KiB). Records published before it, or while music is off, keep `NULL`
  and stay image-only. There is **no backfill**.
- In the same transaction that publishes an inspected image, with music on,
  `shared/music-score.ts` composes a `MusicScoreV1` from the job's already
  stored `CreativeBriefV2` (its `music`, `relation`, `motion`, `metaphor` and
  `space` choices) and a fresh four-byte random seed. The note itself is gone
  by then and is never read again. A score that fails validation is stored as
  `NULL`; the image still publishes, and no substitute sound is made.
- The stored score holds only versions, the seed, tempo, timbre, ending,
  reverb mix and up to 96 note events (time, length, MIDI pitch, velocity).
  No words, drawing, brief, prompt, URL or code.
- Keep, quarantined, cancelled, failed-extraction, blocked and duplicate
  paths never get a score; a repeat publication can't replace one.
- The worker log adds `music=score_saved | score_invalid | off` to its
  `published` line. Scores and seeds are never logged.

### What is public

- Each record carries an optional `music` descriptor: absent (image-only),
  `{ status: "unavailable" }`, or `{ status: "ready", score_version: 1,
  duration_ms: 24000 }`. It travels in pages, the snapshot and the existing
  `artifact:published` event; the score itself never does.
- `GET /api/gallery/:id/score` (no-store) answers
  `{ artifact_id, artifact_version, score }` only for a currently published
  record with a valid stored score while music is on; otherwise the generic
  404. A hide stops it at once, along with the image. A score already
  downloaded can't be recalled.

### In the browser

One player for the page (`src/lib/gallery-audio.ts`): on Play it creates and
resumes the `AudioContext` inside the click, fetches the score, validates it
again, lazy-loads the synth (`src/lib/gallery-synth.ts`), renders a mono
44.1 kHz, 24-second buffer with `OfflineAudioContext`, and plays it at
master volume 0.35. Pause/Resume/Play again reuse that buffer; nothing loops
or advances. Stepping, closing, opening the report form, a hide, a lost
connection, hiding the tab or leaving stop it, and nothing resumes on its
own. No audio is cached beyond the one in-memory buffer.

### Enabling and rolling back (an owner decision)

1. Back up the live database consistently before the first deploy that runs
   migration 10 (it only adds a nullable column).
2. Listen first: in a real desktop browser and a real phone (including iOS
   Safari), check all three timbres and endings for clicks, harshness and
   level, and time the first render. None of this has been verified yet.
3. Set `GALLERY_MUSIC_ENABLED=1` as a Fly secret and restart. Only images
   published from then on get scores.

To roll back, unset it (or set `0`) and restart: stored scores and images
stay, `/score` answers 404, open pages see `music_enabled: false` on their
next reconnect and stop. Pausing image generation alone does not silence
published scores. There are no audio files to back up or delete.
