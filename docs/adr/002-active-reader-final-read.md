# 002 — Letting go takes effect at once; a current reader may finish

Status: accepted, implemented (`db19918`, `947450f`). Decided in `plan.md` §13.1.

## Context

Several people can hold the same paper open. One of them may let it go
(a Keep paper's author, or a Release paper's witness). The README asks for
leaving to be intentional, witnessing to be deliberate and disappearance to
mean something. What should the others holding it see?

## Options

| Option | Benefit | Cost |
| --- | --- | --- |
| Clear the text at once for everyone | strongest disappearance; simplest client | cuts off a deliberate reading mid-sentence; reads like a fault; weakens witnessing |
| Block destruction while anyone reads | reading is never interrupted | another person's open tab holds the right to let go; needs reading leases, timeouts, connection tracking |
| **Destroy at once; a current reader may finish (chosen)** | the right takes effect immediately and current readers are respected | text already fetched stays readable on that screen until closed |

## Decision

- Destruction commits first: one conditional ACTIVE → DESTROYED transition
  that clears the text in the same transaction, then one `paper:destroyed`.
  The count drops for everyone at once.
- A reader who already has the words keeps them and sees "This was let go
  while you were holding it. You may finish reading. Once you close it, it is
  gone." Witness, let-go and report actions disappear; the server refuses
  them anyway (410 `paper_gone`).
- No countdown. The char is a restrained mark on one outer edge, never over
  the text.
- The local copy lives only in memory and is dropped on close, refresh or
  navigation. It is never written to storage or the URL.
- If the destruction arrives before the words do, or a GET answers late, the
  paper is not revived: "This paper is no longer here."
- The visitor who let it go is not a passive reader. Their page plays its own
  ending after server confirmation. ADR 003 extends that presentation to
  crumpling, furnace placement and fire without changing the final-reading rule.
- Safety quarantine gets no final reading: its text is cleared
  from the screen at once.

## Consequences

The honest cost: text a reader has already fetched cannot be revoked from
their screen. The guarantee is narrower and real: once destroyed, a paper
cannot be fetched again, witnessed, reported or let go again, by anyone.

## Verification

- `spec/burn.test.ts`: rights checked on the server (non-author on Keep,
  unwitnessed Release, missing receipt or confirmation are refused); two
  simultaneous let-gos give one 200, one 410 and one event whose total matches
  the winner's; a retried op key returns its first outcome; a destroyed paper
  can't be reopened, witnessed or resubmitted into existence; a reconnect
  snapshot reports it destroyed.
- Browsers (fresh DB): C let go of the paper B was reading; B kept the text,
  saw the notice with only Close, and after closing the paper answered 404.
