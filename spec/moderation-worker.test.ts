import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTotal, openDb, type DB } from "../server/db.ts";
import {
  check,
  FIXTURE,
  fixtureProvider,
  interpret,
  openAiProvider,
  POLICY_VERSION,
  providerFromEnv,
  TIMEOUTS,
  type FixtureProvider,
} from "../server/moderation.ts";
import { burnPaper, createPaper } from "../server/papers.ts";
import { quarantinePaper } from "../server/quarantine.ts";
import { enqueueReport } from "../server/reports.ts";
import { createReviewWorker, MAX_RUNS } from "../server/reviews.ts";

// The parts of moderation an HTTP check can't reach: what is sent to the
// provider, and how the review worker behaves across retries, restarts and
// races. These run in-process on a throwaway in-memory database, with a fake
// fetch or the fixture provider; nothing here calls OpenAI.

const payload = { paper_text: "words", report_reason: null, report_note: null };
const NO_FLAGS = Object.fromEntries(
  ["sexual", "sexual/minors", "harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent",
    "self-harm", "self-harm/intent", "self-harm/instructions", "violence", "violence/graphic"].map((k) => [k, false]),
);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completed = (text: unknown) =>
  json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(text) }] }] });
const allowed = { decision: "allow", reason: "none", certainty: "clear", policy_version: POLICY_VERSION };

function fakeOpenAi(answers: { moderation?: () => Response; policy?: () => Response }) {
  const requests: { path: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    if (path.endsWith("/moderations")) return (answers.moderation ?? (() => json({ results: [{ flagged: false, categories: NO_FLAGS }] })))();
    return (answers.policy ?? (() => completed(allowed)))();
  }) as typeof fetch;
  return { impl, requests };
}

describe("the OpenAI adapter", () => {
  it("sends only the text, with the pinned models, no storage and a strict schema", async () => {
    const api = fakeOpenAi({});
    expect(await check(openAiProvider("sk-test", api.impl), { paper_text: "words", report_reason: "spam_scam", report_note: "a note" })).toEqual({
      kind: "allow",
    });
    const [moderation, policy] = api.requests;
    expect(moderation.path).toBe("/v1/moderations");
    expect(moderation.body).toEqual({ model: "omni-moderation-latest", input: "words" });
    expect(policy.path).toBe("/v1/responses");
    expect(policy.auth).toBe("Bearer sk-test");
    expect(policy.body).toMatchObject({ model: "gpt-4.1-mini-2025-04-14", store: false, stream: false, max_output_tokens: 250 });
    const format = (policy.body.text as { format: Record<string, unknown> }).format;
    expect(format).toMatchObject({ type: "json_schema", strict: true });
    const input = policy.body.input as { role: string; content: string }[];
    expect(input[0].role).toBe("system");
    // the paper and the report travel as separate data fields, never in the instruction
    expect(JSON.parse(input[1].content)).toEqual({ paper_text: "words", report_reason: "spam_scam", report_note: "a note" });
    expect(input[0].content).not.toContain("a note");
  });

  it("rejects on a hard-gate category without the paid second call", async () => {
    const api = fakeOpenAi({ moderation: () => json({ results: [{ flagged: true, categories: { ...NO_FLAGS, "sexual/minors": true } }] }) });
    expect(await check(openAiProvider("k", api.impl), payload)).toEqual({ kind: "reject", reason: "sexual_minors", stage: "gate" });
    expect(api.requests.map((r) => r.path)).toEqual(["/v1/moderations"]);
  });

  it("still asks the contextual check about broad flags instead of blocking them", async () => {
    const api = fakeOpenAi({ moderation: () => json({ results: [{ flagged: true, categories: { ...NO_FLAGS, "self-harm": true, violence: true } }] }) });
    expect(await check(openAiProvider("k", api.impl), payload)).toEqual({ kind: "allow" });
    expect(api.requests).toHaveLength(2);
  });

  it("fails closed on refusal, truncation, malformed output, auth and rate limits", async () => {
    const cases: [() => Response, string][] = [
      [() => json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }), "policy_refusal"],
      [() => json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }), "policy_incomplete"],
      [() => json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{not json" }] }] }), "policy_malformed"],
      [() => completed({ ...allowed, decision: "maybe" }), "policy_malformed"],
      [() => completed({ ...allowed, policy_version: "other" }), "policy_version_mismatch"],
      [() => completed({ ...allowed, reason: "spam" }), "policy_inconsistent"],
      [() => json({ error: {} }, 401), "provider_auth"],
      [() => json({ error: {} }, 429, { "retry-after": "7" }), "provider_rate_limited"],
      [() => json({ error: {} }, 500), "provider_error"],
    ];
    for (const [policy, code] of cases) {
      const verdict = await check(openAiProvider("k", fakeOpenAi({ policy }).impl), payload);
      expect(verdict.kind, code).toBe("unavailable");
      if (verdict.kind === "unavailable") expect(verdict.error.code).toBe(code);
    }
    const limited = await check(openAiProvider("k", fakeOpenAi({ policy: () => json({}, 429, { "retry-after": "7" }) }).impl), payload);
    expect(limited.kind === "unavailable" && limited.error.retryAfterMs).toBe(7000);
  });

  it("fails closed on a timeout", async () => {
    const saved = TIMEOUTS.moderation;
    TIMEOUTS.moderation = 50;
    try {
      const hang = ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
      const verdict = await check(openAiProvider("k", hang), payload);
      expect(verdict.kind === "unavailable" && verdict.error.code).toBe("timeout");
    } finally {
      TIMEOUTS.moderation = saved;
    }
  });

  it("routes uncertain answers to review and never reads a review as an allow", () => {
    expect(interpret({ decision: "review", reason: "uncertain", certainty: "uncertain", policy_version: POLICY_VERSION }).kind).toBe("review");
    expect(interpret({ decision: "reject", reason: "spam", certainty: "uncertain", policy_version: POLICY_VERSION }).kind).toBe("review");
    expect(interpret({ decision: "allow", reason: "none", certainty: "uncertain", policy_version: POLICY_VERSION }).kind).toBe("review");
    expect(interpret({ decision: "reject", reason: "spam", certainty: "clear", policy_version: POLICY_VERSION })).toEqual({
      kind: "reject",
      reason: "spam",
      stage: "policy",
    });
    expect(interpret({ ...allowed, extra: 1 }).kind).toBe("unavailable");
  });
});

describe("choosing a provider", () => {
  it("has no unchecked mode: no key fails closed, and the test double is refused on Fly", async () => {
    expect(providerFromEnv({})).toBeNull();
    expect((await check(null, payload)).kind).toBe("unavailable");
    expect(() => providerFromEnv({ MODERATION_PROVIDER: "fixture", FLY_APP_NAME: "x" })).toThrow();
    expect(() => providerFromEnv({ MODERATION_PROVIDER: "allow-all" })).toThrow();
  });
});

describe("the review worker", () => {
  let db: DB;
  let provider: FixtureProvider;
  let clock: number;
  const workers: ReturnType<typeof createReviewWorker>[] = [];
  const worker = (p: FixtureProvider | null = provider) => {
    const w = createReviewWorker(db, p, { retryDelaysMs: [0, 0, 0], intervalMs: 60_000, now: () => clock });
    workers.push(w);
    return w;
  };
  const identity = (): string => {
    const id = randomUUID();
    db.prepare("INSERT INTO identities (id, created_at) VALUES (?, ?)").run(id, new Date().toISOString());
    return id;
  };
  const paper = (content: string, owner = identity(), mode = "RELEASE"): string => {
    const r = createPaper(db, owner, content, randomUUID(), mode);
    if (!r.ok) throw new Error(r.code);
    return r.value.id;
  };
  const reportOn = (paperId: string, reason = "something_else", note: string | null = null) => {
    const r = enqueueReport(db, paperId, identity(), reason, note, randomUUID(), clock);
    if (r.kind !== "created") throw new Error(r.kind);
    return r;
  };
  const review = (id: string) =>
    db.prepare("SELECT state, attempts, runs, error_code, outcome_reason FROM report_reviews WHERE id = ?").get(id) as {
      state: string;
      attempts: number;
      runs: number;
      error_code: string | null;
      outcome_reason: string | null;
    };
  const status = (id: string) => (db.prepare("SELECT status, content FROM papers WHERE id = ?").get(id) as { status: string; content: string });

  beforeEach(() => {
    db = openDb(":memory:");
    provider = fixtureProvider();
    clock = Date.now();
  });
  afterEach(async () => {
    for (const w of workers.splice(0)) await w.stop();
    db.close();
  });

  it("rejects changed notes under an existing operation key until retention has expired", () => {
    const id = paper("ordinary");
    const reporter = identity();
    const key = randomUUID();
    const initial = enqueueReport(db, id, reporter, "spam_scam", null, key, clock);
    expect(initial.kind).toBe("created");
    expect(enqueueReport(db, id, reporter, "spam_scam", "different context", key, clock).kind).toBe("conflict");
    clock += 31 * 24 * 60 * 60 * 1000;
    expect(enqueueReport(db, id, reporter, "spam_scam", "different context", key, clock).kind).toBe("existing");
    expect(db.prepare("SELECT COUNT(*) AS n FROM reports").get()).toEqual({ n: 1 });
  });

  it("gives an operator dismissal precedence over a late automated rejection", async () => {
    const id = paper(`x ${FIXTURE.reportViolation}`);
    const r = reportOn(id);
    const classify = provider.classify.bind(provider);
    provider.classify = async (...args) => {
      db.prepare("INSERT INTO maintenance_jobs (id, kind, report_id, reason, state, created_at) VALUES (?, 'dismiss', ?, 'no_violation', 'pending', ?)")
        .run(randomUUID(), r.reportId, new Date(clock).toISOString());
      return classify(...args);
    };
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "dismissed", outcome_reason: "no_violation" });
    expect(status(id).status).toBe("ACTIVE");
    expect(db.prepare("SELECT state, outcome FROM maintenance_jobs").get()).toEqual({ state: "done", outcome: "dismissed" });
  });

  it("routes conflicting context arriving during a rejection to a person", async () => {
    const id = paper(`x ${FIXTURE.reportViolation}`);
    const r = reportOn(id, "private_information", "context one");
    const classify = provider.classify.bind(provider);
    provider.classify = async (...args) => {
      reportOn(id, "spam_scam", "context two");
      return classify(...args);
    };
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", outcome_reason: "conflicting_reports", runs: 1 });
    expect(status(id).status).toBe("ACTIVE");
  });

  it("bounds internal worker failures without logging the exception's private text", async () => {
    const id = paper("ordinary");
    const r = reportOn(id);
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql === "SELECT content FROM papers WHERE id = ?") throw new Error("PRIVATE PAPER TEXT");
      return original(sql);
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const w = worker();
      for (let i = 0; i < 5; i++) await w.wake();
      expect(review(r.reviewId)).toMatchObject({ state: "human_review", attempts: 3, error_code: "exhausted_worker_error" });
      expect(status(id).status).toBe("ACTIVE");
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("PRIVATE PAPER TEXT");
    } finally { spy.mockRestore(); consoleSpy.mockRestore(); }
  });

  it("groups a burst of reports into one check", async () => {
    const id = paper("ordinary");
    const r = reportOn(id, "spam_scam");
    reportOn(id, "spam_scam");
    reportOn(id, "spam_scam");
    await worker().wake();
    expect(review(r.reviewId).state).toBe("dismissed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM report_reviews").get()).toEqual({ n: 1 });
    expect(provider.calls.classify).toBe(1);
  });

  it("quarantines a clear violation, clearing its words and dropping the total once", async () => {
    const id = paper(`cruel ${FIXTURE.reportViolation}`);
    const before = activeTotal(db);
    const r = reportOn(id, "threats_abuse");
    await worker().wake();
    expect(status(id)).toEqual({ status: "QUARANTINED", content: "" });
    expect(review(r.reviewId)).toMatchObject({ state: "quarantined", outcome_reason: "targeted_abuse" });
    expect(activeTotal(db)).toBe(before - 1);
  });

  it("sends conflicting reports with unverifiable notes to a person", async () => {
    const id = paper("ordinary");
    const r = reportOn(id, "private_information", "this is my neighbour");
    reportOn(id, "spam_scam");
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", outcome_reason: "conflicting_reports" });
    expect(status(id).status).toBe("ACTIVE");
  });

  it("keeps several same-reason notes for a person instead of silently dropping the context", async () => {
    const id = paper("ordinary");
    const r = reportOn(id, "private_information", "this identifies me");
    reportOn(id, "private_information", "this identifies my colleague too");
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", outcome_reason: "multiple_report_notes" });
    expect(provider.calls.classify).toBe(0);
    expect(status(id).status).toBe("ACTIVE");
    expect(db.prepare("SELECT note FROM reports WHERE review_id = ?").all(r.reviewId)).toHaveLength(2);
  });

  it("bounds paid checks even when another report arrives during every check", async () => {
    const id = paper("ordinary");
    const r = reportOn(id, "spam_scam");
    const classify = provider.classify.bind(provider);
    provider.classify = async (...args) => {
      reportOn(id, "spam_scam");
      return classify(...args);
    };
    await worker().wake();
    expect(provider.calls.classify).toBe(MAX_RUNS);
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", runs: MAX_RUNS });
    expect(status(id).status).toBe("ACTIVE");
  });

  it("retries a failing check three times, then hands it to a person", async () => {
    const id = paper(`x ${FIXTURE.reportTransient}`);
    const r = reportOn(id);
    const w = worker();
    for (let i = 0; i < 5; i++) await w.wake();
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", attempts: 3, error_code: "exhausted_provider_error" });
    expect(status(id).status).toBe("ACTIVE");
  });

  it("goes straight to a person when the provider refuses the credential, or none is configured", async () => {
    const id = paper(`x ${FIXTURE.reportAuth}`);
    const r = reportOn(id);
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "human_review", attempts: 1, error_code: "provider_auth" });

    const other = paper("y");
    const r2 = reportOn(other);
    await worker(null).wake();
    expect(review(r2.reviewId)).toMatchObject({ state: "human_review", attempts: 1, error_code: "unconfigured" });
  });

  it("resumes a job whose lease ran out, as after a crash mid-check", async () => {
    const id = paper("ordinary");
    const r = reportOn(id);
    db.prepare("UPDATE report_reviews SET state = 'running', attempts = 1, lease_until = ? WHERE id = ?").run(
      new Date(clock - 1000).toISOString(),
      r.reviewId,
    );
    await worker().wake();
    expect(review(r.reviewId)).toMatchObject({ state: "dismissed", attempts: 2 });
  });

  it("makes a late review of a destroyed paper obsolete instead of acting on it", async () => {
    const owner = identity();
    const id = paper(`cruel ${FIXTURE.reportViolation}`, owner, "KEEP");
    const r = reportOn(id);
    expect(burnPaper(db, id, owner, randomUUID(), true).outcome).toBe("destroyed");
    await worker().wake();
    expect(review(r.reviewId).state).toBe("obsolete");
    expect(status(id).status).toBe("DESTROYED");
  });

  it("lets destruction and quarantine race without a second decrement or a revival", () => {
    const owner = identity();
    const id = paper("contested", owner, "KEEP");
    const before = activeTotal(db);
    expect(burnPaper(db, id, owner, randomUUID(), true).outcome).toBe("destroyed");
    expect(quarantinePaper(db, id, "spam", "automated").changed).toBe(false);
    expect(activeTotal(db)).toBe(before - 1);
    expect(status(id)).toEqual({ status: "DESTROYED", content: "" });

    const other = paper("contested too", owner, "KEEP");
    expect(quarantinePaper(db, other, "spam", "operator").changed).toBe(true);
    expect(burnPaper(db, other, owner, randomUUID(), true).outcome).toBe("paper_gone");
    expect(activeTotal(db)).toBe(before - 1); // the second paper came and went once
  });

  it("looks again at a dismissed paper reported anew, up to a limit, then asks a person", async () => {
    const id = paper("ordinary");
    const w = worker();
    let reviewId = "";
    for (let i = 0; i < MAX_RUNS; i++) {
      reviewId = reportOn(id).reviewId;
      await w.wake();
      expect(review(reviewId).state).toBe("dismissed");
    }
    reportOn(id);
    expect(review(reviewId).state).toBe("human_review");
    expect(provider.calls.classify).toBe(MAX_RUNS);
  });

  it("applies an operator's decision left by the CLI, and purges old notes", async () => {
    const id = paper("ordinary");
    const r = reportOn(id, "private_information", "a note that must not be kept");
    db.prepare("UPDATE reports SET note_expires_at = ? WHERE id = ?").run(new Date(clock - 1).toISOString(), r.reportId);
    db.prepare("INSERT INTO maintenance_jobs (id, kind, report_id, reason, state, created_at) VALUES (?, 'quarantine', ?, 'private_information', 'pending', ?)").run(
      randomUUID(),
      r.reportId,
      new Date(clock).toISOString(),
    );
    await worker().wake();
    expect(status(id).status).toBe("QUARANTINED");
    expect(db.prepare("SELECT state, outcome FROM maintenance_jobs").get()).toEqual({ state: "done", outcome: "quarantined" });
    expect(db.prepare("SELECT note FROM reports WHERE id = ?").get(r.reportId)).toEqual({ note: null });
  });
});
