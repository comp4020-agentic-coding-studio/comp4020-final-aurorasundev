# 006 — AI-directed scores, performed locally with Web Audio

Date: 2026-10-19. Status: **implemented 2026-10-27, flag off**
(`GALLERY_MUSIC_ENABLED` unset in production; enabling it is the owner's
decision, after real-browser listening that has not yet been done).
Extends
[ADR 005](005-release-keepsakes.md) without changing its source deletion,
burn permissions, extraction deadline or image publication policy.

## Context

The owner wants a released note to become both an abstract cover and a short
instrumental in the record exhibition. They selected OpenAI-generated
parameters followed by browser synthesis. The current ignition brief
already includes musical directions; the current Gallery is image-only.

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
- Music is independently gated by proposed `GALLERY_MUSIC_ENABLED`, off by
  default. Existing `ARTIFACTS_ENABLED` and image budgets keep their meaning.
- Image publication remains valid if music is disabled/invalid. No fake
  sound or unrelated loop is substituted.
- No new music SSE event: the optional descriptor travels in the existing
  atomic `artifact:published` result. Local playback is never broadcast.

The complete contract, synthesis limits, UI states, implementation boundaries
and acceptance checks are in the
[music design](../../design/gallery-records-2026-10-18/music-design.md).

## Implementation (2026-10-27)

- `shared/music-score.ts`: `MusicScoreV1`, the strict validator and the
  frozen `throwaway-score-v1` composer (Mulberry32), shared by server and
  browser.
- Migration 10: nullable `artifacts.music_score`; no backfill.
- `publishArtifact` composes and saves the score in its own transaction when
  the flag is on; `GET /api/gallery/:id/score` is the gated read;
  `/api/gallery/config` adds `music_enabled`.
- `src/lib/gallery-audio.ts` (one player), `src/lib/gallery-synth.ts`
  (`throwaway-synth-v1`, lazy-loaded), `src/lib/useGalleryAudio.ts`,
  `src/components/RecordPlayer.tsx`.
- Specs: `music-score`, `music-publication` (including a schema-9 fixture),
  `gallery-synth`, `gallery-sound-ui` (Web Audio mocked).

Not verified: real-browser rendering and listening, iOS Safari's audio
unlock, first-render latency and memory on a real phone, and the Release
disclosure copy (unchanged until the owner enables music). Operating notes
are in [the runbook](../artifacts-runbook.md).
