// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Header } from "../src/components/Header.tsx";
import { WriteDialog } from "../src/components/WriteDialog.tsx";

// Release already means a public keepsake: the write sheet says so in
// Release's own description and adds nothing else to choose or confirm. The
// Gallery is reachable only from the idle space.

const control = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  createPaper: control.create,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const write = () =>
  act(async () =>
    root.render(
      createElement(WriteDialog, {
        safety: { provider: "fixture", reports: true },
        offline: false,
        onCancel: vi.fn(),
        onThrown: vi.fn(),
        pendingOps: new Set<string>(),
      }),
    ),
  );
async function type(value: string) {
  const el = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());

it("release_copy_explains_automatic_public_keepsake", async () => {
  await write();
  const release = host.querySelector('input[value="RELEASE"]')!.closest("label")!;
  expect(release.textContent!.replace(/\s+/g, " ")).toContain(
    "Its fate is no longer yours to control. When burned, it will automatically become an anonymous AI keepsake in the public Gallery. Your original words and drawing will be deleted.",
  );
  // Keep makes no keepsake promise
  const keep = host.querySelector('input[value="KEEP"]')!.closest("label")!;
  expect(keep.textContent).toBe("Keep itOnly you may destroy it if you encounter it again.");
});

it("gallery_does_not_add_another_checkbox", async () => {
  await write();
  expect(host.querySelectorAll('input[type="radio"][name="mode"]')).toHaveLength(2);
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(host.textContent).not.toMatch(/opt in|opt-in|include in the gallery/i);
});

it("sends exactly the same request as before, and the I understand check still holds it back", async () => {
  control.create.mockRejectedValueOnce(new TypeError("reply lost")).mockResolvedValueOnce({
    paper: { id: "p", version: 1, status: "active" },
    total: 1,
    revision: 1,
    offer_return_key: false,
  });
  await write();
  await type("Something released.");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="RELEASE"]')!.click());
  await submit();
  expect(control.create).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Please tick “I understand” before throwing this paper.");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await submit();
  await submit();
  // (text, drawing, mode, key), and a frozen retry repeats them exactly
  expect(control.create.mock.calls[0]).toHaveLength(4);
  expect(control.create.mock.calls[0].slice(0, 3)).toEqual(["Something released.", null, "RELEASE"]);
  expect(control.create.mock.calls[1]).toEqual(control.create.mock.calls[0]);
});

it("shows the Gallery link only from the idle space", async () => {
  await act(async () => root.render(createElement(Header, { onReturnKey: vi.fn(), total: 3, canVisitGallery: true })));
  const links = () => [...host.querySelectorAll(".header-link")].map((l) => l.textContent);
  expect(links()).toEqual(["Return key", "Gallery", "About"]);
  expect(host.querySelector<HTMLAnchorElement>('a[href="/gallery/"]')).not.toBeNull();
  // writing, reading, the return key and the ritual all pass false
  for (const busy of [false, true]) {
    await act(async () => root.render(createElement(Header, { onReturnKey: vi.fn(), total: 3, busy, canVisitGallery: false })));
    expect(links()).toEqual(["Return key", "About"]);
  }
});
