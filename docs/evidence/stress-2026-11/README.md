# Stress test, 2026-11-09

Whether the room holds up under use it wasn't designed for: many people
acting on the same paper at once, a flood of saves or streams, a slow or
dropped connection, and a restart. Run against local production builds
(`pnpm build`, `node server/index.ts`) on throwaway databases, never the
live app. The fixture moderation provider was used, as in CI.

## Concurrency and limits (`concurrency.mjs`, `limits.mjs`)

Fresh database, address limit raised so one machine can act as 50 people.

| Case | Result |
| --- | --- |
| 50 people save 100 papers at once | all 100 saved (201) in 58 ms; all in the database |
| one submission key sent 10 times at once | one paper |
| 20 people witness one Release paper at once | witness count exactly 20; repeats by one person counted once |
| the same 20 burn it at once | 1 succeeds, 19 get 410 (gone); the winner's retry with its key gets the same answer |
| 70 live streams from one address | 60 open, 10 refused with 503; new streams open again once others close |
| save → event delay on an open stream | 1–4 ms |

Default limits (`limits.mjs`, with `SAVES_PER_ADDRESS_HOUR=30` set because
the fixture provider lifts the address limit for tests):

| Case | Result |
| --- | --- |
| one person sends 15 saves at once | 10 saved, 5 refused 429 `rate_limited` |
| 10 more people from the same address, 3 each | 20 saved, 10 refused: the address stops at 30 |

## Two people, two viewports (`two-sessions.mjs`)

Two browser contexts sharing no cookies, one at 1920×1080 and one at
390×844. A paper saved in either appeared in the other's count 1–34 ms after
the save's reply, with no reload.

## Slow and dropped connection (`slow-network.mjs`)

At 390×844 with about 400 ms latency and 50 KB/s down:

- the room was usable after about 8 s;
- a double-pressed "Crumple and throw" saved one paper;
- after going offline while someone else saved a paper and then coming
  back, the count caught up with no reload. No page errors.

## Restart

A production build was stopped and started on the same database: the
space's papers, its revision and the Gallery's records were unchanged
([ADR 010](../../adr/010-persistence-and-migration-backups.md)).

## Running them

Start a server on a throwaway `DATABASE_PATH`, then
`node concurrency.mjs http://localhost:<port>` (and `limits.mjs`). The two
browser scripts need `PLAYWRIGHT_CORE` (path to playwright-core) and
`CHROME` (a Chromium executable) and take the base URL as their argument.
