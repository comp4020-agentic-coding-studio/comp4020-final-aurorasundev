# Evidence: two visitors, real time, at the crit 10 commit

Two independent Chromium contexts (A and B), each its own cookie jar, driven
by Playwright against the code as it stood for crit 10
([`0c802eb`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/0c802eb)),
run locally on a fresh temporary database with fixture moderation. Not
production, and no manual retouching: each pair is a real SSE push landing
in the other visitor's open room, caught as close to the moment as polling
the header's live count allows.

| Shot | What it shows |
| --- | --- |
| `b-before-arrival.png` | B's room, empty, just before A throws |
| `b-paper-arrived.png` | the same room a moment after A releases a paper: the count moves from 0 to 1 and the new paper is lying on the floor, with no reload and nothing pressed in B |
| `a-before-burn.png` | A's room, the paper still whole, just before B burns it |
| `a-paper-self-ignites.png` | the same spot on A's screen the moment B's burn commits: the count drops to 0 and the paper is already ash, again with nothing pressed in A |

This is the pair PROCESS.md's "Share the room" walkthrough describes in
words; these four frames are that walkthrough actually happening between
two browsers.
