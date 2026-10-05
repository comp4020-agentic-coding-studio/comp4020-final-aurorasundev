# Throwaway — agent harness

Throwaway is an anonymous shared space: write a thought on paper, crumple it,
throw it into the space, come across papers other people left. This repo is the
COMP8020 final project; crits 8, 9 and 10 run in it.

## Current scope: Week 9 / C8 slice only

The contract is `throwaway-week9-claude-package/throwaway-week9-plan.md` and
its design references (D01–D04 desktop, M01–M04 mobile). Read it before
changing behaviour. When an image and the plan disagree, the plan wins.

- Routes: `/` (space, writing and reading are *states* of it) and `/readme/`.
  Never add `/write`, `/paper/:id`, profiles or share links.
- Do not build, stub or show buttons for: Keep/Release, Socket.IO/realtime,
  witnessing, burning, recovery codes, reporting, AI, infinite world, personal
  history, search, ranking, comments, likes, editing or deleting papers.
- The throw animation plays only **after** the server confirms the save. A
  failed save keeps the draft; retries reuse the same `submission_key`.
- Paper text never goes into a WebGL texture. Closed papers are a neutral
  material; text appears only in the HTML reading layer after an explicit open.
- Never hardcode the design references' sample text or counts as data.

## Stack and where things live

- `server/` Express 5 + better-sqlite3, run directly by node 24 type stripping
  (`erasableSyntaxOnly`: no enums, no parameter properties). SQL is always
  parameterised. Logs carry paper ids, never content or cookies.
- `src/` React 19 + Vite. `src/scene/` wraps the paper-crumple-demo (MIT,
  see `THIRD_PARTY_NOTICES.md`) as an init/dispose module. Per-frame state stays
  in the scene, never in React state.
- SQLite lives at `$DATABASE_PATH` (`/data/throwaway.sqlite` on Fly's volume).

## Commands

- `pnpm dev:server` (Express on :8080, `data/dev.sqlite`) + `pnpm dev` (Vite
  on :5173, proxies `/api` and `/readme`).
- `pnpm build && pnpm start` runs the production shape locally.
- `pnpm check` needs a running app (`APP_URL`, default `localhost:8080`). Run it
  against a throwaway DB (`DATABASE_PATH=/tmp/x.sqlite pnpm start`) — the spec
  creates papers. **Never point `APP_URL` at the live Fly app.**
- Deploy: `flyctl deploy --remote-only --ha=false -a comp4020-final-aurorasundev`
  (the app name is all lowercase).

## Rules for the agent

- Keep `spec/invariants.test.ts`; add business checks in `spec/*.test.ts` that
  assert the contract over HTTP, not implementation details.
- Run `pnpm check` (and `docker build` when touching the Dockerfile) before
  saying a phase is done; say plainly what was not verified.
- Small commits that grow with the work; PROCESS.md cites them.
- Don't write the user's reflections or claim experiences they didn't report.
- Don't flip the repo public; that's the user's `/comp4020:ship`.
