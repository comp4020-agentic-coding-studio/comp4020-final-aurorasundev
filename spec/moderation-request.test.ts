import { afterEach, expect, it, vi } from "vitest";
import { createPaper, reportPaper } from "../src/lib/api.ts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function stalledFetch() {
  const send = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", send);
  return send;
}

it("bounds all publication retries and preserves the same words and key", async () => {
  vi.useFakeTimers();
  const send = stalledFetch();
  const result = createPaper("my draft", "KEEP", "original-key").catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(46800);
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(send).toHaveBeenCalledTimes(3);
  for (const [, init] of send.mock.calls) expect(JSON.parse(String(init.body))).toMatchObject({ content: "my draft", submission_key: "original-key" });
});

it("ends a stalled report body without confirming receipt", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) })));
  const result = reportPaper("paper", "receipt", "spam_scam", "context", "report-key").catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ name: "AbortError" });
});
