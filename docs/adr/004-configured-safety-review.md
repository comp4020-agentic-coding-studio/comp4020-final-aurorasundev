# 004 — Configured checks before publication; reports are evidence to review

Status: accepted and implemented; local fixture and real-provider verification passed on 2026-10-10. Release preparation is recorded in PROCESS.md.

## Context

Throwaway should accept ordinary difficult feelings without becoming a place
for targeted harm, exposed private information or scams. Anonymous reporting
can be abused. A report count cannot be treated as proof.

## Options

| Option | Benefit | Cost |
| --- | --- | --- |
| Local keyword checks | no external disclosure or usage cost | misses context and punishes ordinary emotional language |
| Human approval for every submission | a person handles ambiguity | publication waits on operator availability |
| **Configured category and context checks, human report exceptions** | ordinary allowed papers can enter promptly; uncertainty is explicit | external text disclosure, provider cost and an operator queue |

## Decision and service

The server uses OpenAI directly, with `omni-moderation-latest` followed by
`gpt-4.1-mini-2025-04-14` under the versioned Throwaway policy and a strict
JSON schema. The policy prompt separates submitted text and reporter data
from instructions. Clear gate categories reject early; broad emotional
categories still receive contextual assessment.

Publication requires a clear allow. Refusal, malformed output, truncation,
timeouts, provider failures, missing credentials and uncertainty do not
publish; the client retains the draft. Results are tied to the submitted
content digest, so retries cannot substitute different words. The client bounds
publication requests at fifteen seconds per attempt (three attempts maximum)
and reports at eight seconds. Unknown outcomes hold their original payload and
key for retry; definite refusals keep the draft editable. Configuration fetches
can be retried without reloading or losing the open draft.

`GET /api/safety` exposes only provider type and reporting availability,
never credentials. It drives the submission disclosure and report entry.
A configured credential is not proof that the provider is healthy. Fixture
mode is an isolated test double, refused when `FLY_APP_NAME` is set.

## Report handling

- The reporter must hold a valid reading receipt. One identity gets one
  report per paper; retries reuse its operation key.
- Starting limits are five new reports per identity per hour and twenty
  per address per hour. These are abuse controls, not identity guarantees.
- SQLite stores the report and durable review job in one transaction.
  Reporting changes neither paper status nor the total.
- One worker reviews jobs, resumes expired leases and verifies the same
  ACTIVE paper digest before applying a result.
- Clear violations quarantine. Conflicting reasons with notes, multiple
  notes, uncertain answers, unavailable configuration and exhausted
  attempts go to a person. Context is retained for that person rather than
  reduced to a null note and automatically dismissed.
- A paper gets at most three automated decisions; reports arriving during
  a running check cannot bypass that bound. A transient check has at most
  three attempts, including internal worker failures. This bounds review work but does not guarantee three
  individual provider requests: each attempt can involve both service calls.
- New conflicting context arriving during a check receives the same human
  routing as context already present. An operator decision queued during a
  provider request takes precedence over the late automatic result.
- Only quarantine clears the words and lowers the total, once. Open readers
  lose quarantined content immediately, with no final reading or fire.

## Operator workflow and privacy

See the [operations runbook](../moderation-runbook.md) for local setup, future
secret configuration and operator duties. Run the private CLI where the database lives:

```sh
pnpm moderation:list
pnpm moderation:inspect -- <report-id>
pnpm moderation:resolve -- <report-id> dismiss --reason <reason-code>
pnpm moderation:resolve -- <report-id> quarantine --reason <reason-code>
```

Inspect prints private content to that operator's terminal; do not copy it
to public logs or process evidence. Resolution queues a maintenance decision
that the running worker applies and broadcasts. There is no public admin UI.
The operator must actually inspect this queue; the app makes no response-time
promise and sends no automatic messages to people.

Only paper text and relevant report context go to the provider, with policy
response storage disabled. Visitor identities, cookies, keys and credentials
do not. Provider retention is outside the application's guarantee. Report
notes expire after thirty days; after expiry, a person may have less context.
Logs exclude paper text and notes.

## Costs and verification

Outages prevent new publication; an operator queue can wait; external context
checks incur usage charges. Aggregate reporting does not automatically make
a paper disappear. Conservative human routing avoids erasing disagreements
but increases operator work.

HTTP specs and in-process fixtures cover publication, retries, reports,
quarantine, identity isolation and unavailable providers. Worker regressions
cover multiple notes and reports arriving during each review. OpenAI adapter
tests use fake responses, never a paid real request. Real moderation quality,
live credentials and the deployed integration are not established by fixtures.

On 2026-10-10, all 112 tests in fourteen files and the client build passed.
Local Chromium browser checks covered refused drafts, lost publication and
report replies, desktop and short-phone report scrolling, no-key operation,
and both automated and private-CLI quarantine across two readers. No-key
reports entered human review. Real provider credentials, paid calls, Docker
and deployment were not verified in this local-only step.

After the owner configured a local OpenAI key on 2026-10-10, five small
real-service checks used synthetic text. Moderation and Responses endpoints
succeeded, safe publication returned 201, scam publication returned 422,
and reported synthetic legacy scams were quarantined. The final check
notified two SSE sessions, cleared the words, reduced the total once and
made the paper unfetchable. A model-metadata query returned 403 without
blocking the actual service endpoints. General policy accuracy and live
deployment remain unverified; no production text was submitted to this test.
