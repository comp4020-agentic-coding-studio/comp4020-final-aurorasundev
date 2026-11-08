# 010 — Persistent data lives in one SQLite file on a volume, backed up before every migration

Status: accepted. Storage since the C9 plan ([ADR 001](001-sse-snapshots.md));
the pre-migration backup implemented on 2026-11-09 in
[`8087e69`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/commit/8087e69).

## Context

The brief asks that what someone does is still there "across sessions,
restarts and redeploys", and markers come back the next day. Throwaway runs
on one 256 MB Fly machine that stops when nobody is using it
(`auto_stop_machines = "stop"`, `min_machines_running = 0`), so every
marking visit after a pause is a cold start. Its only storage that survives
a stop or a redeploy is the `data` volume mounted at `/data` (1 GB). Every
release may add a schema migration, and a migration runs on the live
papers, accounts and records the moment the new machine starts.

## Decision

- **One SQLite file is the source of truth**: `/data/throwaway.sqlite`
  (`$DATABASE_PATH`), opened in WAL mode by better-sqlite3. Papers, witnesses,
  identities, sessions, accounts, reports and Gallery records all live there;
  Gallery images live beside it in `/data/artifacts`. Nothing the room shows
  is held only in memory: events carry a revision and every reconnect
  reconciles from a snapshot (ADR 001).
- **Each action commits in one transaction before it is answered or
  broadcast**: a save, a witness or a burn either is in the file or did not
  happen, and the throw animation waits for that answer.
- **Schema changes are numbered migrations** (`user_version`) that keep
  existing rows; a version is never edited after release.
- **Before a migration touches a database that holds data, startup copies it**
  with `VACUUM INTO` to `throwaway.sqlite.pre-v<N>-<UTC time>.bak` beside it,
  keeping the newest three. If the copy fails, nothing is migrated and
  startup stops: the owner prefers a deploy that doesn't come up to a
  migration with no way back. A new, empty database needs no copy.
- **Those copies share the volume**, so they protect against a bad
  migration, not against losing the volume. Before a risky migration or a
  bulk operator change (such as the 2026-11-09 music re-score, ADR 006),
  the operator also takes an off-machine copy.

| Option | Gains | Costs |
| --- | --- | --- |
| Postgres or a hosted database | survives the machine; several machines | another service, secret and bill for a class-sized room; a network hop on every action |
| Fly volume snapshots only | nothing to build | daily, not at the moment of a migration; restoring replaces the whole volume |
| **Copy beside the database before migrating (chosen)** | a consistent copy from the exact version a migration started at; automatic | doubles the file briefly on a 1 GB volume; gone if the volume is |

## Consequences

- One machine, one writer. Running a second machine would need another
  storage plan (PROCESS.md, ADR 001).
- A failed backup turns into a failed deploy that is easy to see in the
  Fly log, rather than a silent data risk.
- Restoring is manual: stop the machine, copy a `.bak` over
  `throwaway.sqlite`, start it again.

## How it is checked

- `spec/api.test.ts` ("persistence") closes and reopens a database and finds
  the paper's words unchanged.
- `spec/migration-backup.test.ts`: the copy is made at the old version and
  then the migration runs; only the newest three are kept; when the copy
  can't be written, nothing is migrated and startup refuses; an empty
  database needs none.
- On 2026-11-09 a local production build was stopped and started again on
  the same file: the space's papers, its revision and the Gallery's records
  were all unchanged.
