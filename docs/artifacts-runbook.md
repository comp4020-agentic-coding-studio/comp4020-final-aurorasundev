# Gallery and keepsake operations

How Release keepsakes run, how to switch them on, and what an operator does.
Decisions and costs are in [ADR 005](adr/005-release-keepsakes.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARTIFACTS_ENABLED` | unset (paused) | `1` lets the worker send requests to the image provider. Anything else pauses provider calls only: Release burns still queue jobs, the Gallery still serves published objects, reports and operator actions still work |
| `ARTIFACT_PROVIDER` | `openai` | `fixture` is a local/CI test double; the server refuses to start with it on Fly, whatever `ARTIFACTS_ENABLED` says |
| `OPENAI_API_KEY` | — | the same server-side key moderation uses. Without it there is no provider and generation stays paused |
| `ARTIFACT_IMAGE_MODEL` | `gpt-image-2` | Images API model. Not switched automatically on an access error |
| `ARTIFACT_RECIPE_MODEL` | `gpt-4.1-mini-2025-04-14` | Responses model for the recipe and the visual-policy check |
| `ARTIFACT_DIR` | `artifacts/` beside the database (`/data/artifacts` on Fly) | private image files; never served statically |

`GET /api/gallery/config` answers `{ generation_enabled }`: true only when
enabled **and** a provider is configured. It reports processing, not
eligibility.

## What the worker does

One loop inside the server process, polled every second: operator actions,
discovery of older ACTIVE Release papers (20 at a time), inspection, recipes,
then images, one request at a time. Each request is preceded by a single
transaction that leases the job (180 s, random token) and reserves today's
budget; each result is written only under that lease.

| Step | Limit | Failure |
| --- | --- | --- |
| Recipe (paper still ACTIVE) | 10 s; 2 attempts, 5 s apart | burn uses a neutral recipe from the job's public id |
| Image | 120 s | explicit 429: one retry after max(30 s, Retry-After). Timeout, lost connection, 5xx or a crash after dispatch: `GENERATION_UNKNOWN`, never resent automatically. 401/403: `FAILED` with `provider_auth`. Refusal: `FAILED` |
| Inspection | 30 s per request; 3 runs (now, +5 s, +30 s) | blocked or uncertain: `BLOCKED`; exhausted: `FAILED`; file removed either way |

Daily caps (UTC): 20 recipes, 10 images, 20 inspection runs. Every dispatched
request counts. A job over budget waits with `error_code=daily_budget` until
the next UTC day. A job without storage room waits with `storage_full` and is
rechecked each minute. On startup the worker adopts a finalized image whose
job state was lost, marks an interrupted dispatch `GENERATION_UNKNOWN`, and
removes abandoned staging files.

The Fly machine stops when idle. Queued jobs persist and resume when the app
next runs; nothing here wakes it. A queue is not a completion time.

## Operator commands

Run them where the database lives (on Fly: `fly ssh console`, then in `/app`
use `node scripts/artifacts.ts …`; locally `pnpm artifacts:… -- …` with
`DATABASE_PATH` set). They print ids, states, reasons and ages: never words,
drawings, recipes or provider responses. Every action is **queued**; the
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
  (grid and detail), its reports are resolved, then its file is deleted. A
  repeat is harmless. An image someone already downloaded cannot be recalled.
- **dismiss**: resolves one report; visibility is unchanged.
- **retry**: only for `GENERATION_UNKNOWN`, and only with the flag, because
  the first request may already have produced (and been charged for) an
  image. It sends exactly one more image request.

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
stop, everything else continues, and queued jobs wait. Hiding objects works
while paused.
