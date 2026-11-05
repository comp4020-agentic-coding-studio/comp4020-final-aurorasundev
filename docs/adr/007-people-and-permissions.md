# 007 — Who a person is, what they may see and change, and how the log names them

Status: accepted for paper permissions and logging. The log names
(`who=`) and the `session`, `open` and named `connect` lines were added on
2026-10-20 for Crit 10. [ADR 009](009-optional-accounts.md) superseded
the original return-key decision and shipped optional accounts on
2026-11-04.

## Context at Crit 10

The original room used anonymous browser identities with an optional
return key. Visitors saw no names or profiles. The server still had to
tell people apart, because the rules depend on who is acting
(only the person who kept a paper may let it go). And the operator has to be
able to read from the server log who did what, without the log holding
anyone's words or anything that could sign in as them.

## Original identity options at Crit 10

| Option | Benefit | Cost |
| --- | --- | --- |
| Accounts (email or password) | familiar; recoverable | contradicts the anonymous brief; personal data to hold |
| A pseudonym the visitor types | readable in logs | invites names; one more thing to moderate; people can claim each other's |
| **An anonymous browser identity, with an optional return key** | no personal data; nothing to type to start | the identity lives in one browser unless its key is saved |

## Current decision

**Guest identities and accounts.** A guest has a random identity linked
to an `HttpOnly`, `SameSite=Lax` session cookie. The database stores only
the token's SHA-256. A separate browser profile starts as a new guest.
An optional account restores the same identity and opens its owner's
private paper and record lists. The original return key restored only
rights and was removed by ADR 009.

**Permissions checked on the server** (`server/papers.ts`,
`server/reports.ts`, `server/session.ts` and `server/accounts.ts`):

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
| See your own papers and records | the signed-in owner only (ADR 009) | no one else's list exists |
| Sign in to an account | whoever knows its username and password (ADR 009) | wrong guesses are limited per name and per address |

Every refusal is a 401/403/409/410 from the server, whatever the client
shows. The spec checks the cross-person rules over HTTP (`spec/burn.test.ts`,
`spec/witness.test.ts`, `spec/accounts.test.ts`, `spec/who-did-what.test.ts`).

**How the log names a person.** Every line about a person carries
`who=visitor-xxxxxx` and `identity=<id>`. The alias is an HMAC of the
identity under a key derived from a server secret, so it is stable for that
person, different for everyone else, and can't be turned back into the id or
a cookie. `identity=` lets the operator join a line with the database.
Lines never carry paper words, drafts, cookies, usernames, passwords or other credentials.

## Consequences

- Two pod members in separate profiles appear as two `who=` values from
  their first `session outcome=new` line. A refused attempt on someone
  else's paper shows as `burn … outcome=forbidden` under the person who tried.
- Clearing cookies makes a new person; that is intended. Signing in brings
  the account's person back (`login … outcome=signed_in`, same `who=`). Until
  ADR 009, a saved return key did this (`restore … outcome=restored`).
- Logs live in Fly's log stream (`flyctl logs`), which keeps them for a
  limited time; see `docs/logging-runbook.md`.
