// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";
import type { OrbitCallbacks } from "../src/scene/gallery-belt.ts";

// The hand-over between the record exhibition's WebGL scene and the HTML
// record, with the scene replaced by a recorder: the HTML takes over only when
// the scene says its open timeline has finished (never on a timer), a close
// keeps the browsing caption back until the scene hands back, a step holds
// the HTML until the next record has arrived, and the title the reveal splits
// keeps its whole text for screen readers.

const control = vi.hoisted(() => ({
  page: vi.fn(),
  artifact: vi.fn(),
  config: vi.fn(),
  report: vi.fn(),
  scene: {
    cb: null as OrbitCallbacks | null,
    opens: [] as boolean[],
    steps: [] as number[],
  },
}));
vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryPage: control.page,
  getArtifact: control.artifact,
  getGalleryConfig: control.config,
  reportArtifact: control.report,
}));
vi.mock("../src/scene/gallery-belt.ts", () => ({
  canDrawOrbit: () => true,
  createGalleryBelt: (_host: HTMLElement, _frames: unknown, cb: OrbitCallbacks) => {
    control.scene.cb = cb;
    return {
      setItems: () => {},
      // like the real scene, telling it the state it is already in is nothing
      setOpen: (v: boolean) => {
        if (v !== (control.scene.opens.at(-1) ?? false)) control.scene.opens.push(v);
      },
      focus: () => {},
      step: (d: number) => control.scene.steps.push(d),
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

const art = (n: number): PublicArtifact => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  version: 1,
  image_url: `/api/gallery/x${n}/image`,
  width: 1024,
  height: 1024,
  title: `Knot in clay ${n}`,
  alt: `An abstract object ${n}.`,
});
const page = (ns: number[]): GalleryPage => ({ revision: 1, items: ns.map(art), next_cursor: null, total: ns.length });

let host: HTMLDivElement;
let root: Root;
const dialog = () => host.querySelector<HTMLDialogElement>(".record-dialog");
const pageEl = () => host.querySelector<HTMLElement>(".records-page")!;
async function emit(type: string, data: unknown) {
  await act(async () => FakeSource.current!.emit(type, data));
}
async function press(selector: string) {
  const b = host.querySelector<HTMLButtonElement>(selector);
  expect(b, selector).toBeTruthy();
  await act(async () => b!.click());
}
async function mount(ns: number[]) {
  const { GalleryApp } = await import("../src/GalleryApp.tsx");
  await act(async () => root.render(createElement(GalleryApp)));
  await emit("gallery:snapshot", page(ns));
  await emit("gallery:snapshot", page(ns));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  control.config.mockResolvedValue({ generation_enabled: true });
  control.scene.cb = null;
  control.scene.opens = [];
  control.scene.steps = [];
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
  vi.useRealTimers();
});

it("the HTML record takes over only when the scene's open timeline finishes, not after a timer", async () => {
  await mount([1, 2, 3]);
  expect(control.scene.cb, "the orbit scene was created").toBeTruthy();
  await press(".orbit-open");
  expect(control.scene.opens).toEqual([true]);
  expect(dialog()!.classList.contains("is-arriving")).toBe(true);
  // far past the old 620 ms timer: still the scene's turn
  await act(async () => vi.advanceTimersByTime(5000));
  expect(dialog()!.classList.contains("is-arriving")).toBe(true);
  await act(async () => control.scene.cb!.onArrive());
  expect(dialog()!.classList.contains("is-arriving")).toBe(false);
});

it("the scene's open timeline is handed the dialog's reveal, which keeps the title whole for screen readers", async () => {
  await mount([1, 2]);
  await press(".orbit-open");
  const reveal = control.scene.cb!.reveal!();
  expect(reveal, "a reveal timeline for the open dialog").toBeTruthy();
  const title = dialog()!.querySelector(".record-title")!;
  // mid-reveal the heading is split into letters, labelled with its whole text
  reveal!.progress(0.5);
  expect(title.getAttribute("aria-label")).toBe("Knot in clay 1");
  expect(title.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(0);
  // the end of the reveal gives the plain text back
  reveal!.progress(1);
  expect(title.children.length).toBe(0);
  expect(title.textContent).toBe("Knot in clay 1");
  expect(title.hasAttribute("aria-label")).toBe(false);
  reveal!.kill();
});

it("a close keeps the browsing caption back until the scene hands back", async () => {
  await mount([1, 2]);
  await press(".orbit-open");
  await act(async () => control.scene.cb!.onArrive());
  await press(".record-close");
  expect(dialog()).toBeNull();
  expect(control.scene.opens).toEqual([true, false]);
  expect(pageEl().classList.contains("is-returning")).toBe(true);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(pageEl().classList.contains("is-returning")).toBe(true);
  await act(async () => control.scene.cb!.onHandBack());
  expect(pageEl().classList.contains("is-returning")).toBe(false);
});

it("closing during the open hands over cleanly, and reopening starts a fresh arrival", async () => {
  await mount([1, 2]);
  await press(".orbit-open");
  await press(".record-close");
  // a late arrival from the cancelled open changes nothing on the closed page
  await act(async () => control.scene.cb!.onArrive());
  expect(dialog()).toBeNull();
  await act(async () => control.scene.cb!.onHandBack());
  await press(".orbit-open");
  expect(dialog()!.classList.contains("is-arriving")).toBe(true);
  expect(pageEl().classList.contains("is-returning")).toBe(false);
});

it("stepping inside an open record holds the HTML until the next record has arrived", async () => {
  await mount([1, 2, 3]);
  await press(".orbit-open");
  await act(async () => control.scene.cb!.onArrive());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".record-step")].find((b) => b.getAttribute("aria-label") === "Next record")!.click());
  expect(control.scene.steps).toEqual([1]);
  expect(dialog()!.classList.contains("is-arriving")).toBe(true);
  // the orbit settles on the next record, then the step's timeline ends
  await act(async () => control.scene.cb!.onFocus(art(2).id));
  expect(dialog()!.querySelector(".record-title")!.textContent).toBe("Knot in clay 2");
  await act(async () => control.scene.cb!.onArrive());
  expect(dialog()!.classList.contains("is-arriving")).toBe(false);
});

it("a record hidden while open closes and hands back like a close", async () => {
  await mount([1, 2]);
  await press(".orbit-open");
  await emit("artifact:hidden", { revision: 2, total: 1, id: art(1).id, version: 2 });
  expect(dialog()).toBeNull();
  expect(pageEl().classList.contains("is-returning")).toBe(true);
  await act(async () => control.scene.cb!.onHandBack());
  expect(pageEl().classList.contains("is-returning")).toBe(false);
});
