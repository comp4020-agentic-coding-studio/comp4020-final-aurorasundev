# Throwaway — agent harness

Throwaway is a shared space where everyone else meets your papers
anonymously: write a thought on paper, crumple it, throw it into the space,
come across papers other people left. An account is optional (ADR 009).
This repo is the COMP8020 final project; crits 8, 9 and 10 run in it.

## Current scope: final project

Use these rules, the accepted ADRs and the checks in `spec/` for the shipped
room, furnace, moderation, Gallery and optional accounts. Start at the
[design index](design/README.md) for the plans, Claude handoffs and visual
references. The original C9 plan and the room references (D01–D08 desktop,
M01–M04 mobile) are in `design/room/`. Read the relevant reference before
changing the interface. Apply the current rules when a dated handoff or
image shows a superseded flow.

For the furnace and material pass, also use B01–B05 and the user's approved
`01-space-desktop.png` and `02-write-desktop.png`. B01 defines a squat,
matte cast-iron cylinder with a thick worn rim and shallow view of the
opening. Preserve the actual paper-crumple-demo model and animation;
restore folds and fine paper tooth without metallic highlights or noisy
fibre relief. Writing and reading sheets have wrinkled edges and a quiet
readable centre. Keep phone controls and captions clear of the paper.

- Routes: `/` (space; writing, reading, confirming, reporting, signing in and
  your papers are *states* of it), `/gallery/` and `/readme/`. Never add
  `/write`, `/paper/:id`, `/me`, profiles or share links.
- Never build: a latest feed, search, ranking, public profiles or author
  pages, comments, likes, follows, editing papers, bulk destruction, points,
  countdowns, online lists, cursors, reader counts or per-frame broadcasts.
- Optional accounts (ADR 009) are the one personal view, and it stays
  private: a signed-in person's panel inside `/` lists only their own active
  papers (grouped Kept by you / Released) and the records their released
  papers became, with no witness
  counts or other figures, never shown to anyone else, never in an event.
  The username is shown only to its owner; nothing public names an author.
  Accounts are a username and password, no email. Passwords are scrypt
  (N=2^14, r=8, p=5, sized for the 256 MB machine, two at a time) sealed
  with `ACCOUNT_PEPPER`, a Fly secret that must never change; on Fly without
  it, accounts report themselves unavailable and guests carry on. Sign-in
  and sign-up rotate the session cookie. A guest's papers move to the
  account they sign into.
- The Gallery (ADR 005, docs/artifacts-runbook.md) is the one requested
  exception: a burned **Release** paper can leave one inspected, independent
  AI image if generation succeeds and the image passes inspection. Keep
  papers are ineligible. The burn transaction reads the note once in
  memory just before clearing it. After the reply, one bounded request
  (15 s) turns it into a strict creative brief, and only the brief is stored.
  Failure, timeout or restart leaves no record and no fallback. A released
  paper's fire holds until extraction settles (at most 15 s, never under
  4.8 s). Public objects use an allowlisted shape and an independent id, with
  no link back. An image request with an unknown outcome is never resent
  automatically. It is an unordered record exhibition (no feed, ranking,
  counts, likes or comments), and loads no room code. The browse layout
  is `design/gallery/entry-and-belt/design.md`, which supersedes G01's
  orbit; G02/G03 (opened record, report) keep their content. An entry
  screen with the centred title (Gloock, self-hosted) half-hidden under a
  dense, breathing, pointer-parted mist veil leads by one gesture into the
  exhibition on the stage plate: a deep-charcoal vinyl idle-spinning and
  slowly tumbling at the centre, a counter-rotating graphite globe behind
  it and a belt of 10 cards (6 on phone) in front of it on Goodgrowth's
  latitude-curved band, under an orthographic camera. When that band can't
  fit the width (`beltVertical()` in `belt-layout.ts`: phones and narrow
  windows) the orbit turns a quarter turn to run vertically, and an opened
  record stacks the disc above its sleeve (design §7e). Cards break into
  and gather from particles only in the dissolve zones at the globe's
  sides, where replaced records arrive; operator hides dissolve in place.
  Opening a record is one slow timeline of about 5 s (neighbours dissolve,
  sleeve forward over a fading-in mineral ground, disc turns once in the
  sleeve, slides out, title letter by letter); the HTML takes over only on
  its completion. Pure rules live in `src/scene/belt-layout.ts`,
  `particles-plan.ts`, `record-timeline.ts` and `gallery-motion.ts`, with
  specs; reduced motion or no WebGL gets the grid. A pale paper tag
  above a record's name (HTML only, never on the cards) reads "Arrived
  recently" (the server's coarse 24 h `recent: true`, never a time) or
  "New to you", and an opened record reads "Not heard yet". Both
  are held only in this browser's `localStorage` (`record-marks.ts`) and are
  never sent (owner, 2026-10-27; ADR 005 revision). The one exception to
  the unordered exhibition is the entry (owner, 2026-11-08): the belt's
  front three places go to records this browser has not opened, recent ones
  first (`entry-front.ts`); the live snapshot also lists up to 12 recent
  records, in id order, so one past the first page can come forward. The
  choice is made once; turning, paging and arrivals then keep their rules.
  Pages stay in id order, and there is still no latest view. Sound is
  **implemented behind `GALLERY_MUSIC_ENABLED`, which the owner turned on
  in production on 2026-10-27** (a Fly secret; unset it to switch off).
  A one-time operator backfill scored five older records. Records without a
  valid score remain image-only. The design is
  `design/gallery/record-exhibition/music-design.md` (ADR 006): the
  existing AI musical directions plus a random seed go through the current
  composer in `shared/music-score.ts` (`throwaway-score-v3`; v1 and v2 are
  kept frozen beside it, pinned by tests, and still validate and play);
  the score is saved once, in the
  image's publication transaction (migration 10, `artifacts.music_score`,
  no automatic backfill), served only by the published-gated
  `/api/gallery/:id/score`, and performed with native Web Audio
  (`src/lib/gallery-audio.ts`, one player) only after Listen. No second
  model request, external music service/key, MP3, audio job or autoplay.
  The flag is independent from image generation; a changed composer or
  renderer is a new version, never a silent change to stored scores.
  New ignition briefs give both the image and the music a mood that
  contrasts with the original note (ADR 008). Existing records keep their
  stored art and score. Preserve the current fire/extraction protocol.
  `ARTIFACTS_ENABLED` is the owner's switch for image generation (a Fly
  secret, on since the owner enabled it); the fixture provider is refused
  on Fly.
- Real-time is SSE (`GET /api/events`) + HTTP. The database is the source of
  truth; events carry a shared `revision` and are merged by version; every
  reconnect reconciles from a snapshot, never by replaying history.
- Content and Keep/Release mode are immutable once saved, enforced on the
  server. Witness counts appear only inside an opened paper, never in lists
  or global events. Opening is not witnessing.
- The throw animation plays only **after** the server confirms the save. A
  failed save keeps the draft; retries reuse the same `submission_key`.
  Destruction commits before any animation.
- Release prepares; only an actual drop inside or the explicit Place button
  commits. Match every result to both paper id and operation key. An old
  HTTP reply or fallback timer must never change a later ritual. A burn
  request times out after eight seconds; an unresolved operation retries its
  original key in the background, without pretending cancellation undid it.
- Paper text never goes into a WebGL texture. Closed papers are a neutral
  material; text appears only in the HTML reading layer after an explicit open.
- The interface (`src/lib/i18n.ts`, `i18n-dict.ts`) offers English and
  Simplified Chinese; the choice lives only in this browser's
  `localStorage` and is never sent. A paper's own words and drawing are
  never translated and never carry a language: the page around an open
  paper switches, the paper itself does not. This isn't a hard technical
  wall for typed text — a drawing has no text to translate, but typed
  words could be — it's a cost and a judgement call not revisited here:
  translating would need a model call per paper and would risk changing
  what someone meant to say. Record titles and alt text, server-chosen
  from a fixed table, do switch with the interface (`i18n-dict.ts`).
  Keep `spec/i18n-ui.test.ts` and `i18n-dictionary.test.ts` green for any
  change here.
- Below 600 px the space and Gallery headers fold their places into one
  Menu (`src/components/SiteMenu.tsx`, `GalleryLinks.tsx`) rather than
  stacking them; desktop is unchanged. Its links only exist while it is
  open, so nothing is ever duplicated in the page; its own Escape must
  never also close a dialog it happens to sit inside; a release in
  progress disables it rather than letting the header move. Keep
  `spec/site-menu-ui.test.ts` green for any change to the header's places
  or to this pattern.
- Never hardcode the references' sample text or counts as data.
  The plan's sample body is for local fixtures only, never the live pool.
- Moderation must be a real configured service; never a fake pass. If it is
  unconfigured, say so and show the plan's failure copy.
- Frontend safety disclosure and reports follow `GET /api/safety`; never
  reintroduce a static flag that can disagree with the deployed backend.
  OpenAI credentials stay server-side. Fixture mode belongs only in local
  tests and CI; Fly refuses it. See ADR 004 and docs/moderation-runbook.md
  for review and operator limits. A lost report reply must hold its original
  reason, note and operation key; operator decisions take precedence over
  in-flight automated results. Never log worker exception messages that could
  contain private text.

## Stack and where things live

- `server/` Express 5 + better-sqlite3, run directly by node 24 type stripping
  (`erasableSyntaxOnly`: no enums, no parameter properties). SQL is always
  parameterised. Schema changes are versioned migrations that preserve
  existing papers and identities.
- Logs carry time, action, the person (`who=visitor-…` alias plus internal
  identity, via `person()` in `server/log.ts`), paper id, outcome and
  revision. Never content, drafts, cookies, usernames, passwords or other
  credentials. Any new per-person action logs through `person()` so crit-10
  narration keeps working; who may do what is ADR 007 as revised by ADR 009,
  reading the log is `docs/logging-runbook.md`.
- `src/` React 19 + Vite. `src/scene/` wraps the paper-crumple-demo (MIT,
  see `THIRD_PARTY_NOTICES.md`) as an init/dispose module. Per-frame state stays
  in the scene, never in React state.
- SQLite lives at `$DATABASE_PATH` (`/data/throwaway.sqlite` on Fly's volume).

## Images

These rules are for static assets checked into the repo. The Gallery's
runtime image generation is separate: it calls the OpenAI Images API from the
server under docs/artifacts-runbook.md, and its outputs are never committed.

When this project needs an image asset, generate it via the strproxy
`images/generations` endpoint — see
https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/generating-images/
for the request format and auth. After generation, automatically fetch the
returned URL and save the downloaded image into the repo; do not just print
or reference the URL.

The 2026-10-09 approved material pass used Codex's built-in image generation
for `public/textures/sheet-creases-v2.jpg`; its provenance is recorded in
`docs/generated-assets.md`. Keep that checked-in asset rather than
regenerating it on application startup.

## Commands

- `pnpm dev:server` (Express on :8080, `data/dev.sqlite`) + `pnpm dev` (Vite
  on :5173, proxies `/api` and `/readme`).
- `pnpm build && pnpm start` runs the production shape locally.
- `pnpm check` needs a running app (`APP_URL`, default `localhost:8080`). Run it
  against a throwaway DB (`DATABASE_PATH=/tmp/x.sqlite pnpm start`) — the spec
  creates and destroys papers. **Never point `APP_URL` at the live Fly app.**
- The repo is public, so **every push to `main` deploys to production via CI**.
  Push only work that passes `pnpm check` and is safe to run against the live
  database. Back up the live database before the first push that migrates it.
- Manual deploy: `flyctl deploy --remote-only --ha=false -a comp4020-final-aurorasundev`.

## Rules for the agent

- Keep `spec/invariants.test.ts`; add business checks in `spec/*.test.ts` that
  assert the contract over HTTP, not implementation details.
- Run `pnpm check` (and `docker build` when touching the Dockerfile) before
  saying a phase is done; say plainly what was not verified.
- **Any visual or interaction change is tried by a person on a local
  deployment, and pushed only after the owner approves it** (owner,
  2026-11-08). Render-check it yourself first (desktop and phone, and the
  widths between when layout moves), then run the production build locally
  (`pnpm build`, then `node server/index.ts` with a throwaway
  `DATABASE_PATH`), give the owner the URL (localhost and the LAN address for
  a phone) and what to look at, and wait. Commit locally meanwhile; never push
  a visual or interaction change, even a passing one, before that approval.
  Every push to `main` deploys, so CI is not the place to find out how it
  looks.
- Small commits that grow with the work; PROCESS.md cites them.
- Don't write the user's reflections or claim experiences they didn't report.
- Never move a `crit-<n>` tag after its cutoff.
- Leave the owner's machine as you found it. When a task or subagent
  finishes (or is stopped), shut down every background process it started
  that is no longer needed: local servers, `--watch` runners, headless
  browsers (`pkill -f ms-playwright/chromium`), Docker Desktop and
  containers, and file watchers. Keep only what the owner is actively
  using, such as a preview they asked for, and say what is still running.
- Headless Chromium falls back to SwiftShader (software WebGL), which can
  pin every CPU core. On the owner's Apple Silicon Mac launch it on the GPU
  instead: `args: ["--use-gl=angle", "--use-angle=metal",
  "--ignore-gpu-blocklist"]`, and check the WebGL `UNMASKED_RENDERER_WEBGL`
  string reads "ANGLE Metal Renderer" (verified 2026-10-27: Apple M4 Pro).
  Use SwiftShader flags only in GPU-less CI. Either way keep browser runs
  short, few and small, close each browser in the same script, and prefer
  unit tests over rendered checks. Run one subagent at a time unless the
  owner asks for parallel work.

## Release verification

Main pushes run container checks and secret scans before Fly deployment.
Check the workflow and machine image to verify a release. Keep credentials
out of Git and the remote build context. The 2026-10-10 moderation release
(`351439c`) is recorded in ADR 004. See `docs/moderation-runbook.md` for
operator review and release procedures.
