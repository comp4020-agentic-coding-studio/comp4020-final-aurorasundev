# 008 — The Gallery answers a note's weight with its opposite, not a mirror of it

Status: accepted and implemented on 2026-10-30 in
[`74c1291`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/74c1291).
Deployed on 2026-11-04 with
[`fa446d8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/fa446d8)
in [run 41795798041](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/actions/runs/41795798041).
Automated checks cover the implementation. A [listening check](#listening-check)
records one person's response to two Gallery tracks.

## Context

ADR 005 and the Gallery's original design asked the ignition brief to
*match* a note's emotional tone: `BRIEF_INSTRUCTION` in
`server/artifacts/provider.ts` said "Do not force a hopeful ending onto a
sad note," and `design/gallery/record-exhibition/design.md` said "do not
force every sad note into a cheerful ending."

The owner reframed the Gallery's purpose as destruction → rebirth and wrote
this into `README.md` on 2026-10-30 (commit `98f8257`):

> "My revised direction for the Gallery is rebirth. Burning ends the
> original note and opens a contrasting emotional direction: sadness
> towards brightness, anger towards calm, powerlessness towards energy.
> Ambiguous notes can become mysterious works. I want image and music to
> carry that transformation together, using each note as the starting
> material for a new creation."

That passage is the authoritative statement of intent for this ADR.

## Decision

**The brief answers a note's weight with a contrasting, newly made feeling
instead of mirroring it.** `BRIEF_INSTRUCTION` now tells the model: a heavy,
sad or numb note becomes bright and lifted; an angry or pressured note
becomes calm and gentle; a weak or powerless note becomes bold and
triumphant; a note whose meaning is genuinely unclear leans mysterious. This
replaces the earlier "do not force a hopeful ending" guidance with its
opposite, for the dimensions that actually carry emotional weight:
`motion`, `palette`, `material`, and the general framing shared with
`relation`. The purely physical phrase dictionaries
(`METAPHOR_PHRASE`/`RELATION_PHRASE`/`MOTION_PHRASE`/`SPACE_PHRASE`/
`MATERIAL_PHRASE`) describe surface and texture, not mood, so none of them
needed to change — only the instruction's guidance on which enum value to
pick for a given note's mood changed.

Ambiguous or unreadable notes get one light instruction-level nudge toward
a mysterious reading; this is not a new schema field or enum member, by
design — it stays a soft bias the model applies, not a guaranteed branch.

### Vocabulary expansion

The existing three-member palette and timbre vocabularies were deliberately
restrained (cool blue-grey, deep sage, cobalt/ochre; soft piano, glass,
pad), so inverted guidance alone could only reach a diluted version of
"bright" or "bold." Two new values were added so all four target moods are
actually achievable:

- **`gold_dawn`** (palette): `"warm golden yellow and soft marigold against
  a pale rose-tinted cream, luminous and sun-washed"` — a bright, warm hue
  family distinct from the three existing palettes.
- **`bright_bell`** (timbre): a fast-attack, bell-like preset in
  `src/lib/gallery-synth.ts` (`attackS: 0.006`, `lowpassHz: 5_200`,
  inharmonic upper partials) — the fastest attack and brightest filter of
  the four presets, read as struck and bold rather than soft.

The tempo ceiling moved from 72 to 88 BPM and the velocity ceiling from
0.70 to 0.78 (`shared/music-score.ts`), giving the music enough headroom
for an energetic mood without exceeding the renderer's absolute 0.70
sample-peak limiter (`PEAK_LIMIT` in `src/lib/gallery-synth.ts`, unchanged
— a loud result is still clamped, never boosted).

Metaphor, relation, motion, space and material keep their existing
cardinality; only palette and timbre gained a member.

### The one disclosed exception: `motion: "unfolding"` now maps to 88 BPM

`shared/music-score.ts`'s `TEMPO_FOR` is keyed by the four existing motion
values, with no open slot for a new tempo tier. Reaching the new 88 BPM
tier therefore required reassigning an existing key rather than adding one:
`unfolding` moved from 72 to 88 BPM, reframed in the instruction as
"rising, gathering strength" rather than merely "a new beginning." Leaving
`TEMPO_FOR` untouched would have made the ceiling raise a no-op — a valid
`tempo_bpm` value no composer path could ever produce.

This is the only place in this change where an *already-assigned* enum
value's table entry changes meaning. Every other table (`SCALE_FOR`,
`MOTIFS`, `REVERB_FOR`, the three original `NOTE_BEATS`/`PRESETS` entries)
is untouched.

**Consequence, disclosed and accepted:** `artifact_jobs.brief` is never
cleared after publication (confirmed in `server/artifacts/store.ts`) and
`scripts/backfill-scores.ts` re-reads it with no re-validation of enum
*meaning* against the live tables. If that script is ever manually re-run
by an operator, an old published record whose stored brief has
`motion: "unfolding"` would recompose at 88 BPM instead of the 72 BPM it
was composed at when the record was first published. This is not automatic
— `scripts/backfill-scores.ts` only runs when an operator invokes it, and
per ADR 006 it only touches image-only records that never got a score, not
records that already have one. No currently-published score changes as a
result of this ADR; only a future manual backfill of a not-yet-scored,
`unfolding`-motion record would sound different from how it would have
sounded before this change. The owner's own reasoning (also used to accept
additive vocabulary generally) applies here too: an old image already
reflects the old visual direction, and a backfilled score drifting to match
the new tempo table is an acceptable, scoped cost, not a correctness bug.

## What does not change

- `CreativeBriefV2.schema_version` stays `2` — this is additive vocabulary,
  not a structural change. `parseBrief`'s `oneOf(PALETTES, …)` /
  `oneOf(TIMBRES, …)` checks against the live arrays, so every brief ever
  stored under the 3-member vocabularies remains valid forever.
- `COMPOSER_VERSION` (`"throwaway-score-v1"`) and `RENDERER_VERSION`
  (`"throwaway-synth-v1"`) are unchanged — the algorithm and every existing
  entry's values are unchanged except the one disclosed `unfolding`
  exception above; `parseMusicScore`'s strict equality checks still accept
  only these exact strings.
- `STYLE_PRESET_VERSION` moves from `"mineral-record-v2"` to
  `"mineral-record-v3"`, using the mechanism built for exactly this: an
  image prompt is rebuilt from the stored brief at generation time and
  never itself stored, so a new preset version changes nothing about
  already-published images and needs no migration.
- No new database column, migration, or route. No change to the burn
  transaction, extraction timing, budgets, inspection policy, or any
  public contract shape.
- Backfill is not re-run as part of this change, and this ADR does not
  recommend re-running it.

## Listening check

I asked someone outside the project to compare two Gallery tracks, one
intended to sound bright and the other calm. They heard a clear
difference between them and liked the music. The moods they heard only
partly matched what I had in mind.

## See also

- [ADR 005](005-release-keepsakes.md) — the original decision this ADR
  reverses the emotional-matching guidance of; source deletion, extraction
  timing and the one-attempt budget are untouched.
- [ADR 006](006-browser-synthesised-record-music.md) — the composer/
  renderer contract this ADR extends with one new timbre and tempo tier,
  not a new version of either.
- `design/gallery/record-exhibition/design.md` §5 and
  `design/gallery/record-exhibition/music-design.md` §4 — updated
  illustrative tables and the `MusicScoreV1` type comment.
