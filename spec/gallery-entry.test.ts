// @vitest-environment jsdom
import { gsap } from "gsap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";
import { createGate, GATE_CAP_MS, isAdvanceKey, progress, returnGesture, swipeDirection, takesInput, wheelDirection, type Stage } from "../src/lib/gallery-progress.ts";
import type { OrbitCallbacks, OrbitOptions } from "../src/scene/gallery-belt.ts";
import { flight } from "../src/lib/entry-motion.ts";

// The Gallery's entry (design 2026-10-19 §1–§3) without WebGL: the virtual
// progress p and its rules (advance, return, skip, never replaying on close,
// no exhibition input while p < 1), the load gate's 1.4 s cap, and the page
// in jsdom with the scene replaced by a recorder: the title's accessible
// name, the old title block gone, keys and the Enter hint advancing, Escape
// returning only with no record open, and a closed record not replaying it.

describe("progress p", () => {
  const run = (events: Parameters<typeof progress>[1][], from: Stage = "entry") => events.reduce(progress, from);

  it("advances from the entry and settles on the exhibition", () => {
    expect(progress("entry", { type: "advance" })).toBe("advancing");
    expect(run([{ type: "advance" }, { type: "settled", at: 1 }])).toBe("exhibition");
  });

  it("returns to the entry and settles there; a return mid-advance turns the same timeline back", () => {
    expect(run([{ type: "back", recordOpen: false }, { type: "settled", at: 0 }], "exhibition")).toBe("entry");
    expect(progress("advancing", { type: "back", recordOpen: false })).toBe("returning");
    expect(progress("returning", { type: "advance" })).toBe("advancing");
  });

  it("never returns while a record is open, so closing one never replays the entry", () => {
    expect(progress("exhibition", { type: "back", recordOpen: true })).toBe("exhibition");
    // a stray settle (e.g. a late timeline callback) changes nothing
    expect(progress("exhibition", { type: "settled", at: 0 })).toBe("exhibition");
    expect(progress("entry", { type: "settled", at: 1 })).toBe("entry");
  });

  it("an advance at p = 1 or while advancing changes nothing", () => {
    expect(progress("exhibition", { type: "advance" })).toBe("exhibition");
    expect(progress("advancing", { type: "advance" })).toBe("advancing");
  });

  it("gives the exhibition input only once settled at p = 1", () => {
    expect((["entry", "advancing", "returning"] as Stage[]).map(takesInput)).toEqual([false, false, false]);
    expect(takesInput("exhibition")).toBe(true);
  });

  it("reads wheel down, swipe up, Space, PageDown and ArrowDown as advance", () => {
    expect([" ", "PageDown", "ArrowDown"].every(isAdvanceKey)).toBe(true);
    expect(["ArrowUp", "ArrowLeft", "Enter", "a"].some(isAdvanceKey)).toBe(false);
    expect(wheelDirection({ deltaX: 0, deltaY: 40 })).toBe(1);
    expect(wheelDirection({ deltaX: 0, deltaY: -40 })).toBe(-1);
    // a sideways trackpad turn is the exhibition's, not the page's
    expect(wheelDirection({ deltaX: 60, deltaY: 10 })).toBe(0);
    expect(swipeDirection(4, -120)).toBe(1);
    expect(swipeDirection(-6, 120)).toBe(-1);
    expect(swipeDirection(120, -30)).toBe(0);
    expect(swipeDirection(0, -10)).toBe(0);
  });
});

describe("the title's flight into the corner", () => {
  it("lands the title's first line exactly on the corner's text, scaled about the title's top left", () => {
    // a centred heading box, its first line's text inset in it, and the corner
    const box = { left: 100, top: 400 };
    const line = { left: 260, top: 410 };
    const to = { left: 48, top: 40 };
    const scale = 40 / 112;
    const f = flight(box, line, to, scale);
    // where the first line's top left ends up after translate + scale (origin 0 0)
    const land = { left: box.left + f.x + (line.left - box.left) * scale, top: box.top + f.y + (line.top - box.top) * scale };
    expect(land.left).toBeCloseTo(to.left, 9);
    expect(land.top).toBeCloseTo(to.top, 9);
    expect(f.scale).toBe(scale);
  });
});

describe("the return gesture at p = 1", () => {
  it("absorbs the first wheel-up at rest and returns on the second", () => {
    const a = returnGesture({ armedAt: null }, 1000, true);
    expect(a.result).toBe("absorb");
    expect(returnGesture(a.arm, 1600, true).result).toBe("return");
  });

  it("never counts a gesture that starts while the exhibition is still turning (a flick's tail)", () => {
    const armed = returnGesture({ armedAt: null }, 1000, true).arm;
    const tail = returnGesture(armed, 1100, false);
    expect(tail.result).toBe("ignore");
    // and the tail disarms: the next gesture at rest is absorbed again
    expect(returnGesture(tail.arm, 1300, true).result).toBe("absorb");
  });

  it("a stale arm is absorbed again rather than returning", () => {
    const armed = returnGesture({ armedAt: null }, 0, true).arm;
    expect(returnGesture(armed, 60_000, true).result).toBe("absorb");
  });
});

describe("load gate", () => {
  afterEach(() => vi.useRealTimers());

  it("holds at most 1.4 s for an exhibition that is not ready", async () => {
    vi.useFakeTimers();
    const gate = createGate();
    let result: boolean | null = null;
    void gate.wait().then((ok) => (result = ok));
    await vi.advanceTimersByTimeAsync(GATE_CAP_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
    expect(GATE_CAP_MS).toBe(1400);
  });

  it("a longer cap asked for is still 1.4 s", async () => {
    vi.useFakeTimers();
    const gate = createGate();
    let result: boolean | null = null;
    void gate.wait(10_000).then((ok) => (result = ok));
    await vi.advanceTimersByTimeAsync(1400);
    expect(result).toBe(false);
  });

  it("lets go as soon as the exhibition is ready, and never waits once it is", async () => {
    vi.useFakeTimers();
    const gate = createGate();
    let result: boolean | null = null;
    void gate.wait().then((ok) => (result = ok));
    await vi.advanceTimersByTimeAsync(300);
    gate.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe(true);
    expect(await gate.wait()).toBe(true);
  });
});

// --- the page -------------------------------------------------------------

const control = vi.hoisted(() => ({
  page: vi.fn(),
  artifact: vi.fn(),
  config: vi.fn(),
  report: vi.fn(),
  still: false,
  scene: {
    cb: null as OrbitCallbacks | null,
    held: undefined as boolean | undefined,
    input: [] as boolean[],
    entry: 0,
    opens: [] as boolean[],
    rest: true,
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
  createGalleryBelt: (_host: HTMLElement, _frames: unknown, cb: OrbitCallbacks, opts: OrbitOptions = {}) => {
    control.scene.cb = cb;
    control.scene.held = opts.held;
    return {
      setItems: () => {},
      setOpen: (v: boolean) => {
        if (v !== (control.scene.opens.at(-1) ?? false)) control.scene.opens.push(v);
      },
      focus: () => {},
      step: () => {},
      setInput: (v: boolean) => control.scene.input.push(v),
      setEntry: (v: number) => (control.scene.entry = v),
      atRest: () => control.scene.rest,
      dispose: () => {},
    };
  },
}));
// the mist module draws with WebGL, which jsdom lacks: a recorder stands in
vi.mock("../src/scene/mist.ts", () => ({
  MIST_ENTRY: 1,
  MIST_BEHIND: 0,
  MIST_STILL: 0.32,
  createMist: () => ({ level: { value: 1 }, touch: () => {}, setBackground: () => {}, dispose: () => {} }),
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
const pageEl = () => host.querySelector<HTMLElement>(".records-page")!;
const stage = () => pageEl().dataset.stage;
async function emit(type: string, data: unknown) {
  await act(async () => FakeSource.current!.emit(type, data));
}
async function mount(ns: number[] = [1, 2, 3]) {
  const { GalleryApp } = await import("../src/GalleryApp.tsx");
  await act(async () => root.render(createElement(GalleryApp)));
  await emit("gallery:snapshot", page(ns));
  await emit("gallery:snapshot", page(ns));
}
// GSAP's root timeline is detached from the real ticker for these tests and
// moved forward on a virtual clock that only ever advances
let clock = 0;
async function play(seconds: number) {
  await act(async () => {
    for (let t = 0; t < seconds; t += 0.05) gsap.updateRoot((clock += 0.05));
  });
  await act(async () => {});
}
async function key(k: string, target: EventTarget = document.body) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
}

describe("the entry page", () => {
  beforeAll(() => {
    gsap.ticker.remove(gsap.updateRoot);
    clock = gsap.ticker.time + 1;
    gsap.updateRoot(clock);
  });
  afterAll(() => {
    gsap.ticker.add(gsap.updateRoot);
  });
  beforeEach(() => {
    control.config.mockResolvedValue({ generation_enabled: true });
    control.scene.cb = null;
    control.scene.held = undefined;
    control.scene.input = [];
    control.scene.entry = 0;
    control.scene.opens = [];
    control.scene.rest = true;
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      EventSource: FakeSource,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    window.matchMedia = ((q: string) => ({ matches: control.still && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
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
    control.still = false;
  });

  it("opens on the entry with the whole title for screen readers, and the old title block is gone", async () => {
    await mount();
    expect(stage()).toBe("entry");
    const h1 = host.querySelector("h1")!;
    // whole, real text (owner 2026-10-20: no per-letter split or scramble;
    // the mist above it does the revealing)
    expect(h1.textContent).toBe("The Throwaway Gallery");
    expect(h1.children).toHaveLength(0);
    expect(h1.getAttribute("aria-hidden")).toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.textContent).toContain("Images shaped by released notes.");
    expect(host.querySelector(".records-title, .records-intro")).toBeNull();
    // the header keeps its wordmark and links; the wordmark is named for the
    // Gallery and leads to the Gallery's entry, never the room (owner,
    // 2026-10-20); "Back to the space" is the way to "/"
    const mark = host.querySelector(".records-header .wordmark")!;
    expect(mark.getAttribute("aria-label")).toBe("The Throwaway Gallery");
    expect(mark.querySelector(".wm-old")!.textContent).toBe("Throwaway");
    expect(mark.querySelector(".wm-name")!.textContent).toBe("The Throwaway Gallery");
    expect([...host.querySelectorAll(".records-header a")].map((a) => a.getAttribute("href"))).toEqual(["/gallery/", "/", "/readme/"]);
    // the Enter hint is a real, focusable button
    const enter = host.querySelector<HTMLButtonElement>(".entry-enter")!;
    expect(enter.tagName).toBe("BUTTON");
    expect(enter.textContent).toContain("Enter");
    // no counts, dates or totals anywhere on the entry
    expect(host.querySelector(".gallery-entry")!.textContent).not.toMatch(/\d/);
  });

  it("the exhibition takes no input while p < 1, and the scene starts held", async () => {
    await mount();
    expect(control.scene.held).toBe(true);
    expect(control.scene.input.at(-1)).toBe(false);
    await act(async () => control.scene.cb!.onReady?.());
    await key("ArrowDown");
    expect(stage()).toBe("advancing");
    expect(control.scene.input.at(-1)).toBe(false);
    // Left/Right do not reach the orbit mid-transition either
    await play(2.4);
    expect(stage()).toBe("exhibition");
    expect(control.scene.input.at(-1)).toBe(true);
    expect(control.scene.entry).toBe(1);
  });

  it("Space, PageDown and the Enter hint all advance; a second advance changes nothing", async () => {
    for (const how of [" ", "PageDown", "enter"]) {
      await mount();
      await act(async () => control.scene.cb!.onReady?.());
      if (how === "enter") await act(async () => host.querySelector<HTMLButtonElement>(".entry-enter")!.click());
      else await key(how);
      expect(stage(), how).toBe("advancing");
      await key("ArrowDown");
      expect(stage()).toBe("advancing");
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });

  it("a wheel down advances; at rest the first wheel up is absorbed and the second returns", async () => {
    await mount();
    await act(async () => control.scene.cb!.onReady?.());
    const wheel = (deltaY: number) => act(async () => window.dispatchEvent(new WheelEvent("wheel", { deltaY, cancelable: true })));
    await wheel(60);
    expect(stage()).toBe("advancing");
    await play(2.4);
    expect(stage()).toBe("exhibition");
    // a wheel-up that starts while the orbit is still turning is the orbit's
    control.scene.rest = false;
    await wheel(-80);
    expect(stage()).toBe("exhibition");
    control.scene.rest = true;
    await new Promise((r) => setTimeout(r, 260));
    await wheel(-80);
    expect(stage(), "the first gesture at rest is absorbed").toBe("exhibition");
    await new Promise((r) => setTimeout(r, 260));
    await wheel(-80);
    expect(stage()).toBe("returning");
    await play(2.4);
    expect(stage()).toBe("entry");
    expect(control.scene.input.at(-1)).toBe(false);
  });

  it("Escape returns to the entry only with no record open; closing a record never replays the entry", async () => {
    await mount();
    await act(async () => control.scene.cb!.onReady?.());
    await key("ArrowDown");
    await play(2.4);
    expect(stage()).toBe("exhibition");
    await act(async () => host.querySelector<HTMLButtonElement>(".orbit-open")!.click());
    expect(control.scene.opens).toEqual([true]);
    // the dialog's Escape closes the record (keydown first, then the
    // browser's cancel, as in a real modal); the page stays at p = 1
    const dialog = host.querySelector("dialog")!;
    await key("Escape", dialog);
    await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(host.querySelector("dialog")).toBeNull();
    expect(stage()).toBe("exhibition");
    await play(2.4);
    expect(stage()).toBe("exhibition");
    // with nothing open, Escape plays the transition back
    await key("Escape");
    expect(stage()).toBe("returning");
    await play(2.4);
    expect(stage()).toBe("entry");
  });

  it("an exhibition not ready holds the transition's first beat, then arrives once ready", async () => {
    await mount();
    await key("ArrowDown");
    await play(2.4);
    // held after the first beat: still on its way, the scene not risen
    expect(stage()).toBe("advancing");
    expect(control.scene.entry).toBe(0);
    await act(async () => control.scene.cb!.onReady?.());
    await play(2.4);
    expect(stage()).toBe("exhibition");
  });

  it("reduced motion: no entry, a plain title above the collection, and the exhibition has input", async () => {
    control.still = true;
    await mount();
    expect(stage()).toBe("exhibition");
    expect(pageEl().classList.contains("is-plain")).toBe(true);
    expect(host.querySelector("h1")!.textContent).toBe("The Throwaway Gallery");
    expect(host.querySelector(".entry-enter")).toBeNull();
    expect(host.querySelectorAll(".records-tile")).toHaveLength(3);
    await key("Escape");
    expect(stage()).toBe("exhibition");
  });

  it("the corner wordmark returns to the entry from the exhibition and from an open record, never navigating to the room", async () => {
    await mount();
    await act(async () => control.scene.cb!.onReady?.());
    await key("ArrowDown");
    await play(2.4);
    expect(stage()).toBe("exhibition");
    const mark = () => host.querySelector<HTMLAnchorElement>(".records-header .wordmark")!;
    // the click is handled in place: the browser's navigation is cancelled
    const click = () => {
      const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      mark().dispatchEvent(e);
      return e;
    };
    let e!: MouseEvent;
    await act(async () => void (e = click()));
    expect(e.defaultPrevented).toBe(true);
    expect(mark().getAttribute("href")).not.toBe("/");
    expect(stage()).toBe("returning");
    await play(2.4);
    expect(stage()).toBe("entry");
    // the entry replays normally afterwards
    await key("ArrowDown");
    expect(stage()).toBe("advancing");
    await play(2.4);
    expect(stage()).toBe("exhibition");
    // from an open record: the dialog's own header copy closes it, then returns
    await act(async () => host.querySelector<HTMLButtonElement>(".orbit-open")!.click());
    const copy = host.querySelector<HTMLAnchorElement>("dialog .wordmark")!;
    expect(copy.getAttribute("aria-label")).toBe("The Throwaway Gallery");
    expect(copy.textContent).toBe("The Throwaway Gallery");
    // the page header's entry-state rules never hide the dialog's copy
    expect(copy.closest("dialog .records-header")).not.toBeNull();
    expect(copy.querySelector(".wm-old")).toBeNull();
    // Space works as on a button (Enter is the link's own click)
    await key(" ", copy);
    expect(host.querySelector("dialog")).toBeNull();
    expect(control.scene.opens).toEqual([true, false]);
    expect(stage()).toBe("returning");
    await play(2.4);
    expect(stage()).toBe("entry");
  });
});
