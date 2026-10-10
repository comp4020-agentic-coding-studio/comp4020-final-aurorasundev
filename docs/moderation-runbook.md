# Moderation operations

Release preparation (2026-10-10): local real-service smoke checks passed
using the key in ignored `mise.local.toml`. The owner authorized commit and
push. The OpenAI key and real-provider selection were staged separately in
Fly secrets. The main workflow builds/tests the image and then deploys it;
check its result and the Fly machine revision before assuming it is live.
Every push to `main` deploys automatically.

The pinned model's metadata query returned 403, but the actual moderation and
Responses endpoints returned 200. No extra model-list permission is required
for the tested flow. Five small checks used synthetic text, never production
paper content. A safe paper published (201), an explicit scam was refused
(422), and reported synthetic legacy scams were quarantined. The final report
check delivered removal to two SSE sessions in about two seconds including
the external review; the total dropped once and reopening returned 404.
This small sample verifies integration, not general moderation accuracy.

## Service contract

The server calls OpenAI directly: `omni-moderation-latest`, then
`gpt-4.1-mini-2025-04-14` with strict structured output and
`throwaway-safety-v1`. It sends text and relevant report context only. The
category request has four seconds, the context request six, and the complete
check ten. A clear allow is required before a new paper is saved. Uncertain
new submissions stay editable for revision; they do not create a queue of
unpublished personal drafts. Missing keys and failed checks never become a
pass. A configured provider in `/api/safety` is not a successful health check.

A report requires a reading receipt. One identity can report a paper once;
new reports are limited to five per identity and twenty per address per hour.
Reasons are threats/abuse, private information, sexual/graphic content,
harmful instructions, spam/scam, and something else. Optional notes have a
500-code-point limit and expire after thirty days. Reports alone never remove
papers. A clear violation quarantines; uncertainty, conflicting context,
missing credentials and exhausted checks go to a person. There are at most
three automatic decisions per paper and three attempts per review run.

Publication requests end after fifteen seconds per attempt, with at most
three automatic attempts using the same key (about 47 seconds in total).
Report requests end after eight seconds. If the reply is lost, the original
payload is held for retry. The server returns the original result instead of
creating another paper or report. A definite refusal leaves fields editable.
A failed configuration fetch can be retried from the writing sheet.

## Local verification without a key

Use two terminals in the repository. Start each complete test run with a
fresh database and a fresh server: rate-limit state intentionally persists
within a running process. Do not point tests at production.

```sh
pnpm build
MODERATION_PROVIDER=fixture PORT=18115 DATABASE_PATH=/tmp/throwaway-safety-test.sqlite NODE_ENV=test node server/index.ts
```

In the second terminal:

```sh
APP_URL=http://127.0.0.1:18115 pnpm check
pnpm check:evidence
```

Open `http://127.0.0.1:18115/` to inspect the local flow. Fixture mode is a
mechanical test double, not a real assessment of ordinary language. Test
markers are documented in `server/moderation.ts`; never seed production with
them. The server refuses fixture mode when `FLY_APP_NAME` is present. To test
the unavailable state, start a separate process with no `OPENAI_API_KEY` and
`MODERATION_PROVIDER=openai`. Existing papers remain readable; submission is
blocked and reports await an operator.

## Current local configuration and future deployment

The owner has placed `OPENAI_API_KEY` under `[env]` in `mise.local.toml`.
`mise exec` loads it for the child server process. The file is ignored by both
Git and Docker and now has owner-only permissions. The key was verified absent
from the client build. Do not print or paste the file, use a `VITE_` variable,
or put a literal key in command history. The Anthropic course proxy is not the
moderation endpoint. Default models and policy version are already in code.

Start a local real-provider server with a separate database:

```sh
DATABASE_PATH=data/moderation-dev.sqlite PORT=18117 MODERATION_PROVIDER=openai mise exec -- node server/index.ts
```

An alternative is a private `.env.moderation` file containing only the OpenAI
key and provider selection, loaded with Node 24's `--env-file` option. This
file is not needed for the current local configuration.

Restarting is required because provider configuration is read at startup.
The safe submission, refusal and automatic report quarantine passed a local
real-service smoke test. Provider-failure draft retention and the private
operator path passed the separate deterministic tests. The release reran all
112 tests and the build. Local Docker is unavailable; the required workflow
builds and tests the container before its deploy job. Verify that workflow
and the live configuration after the release. Neither fixtures
nor this small real-service sample establish broad policy quality. Assess
ordinary distress and first-person accounts separately from threats and
identifiable private details.

For a later authorized Fly release, create an owner-only `.env.moderation`
containing only the required server secrets and stage it via stdin. Do not
import or upload `mise.local.toml`: it can contain other credentials. Writing
a local configuration file does not configure Fly automatically.

```sh
mise exec -- flyctl secrets import --stage -a comp4020-final-aurorasundev < .env.moderation
```

`--stage` avoids restarting the current release. Back up the live SQLite
database consistently before the schema-7 deployment. Inspect the final diff,
run checks and the container build, then deploy only after the owner's
instruction. Verify provider configuration without displaying secrets,
publication/report behavior, SSE quarantine, and preservation of existing
papers and identities. If rolling back code after quarantine, retain the
current database; restoring old paper content would undo the moderation
result. No rollback or database restoration is performed by this runbook.

## Human review

The project owner is the operator. Check the queue before a crit/demo and
regularly while submissions are accepted; the app sends no notifications and
promises no response time. A `human_review` paper remains in space until an
operator decides, so do not leave that queue unattended.

Locally, set `DATABASE_PATH` to the same database as the running server:

```sh
DATABASE_PATH=data/moderation-dev.sqlite pnpm moderation:list
DATABASE_PATH=data/moderation-dev.sqlite pnpm moderation:inspect -- REPORT_ID
DATABASE_PATH=data/moderation-dev.sqlite pnpm moderation:resolve -- REPORT_ID dismiss --reason no_violation
DATABASE_PATH=data/moderation-dev.sqlite pnpm moderation:resolve -- REPORT_ID quarantine --reason private_information
```

On Fly, use the owner's authenticated private console:

```sh
mise exec -- flyctl ssh console -a comp4020-final-aurorasundev
cd /app
node scripts/moderation.ts list
node scripts/moderation.ts inspect REPORT_ID
node scripts/moderation.ts resolve REPORT_ID dismiss --reason no_violation
```

Inspect each relevant report ID on the same paper when context conflicts.
`inspect` prints private paper text and the selected reporter's note. Keep
that output in the private terminal; do not paste it into evidence, logs or
chat. Choose a reason supported by what is actually available. Dismissal
reasons: `no_violation`, `insufficient_evidence`, `duplicate`. Quarantine
reasons: `targeted_threat`, `targeted_abuse`, `hate`, `sexual_minors`,
`explicit_sexual`, `graphic_violence`, `self_harm_instruction`,
`harmful_instruction`, `private_information`, `spam`.

Resolve writes a durable maintenance job. The running server applies it and
broadcasts the result, normally on its next five-second worker wake. If it is
stopped, the job waits for startup; the CLI reports that it is queued rather
than pretending completion. An operator decision queued while a provider
request is running takes precedence over its late result. Quarantine clears
the stored words, decreases the total once, and removes open reading text
without fire or a final reading. Run `list` afterwards to confirm the state.
Expired notes mean less available context, not proof that a report was false.

## Sources and decisions

- [OpenAI moderation API](https://developers.openai.com/api/docs/guides/moderation)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [ADR 004](adr/004-configured-safety-review.md)
