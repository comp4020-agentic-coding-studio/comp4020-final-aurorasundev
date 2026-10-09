import { afterEach, expect, it, vi } from "vitest";
import { burnPaper } from "../src/lib/api.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ends a hung burn request so the visitor can return and retry the same operation", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const result = burnPaper("paper-one", "receipt", "same-operation").catch((err: Error) => err);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ name: "AbortError" });
});

it("also times out a stalled response body without treating it as a successful deletion", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  })));
  const result = burnPaper("paper-one", "receipt", "same-operation").catch((err: Error) => err);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ name: "AbortError" });
});

it("does not treat a damaged successful response as confirmation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => { throw new SyntaxError("Truncated JSON"); },
  })));
  await expect(burnPaper("paper-one", "receipt", "same-operation")).rejects.toThrow("Truncated JSON");
});
