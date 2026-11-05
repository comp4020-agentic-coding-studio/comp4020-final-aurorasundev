# 009 — Optional accounts replace return keys; only you see your own papers

Status: accepted on 2026-11-03. Merged to `main` and deployed on
2026-11-04 in [run 41795798041](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/actions/runs/41795798041).
Supersedes the return-key decision in [ADR 007](007-people-and-permissions.md).
The same paper permissions apply to guests and signed-in visitors.

## Context

Throwaway began with no accounts at all: a person was an anonymous browser
identity, and a return key could carry that identity to another browser
(ADR 007). The key restored *rights*, never *papers*: a Keep paper could be
let go only by its author, but its author could only find it again by
chance, in a random window of the shared room. As the room fills, that
chance falls, so the right a Keep promises becomes one its author can
rarely use. The Gallery made a second gap visible: a released paper is
reborn as a record ([ADR 008](008-rebirth-reversal.md)), but the person who
wrote it never learns which one, so rebirth reaches every visitor except
the one it is about.

The tutor's feedback on describing the user (does a person visit once or
come back?) and two people the owner showed the project to asked the same
thing: how do I see my own papers again? The return key never answered it.

## Options

| Option | Benefit | Cost |
| --- | --- | --- |
| Keep return keys | no personal data | a Keep stays findable only by chance; a released paper's record is never yours to find |
| Return keys plus a private list | finds papers without a password | a lost or leaked key is the whole account; a 32-character key is hard to keep |
| **Optional username and password, no email; a private panel** | familiar; a guest can still start without signing up | a password to store well; no recovery without email; a private owner link is read |
| Accounts with email | password recovery | personal data to hold and protect; needs a sending domain the project doesn't have |

## Decision

**Accounts are optional.** A guest still starts with an anonymous identity
and nothing to type. An account is a username and a password attached to
that same identity (`accounts.identity_id → identities.id`), so creating one
keeps every paper, witness and right the guest already had. There is no
email and no password recovery yet; the sign-up form says so.

**Sign in sits in the header beside About.** A guest is also invited, once,
after their first Keep and once more at their third paper. "Not now" closes
it and nothing records the refusal: the invitation can happen at most twice.

**Only you see your own papers.** Signed in, the header shows your username
and opens a panel within the space (no new route). The papers you left that
are still here are grouped by how they were left, because the two mean
different things to their author: **Kept by you** (still yours to let go)
and **Released** (in readers' hands). Each opens into the ordinary reading
sheet, so a Keep can be let go from there, in the drawn furnace if it isn't
on screen. Below them, **What they became** shows the Gallery records your
released papers left, playable with the Gallery's one player. The list carries no witness counts, readers or other figures.
Signing in elsewhere moves any papers the guest in that browser left to the
account, and the account's own witness on them stops counting, as an
author's never does.

**Everyone else still meets every paper anonymously.** The username is
shown only to its owner. The room, the Gallery, their events and every
public object are unchanged: no author, username or link back to a paper.
The panel's record list is built from a private link the database already
held (paper → record job → record) and leaves the server only in that
owner's reply, in exactly the Gallery's public shape.

**Return keys are removed.** Migration 11 adds `accounts` and drops
`return_keys`; every paper, identity and session stays where it was.

## How a password is kept

Following the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
(`server/password.ts`):

- **scrypt with a per-account random salt**, from `node:crypto` (no new
  dependency). OWASP's baseline (N=2^17) needs 128 MiB per hash and this
  machine has 256 MB, so it uses OWASP's listed equivalent N=2^14, r=8, p=5
  (16 MiB), and at most two hashes run at once.
- **A pepper outside the database**: the scrypt output is sealed with
  HMAC-SHA256 under `ACCOUNT_PEPPER`, a Fly secret. A copied database file
  alone gives an attacker nothing to test guesses against. The pepper must
  never change, or every stored password stops matching.
- **Fails closed**: on Fly without the pepper, accounts report themselves
  unavailable (503 `accounts_unconfigured`) and guests carry on unaffected.
  Local runs and CI use a fixed development pepper.
- **Sign-in tells nothing extra**: a wrong password and an unknown username
  get the same answer, and an unknown name still spends one scrypt.
- **Session fixation**: creating an account or signing in deletes the
  browser's previous session and issues a new cookie.
- **Limits** (in memory, failures only, so people sharing an address can
  still sign in): 10 wrong passwords per username per 15 minutes, 50
  failures per address per 15 minutes, 30 new accounts per address an hour.

Usernames are 3–24 letters, numbers, hyphens or underscores, unique without
regard to case. Passwords are 8–128 characters and can't equal the username.

## Permissions added to ADR 007's table

| Action | Who may | Why |
| --- | --- | --- |
| See your own papers and records | the signed-in owner only | finding your own papers was the problem; no one else's list exists |
| Create an account | the current guest, once | it becomes that same identity; nothing is copied |
| Sign in | whoever knows the username and password | the password is the proof; wrong guesses are limited per name and per address |

## Consequences

- A Keep can be found again from any browser; a released paper's record is
  visible to its author. That was the point.
- A forgotten password can't be recovered. The cost is accepted for now;
  email recovery needs a sending domain and is future work.
- The database now holds usernames and password hashes. A leaked database
  reveals which username wrote which paper: the private owner link existed
  before, but was attached only to random ids. No email or other personal
  data is held.
- Previously saved return keys stopped working at deployment.
  Their current browser's cookie still works for a year, and creating an
  account there carries everything with it.
- Logs name the person (`who=`), never the username or password; see
  `docs/logging-runbook.md`.

## Verification

The deployment used `ACCOUNT_PEPPER` and applied migration 11 after a
database backup. [The local Chromium pass](../evidence/accounts-2026-11/README.md)
records desktop and phone-size evidence and its limits. The owner also
reported trying the account flow successfully on the live site. The
local pass leaves Safari, a physical phone and playback from the private
panel outside its coverage.
