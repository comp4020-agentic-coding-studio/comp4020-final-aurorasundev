# Process overview

## From the brief to a plan

Throwaway's design (what it is for, what "good" means, what is deliberately
absent) is mine and lives in `README.md`
([`7d955b3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/7d955b3)).
Before any code I turned the C8 brief into a Week 9 contract for the agent: a
plan with fixed scope, API, copy and acceptance gates, plus eight design
references, one per screen and viewport
([`e1f8d44`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/e1f8d44)).
The plan's main job is to say *no*. Keep / Release, witnessing, burning,
real-time, recovery codes and social features are all out for this week, and
the agent may not stub them or leave buttons for them.

## Harness

`CLAUDE.md` turns that scope into standing rules
([`90fa5fb`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/90fa5fb)):
- only `/` and `/readme/`
- the throw plays only after the server confirms the save
- no paper text in WebGL textures
- never point the spec at the live app
- never write my reflection

An image-generation rule was added later
([`8715209`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/8715209)).

The backpressure is `spec/api.test.ts`, alongside the starter's invariants
([`df3bd71`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/df3bd71)).
It asserts the contract over HTTP, not the implementation:
- text reads back exactly in another session
- blank and over-2,000-code-point papers are refused
- the list carries no words or owners
- a retried submission is the same paper
- a paper survives the database being reopened

## Decision record: first stack

**Context.** One shared-cpu-1x machine with 256 MB and one volume. The papers
need a real shared store. The crumpled paper is a vanilla Three.js +
cannon-es demo I wanted to reuse rather than re-create.

**Decision.**
- **Client:** Vite + React for the HTML states (space, writing, reading).
- **Paper:** the demo's own Three.js code wrapped as an init/dispose module, not
  React Three Fiber.
- **Server:** Express 5, run directly by Node 24's type stripping, so the server
  has no build step.
- **Data:** SQLite through better-sqlite3 at `/data/throwaway.sqlite`.
- **`/readme/`:** rendered on the server from `README.md`.

**Consequences.**
- One process and one origin keep the deploy simple. Single-instance SQLite
  means a short outage on deploy, and there is no replication: a Fly volume
  is neither shared nor copied between machines.
- Real-time (Week 10) will need a socket layer added to this same server.
- If the app outgrows a single machine, the store has to change, and that will
  get a new record.

## Reusing the paper demo

The paper is
[paper-crumple-demo](https://github.com/item-develop/paper-crumple-demo) at
commit `f84648b0` (MIT, nagasawa / ITEM Inc.). The assets and the VAT decoder
came over unchanged except for debug flags. `paper.js` lost the fictional
brand print, so every paper shares one plain material and no words can reach
the GPU
([`6d19813`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/6d19813)).
`main-vat.js` became `createPaperScene()`, keyed by database ids, with a
`dispose()`. The camera, colours and phone settings were retuned against the
references
([`83c6fdc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/83c6fdc)).
`THIRD_PARTY_NOTICES.md` lists every change.

A second comparison pass against D01/M01 retuned the camera, lighting and
visible-paper count again, and a third pass fixed the write and reading
sheets: the flat HTML card never read as paper, and making it transparent to
show the bare unfolded mesh didn't either, so a generated photograph of a
torn, creased sheet now backs both as a CSS `background-image`
([`982d8ee`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/982d8ee)).
It only changes how the already-finished unfold looks once revealed; the
geometry, physics and the rule that paper text never reaches a WebGL texture
are untouched. `README.md` was also cut down to the length the D04/M04
references actually show
([`2baa50c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/2baa50c)).

A fourth pass answered a direct comparison against the demo's own screenshot:
its wall-and-floor corner reads as a real room, where the space had only a
flat backdrop colour. A lit floor plane plus a flat wall plane were added
behind it ([`42c79a4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/42c79a4)),
and the wall was given a colour of its own rather than the background's
([`31c45d6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/31c45d6)).

## Corrections along the way

- **The README was overwritten.** The agent drafted a README from the D04 design
  image, which replaced the one I had already written. It noticed my commit
  while gathering hashes for this file. It restored my text and only added the
  Week 9 scope, the future work and the references. The plan had said to use
  my README; the fix was to check `git log` for my own commits before writing
  any file I own.
- **The reading layer didn't line up with the sheet.** The HTML words sat off
  the unfolded 3D sheet, which the screenshot comparison against D03 showed.
  The FBX contains dummy bounding-box vertices that the demo excludes from its
  triangles but that still inflate the geometry's bounds. The sheet is now
  measured from the vertices its triangles use.
- **The scene crashed while papers were dropping in.** Papers waiting for their
  staggered drop-in were iterated as if they existed. The browser console in a
  Playwright run caught it.
- **`/readme/` looped.** A `/readme` → `/readme/` redirect looped because
  Express matches both paths with the same route. The starter's invariant
  check caught it before the first commit.
- **The paper's own torn edge was hidden by a rectangle.** The replacement
  `paper-sheet.png` is alpha-matted to a torn-paper cutout, but the dialog's
  CSS filled the transparent corners with a solid fallback colour, so a
  rectangular edge showed past the texture's own silhouette. Swapping the
  fallback for `transparent` and the shadow for a `filter: drop-shadow` that
  follows the alpha channel fixed it
  ([`e4b5916`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/e4b5916)).
- **The depth fix undid itself.** The fog added for the wall/floor depth
  pass was tuned against straight-line distance, not the camera's actual
  distance to the floor at its angle (height and depth together), so almost
  the entire visible floor was already past the fog's far end and rendered as
  the wall's own colour — the two planes read as one flat backdrop again,
  the opposite of the point of adding them. It was dropped rather than
  retuned, since the reference's wall/floor shot has a crisp seam, not a
  soft one
  ([`31c45d6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/31c45d6)).
- **Only the physics step was guarding against a stalled frame.** Comparing
  the open/discard animation against the demo's own source after a report
  that it looked ugly found no difference in the constants, easing or VAT
  playback — both only cap a single frame's elapsed time for the physics
  step, not for the unfold/crumple timers next to it, so one long frame (a
  paused tab, a slow phone) can jump those timers most of the way through
  the animation and make it look like it snapped. The same cap was added
  there too
  ([`6d96915`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/6d96915)).
  Not confirmed as the cause of the specific report, since it only reproduces
  under an artificially slow frame rate, not normal GPU playback.

## Evidence

- **Two-browser checks.** Locally and on Fly, a scripted two-browser run
  (Playwright, Chromium) has browser A write a paper. The count goes from
  N to N+1, and an independent browser B opens the same paper by keyboard and
  reads identical text, including Chinese and a line break. The run reported
  no console errors and no horizontal overflow at 390×844.
- **Restart (live).** Paper `62324d9a-df43-47a5-8631-e2fd2631efcd` read back
  identically before (13:53:56Z) and after (13:54:13Z, 5 Oct UTC)
  `flyctl machine restart`.
- **Redeploy (live).** The same paper read back identically after a redeploy
  to release v3 (image `deployment-01M465M29FHP9R8CAZNT98P3DD`, 13:58:43Z),
  which shipped
  [`b926314`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/b926314).
  The starter's invariants passed against the live URL.
- **Without WebGL.** The papers fall back to plain buttons that still open.
- **Screenshots** are in `docs/evidence/week9/`:
  - the live empty state, writing, the throw after the save, and browser B
    reading
  - phone views of the space, writing, reading and `/readme/`
  - `/readme/` on desktop
  - a local space with papers
  - the fallback without WebGL

  The papers' exact positions differ from the references by design: they
  land randomly. The models are the demo's own rather than the references'
  rendered paper.
- **Not verified:**
  - performance on real phone GPUs; screenshots came from software WebGL
  - a local `docker build`, since the Docker daemon wasn't running; Fly's
    remote builder is the image check
  - the GitHub CI run, which only starts once the repo is public
