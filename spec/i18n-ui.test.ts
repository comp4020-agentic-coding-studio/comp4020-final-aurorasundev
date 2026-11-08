// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ApiError } from "../src/lib/api.ts";
import type { PublicArtifact } from "../src/lib/gallery-api.ts";
import { LANG_KEY, resetLangForTests, serverText } from "../src/lib/i18n.ts";

// The English / 简体中文 toggle in the space's header, with the real App,
// header and dialogs. Only HTTP and the WebGL surface are substituted.

const control = vi.hoisted(() => ({
  account: vi.fn(),
  records: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  getSafetyConfig: async () => ({ provider: "fixture", reports: true }),
  accountState: control.account,
  signIn: control.signIn,
  ownPapers: async () => ({ papers: [] }),
  ownRecords: control.records,
  getPaper: async (id: string) => ({
    id, mode: "keep", version: 1, witness_count: 2, content: "I saw it. Close the door.", drawing: null,
    read_receipt: "receipt-" + id, viewer: { is_author: false, has_witnessed: false, can_burn: false },
  }),
}));

vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryConfig: async () => ({ generation_enabled: true, music_enabled: false }),
}));

vi.mock("../src/lib/useLiveSpace.ts", () => {
  const space = { status: "ready", connection: "live", ids: ["near"], total: 3, revision: 1, ended: [] };
  return { useLiveSpace: () => ({ space, current: () => space, dispatch: () => {}, retry: () => {} }) };
});

vi.mock("../src/components/PaperField.tsx", async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import("react");
  return { PaperField: forwardRef((props: { onOpen: (id: string) => void }, ref) => {
    useImperativeHandle(ref, () => ({
      openPaper: (_id: string, revealed: (rect: null) => void) => revealed(null),
      closePaper: () => {},
      prefetchFire: () => {},
    }));
    return createElement("button", { type: "button", className: "stub-open", onClick: () => props.onOpen("near") }, "open");
  }) };
});

let host: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {});
};
const byText = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const toggle = () => host.querySelector<HTMLButtonElement>(".lang-toggle")!;
async function press(el: HTMLElement | undefined | null) {
  expect(el).toBeTruthy();
  await act(async () => el!.click());
  await flush();
}
async function mount() {
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  await flush();
}
async function remount() {
  await act(async () => root.unmount());
  resetLangForTests();
  await mount();
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetLangForTests();
  control.account.mockResolvedValue({ available: true, signed_in: false });
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
  await mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("switches the header and the write dialog to Chinese with one press, and back with another", async () => {
  expect(document.documentElement.lang).toBe("en-AU");
  expect(toggle().getAttribute("aria-label")).toBe("切换到中文");
  expect(byText("Sign in")).toBeTruthy();
  expect(host.querySelector(".header-about")!.getAttribute("href")).toBe("/readme/");

  await press(toggle());
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(toggle().getAttribute("aria-label")).toBe("Switch to English");
  expect(byText("登录")).toBeTruthy();
  expect(host.querySelector(".header-about")!.textContent).toBe("关于");
  expect(host.querySelector(".header-about")!.getAttribute("href")).toBe("/readme/zh/");
  expect(host.querySelector(".space-count")!.getAttribute("aria-label")).toBe("3 件事还留在这里。");

  await press(byText("在这里留下点什么"));
  expect(host.querySelector("#write-title")!.textContent).toBe("你准备好放下什么了？");
  expect(host.textContent).toContain("揉皱，扔出去");
  expect(host.querySelector<HTMLTextAreaElement>("#paper-text")!.placeholder).toBe("写下一直压在你心上的事。");

  await press(toggle());
  expect(host.querySelector("#write-title")!.textContent).toBe("What are you ready to put down?");
  expect(host.textContent).toContain("Crumple & throw");
  expect(byText("Sign in")).toBeTruthy();
  expect(document.documentElement.lang).toBe("en-AU");
});

it("keeps the choice in this browser across a reload", async () => {
  await press(toggle());
  expect(window.localStorage.getItem(LANG_KEY)).toBe("zh");
  await remount();
  expect(byText("登录")).toBeTruthy();
  await press(toggle());
  expect(window.localStorage.getItem(LANG_KEY)).toBe("en");
  await remount();
  expect(byText("Sign in")).toBeTruthy();
});

it("never translates what someone wrote, while the sheet around it is in Chinese", async () => {
  await press(toggle());
  await press(host.querySelector<HTMLElement>(".stub-open"));
  expect(host.querySelector(".read-text")!.textContent).toBe("I saw it. Close the door.");
  expect(byText("我看见了")).toBeTruthy();
  expect(host.textContent).toContain("2 人见证了它。");
});

it("shows a record's title in Chinese in the signed-in panel, and in English again after switching back", async () => {
  const record: PublicArtifact = {
    id: "00000000-0000-4000-8000-000000000001", version: 1, image_url: "/api/gallery/x/image", width: 1024, height: 1024,
    title: "An unfinished thread",
    alt: "An abstract artwork: a long folded paper ribbon or thread made of heavy creased paper and weathered, pitted stone, two forms held apart, with a clear gap that the connection does not close.",
  } as PublicArtifact;
  control.account.mockResolvedValue({ available: true, signed_in: true, username: "mira" });
  control.records.mockResolvedValue({ records: [record] });
  await remount();
  await press(toggle());
  await press(host.querySelector<HTMLElement>(".header-account"));
  expect(host.querySelector(".mine-record-title")!.textContent).toBe("未完的线");
  expect(host.querySelector(".mine-record img")!.getAttribute("alt")).toMatch(/^一件抽象作品：/);
  await press(toggle());
  expect(host.querySelector(".mine-record-title")!.textContent).toBe("An unfinished thread");
  expect(host.querySelector(".mine-record img")!.getAttribute("alt")).toBe(record.alt);
});

it("shows a known server refusal in Chinese by its code, and an unknown one in the server's English", async () => {
  await press(toggle());
  await press(byText("登录"));
  const fill = async (id: string, value: string) => {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await fill("account-username", "mira");
  await fill("account-password", "a long passphrase");

  control.signIn.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "Username or password is incorrect."));
  await act(async () => host.querySelector("form")!.requestSubmit());
  await flush();
  expect(host.querySelector(".form-error")!.textContent).toBe("用户名或密码不正确。");
  // switching language changes the shown message too
  await press(toggle());
  expect(host.querySelector(".form-error")!.textContent).toBe("Username or password is incorrect.");
  await press(toggle());

  control.signIn.mockRejectedValueOnce(new ApiError(418, "brand_new_code", "A message the client has never seen."));
  await act(async () => host.querySelector("form")!.requestSubmit());
  await flush();
  expect(host.querySelector(".form-error")!.textContent).toBe("A message the client has never seen.");

  expect(serverText("zh", "rate_limited", "Too many tries. Wait a few minutes and try again.")).toBe("尝试次数过多。请等几分钟再试。");
  expect(serverText("en", "rate_limited", "Too many tries. Wait a few minutes and try again.")).toBe("Too many tries. Wait a few minutes and try again.");
  expect(serverText("zh", "rate_limited", "Too many papers for now. Try again later.")).toBe("暂时扔出的纸太多了。请稍后再试。");
});
