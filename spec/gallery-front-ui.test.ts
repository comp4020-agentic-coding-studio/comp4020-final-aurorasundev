// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";
import { MARKS_KEY } from "../src/lib/record-marks.ts";
import type { OrbitCallbacks } from "../src/scene/gallery-belt.ts";

// The Gallery's entry (owner, 2026-11-08): the belt's front three places go to
// records this browser has not opened, recent ones first, even when a recent
// one lies past the first page; after that, the belt's arrangement holds.
// The scene is replaced by a recorder of what it is handed.

const control = vi.hoisted(() => ({
  page: vi.fn(),
  config: vi.fn(),
  scene: { cb: null as OrbitCallbacks | null, items: [] as string[][] },
}));
vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryPage: control.page,
  getGalleryConfig: control.config,
}));
vi.mock("../src/scene/gallery-belt.ts", () => ({
  canDrawOrbit: () => true,
  createGalleryBelt: (_host: HTMLElement, _frames: unknown, cb: OrbitCallbacks) => {
    control.scene.cb = cb;
    return {
      setItems: (items: { id: string }[]) => control.scene.items.push(items.map((i) => i.id)),
      setOpen: () => {},
      focus: () => {},
      step: () => {},
      dispose: () => {},
    };
  },
}));

class FakeSource {
  static current: FakeSource | null = null;
  readyState = 1;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor() {
    FakeSource.current = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  static CLOSED = 2;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const art = (n: number, recent = false): PublicArtifact => ({
  id: id(n),
  version: 1,
  image_url: `/api/gallery/${id(n)}/image`,
  width: 1024,
  height: 1024,
  title: `Record ${n}`,
  alt: "An abstract object.",
  ...(recent ? { recent: true as const } : {}),
});
const page = (ns: number[], next: string | null = null): GalleryPage => ({ revision: 1, items: ns.map((n) => art(n)), next_cursor: next, total: 30 });
const opened = (ns: number[]) =>
  window.localStorage.setItem(MARKS_KEY, JSON.stringify({ known: ns.map(id), opened: ns.map(id), heard: [] }));

let host: HTMLDivElement;
let root: Root;
const caption = () => host.querySelector(".orbit-title")?.textContent ?? null;
const shown = () => control.scene.items.at(-1) ?? [];
const front = () => {
  const s = shown();
  return [s[0], s[1], s[s.length - 1]];
};
async function emit(type: string, data: unknown) {
  await act(async () => FakeSource.current!.emit(type, data));
}
async function mount() {
  const { GalleryApp } = await import("../src/GalleryApp.tsx");
  await act(async () => root.render(createElement(GalleryApp)));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  control.config.mockResolvedValue({ generation_enabled: true });
  control.page.mockReset();
  // a page asked for and never answered, unless a test says otherwise
  control.page.mockReturnValue(new Promise(() => {}));
  control.scene.cb = null;
  control.scene.items = [];
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    EventSource: FakeSource,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  globalThis.requestAnimationFrame = ((fn: () => void) => setTimeout(fn, 0)) as unknown as typeof requestAnimationFrame;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("puts unopened records in the front three places, in a fixed order", async () => {
  opened([1, 2, 3]);
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4, 5, 6]), recent: [] });
  expect(front()).toEqual([id(4), id(5), id(6)]);
  expect(caption()).toBe("Record 4");
});

it("brings a recent record from past the first page to the very front", async () => {
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4], id(4)), recent: [art(20, true)] });
  expect(front()[0]).toBe(id(20));
  expect(caption()).toBe("Record 20");
  // it is in the belt once, and the rest of the window is all there
  expect(shown().filter((x) => x === id(20))).toHaveLength(1);
  expect([...shown()].sort()).toEqual([1, 2, 3, 4, 20].map(id).sort());
});

it("reads on for unopened records before choosing, then shows them in front", async () => {
  opened([1, 2, 3, 4]);
  control.page.mockResolvedValueOnce(page([5, 6, 7, 8]));
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4], id(4)), recent: [] });
  for (let i = 0; i < 5; i++) await act(async () => {});
  // one request continues from the snapshot's cursor (a second would abort it)
  expect(control.page.mock.calls.filter((c) => c[0] === id(4))).toHaveLength(1);
  expect(front()).toEqual([id(5), id(6), id(7)]);
  // the belt's very first list already had them in front
  expect(control.scene.items[0].slice(0, 2)).toEqual([id(5), id(6)]);
});

it("does not wait forever for a page that never answers", async () => {
  opened([1, 2]);
  control.page.mockReturnValue(new Promise(() => {}));
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2], id(2)), recent: [] });
  expect(shown()).toEqual([]);
  await act(async () => vi.advanceTimersByTime(2000));
  expect(shown().length).toBe(2);
});

it("after the entry, a live arrival and a later snapshot leave the chosen arrangement in place", async () => {
  opened([1, 2]);
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4, 5]), recent: [] });
  const first = shown();
  expect(front()).toEqual([id(3), id(4), id(5)]);
  await emit("artifact:published", { revision: 2, total: 6, artifact: art(9, true) });
  const after = shown().filter((x) => x !== id(9));
  expect(after).toEqual(first);
  // the record in front is not replaced by the arrival
  expect(caption()).toBe("Record 3");
});

it("the belt's very first list already leads with a recent front from past the first page", async () => {
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4], id(4)), recent: [art(20, true)] });
  expect(control.scene.items[0][0]).toBe(id(20));
});

it("a failed first load still gets a front once Try again succeeds", async () => {
  await mount();
  await act(async () => {
    FakeSource.current!.readyState = 2;
    FakeSource.current!.onerror?.();
  });
  await act(async () => vi.advanceTimersByTime(2500));
  const retry = host.querySelector<HTMLButtonElement>(".records-state button");
  expect(retry, "the Try again button").toBeTruthy();
  await act(async () => retry!.click());
  await emit("gallery:snapshot", { ...page([1, 2, 3]), recent: [art(9, true)] });
  expect(front()[0]).toBe(id(9));
});

it("keeps an unopened first-page record a candidate after reading on retires it from the window", async () => {
  // 60 records, pages of 12; only record 2 (on the first page) is unopened.
  // Reading on past 48 tiles retires the first page from the window before
  // the pages run out; record 2 must still be chosen and rejoin the belt.
  const all = Array.from({ length: 60 }, (_, i) => i + 1);
  opened(all.filter((n) => n !== 2));
  const pages = [1, 2, 3, 4].map((k) => all.slice(k * 12, k * 12 + 12));
  pages.forEach((p, k) => control.page.mockResolvedValueOnce(page(p, k < 3 ? id(p[p.length - 1]) : null)));
  await mount();
  await emit("gallery:snapshot", { ...page(all.slice(0, 12), id(12)), recent: [] });
  for (let i = 0; i < 20; i++) await act(async () => {});
  expect(control.page).toHaveBeenCalledTimes(4);
  expect(front()[0]).toBe(id(2));
  expect(caption()).toBe("Record 2");
  expect(shown().filter((x) => x === id(2))).toHaveLength(1);
});

it("never chooses a record that was hidden while the front was being chosen", async () => {
  opened([1, 2, 3, 4]);
  let answer: (p: GalleryPage) => void = () => {};
  control.page.mockReturnValueOnce(new Promise<GalleryPage>((r) => (answer = r)));
  await mount();
  await emit("gallery:snapshot", { ...page([1, 2, 3, 4, 5], id(5)), recent: [] });
  // record 5 is the only unopened one so far; it is hidden before the next page answers
  await emit("artifact:hidden", { type: "artifact:hidden", revision: 2, total: 29, id: id(5), version: 2 });
  await act(async () => answer({ ...page([6, 7, 8, 9]), revision: 2 }));
  for (let i = 0; i < 5; i++) await act(async () => {});
  expect(shown()).not.toContain(id(5));
  // all three places go to records still there (a hidden choice would leave
  // the third place to whatever ends the window, here record 9)
  expect(front()).toEqual([id(6), id(7), id(8)]);
});
