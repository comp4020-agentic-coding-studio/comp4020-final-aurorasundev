// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ApiError } from "../src/lib/api.ts";

// The account entry in the space's header, the suggestion after a Keep, and
// your papers (ADR 009), with the real dialogs and App state. Only HTTP and
// the WebGL surface are substituted.

const control = vi.hoisted(() => ({
  account: vi.fn(),
  register: vi.fn(),
  recover: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  papers: vi.fn(),
  records: vi.fn(),
  burn: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
  ignite: vi.fn(),
}));

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  getSafetyConfig: async () => ({ provider: "fixture", reports: true }),
  accountState: control.account,
  register: control.register,
  recoverAccount: control.recover,
  signIn: control.signIn,
  signOut: control.signOut,
  ownPapers: control.papers,
  ownRecords: control.records,
  burnPaper: control.burn,
  createPaper: control.create,
  getPaper: async (id: string) => ({
    id, mode: "keep", version: 1, witness_count: 0, content: "Words belonging to " + id, drawing: null,
    read_receipt: "receipt-" + id, viewer: { is_author: true, has_witnessed: false, can_burn: true },
  }),
}));

vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryConfig: async () => ({ generation_enabled: false, music_enabled: false }),
}));

vi.mock("../src/lib/useLiveSpace.ts", () => {
  // "far" is a paper of yours that this page's window doesn't hold
  const space = { status: "ready", connection: "live", ids: ["near"], total: 2, revision: 1, ended: [] };
  return { useLiveSpace: () => ({ space, current: () => space, dispatch: () => {}, retry: control.retry }) };
});

vi.mock("../src/components/PaperField.tsx", async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import("react");
  return { PaperField: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      openPaper: (_id: string, revealed: (rect: null) => void) => revealed(null),
      // no ball in the scene for a paper off screen: the drawn furnace
      prepareRitual: () => false,
      cancelRitual: () => {},
      endRitual: () => {},
      placeRitual: () => true,
      prefetchFire: () => {},
      igniteRitual: control.ignite,
      burnRitualRemotely: () => {},
      throwCreatedPaper: () => {},
      closePaper: () => {},
      clearRitual: () => {},
    }));
    return createElement("div");
  }) };
});

let host: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {});
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);
async function click(text: string) {
  const b = button(text);
  expect(b, text).toBeTruthy();
  await act(async () => b!.click());
  await flush();
}
async function type(id: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => host.querySelector("form")!.requestSubmit());
  await flush();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  control.account.mockResolvedValue({ available: true, signed_in: false });
  control.papers.mockResolvedValue({ papers: [] });
  control.records.mockResolvedValue({ records: [] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  HTMLFormElement.prototype.requestSubmit ??= function (this: HTMLFormElement) {
    this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("offers Sign in in the header, and shows the username once an account is created and its recovery code saved", async () => {
  expect(button("Sign in")).toBeTruthy();
  await click("Sign in");
  expect(host.querySelector("#account-title")!.textContent).toBe("Sign in");
  await click("Create an account");
  expect(host.querySelector("#account-title")!.textContent).toBe("Keep an account");
  expect(host.textContent).toContain("you'll get a recovery code for a forgotten password");
  control.register.mockResolvedValueOnce({ signed_in: true, username: "mira", recovery_code: "ABCD-EFGH-JKMN-PQRS-TUVW" });
  await type("account-username", "mira");
  await type("account-password", "a long passphrase");
  await submit();
  expect(control.register).toHaveBeenCalledWith("mira", "a long passphrase");
  // the code, once, with what it is for; nothing goes on until it is saved
  expect(host.querySelector("#account-title")!.textContent).toBe("Your account is ready");
  expect(host.querySelector(".recovery-code")!.textContent).toBe("ABCD-EFGH-JKMN-PQRS-TUVW");
  expect(host.textContent).toContain("It is how you get back in if you forget your password.");
  expect(host.textContent).toContain("It is shown only this once");
  expect(button("Done")!.disabled).toBe(true);
  expect(button("mira")).toBeFalsy();
  // Escape doesn't dismiss it either: the code is never shown again
  await act(async () => host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(host.querySelector(".recovery-code")).toBeTruthy();
  await act(async () => host.querySelector<HTMLInputElement>(".recovery-saved input")!.click());
  await click("Done");
  expect(host.querySelector(".account-dialog")).toBeNull();
  expect(button("mira")).toBeTruthy();
  // a new identity behind the cookie: the space is asked again
  expect(control.retry).toHaveBeenCalledOnce();
});

it("resets a forgotten password with the username and recovery code, then shows the new code", async () => {
  await click("Sign in");
  await click("Forgot your password?");
  expect(host.querySelector("#account-title")!.textContent).toBe("Forgot your password?");
  control.recover.mockRejectedValueOnce(new ApiError(401, "invalid_recovery", "That username and recovery code don't match."));
  await type("account-username", "mira");
  await type("account-recovery", "abcd efgh jkmn pqrs tuvx");
  await type("account-password", "a brand new passphrase");
  await submit();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("That username and recovery code don't match.");
  control.recover.mockResolvedValueOnce({ signed_in: true, username: "mira", recovery_code: "WXYZ-2345-6789-ABCD-EFGH" });
  await type("account-recovery", "abcd efgh jkmn pqrs tuvw");
  await type("account-password", "a brand new passphrase");
  await submit();
  expect(control.recover).toHaveBeenLastCalledWith("mira", "abcd efgh jkmn pqrs tuvw", "a brand new passphrase");
  expect(host.querySelector("#account-title")!.textContent).toBe("Your password is changed");
  expect(host.querySelector(".recovery-code")!.textContent).toBe("WXYZ-2345-6789-ABCD-EFGH");
  await act(async () => host.querySelector<HTMLInputElement>(".recovery-saved input")!.click());
  await click("Done");
  expect(host.querySelector(".account-dialog")).toBeNull();
  expect(button("mira")).toBeTruthy();
  expect(control.retry).toHaveBeenCalledOnce();
});

it("keeps the dialog and the typed name when sign-in is refused", async () => {
  await click("Sign in");
  control.signIn.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "Username or password is incorrect."));
  await type("account-username", "mira");
  await type("account-password", "not the password");
  await submit();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("Username or password is incorrect.");
  expect(host.querySelector<HTMLInputElement>("#account-username")!.value).toBe("mira");
  expect(control.retry).not.toHaveBeenCalled();
});

it("says so plainly when accounts are switched off", async () => {
  control.account.mockResolvedValue({ available: false, signed_in: false });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
  await click("Sign in");
  expect(host.textContent).toContain("Accounts aren't available right now. You can keep using Throwaway as a guest.");
  expect(host.querySelector("#account-username")).toBeNull();
});

it("suggests an account after a guest's first Keep, and Not now just closes it", async () => {
  control.create.mockResolvedValueOnce({ paper: { id: "new", status: "active", version: 1 }, total: 3, revision: 2, offer_account: true });
  await click("Leave something here");
  await act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Something kept.");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLInputElement>('input[value="KEEP"]')!.click());
  await act(async () => host.querySelector<HTMLInputElement>('.choice-check input[type="checkbox"]')!.click());
  await click("Crumple & throw");
  expect(host.querySelector(".account-dialog")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(host.querySelector("#account-title")!.textContent).toBe("Keep an account");
  expect(host.textContent).toContain("Want to find your papers again later?");
  await click("Not now");
  expect(host.querySelector(".account-dialog")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.querySelector(".account-dialog")).toBeNull();
});

it("lists your papers, opens one that isn't on screen, and lets a Keep go in the drawn furnace", async () => {
  control.account.mockResolvedValue({ available: true, signed_in: true, username: "mira" });
  control.papers.mockResolvedValue({
    papers: [{ id: "far", mode: "keep", excerpt: "A thing I kept", has_drawing: false, created_at: "2026-11-01T00:00:00.000Z" }],
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
  await click("mira");
  expect(host.querySelector("#mine-title")!.textContent).toBe("Your papers");
  expect(host.textContent).toContain("When a paper you released burns, the record it leaves will appear here.");
  expect(host.querySelector("#mine-keep")!.textContent).toBe("Kept by you");
  expect(host.querySelector("#mine-release")).toBeNull();
  const paper = host.querySelector<HTMLButtonElement>("[aria-labelledby=mine-keep] .mine-paper")!;
  expect(paper.textContent).toBe("A thing I kept");
  await act(async () => paper.click());
  await flush();
  expect(host.querySelector(".mine-dialog")).toBeNull();
  expect(host.textContent).toContain("Words belonging to far");
  await click("Release it");
  expect(host.querySelector(".ritual.is-fallback")).toBeTruthy();
  control.burn.mockImplementationOnce(async (id: string, _r: string, op: string) => ({ id, op, status: "destroyed", revision: 3, total: 1, effect_seed: "abc", burn_duration_ms: 4800 }));
  await click("Place in furnace");
  expect(control.burn).toHaveBeenCalledWith("far", "receipt-far", expect.any(String));
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(host.querySelector(".ritual.is-ashes .ritual-drawn-furnace")).toBeTruthy();
});

it("groups your papers by how they were left", async () => {
  control.account.mockResolvedValue({ available: true, signed_in: true, username: "mira" });
  control.papers.mockResolvedValue({
    papers: [
      { id: "r1", mode: "release", excerpt: "Handed over", has_drawing: false, created_at: "2026-11-02T00:00:00.000Z" },
      { id: "k1", mode: "keep", excerpt: "Still mine", has_drawing: false, created_at: "2026-11-01T00:00:00.000Z" },
      { id: "k2", mode: "keep", excerpt: "", has_drawing: true, created_at: "2026-10-31T00:00:00.000Z" },
    ],
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
  await click("mira");
  const headings = [...host.querySelectorAll(".mine-heading")].map((h) => h.textContent);
  expect(headings).toEqual(["Kept by you", "Released", "What they became"]);
  const rows = (group: string) => [...host.querySelectorAll(`[aria-labelledby=mine-${group}] .mine-paper`)].map((b) => b.textContent);
  expect(rows("keep")).toEqual(["Still mine", "A drawing"]);
  expect(rows("release")).toEqual(["Handed over"]);
  expect(host.textContent).not.toContain("Nothing you left is in the space right now.");
});

it("signs out from your papers, back to a guest", async () => {
  control.account.mockResolvedValue({ available: true, signed_in: true, username: "mira" });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
  await click("mira");
  control.signOut.mockResolvedValueOnce({ signed_in: false });
  await click("Sign out");
  expect(host.querySelector(".mine-dialog")).toBeNull();
  expect(button("Sign in")).toBeTruthy();
  expect(control.retry).toHaveBeenCalledOnce();
});
