// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ApiError } from "../src/lib/api.ts";
import type { Ending } from "../src/lib/useLiveSpace.ts";
import type { RitualEvent } from "../src/components/PaperField.tsx";

const control = vi.hoisted(() => ({
  burn: vi.fn(),
  dispatch: vi.fn(),
  cancel: vi.fn(),
  end: vi.fn(),
  prepare: false,
  onGone: null as null | ((id: string, why: "destroyed", ending: Ending) => void),
  onRitual: null as null | ((event: RitualEvent) => void),
}));

vi.mock("../src/lib/api.ts", async (original) => ({
  ...await original<typeof import("../src/lib/api.ts")>(),
  getPaper: async (id: string) => ({
    id, mode: "keep", version: 1, witness_count: 0, content: "Words belonging to " + id,
    read_receipt: "receipt-" + id, viewer: { is_author: true, has_witnessed: false, can_burn: true },
  }),
  burnPaper: control.burn,
}));

vi.mock("../src/lib/useLiveSpace.ts", () => {
  const space = { status: "ready", connection: "live", ids: ["first", "second"], total: 2, revision: 1, ended: [] };
  const current = () => space;
  return { useLiveSpace: (options: { onGone: typeof control.onGone }) => {
    control.onGone = options.onGone;
    return { space, current, dispatch: control.dispatch, retry: () => {} };
  } };
});

// Only the WebGL surface is substituted. Real dialogs, HTTP-result handling,
// buttons, Escape, fallback rendering and timers run together in React.
vi.mock("../src/components/PaperField.tsx", async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import("react");
  return { PaperField: forwardRef((props: { onOpen: (id: string) => void; onRitual: (event: RitualEvent) => void }, ref) => {
    control.onRitual = props.onRitual;
    useImperativeHandle(ref, () => ({
      openPaper: (_id: string, revealed: (rect: null) => void) => revealed(null),
      prepareRitual: () => control.prepare,
      cancelRitual: control.cancel,
      endRitual: control.end,
      placeRitual: () => true,
      prefetchFire: () => {},
      igniteRitual: () => {},
      burnRitualRemotely: () => {},
    }));
    return createElement("div", null, ...["first", "second"].map((id) =>
      createElement("button", { key: id, onClick: () => props.onOpen(id) }, "Open " + id)));
  }) };
});

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => {}); };
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
  await flush();
}
async function prepare(id: string) {
  await click("Open " + id);
  await click("Release it");
}
async function escape() {
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
}
const answer = (id: string, op: string) => ({ id, op, status: "destroyed", revision: 2, total: 1, effect_seed: "abc", burn_duration_ms: 4800 });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  control.prepare = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("a late answer for an earlier release cannot ignite the next paper", async () => {
  let finish!: (value: ReturnType<typeof answer>) => void;
  control.burn.mockRejectedValueOnce(new ApiError(503, "unavailable", "Try again"));
  control.burn.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await prepare("first");
  await click("Place in furnace");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await click("Back to the space");
  expect(control.cancel).toHaveBeenCalledOnce();
  await prepare("second");
  await act(async () => finish(answer("first", control.burn.mock.calls[0][2])));
  expect(host.querySelector(".ritual.is-ready")).toBeTruthy();
  expect(host.querySelector(".ritual.is-burning")).toBeNull();
  expect(control.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "first", reading: "second" }));
});

it("an earlier fallback ending cannot turn a new paper to ash", async () => {
  control.burn.mockImplementationOnce(async (id: string, _receipt: string, op: string) => answer(id, op));
  await prepare("first");
  await click("Place in furnace");
  expect(host.querySelector(".ritual.is-burning")).toBeTruthy();
  await escape();
  await prepare("second");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(host.querySelector(".ritual.is-ready")).toBeTruthy();
  expect(host.querySelector(".ritual.is-ashes")).toBeNull();
});

it("a server event completes another visitor's release in the no-WebGL ritual", async () => {
  await prepare("first");
  await act(async () => control.onGone!("first", "destroyed", {
    id: "first", version: 2, revision: 2, active_total: 1, effect_seed: "abc",
  }));
  expect(host.querySelector(".ritual.is-burning")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(host.querySelector(".ritual.is-ashes")).toBeTruthy();
  expect(host.textContent).toContain("Someone else let it go first.");
});

it("a fire asset failure switches to a usable drawn furnace before any deletion", async () => {
  control.prepare = true;
  await prepare("first");
  expect(host.querySelector(".ritual.is-preparing")).toBeTruthy();
  await act(async () => control.onRitual!({ type: "fallback" }));
  expect(host.querySelector(".ritual.is-ready.is-fallback .ritual-drawn-furnace")).toBeTruthy();
  expect(control.burn).not.toHaveBeenCalled();
  control.burn.mockImplementationOnce(async (id: string, _receipt: string, op: string) => answer(id, op));
  await click("Place in furnace");
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(host.querySelector(".ritual.is-ashes .ritual-drawn-furnace")).toBeTruthy();
});

it("holds the ash for three seconds before enabling the return button", async () => {
  control.burn.mockImplementationOnce(async (id: string, _receipt: string, op: string) => answer(id, op));
  await prepare("first");
  await click("Place in furnace");
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(host.querySelector<HTMLButtonElement>(".ritual-back")!.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.querySelector<HTMLButtonElement>(".ritual-back")!.disabled).toBe(false);
});
