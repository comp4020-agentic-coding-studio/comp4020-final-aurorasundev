# 001 — Real-time over SSE + HTTP, recovered from snapshots

Status: accepted, implemented (`2a9f943`, `594b830`). Decided in `plan.md` §3 and §7.

## Context

Throwaway's shared changes are discrete and confirmed by the server: a paper
is saved, witnessed, let go (and, later, quarantined). Dragging, the camera,
crumpling and where papers lie are local to each visitor and never need to
reach anyone else. The app is one Fly machine with SQLite on a volume.

## Options

| Option | For | Against |
| --- | --- | --- |
| Socket.IO | rooms, reconnection, two-way | no two-way traffic to carry; its defaults don't promise to recover missed events either |
| Native WebSocket | small | reconnection and heartbeats by hand, for no product gain |
| Polling every 250–500 ms | trivial | requests when nothing changes; latency of the timer on top |
| **SSE + HTTP** | one-way push fits; actions stay ordinary HTTP with their own status codes | one stream per page; reconnect must reconcile |

## Decision

- Actions are HTTP. Each one that changes shared state commits in one SQLite
  transaction that also bumps a single shared `revision`, then broadcasts
  once: `paper:created`, `paper:witnessed`, `paper:destroyed`. Events never
  carry text, owners or witness counts.
- `GET /api/events` writes a `space:snapshot` in the same tick the subscriber
  is registered, so no commit can fall between the snapshot and the first
  live event.
- Missed events are recovered as **current facts**, never replayed. The
  client reconnects by hand (not EventSource's own retry, whose URL is stale)
  sending the ids on screen; the snapshot says which still exist and refills
  the window.
- The client merges by revision (totals) and by paper version (an open
  paper), so an old HTTP answer can't overwrite newer state.
- Positions, physics and the camera stay local: the pool is shared, the
  layout isn't.
- Papers saved before Keep/Release existed are backfilled as KEEP: no
  stranger gains a right to destroy them that their author never granted.
  This is a conservative default, not a claim that those authors chose Keep.

## Consequences

- No event store, Redis or queue: the database is the only history.
- A page that was offline sees the space as it is now, not an animation of
  everything it missed.
- Fly's auto-stop means a cold start is slower than delivery between pages
  already connected; the two are measured separately.

## Verification

- `spec/realtime.test.ts`: three connected streams receive a save within one
  second; refused and retried saves broadcast nothing; a reconnect with known
  ids gets their status and a refilled window.
- Browsers (Playwright, three contexts, software WebGL, one machine): B and C
  showed the new count 793 ms and 631 ms after the server's commit log line.
  A server restart while connected: the page said Reconnecting…, caught up to
  a paper saved meanwhile, kept the draft, did not reload.
