# Throwaway — agent harness

Throwaway is an anonymous shared space: write a thought on paper, crumple it,
throw it into the space, come across papers other people left. This repo is the
COMP8020 final project; crits 8, 9 and 10 run in it.

## Current scope: C9 real-time, then the full Final MVP

The contract is `plan.md` and its references in `reference-images/`
(D01–D08 desktop, M01–M04 mobile). Read the relevant section and open the
relevant image before changing behaviour. When an image and the plan disagree,
the plan wins. Priority order: P1–P3 (real-time, Keep/Release + witnessing,
destruction + final reading) for C9, then P4–P7.

- Routes: `/` (space; writing, reading, confirming, reporting and return keys
  are *states* of it) and `/readme/`. Never add `/write`, `/paper/:id`,
  profiles or share links.
- Never build: a latest feed, search, ranking, profiles, My Papers / personal
  history, comments, likes, follows, editing papers, bulk destruction, points,
  countdowns, online lists, cursors, reader counts or per-frame broadcasts.
  Gallery / AI artifacts are out unless the user asks.
- Real-time is SSE (`GET /api/events`) + HTTP. The database is the source of
  truth; events carry a shared `revision` and are merged by version; every
  reconnect reconciles from a snapshot, never by replaying history.
- Content and Keep/Release mode are immutable once saved, enforced on the
  server. Witness counts appear only inside an opened paper, never in lists
  or global events. Opening is not witnessing.
- The throw animation plays only **after** the server confirms the save. A
  failed save keeps the draft; retries reuse the same `submission_key`.
  Destruction commits before any animation.
- Paper text never goes into a WebGL texture. Closed papers are a neutral
  material; text appears only in the HTML reading layer after an explicit open.
- Never hardcode the references' sample text, counts or return key as data.
  The plan's sample body is for local fixtures only, never the live pool.
- Moderation must be a real configured service; never a fake pass. If it is
  unconfigured, say so and show the plan's failure copy.

## Stack and where things live

- `server/` Express 5 + better-sqlite3, run directly by node 24 type stripping
  (`erasableSyntaxOnly`: no enums, no parameter properties). SQL is always
  parameterised. Schema changes are versioned migrations that preserve
  existing papers and identities.
- Logs carry time, internal identity, action, paper id, outcome and revision.
  Never content, drafts, cookies, return keys or credentials.
- `src/` React 19 + Vite. `src/scene/` wraps the paper-crumple-demo (MIT,
  see `THIRD_PARTY_NOTICES.md`) as an init/dispose module. Per-frame state stays
  in the scene, never in React state.
- SQLite lives at `$DATABASE_PATH` (`/data/throwaway.sqlite` on Fly's volume).

## Images

When this project needs an image asset, generate it via the strproxy
`images/generations` endpoint — see
https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/generating-images/
for the request format and auth. After generation, automatically fetch the
returned URL and save the downloaded image into the repo; do not just print
or reference the URL.

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
- Small commits that grow with the work; PROCESS.md cites them.
- Don't write the user's reflections or claim experiences they didn't report.
- Never move a `crit-<n>` tag after its cutoff.
