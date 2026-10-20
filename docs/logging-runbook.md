# Logging runbook — reading who did what

The server writes one line per action to stdout, which Fly keeps in the app's
log stream. Rules for who may do what are in
[ADR 007](adr/007-people-and-permissions.md).

## Watching the live app

```sh
mise exec -- flyctl logs -a comp4020-final-aurorasundev
```

The machine stops when idle, so the first request after a pause shows Fly's
boot lines, then `throwaway listening on 0.0.0.0:8080`. Only the app's own
lines follow the shape below; to see just those:

```sh
mise exec -- flyctl logs -a comp4020-final-aurorasundev | grep --line-buffered -E ' (session|connect|disconnect|open|create|witness|burn|report|return_key|restore|quarantine|review|operator_decision) '
```

## Line shape

```
<ISO time> <action> who=visitor-xxxxxx identity=<id> [paper=<id>] [mode=keep|release] outcome=<…> [revision=<n>]
```

`who` is the short name to say aloud; it is the same for one person on
every line and different for everyone else. `identity` is the full id for
joining with the database. No line holds paper words, drafts, cookies, return
keys or credentials.

| Action | Outcomes | Means |
| --- | --- | --- |
| `session` | `new`, `resumed` | someone arrived (a new browser is a new person) or came back |
| `connect` / `disconnect` | `ok` | their live view opened or closed (`subscribers=` people watching) |
| `open` | `own`, `other`, `paper_gone` | they opened a paper: their own, someone else's, or one already gone |
| `create` | `created`, `retry`, `moderation_rejected`, `moderation_review_required`, `moderation_unavailable`, … | they threw a paper (or it was refused; `reason=` says which check) |
| `witness` | `counted`, `author`, `repeat`, `forbidden`, `paper_gone` | they said "I saw it" (`author` = on their own paper, not counted) |
| `burn` | `destroyed`, `retry`, `forbidden`, `forbidden_receipt`, `op_conflict`, `paper_gone` | they let a paper go, or were refused |
| `report` | `queued`, `repeat`, `forbidden`, `rate_limited`, … | they reported a paper |
| `return_key` / `restore` | `issued`, `saved`, `restored`, `invalid`, `rate_limited` | they saved a key / used one in another browser |
| `quarantine`, `review`, `operator_decision` | — | the safety worker or an operator acted (no `who`) |

## Narrating a two-person session (crit 10)

Two pod members open the URL in separate Chrome profiles. Read the log, not
the screen:

1. Two `session … outcome=new` lines with different `who=`: call them A and B.
2. `create who=A paper=P mode=keep outcome=created`: A threw paper P and
   kept it (`mode=release` if released).
3. `open who=B paper=P outcome=other`: B came across A's paper and opened it.
4. `witness who=B paper=P outcome=counted`: B said "I saw it".
5. If P was kept: `burn who=B paper=P outcome=forbidden`. B tried to let go
   of A's kept paper and the server refused. If P was released:
   `burn who=B paper=P outcome=destroyed`. B, as a witness, let it go.

A finding is any line where an action on someone else's paper succeeds that
ADR 007 says should not, or where two people share one `who`.

## Retention

Fly keeps the log stream for a limited window. These lines are what to
consult first when the deployed app misbehaves: find the `who` from the
report, then follow that person's lines in time order.
