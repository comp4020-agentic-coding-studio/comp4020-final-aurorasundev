# Throwaway design and Claude handoffs

Open the folder for the feature you are working on. Each one puts the design,
implementation brief and relevant visual references together. For current
product rules, start with [CLAUDE.md](../CLAUDE.md). [Decision records](../docs/adr/)
explain what shipped and what changed. The [process overview](../PROCESS.md)
links those choices to the development history.

## Shared room and furnace

- [C9 implementation plan](room/c9-implementation-plan.md) — the original plan
  for writing, reading, real-time updates and multi-user permissions.
- [Claude handoff for the furnace and safety](room/claude-furnace-and-safety-handoff.md)
  — interaction, visual states, moderation and the checks requested in the
  October 8 correction prompt.
- [Shared visual references](room/reference-images/) — desktop, mobile and
  furnace states used by both documents. The old return-key screen records
  the earlier design. [ADR 009](../docs/adr/009-optional-accounts.md) covers its replacement.

## Gallery

- **AI keepsakes** — the first [feature design](gallery/ai-keepsakes/design.md)
  and [Claude implementation plan](gallery/ai-keepsakes/implementation-plan.md).
  [ADR 005](../docs/adr/005-release-keepsakes.md) records the implemented
  generation and publication flow. [ADR 008](../docs/adr/008-rebirth-reversal.md)
  records the later move to emotional contrast.
- **Record exhibition** — the [visual design](gallery/record-exhibition/design.md),
  [technical notes](gallery/record-exhibition/technical-notes.md),
  [reference images](gallery/record-exhibition/reference-images/),
  [image prompts](gallery/record-exhibition/image-prompts.md),
  [asset prompts](gallery/record-exhibition/asset-prompts.md) and
  [Claude revision handoff](gallery/record-exhibition/claude-revision-prompt-2026-10-19.md).
  [Music design](gallery/record-exhibition/music-design.md) explains the score
  and browser playback.
- **Entry and record belt** — the later [mist, orbit and open/close design](gallery/entry-and-belt/design.md)
  supersedes the initial browsing layout. It includes the
  [type specimen](gallery/entry-and-belt/font-specimen.html).

For another feature or revision, put its design, Claude prompt and reference
material together under `design/<feature>/`. Mark a superseded handoff with
a link to the newer decision so the original brief stays useful as history.
