# 005 — Who a person is, what they may see and change, and how the log names them

Status: accepted. The rules below were already enforced on the server; the
log names (`who=`) and the `session`, `open` and named `connect` lines were
added on 2026-10-20 for crit 10.

## Context

Throwaway is anonymous by design: no accounts, no names, no profiles. It
still has to tell people apart, because the rules depend on who is acting
(only the person who kept a paper may let it go). And the operator has to be
able to read from the server log who did what, without the log holding
anyone's words or anything that could sign in as them.

## Options

| Option | Benefit | Cost |
| --- | --- | --- |
| Accounts (email or password) | familiar; recoverable | contradicts the anonymous brief; personal data to hold |
| A pseudonym the visitor types | readable in logs | invites names; one more thing to moderate; people can claim each other's |
| **An anonymous browser identity, with an optional return key** | no personal data; nothing to type to start | the identity lives in one browser unless its key is saved |

## Decision

**A person is an anonymous browser identity.** `POST /api/session` creates
one (a random id) and sets an `HttpOnly`, `SameSite=Lax` cookie holding a
random token; only the token's SHA-256 is stored. A separate Chrome profile
or an incognito window is a different person. After keeping a paper, a
visitor may save a one-time return key that restores the same identity in
another browser (rights, not history).

**What each person may see and change, checked on the server** (`server/papers.ts`
`viewerState`, `server/reports.ts`, `server/identity.ts`):

| Action | Who may | Why |
| --- | --- | --- |
| See papers in the space (ids only) | anyone | the space is shared; ids say nothing about authors |
| Open a paper and read its words | anyone, while it is active | encounter is the point; opening records nothing |
| Witness ("I saw it") | anyone who opened it (needs the read receipt bound to them and that paper) | a witness must have actually read it; counted once per identity |
| Let a **Keep** paper go | its author only | the writer asked to keep it |
| Let a **Release** paper go | anyone who has witnessed it (the author too, after witnessing) | the writer handed it over to readers |
| Report a paper | anyone who opened it, with limits per address | reports need context; abuse is bounded |
| Edit a paper, change its mode | no one | content and mode are immutable once saved |
| See who wrote or witnessed a paper | no one | no attribution is ever shown; counts appear only inside an opened paper |
| Restore an identity | whoever holds its return key | the key is the only proof; wrong guesses are slowed per address |

Every refusal is a 401/403/409/410 from the server, whatever the client
shows. The spec checks the cross-person rules over HTTP (`spec/burn.test.ts`,
`spec/witness.test.ts`, `spec/identity.test.ts`, `spec/who-did-what.test.ts`).

**How the log names a person.** Every line about a person carries
`who=visitor-xxxxxx` and `identity=<id>`. The alias is an HMAC of the
identity under a key derived from a server secret, so it is stable for that
person, different for everyone else, and can't be turned back into the id or
a cookie. `identity=` lets the operator join a line with the database.
Lines never carry paper words, drafts, cookies, return keys or credentials.

## Consequences

- Two pod members in separate profiles appear as two `who=` values from
  their first `session outcome=new` line. A refused attempt on someone
  else's paper shows as `burn … outcome=forbidden` under the person who tried.
- Clearing cookies makes a new person; that is intended. A saved return key
  brings the old one back (`restore … outcome=restored`, same `who=`).
- Logs live in Fly's log stream (`flyctl logs`), which keeps them for a
  limited time; see `docs/logging-runbook.md`.
