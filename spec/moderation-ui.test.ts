// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadDialog } from "../src/components/ReadDialog.tsx";
import { WriteDialog } from "../src/components/WriteDialog.tsx";
import { ApiError } from "../src/lib/api.ts";

const control = vi.hoisted(() => ({ report: vi.fn(), create: vi.fn() }));
vi.mock("../src/lib/api.ts", async (original) => ({
  ...await original<typeof import("../src/lib/api.ts")>(),
  reportPaper: control.report,
  createPaper: control.create,
  getPaper: async () => ({ id: "paper", mode: "release", version: 1, witness_count: 0, content: "An ordinary paper.",
    read_receipt: "receipt", viewer: { is_author: false, has_witnessed: false, can_burn: false } }),
}));
let host: HTMLDivElement;
let root: Root;
async function click(text: string) {
  const b = [...host.querySelectorAll("button")].find((el) => el.textContent === text);
  expect(b, text).toBeTruthy();
  await act(async () => b!.click());
}
async function input(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const readProps = { safety: { provider: "fixture" as const, reports: true }, id: "paper", revealed: true, rect: null, liveVersion: 1,
  ended: null, reconnecting: false, onRelease: vi.fn(), onReleasable: vi.fn(), onEnded: vi.fn(), onClose: vi.fn() };

it("locks an unconfirmed report and resends its original payload after closing and reopening the report form", async () => {
  control.report.mockRejectedValueOnce(new TypeError("reply lost")).mockResolvedValueOnce({ report_id: "report", status: "queued" });
  await act(async () => root.render(createElement(ReadDialog, readProps)));
  await click("Report this paper");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="private_information"]')!.click());
  await input(host.querySelector("textarea")!, "My context");
  await click("Send report");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(true);
  expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
  await click("Cancel"); await click("Report this paper"); await click("Try again");
  expect(control.report).toHaveBeenCalledTimes(2);
  expect(control.report.mock.calls[1]).toEqual(control.report.mock.calls[0]);
  expect(control.report.mock.calls[0].slice(0, 4)).toEqual(["paper", "receipt", "private_information", "My context"]);
  expect(host.textContent).toContain("Report received.");
});

it("keeps a definitely refused report editable", async () => {
  control.report.mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many reports for now."));
  await act(async () => root.render(createElement(ReadDialog, readProps)));
  await click("Report this paper");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="spam_scam"]')!.click());
  await click("Send report");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(false);
  expect(host.textContent).toContain("Too many reports for now.");
});

it("removes open words immediately on quarantine without a final reading", async () => {
  await act(async () => root.render(createElement(ReadDialog, readProps)));
  expect(host.textContent).toContain("An ordinary paper.");
  await act(async () => root.render(createElement(ReadDialog, { ...readProps, ended: "quarantined" })));
  expect(host.textContent).not.toContain("An ordinary paper.");
  expect(host.textContent).toContain("This paper is no longer available.");
});

it("retains an editable draft without a provider and offers a configuration retry", async () => {
  const retry = vi.fn();
  await act(async () => root.render(createElement(WriteDialog, { safety: null, onRetrySafety: retry, offline: false,
    onCancel: vi.fn(), onThrown: vi.fn(), pendingOps: new Set<string>() })));
  await input(host.querySelector("textarea")!, "My unfinished thought.");
  await click("Retry checks");
  expect(retry).toHaveBeenCalledTimes(1);
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("My unfinished thought.");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(control.create).not.toHaveBeenCalled();
});

async function readyDraft() {
  await input(host.querySelector("textarea")!, "My unfinished thought.");
  await act(async () => {
    host.querySelector<HTMLInputElement>('input[value="KEEP"]')!.click();
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
}

it("keeps a refused publication editable and submits revised words with a new key", async () => {
  control.create.mockRejectedValueOnce(new ApiError(422, "moderation_rejected", "Please revise this paper."))
    .mockResolvedValueOnce({ paper: { id: "saved", status: "ACTIVE", version: 1 }, total: 1, revision: 1, offer_return_key: false });
  const thrown = vi.fn();
  await act(async () => root.render(createElement(WriteDialog, { safety: { provider: "fixture", reports: true }, offline: false,
    onCancel: vi.fn(), onThrown: thrown, pendingOps: new Set<string>() })));
  await readyDraft(); await click("Crumple & throw");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(false);
  await input(host.querySelector("textarea")!, "A revised thought."); await click("Crumple & throw");
  expect(control.create.mock.calls[1][0]).toBe("A revised thought.");
  expect(control.create.mock.calls[1][2]).not.toBe(control.create.mock.calls[0][2]);
  expect(thrown).toHaveBeenCalledTimes(1);
});

it("retries an unconfirmed publication with the original draft and key", async () => {
  control.create.mockRejectedValueOnce(new TypeError("reply lost"))
    .mockResolvedValueOnce({ paper: { id: "saved", status: "ACTIVE", version: 1 }, total: 1, revision: 1, offer_return_key: false });
  const thrown = vi.fn();
  await act(async () => root.render(createElement(WriteDialog, { safety: { provider: "fixture", reports: true }, offline: false,
    onCancel: vi.fn(), onThrown: thrown, pendingOps: new Set<string>() })));
  await readyDraft(); await click("Crumple & throw");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(true);
  await click("Try again");
  expect(control.create.mock.calls[1]).toEqual(control.create.mock.calls[0]);
  expect(thrown).toHaveBeenCalledTimes(1);
});
