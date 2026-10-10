# Process overview

## From brief to product direction

I didn't start by asking an agent to build a full-stack app. I first used
Codex as a brainstorming partner to weigh several ideas against the brief —
in particular, whether multi-user, persistence and real-time behaviour would
matter to the experience itself, rather than being bolted on just to satisfy
the technical requirements.

That led to **Throwaway**: a shared anonymous space where people write down
something they've been carrying, crumple it, throw it away, and later come
across what strangers left behind.

I then used the `grillme` skill to pressure-test the idea decision by
decision. That settled: the site opens directly into the shared space, not a
personal archive; ownership exists for control, not retrieval; and future
interactions (witnessing, burning) should feel deliberate, not like
social-media engagement. It also named what to reject outright — likes,
comments, profiles, search, popularity ranking.

I wrote the first README myself to record these decisions and define what
"good" means for the project
([`7d955b3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/7d955b3)).

## From decisions to a harness

With the product direction settled, I used the Build Web Apps plugin to turn
the concept into screen-level design references and a Week 9 plan — fixed
scope, API, copy and acceptance gates
([`e1f8d44`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/e1f8d44)).
Concrete references to compare the implementation against, rather than an
open-ended "make it look good."

Those decisions became standing rules in `CLAUDE.md`
([`90fa5fb`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/90fa5fb),
image-generation rule added in
[`8715209`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/8715209)):
protect the human-written README, keep paper text out of WebGL textures,
require the server to confirm persistence before the throw animation plays,
never point the spec at the live app, never write my own reflection.

`spec/api.test.ts`
([`df3bd71`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/df3bd71))
is the main backpressure. It checks HTTP-level product promises, not
implementation details: exact cross-session text persistence, input limits,
no text or ownership leaking into list responses, idempotent retries, and
persistence across a database reopen.

My loop: **judgement → update plan/harness → Claude implements a bounded
change → automated checks → browser inspection → reference comparison →
refine the harness**. Codex and `grillme` did the product judgement; Build
Web Apps turned it into visual references; Claude was most useful once the
intended behaviour had already become an explicit constraint.

## Stack

A deliberately small stack: one Fly.io `shared-cpu-1x` machine (256 MB, one
volume), so storage, client and server choices stay simple enough for both
me and the agent to reason about and debug.

- **Data:** SQLite via `better-sqlite3` at `/data/throwaway.sqlite` —
  durable, single-machine state without a separate DB service. Trade-off: a
  Fly volume isn't replicated, so a multi-machine future needs a new storage
  decision.
- **Client:** Vite + React — most states (write, read, overlays) are
  conventional HTML UI; the 3D scene stays outside React's render loop.
- **Server:** Express 5 under Node 24 type stripping — a small API, no
  separate server build step.
- **`/readme/`** renders straight from `README.md`, so the argument being
  assessed is the same document that's versioned, not a second copy.

This also leaves a clear extension point: a socket layer for Week 10's
real-time behaviour can be added to this same server without replacing the
persistence model.

## Reusing the paper interaction demo

The hardest part of the concept wasn't the CRUD interface — it was making
paper convincingly crumple, unfold, fall and behave like a physical object.
Building that from scratch would have cost project time disproportionate to
the actual design problem.

I built on the MIT-licensed
[paper-crumple-demo](https://github.com/item-develop/paper-crumple-demo)
(Three.js + cannon-es + a Houdini Vellum simulation baked into Vertex
Animation Textures), at commit `f84648b0`, which already had the physical
behaviour I needed.

It's a foundation, not the application. The VAT assets and decoder came over
unchanged; the fictional branding was stripped so every paper shares one
plain material and no words reach the GPU
([`6d19813`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/6d19813)),
and the scene became a reusable `createPaperScene()` module keyed by
database paper ids, with its own `dispose()`
([`83c6fdc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/83c6fdc)).
Camera, lighting, colours and paper count were then retuned against
Throwaway's own references over several passes: a generated torn-paper
photograph now backs the write/read sheets instead of a flat card
([`982d8ee`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/982d8ee)),
a floor and wall replaced the flat backdrop
([`42c79a4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/42c79a4),
[`31c45d6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/31c45d6)),
and the crumpled-paper material was redone as a matte, less reflective
procedural surface
([`facca8a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/facca8a)).

Written text deliberately never reaches the WebGL texture — the 3D object
is the physical paper, the content is HTML — which keeps it accessible,
keeps private text off the GPU, and keeps the third-party rendering
technique separate from the app's own data. Full attribution is in
`THIRD_PARTY_NOTICES.md`.

## Corrections and feedback loops

A few failures changed the process itself, not just the code:

- **A human-authored file got overwritten.** The agent drafted a README from
  a design image and replaced the one I'd already written. Fixed by
  restoring my text and adding a rule: check an artefact's own commit
  history before letting the agent touch something I own.
- **Visual comparison caught what tests couldn't.** Unused FBX bounding-box
  vertices had inflated the measured geometry, so on-screen text didn't line
  up with the unfolded sheet; a staggered paper drop-in crashed the scene,
  caught by the browser console in a Playwright run; `/readme` → `/readme/`
  looped because Express matched both paths to the same route, caught by the
  starter's own invariant check.
- **Reference-driven passes on the scene itself:** the paper texture's torn
  silhouette was hidden behind a solid CSS fallback
  ([`e4b5916`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/e4b5916)),
  then found to still have transparent padding baked into the PNG itself,
  cropped out at the source
  ([`c83fcfc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/c83fcfc));
  fog added for room depth was tuned against the wrong distance and washed
  the floor back into the wall's own colour, so it was dropped rather than
  retuned
  ([`31c45d6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/31c45d6));
  contact shadows read far lighter than the references because the
  environment-map lighting isn't blocked by the shadow map at all, fixed by
  turning down the floor material's own `envMapIntensity`
  ([`69089df`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/69089df));
  and only the physics step was guarding against a stalled frame, so one
  long frame could jump the open/close/throw timers most of the way through
  the animation — the same clamp was added there too
  ([`6d96915`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/6d96915)).
- **Leftover Japanese comments from the vendored source** were translated to
  English across the three scene files, technical detail preserved
  ([`1fd69f9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/1fd69f9)).

The lesson that stuck: when an agent gets something wrong, don't just
re-prompt "fix it" — find what constraint or information was actually
missing, and turn it into a rule, a test, or a reference comparison.

## Evidence

- **Two-browser checks.** A scripted Playwright run has browser A write a
  paper; the count goes from N to N+1, and an independent browser B opens
  the same paper by keyboard and reads identical text back, including
  Chinese and a line break. No console errors, no horizontal overflow at
  390×844.
- **Restart (live).** Paper `62324d9a-df43-47a5-8631-e2fd2631efcd` read back
  identically before (13:53:56Z) and after (13:54:13Z, 5 Oct UTC)
  `flyctl machine restart`.
- **Redeploy (live).** The same paper read back identically after
  redeploying release v3 (image `deployment-01M465M29FHP9R8CAZNT98P3DD`,
  13:58:43Z), which shipped
  [`b926314`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/b926314).
  The starter's invariants passed against the live URL.
- **Without WebGL,** papers fall back to plain buttons that still open.
- **Screenshots** are in `docs/evidence/week9/`: the live empty state,
  writing, the throw after a save, browser B reading, phone views of the
  space/writing/reading/`/readme/`, `/readme/` on desktop, a local space
  with papers, and the no-WebGL fallback. Paper positions differ from the
  references by design — they land randomly.
- **Dialog and matte-paper pass.** `facca8a` widened the reading column,
  preserved the texture's cut-out edge, and replaced the paper-ball material
  with a matte procedural surface (no words, disposed with the scene).
  Re-validated against a temporary SQLite database: typecheck and all 12
  tests passed, as did the production build; manual checks covered desktop
  1440×900 and phone 390×844 for rendering, open/close and the write window,
  plus long bilingual text and independent scrolling at 1920×1080.
- **Not verified:** performance on real phone GPUs (screenshots used
  software WebGL); a local `docker build` (the daemon wasn't running — Fly's
  remote builder is the image check); the GitHub CI run, which only starts
  once the repo is public.

### Week 10 (C9) evidence

Facts only; the account of how the week went is mine to write.

- **Scope.** `plan.md` and its twelve references replaced the Week 9
  package, and `CLAUDE.md` was rescoped to it
  ([`d1e6b8c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/d1e6b8c)).
- **Built.** Versioned migrations, a shared revision and SSE
  ([`2a9f943`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/2a9f943),
  [`594b830`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/594b830));
  Keep/Release and witnessing
  ([`b35b8ee`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/b35b8ee),
  [`60b7613`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/60b7613));
  letting go and final reading
  ([`db19918`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/db19918),
  [`947450f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/947450f)).
  The decisions are in `docs/adr/001-sse-snapshots.md` and
  `docs/adr/002-active-reader-final-read.md`
  ([`06e2edd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/06e2edd)).
- **Migration.** The live database was backed up on its volume
  (`/data/backup-pre-c9-2026-10-08.sqlite`, plus a local copy) and the
  migration was rehearsed on a copy first: its 4 papers kept their text and
  became KEEP, 9 identities and sessions kept. On deploy the app logged
  versions 1–4, and paper `62324d9a…` from Week 9 still reads back.
- **Live, three sessions (8 Oct, after `06e2edd` deployed by CI).** Two
  browsers on the deployed app, a third client saving over HTTP: both
  browsers showed the new count 509 ms and 377 ms after the save was sent
  (network included), with no dialog opened; letting it go reached them in
  380 ms and 519 ms; the paper then answered 404. The event stream is served
  over HTTP/2 and its snapshot arrives unbuffered.
- **Checks.** 32 HTTP specs, run by CI against the Docker image on every
  push: live arrival within a second to three streams, no broadcast for
  refused or retried saves, reconnect reconciliation, witnessing counted
  once per identity, author acknowledged but not counted, receipts required,
  rights checked server-side, simultaneous let-go happening once, idempotent
  retries.
- **Corrections found by looking.** The torn HTML sheet showed the flat 3D
  sheet as a grey rectangle around it once the backdrop was made clear; it
  now hides once covered. The write dialog's scroll box clipped the sheet's
  shadow into a visible rectangle. The first let-go ending faded a flat
  grey card; it now crumples, darkens and fades. Several count assertions
  raced between spec files; the files now run one at a time.
- **Not verified for C9:** real phone GPUs; behaviour behind networks that
  buffer streams; cold-start latency after Fly stops the machine (measured
  above only with the machine already running).

### Final MVP evidence (in progress)

Facts only, added as the work lands.

- **Return keys (P4).** Issued once after a Keep, stored only as a digest,
  never shown again once confirmed saved; restoring one maps a new browser
  to the identity's rights and witness record, and returns no history
  ([`68db6b4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/68db6b4),
  [`a36c8df`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/a36c8df)). The live
  database was backed up first (`/data/backup-pre-p4-2026-10-08.sqlite`) and
  migrated to version 5 on deploy. Six more HTTP specs (38 in all) cover
  issuing, replacement, restore, wrong keys and rate limiting.
- **Moderation and reporting (P5): not built.** The course image proxy did
  not answer from the Fly machine, so no automated check is configured, and
  the report action stays hidden rather than promising a check that does not
  exist. It waits on choosing a moderation service.
- **Visual pass (P6).** Against D01/M01 the floor/wall seam now fades over
  the back of the stage, the paper is ivory, shadows are softer and papers
  spread across the width, roomiest spot first on a phone
  ([`28fc6e8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/28fc6e8)); the readme
  follows D06's serif hierarchy
  ([`e982d5c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/e982d5c)).
- **Corrections found by looking (P6).** In a keyboard check, closing a
  paper left focus on the page body: the field was still inert and the
  paper's button hidden while it crumpled back. Focus now returns once the
  button is back, and to "Leave something here" after the write dialog
  ([`dad880a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/dad880a)). In the
  spec run, a long-running local server failed two return-key specs with 429
  because earlier runs had used up its in-memory failure allowance. CI starts
  a fresh container each time, so only local reruns are affected; locally
  the specs are now run against a freshly started server.
- **Parallel tracks (P6).** Two sub-agents worked in separate worktrees on
  disjoint files, without pushing; each change was reviewed, merged and
  re-checked together before one push. Papers arriving from other visitors
  now drop from inside the top quarter of the frame and settle in about a
  second instead of falling unseen above it
  ([`50974ba`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/50974ba)). The
  phone reading sheet grows from about six visible lines to ten (M03), and
  the write, key, confirm and final-reading sheets were brought closer to
  D02/M02, D04, D05 and D07
  ([`b9c290f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/b9c290f),
  [`15da446`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/15da446)). Deployed by CI
  at `a2d606b`; the Week 9 paper still reads back.
- **Checked in a browser (local, fresh database):** a 2,000-code-point
  Chinese/emoji/newline paper reads back exactly and scrolls inside the
  sheet at 1672 and 390 wide with no sideways page scroll; without WebGL the
  fallback still receives a paper thrown elsewhere and opens it; with
  reduced motion a throw still lands and the count moves.

## 2026-10-09 — furnace fidelity and audit corrections

This is a local, uncommitted implementation pass requested after review of
Claude's furnace work. The user supplied B01, 01-space and 02-write and asked
for a better iron furnace and restored matte paper folds, together with the
audit fixes. Existing staged safety work was preserved; no reflection was
written, no production paper was changed, and no push or deploy was performed.

- The furnace now has straight iron walls, a thick worn crown, pitted normal
  relief, a lower ritual camera and visible layered ash. Desktop preparation
  uses depth of field; mobile uses smaller side papers and a short-screen
  composition. Edge wrinkles use one newly generated paper texture, with a
  quieter reading centre. The original paper-crumple-demo animation remains.
- The audit reproductions became regressions: an old HTTP result must match
  its paper and operation; fallback timers belong to one ritual; eight-second
  request timeouts cover stalled or damaged response bodies; effects failures switch to
  drawn paper/furnace/ash; remote no-WebGL endings finish; shader edge ordering
  is defined; report decisions are bounded even when more reports arrive
  during a check, and multiple notes go to human review without being erased.
- Submission disclosure and the report entry now follow the server's public
  safety configuration. ADR 003 records placement and recovery; ADR 004 records
  OpenAI checks, privacy, review limits, uncertain cases and the operator CLI.
  These document local implementation, not proof of live moderation quality.
- Validation: a fresh temporary database and freshly started service passed
  type checking and all 99 tests in 12 files. Build passed. An earlier rerun
  against an already-used service hit intentional rate limits and its cached
  older README; restarting a clean test service resolved those environment
  failures without weakening the limits or the README test.
- Regular Playwright was used because the Browser plugin was not available.
  Chromium reported the Apple M4 Pro Metal renderer, so this pass used the
  Mac GPU rather than software rendering. Checked 1672×941, 1920×1080, 390×844
  and 390×480. Normal screens had no console errors or warnings; deliberately
  broken WebGL/textures produced expected errors and usable fallback endings.
- The five earlier browser failures passed their reproductions. Pointer drag
  into the real opening completed; outside drag and resizing before placement
  left the paper intact. Other-session count delivery measured 124 ms locally,
  with combustion at the original position and no observer furnace. Reduced
  motion completed in about 1.9 s. Local ash persisted, with the return button
  enabled after three seconds. Screenshots and temporary browser scripts remain
  outside the repository.
- Limits: no paid real-provider request, live credential verification, physical
  phone or Safari test was performed. Docker's daemon was unavailable, so the
  container build was not verified. CI/deployment remains a separate step.


## 2026-10-10 — visual and ritual release

The user approved deploying the interface and furnace corrections first,
while keeping the existing paper publication flow. OpenAI moderation and
report processing remain local pending credential configuration; they are
not part of this release. Their original staged files are preserved.

- [6f098db](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/6f098db)
  restores matte paper folds and fibres, continuous read/write sheet texture,
  the straight cast-iron furnace and its lower camera. It fixes late release
  replies, stale fallback timers, stalled/damaged HTTP responses, effect
  failures and slow-renderer burn timing. Ash holds for three seconds before
  the visible return button becomes available. ADR 003 records the tradeoff.
- A consistent live SQLite backup was made before pushing, at
  `/data/backup-pre-material-pass-2026-10-10.sqlite`, with a private local copy.
  It passed `integrity_check`, was schema version 6 and contained four active
  papers. This selected release makes no schema or publication API change.
- The isolated release passed type checking and all 63 tests in nine files:
  the existing 55 plus eight release-recovery regressions. Vite build passed
  with the existing large Three.js bundle warning. Process evidence resolves.
- Browser plugin was unavailable, so regular Playwright checked Chromium at
  1672×941 and 420×685 using the Mac GPU. An actual local submission returned
  201, its words read back, witnessing enabled release, the furnace prepared,
  and cancellation left the paper available (200). Both sheets had a filled,
  continuous texture. Normal flows had no console errors or warnings.
- A first browser attempt reached the build placeholder because its test
  service had started before the build existed; restarting after the build
  resolved that setup problem. A sandboxed test attempt could not reach the
  local service; the authorized local-network run passed without test changes.
- No physical phone or Safari check was performed. The local Docker daemon
  is unavailable; the GitHub check job builds and tests the deployment image
  before its dependent Fly deploy job. Live verification follows that run.
- Machine-local credential files are excluded from both Git and remote build
  contexts, including the existing misspelled local configuration filename.
  No reflections, course tags, paid-provider requests or live paper content
  were changed by this release preparation.


- Deployment verification: [checks and deploy run 37937921675](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/actions/runs/37937921675)
  passed the Docker build, specs, evidence and secret scans, then deployed
  commit d324ca2 as Fly release 29. Fly's machine image label matches that
  commit. The original 15 staged moderation files retain their exact blob
  contents on top of this release; they remain unpushed pending credentials.
- Live browser verification then passed at 1672×941 and 420×685: HTTP 200,
  the new CSS and paper texture matched the checked release, both completed
  read/write sheets used a filled texture, and publication controls remained
  enabled. Console errors/warnings were zero. Existing papers were only read;
  no live paper was submitted, witnessed or destroyed during verification.
  Read-only database verification reported schema 6, integrity ok and all four
  original active papers unchanged.

## 2026-10-10 — local moderation and operator verification

The user asked to continue the retained moderation work and explicitly chose
local development/testing because no OpenAI key is configured. This step is
uncommitted, unpushed and undeployed; production remains the earlier visual
release. The existing staged moderation files are preserved for review.

- Added bounded publication/report requests and kept the original payload for
  an unknown-outcome retry. A failed safety configuration fetch can be retried
  from the open writing sheet without losing its draft.
- Tightened report operation-key matching: an original empty note no longer
  permits replacement context before the retention deadline. After expiry,
  retries can still return the original receipt without retaining old notes.
- Bounded internal worker failures at three attempts with identifier-only logs.
  A queued operator decision takes precedence over a late automatic result.
  Conflicting context arriving during a check follows the same human routing
  as context present at its start.
- Added thirteen regressions. A fresh schema-7 database and fixture server
  passed type checking and all 112 tests in fourteen files. The client build
  passed with the existing large Three.js bundle warning. An extra test run
  mistakenly reused a rate-limited server and ran the whole suite because of
  argument forwarding; restarting on a fresh database resolved the setup
  failure, without relaxing the rate limits or changing HTTP assertions.
- Browser plugin was unavailable, so regular Playwright checked Chromium
  with the Mac GPU at 1672×941, 390×844 and 390×480. Correct page content,
  primary controls, absence of framework overlays, console output,
  interactions and rendered screenshots were checked. Normal report/draft
  flows had zero errors and warnings; deliberate HTTP refusal and lost-reply
  tests produced their expected network errors and no JavaScript exceptions.
- Browser tests refused a draft without publishing, allowed revision, and
  lost all three publication replies after the save reached the server. The
  subsequent manual retry used the same key and left just one paper. A lost
  report reply held its reason/note and the retry received the original
  receipt. Desktop and short-phone report notes remained reachable by scroll,
  buttons remained usable, cancellation worked and the sheet texture stayed
  continuous. Screenshots waited for the sheet's reveal transition to finish.
- Two readers lost quarantined words in 37 ms locally, without fire. A
  separate no-key server blocked publication, retained an editable draft and
  kept existing reading available. Its report entered human review; private
  CLI list/inspect/resolve worked against synthetic data. Operator quarantine
  cleared both readers and lowered the total once to zero.
- Added docs/moderation-runbook.md for private key loading, future staged Fly
  secret configuration and human review duties. The OpenAI adapter contract
  was checked against official moderation and structured-output documentation.
  Fixtures prove mechanics only: no real moderation quality, paid request,
  live credential or deployment is claimed. Docker remains unavailable;
  physical phone and Safari were not tested. Reflection files were untouched.

## 2026-10-10 — local real-provider smoke check

The owner configured OPENAI_API_KEY in ignored mise.local.toml after the
local-only implementation. Mise loaded the key without displaying it. The
file is excluded from Git and Docker, its permissions were restricted to
the owner, and the client build contains no copy of the key.

- Checked the OpenAI Docs moderation and structured-output contracts. The
  pinned model's metadata query returned 403, but actual category and policy
  requests succeeded; the key was not broadened merely to query metadata.
- Five small real-service checks used only synthetic text in an isolated
  local SQLite database. An ordinary emotional statement was allowed; safe
  HTTP publication returned 201 and read back correctly. A synthetic scam
  returned 422 without increasing the count. Report review used the real
  OpenAI provider and quarantined a synthetic legacy scam.
- The temporary smoke harness initially expected `total` in an SSE event
  whose documented field is `active_total`. Database inspection confirmed
  the first quarantine succeeded. The harness was corrected and only the
  report case was repeated: both sessions received the correct event, the
  total decreased once from two to one, words were cleared, and reopening
  returned 404. Review plus event receipt took 2006 ms; this is external
  review duration, not a measured post-commit SSE propagation time.
- Updated the operations runbook to use mise for local startup and distinguish
  local credentials from future Fly secret configuration. Existing staged
  changes remain intact. No push, deployment, Fly secret change, production
  paper modification or reflection editing occurred. This tiny smoke sample
  establishes access and integration, not broad classifier accuracy.

## 2026-10-10 — moderation release preparation

The user explicitly requested commit and push. Since main automatically
deploys, this also required configuring the real server secret for the release
so the newly fail-closed publishing path would remain usable.

- [351439c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/351439c)
  commits the retained Claude moderation implementation, its corrected review
  races and retry boundaries, server-driven disclosure/report UI and thirteen
  additional regressions. No local credential files or reflections are included.
- Reran type checking and all 112 tests in fourteen files against a fresh
  isolated fixture server, then the client build and process-evidence check.
  All passed; the existing Three.js bundle-size warning remains. Docker's
  local daemon is unavailable, so container validation belongs to the
  mandatory GitHub check job before its dependent deployment.
- Created /data/backup-pre-moderation-2026-10-10.sqlite and an owner-only local
  copy. Integrity was ok, schema version six and four papers were ACTIVE.
  Migrating a separate copy to schema seven preserved every existing column
  and row in all eight original tables; integrity remained ok.
- Staged only OPENAI_API_KEY and MODERATION_PROVIDER=openai in Fly secrets
  using stdin. The old machine was not restarted at that stage. Scanned the
  staged code for the actual configured credentials without displaying them;
  none were present. Private configuration remained excluded.
- The [checks and deploy workflow](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/actions/workflows/checks.yml)
  records the container, secret-scan and Fly deployment result for this push.
  A pushed revision alone is not deployment proof. Live verification must
  check the machine image, safety configuration, readable existing content
  and database preservation. General moderation accuracy remains limited
  by the small synthetic smoke sample.

## 2026-10-10 — loading and furnace choreography release

The owner requested faster loading, a simple reading close icon, neutral
cast iron, a smooth low-to-overhead burn viewpoint and preservation of the
surrounding paper population. The earlier checkbox reminder and room depth
changes are included; the paper model and material remain unchanged.

- [75e3256](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/75e3256)
  defers the Three.js scene behind the usable app, preloads model data and
  compresses fixed scripts/styles once at server startup. SSE stays
  uncompressed and private API replies keep their existing cache policy.
- The furnace uses neutral cast-iron relief and a thick bevelled rim. Its
  camera moves overhead only after confirmed destruction. Existing papers
  move aside with their original poses retained; the furnace disappears
  before the papers return, then physics resumes. New arrivals are handled
  during the ritual rather than dropped belatedly afterward.
- Final production build, type checking and all 115 tests in fifteen files
  passed against an isolated local fixture database. Added regressions for
  gzip/identity cache variants, the accessible reading close button and
  unchecked confirmation without publication. No production test data was
  created. The existing deferred Three.js chunk-size warning remains.
- Browser-plugin tools were unavailable, so Playwright used Chrome with
  hardware GPU rendering. Desktop mouse drag, phone Place, cancellation,
  server refusal, a short phone viewport, reduced motion and no-WebGL
  fallback were checked. Paper counts persisted during preparation and
  restoration matched the saved positions; the furnace retreat preceded
  the return animation. Physical touch devices and Safari were not tested.
- Three cold local runs under identical throttling measured median live-count
  display at 1466 ms versus 4554 ms before, and first paper at 10058 ms versus
  13482 ms. These are controlled local comparisons, not Fly latency claims.
  Individual reading fetches showed no meaningful speed improvement.
- The owner then authorized commit, push and deployment. Configured
  credentials were scanned without disclosure and remain ignored/excluded
  from the build context. No schema, Fly secret or reflection change is part
  of this release. The dependent GitHub checks/deploy workflow must finish
  and the live assets must match before deployment is claimed complete.

## 2026-10-10 — reading reveal artifacts and initial focus

The owner reported straight translucent strips above/below the reading sheet
during opening, and a persistent initial circle around its close icon.

- [d8a0d68](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/d8a0d68)
  replaces the 300 ms delayed hiding of the flat WebGL paper with an immediate
  handoff to the HTML sheet, whose scene-backed surface now appears without
  an opacity fade. The rectangular mesh no longer protrudes around torn edges;
  closing still restores the mesh for crumpling.
- Isolated the cause locally by disabling HTML shadows, hiding the canvas
  and disabling the reveal transition separately. Removing HTML shadows
  retained the strip; hiding the canvas removed it. The initial close circle
  was the global focus-visible outline triggered by button autofocus.
- Initial focus now goes to the native reading dialog, with no dialog outline.
  Tab still reaches the close icon and displays its keyboard focus indicator.
  React's dialog autoFocus prop did not set the native attribute in the
  browser; replaced that attempt with explicit native focus after showModal.
- Browser-plugin tools were unavailable; Playwright/Chrome checked desktop
  1672 x 1040, phone 390 x 844, reduced motion and forced no-WebGL fallback.
  Each ran three open/close cycles, including Escape and Tab. First-reveal
  and subsequent screenshots were captured through 2200 ms. The strips and
  initial ring disappeared, totals stayed unchanged, and there were no paper
  publication, witnessing or destruction requests. Normal cases had no
  console errors/warnings; forced no-WebGL produced only the expected context
  errors and unused-preload warnings. Safari and physical touch were untested.
- Production build and all 115 checks in fifteen files passed against a fresh
  isolated fixture database. An intermediate recheck against a reused fixture
  database and stale startup asset cache was discarded; restarting against a
  fresh database after the final build restored the valid test conditions.
  The existing deferred Three.js chunk-size warning remains.
- This follow-up release uses the existing main-to-Fly workflow. No schema,
  moderation configuration, credentials, paper material or reflection changed.
  Live deployment verification must compare the workflow and served assets;
  local browser evidence alone is not a claim about production.
