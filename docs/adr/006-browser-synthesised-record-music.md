# 006 — AI-directed scores, performed locally with Web Audio

Date: 2026-10-19. Status: **selected design; not implemented**. Extends
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
This record documents a decision, not completion or release evidence.
