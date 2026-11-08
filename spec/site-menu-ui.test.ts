// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GalleryLinks } from "../src/components/GalleryLinks.tsx";
import { Header } from "../src/components/Header.tsx";
import { SiteMenu } from "../src/components/SiteMenu.tsx";

// On a phone the header's places fold into one Menu (owner, 2026-11-08). The
// CSS decides which of the row and the Menu shows; these check the menu's own
// behaviour: it holds the same places, only while open, and its Escape never
// reaches a dialog it sits inside.

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
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

const menu = () => host.querySelector<HTMLDialogElement>(".site-menu");
const press = (el: Element | null) => act(async () => (el as HTMLElement).click());
const places = () => [...(menu()?.querySelectorAll(".site-menu-links > *") ?? [])].map((e) => e.textContent);
const header = (props: Partial<Parameters<typeof Header>[0]> = {}) =>
  act(async () => root.render(createElement(Header, { onAccount: vi.fn(), username: null, total: 3, canVisitGallery: true, ...props })));

it("holds the header's places only while open, so they are never in the page twice", async () => {
  await header();
  expect(menu()).toBeNull();
  expect(host.querySelectorAll(".header-account")).toHaveLength(1);
  await press(host.querySelector(".site-menu-open"));
  expect(menu()!.open).toBe(true);
  expect(host.querySelector(".site-menu-open")!.getAttribute("aria-expanded")).toBe("true");
  expect(places()).toEqual(["Gallery", "About", "Sign in", "中/EN"]);
  await press(menu()!.querySelector(".site-menu-close"));
  expect(menu()).toBeNull();
});

it("keeps the language for the idle space, as the stacked links did, and waits through a burn", async () => {
  await header({ canVisitGallery: false });
  await press(host.querySelector(".site-menu-open"));
  expect(places()).toEqual(["About", "Sign in"]);
  await header({ canVisitGallery: false, busy: true });
  expect(menu()).toBeNull();
  expect(host.querySelector<HTMLButtonElement>(".site-menu-open")!.disabled).toBe(true);
});

it("closes on a choice, so the account sheet never opens over it", async () => {
  const onAccount = vi.fn();
  await header({ onAccount });
  await press(host.querySelector(".site-menu-open"));
  await press(menu()!.querySelector(".header-account"));
  expect(onAccount).toHaveBeenCalledTimes(1);
  expect(menu()).toBeNull();
});

it("its Escape closes only the menu, never a record it sits inside", async () => {
  const onCancel = vi.fn();
  await act(async () =>
    root.render(createElement("dialog", { open: true, onCancel }, createElement(SiteMenu, null, createElement("a", { href: "/" }, "Back to the space")))),
  );
  await press(host.querySelector(".site-menu-open"));
  await act(async () => menu()!.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));
  expect(menu()).toBeNull();
  expect(onCancel).not.toHaveBeenCalled();
});

it("the Gallery's menu holds its own places, with the full way back to the space", async () => {
  await act(async () => root.render(createElement(GalleryLinks)));
  expect(menu()).toBeNull();
  await press(host.querySelector(".site-menu-open"));
  expect(places()).toEqual(["Back to the space", "About", "中/EN"]);
  expect([...menu()!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/", "/readme/?from=gallery"]);
});

it("a press on the backdrop closes it, a press on the sheet does not", async () => {
  await header();
  await press(host.querySelector(".site-menu-open"));
  await press(menu()!.querySelector(".site-menu-sheet"));
  expect(menu()).not.toBeNull();
  await press(menu());
  expect(menu()).toBeNull();
});

it("gives focus back to Menu when it closes with nothing else chosen", async () => {
  await header();
  const opener = host.querySelector<HTMLButtonElement>(".site-menu-open")!;
  await press(opener);
  await act(async () => (document.activeElement as HTMLElement | null)?.blur());
  await press(menu()!.querySelector(".site-menu-close"));
  expect(document.activeElement).toBe(opener);
});
