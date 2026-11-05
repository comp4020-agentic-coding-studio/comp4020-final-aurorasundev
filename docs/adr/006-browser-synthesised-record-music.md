# 006 — AI-directed scores, performed locally with Web Audio

Date: 2026-10-19. Status: **implemented and enabled in production on
2026-10-27** via `GALLERY_MUSIC_ENABLED`. Extends
[ADR 005](005-release-keepsakes.md) while preserving its source deletion,
burn permissions, extraction deadline and image publication policy.

## Context

The owner wants a released note to become both an abstract cover and a short
instrumental in the record exhibition. They selected OpenAI-generated
parameters followed by browser synthesis. At the time of the decision,
the ignition brief already included musical directions and the Gallery
was image-only.

## Decision

Reuse the validated `CreativeBriefV2` from the one existing at-ignition
Responses request. Translate its musical/visual directions with a bounded,
versioned deterministic composer and one program-generated seed. Save the
24-second score once, atomically with an inspected image's publication.
Serve it only through a currently published-state-gated JSON route.

On explicit Play, one Gallery player renders a short buffer with
OfflineAudioContext and performs it with Web Audio. Pause/resume/replay reuse
that buffer. No playback action calls AI. Source words/drawings are neither
sent again nor stored with music. No external music service, MP3, samples,
audio job or new API credential is introduced.

## Options and costs

| Option | Decision and cost |
| --- | --- |
| Reuse existing brief + local score + Web Audio | Selected: fewest changes and no extra AI round trip; the vocabulary and synthetic sound are deliberately limited |
| Make the model output a larger score at ignition | Deferred: more control, but changes the working schema/token budget and deadline risk |
| Generate recorded audio through a separate provider | Superseded: additional fees, key, latency, files and audio-content review |

This is **AI-directed generative music**, not a model-produced recording.
Musical quality needs listening tests; identical stored notes do not promise
bit-identical sound on every browser/speaker. A first Play may need a short
local render. Legacy records remain image-only in the first release; no
historical backfill is included.

## Constraints and consequences

- One local player; explicit start; no autoplay/loop/auto-next. Stop on
  switch, close, reporting, hide, reconnect, backgrounding or leaving.
- A fixed seed and stored note list make repeat visits reproduce the piece.
- Strict score/renderer allowlists exclude arbitrary code, files, voices,
  lyrics and URLs. Existing reports target the whole record; hiding gates
  both the image and score. Downloaded data cannot be recalled.
- Music is independently gated by `GALLERY_MUSIC_ENABLED`, off when unset. Existing `ARTIFACTS_ENABLED` and image budgets keep their meaning.
- Image publication remains valid if music is disabled/invalid. No fake
  sound or unrelated loop is substituted.
- No new music SSE event: the optional descriptor travels in the existing
  atomic `artifact:published` result. Local playback is never broadcast.

The complete contract, synthesis limits, UI states, implementation boundaries
and acceptance checks are in the
[music design](../../design/gallery/record-exhibition/music-design.md).

## Implementation (2026-10-27)

- `shared/music-score.ts`: `MusicScoreV1`, the strict validator and the
  frozen `throwaway-score-v1` composer (Mulberry32), shared by server and
  browser.
- Migration 10 adds nullable `artifacts.music_score`. It leaves older rows
  unchanged. The owner later ran a one-time production backfill for five
  older records ([`710fed9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/710fed9)).
- `publishArtifact` composes and saves the score in its own transaction when
  the flag is on; `GET /api/gallery/:id/score` is the gated read;
  `/api/gallery/config` adds `music_enabled`.
- `src/lib/gallery-audio.ts` (one player), `src/lib/gallery-synth.ts`
  (`throwaway-synth-v1`, lazy-loaded), `src/lib/useGalleryAudio.ts`,
  `src/components/RecordPlayer.tsx`.
- Specs: `music-score`, `music-publication` (including a schema-9 fixture),
  `gallery-synth`, `gallery-sound-ui` (Web Audio mocked).

The owner listened to the earlier records and found them too similar.
That listening informed ADR 008. The sound of newly generated records
under that revision, iOS Safari's audio unlock, and first-render latency
and memory on a physical phone remain separate checks. Operating notes
are in [the runbook](../artifacts-runbook.md).

### Revision 2026-10-30: rebirth reversal

The ignition brief's musical/visual instruction now answers a note's
emotional weight with a contrasting mood ([ADR 008](008-rebirth-reversal.md))
rather than matching it; image and music continue to stay coherent with
each other under whichever direction the instruction currently selects. A
fourth timbre (`bright_bell`) and a fourth tempo tier (88 BPM) were added,
and the velocity ceiling moved from 0.70 to 0.78, all within the existing
`throwaway-score-v1`/`throwaway-synth-v1` versions — the score schema,
composer/renderer version strings and stored contract here are unchanged.

### Revision 2026-11-05/06: new composers, v2 and v3

The owner listened to records made by v1 and found them thin: one rising
motif over a held root, every note the same length. Following this ADR's
rule that a changed composer is a new version, two composers were added in
`shared/music-score.ts`, and the validator accepts all three
(`COMPOSER_VERSIONS`); the score schema and `throwaway-synth-v1` renderer
are unchanged, so the browser plays every version the same way.

- **`throwaway-score-v2`** (2026-11-05,
  [`fe4be95`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/fe4be95)):
  a short piece in sections (intro, A, B, A', cadence, final chord), a
  chord progression chosen by `relation`, a bass line and accompaniment,
  and a melody with varied rhythm that fills the 24 seconds at every tempo.
- **`throwaway-score-v3`** (2026-11-06,
  [`3cc6633`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/3cc6633)):
  after listening to v2, the owner kept its rhythm but heard the melody as
  a high note and a low one in turn. v3 walks the melody mostly by step
  towards one high point in B and never jumps an octave, contrasts B's
  accompaniment and adds sevenths there, and spreads keys across the
  octave. New publications use v3.

v1 and v2 are frozen beside v3 (`composeMusicScoreV1`, `composeMusicScoreV2`)
so a stored score can be reproduced from its brief and seed; tests pin v1's
first notes and a fingerprint of v2's output for every brief. Stored scores
are never recomposed: each record keeps the version it was published with.
The one-time backfill script uses the current composer, and only for a
record that has no score.
