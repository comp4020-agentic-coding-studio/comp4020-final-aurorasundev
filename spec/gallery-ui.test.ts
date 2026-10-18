// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import type { GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";

// The Gallery page in jsdom, with its HTTP calls and its EventSource faked:
// loading, honest empty and failure states, the paused note, the opened
// record and its focus, live removal, and a report that holds its key.
// jsdom has no WebGL, so this is the plain collection the orbit falls back
// to under reduced motion or without WebGL; both share the same state.

const control = vi.hoisted(() => ({
  page: vi.fn(),
  artifact: vi.fn(),
  config: vi.fn(),
  report: vi.fn(),
}));
vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryPage: control.page,
  getArtifact: control.artifact,
  getGalleryConfig: control.config,
  reportArtifact: control.report,
}));

// a controllable EventSource: tests push named events into the open one
class FakeSource {
  static current: FakeSource | null = null;
  static opened = 0;
  readyState = 1;
  url: string;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeSource.current = this;
    FakeSource.opened++;
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

const art = (n: number, version = 1): PublicArtifact => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  version,
  image_url: `/api/gallery/x${n}/image`,
  width: 1024,
  height: 1024,
  title: `Knot in clay ${n}`,
  alt: `An abstract object ${n}.`,
});
const page = (ns: number[], revision = 1, next: string | null = null): GalleryPage => ({ revision, items: ns.map((n) => art(n)), next_cursor: next, total: ns.length });

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? "";
async function click(label: string) {
  const b = [...host.querySelectorAll("button")].find((el) => el.textContent === label || el.getAttribute("aria-label") === label);
  expect(b, label).toBeTruthy();
  await act(async () => b!.click());
}
async function emit(type: string, data: unknown) {
  await act(async () => FakeSource.current!.emit(type, data));
}
async function mount() {
  const { GalleryApp } = await import("../src/GalleryApp.tsx");
  await act(async () => root.render(createElement(GalleryApp)));
}

beforeEach(() => {
  vi.resetAllMocks();
  control.config.mockResolvedValue({ generation_enabled: true });
  FakeSource.current = null;
  FakeSource.opened = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, EventSource: FakeSource });
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
});

it("says it is opening, then shows an honest empty state with no fixture art or total", async () => {
  await mount();
  expect(text()).toContain("Opening the Gallery…");
  await emit("gallery:snapshot", page([]));
  expect(text()).toContain("No records have arrived yet.");
  expect(text()).toContain("When a released paper is burned, an image shaped by it can arrive here after it passes safety checks.");
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(text()).not.toMatch(/\d+ (objects?|records?)/);
});

it("says when generation is paused, and still shows what is here", async () => {
  control.config.mockResolvedValue({ generation_enabled: false });
  await mount();
  await emit("gallery:snapshot", page([1]));
  expect(text()).toContain("New records are not being made right now.");
  expect(host.querySelectorAll(".records-tile")).toHaveLength(1);
});

it("offers a retry when the Gallery can't be opened", async () => {
  await mount();
  await act(async () => {
    FakeSource.current!.readyState = 2;
    FakeSource.current!.onerror?.();
  });
  expect(text()).toContain("The Gallery could not be opened. Try again.");
  await click("Try again");
  expect(FakeSource.opened).toBe(2);
  await emit("gallery:snapshot", page([1]));
  expect(host.querySelectorAll(".records-tile")).toHaveLength(1);
});

it("renders square, lazy images with alt text and explicit size, and nothing about papers or sound", async () => {
  await mount();
  await emit("gallery:snapshot", page([1, 2]));
  const img = host.querySelector<HTMLImageElement>(".records-tile img")!;
  expect([img.getAttribute("width"), img.getAttribute("height"), img.getAttribute("loading"), img.getAttribute("decoding")]).toEqual([
    "1024",
    "1024",
    "lazy",
    "async",
  ]);
  expect(img.alt).toBe("An abstract object 1.");
  expect(text()).not.toMatch(/paper id|recover|original text|witness/i);
});

it("an opened record says the note is gone and has no fake player", async () => {
  await mount();
  await emit("gallery:snapshot", page([1]));
  await act(async () => host.querySelector<HTMLButtonElement>(".records-tile")!.click());
  const dialog = host.querySelector(".record-dialog")!;
  expect(dialog.textContent).toContain("The original note is gone.");
  // image-only: the player slot is a disabled control with honest copy, and
  // nothing shows a waveform, a time or an audio element
  const play = dialog.querySelector<HTMLButtonElement>(".player-button")!;
  expect(play.disabled).toBe(true);
  expect(dialog.textContent).toContain("There is no sound for this record yet.");
  expect(dialog.querySelector("audio")).toBeNull();
  expect(dialog.textContent).not.toMatch(/\d\d:\d\d|instrumental/);
});

it("steps to the next record from an opened one", async () => {
  await mount();
  await emit("gallery:snapshot", page([1, 2, 3]));
  await act(async () => host.querySelector<HTMLButtonElement>(".records-tile")!.click());
  await click("Next record");
  expect(host.querySelector(".record-title")!.textContent).toBe("Knot in clay 2");
  await click("Previous record");
  await click("Previous record");
  expect(host.querySelector(".record-title")!.textContent).toBe("Knot in clay 3");
});

it("opens a detail focused on the dialog, closes on Escape and returns focus to its tile", async () => {
  await mount();
  await emit("gallery:snapshot", page([1, 2]));
  const tile = host.querySelectorAll<HTMLButtonElement>(".records-tile")[1];
  await act(async () => tile.click());
  const dialog = host.querySelector<HTMLDialogElement>(".record-dialog")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(document.activeElement).toBe(dialog);
  expect(dialog.querySelector(".record-title")!.textContent).toBe("Knot in clay 2");
  await act(async () => {
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(host.querySelector(".record-dialog")).toBeNull();
  expect(document.activeElement).toBe(host.querySelectorAll(".records-tile")[1]);
});

it("removes a hidden object from the grid and closes its open detail live", async () => {
  await mount();
  await emit("gallery:snapshot", page([1, 2]));
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".records-tile")[0].click());
  expect(host.querySelector(".record-dialog")).not.toBeNull();
  await emit("artifact:hidden", { revision: 2, total: 1, id: art(1).id, version: 2 });
  expect(host.querySelector(".record-dialog")).toBeNull();
  expect(host.querySelectorAll(".records-tile")).toHaveLength(1);
  // a later publish of an older version can't restore it
  await emit("artifact:published", { revision: 3, total: 2, artifact: art(1, 1) });
  expect(host.querySelectorAll(".records-tile")).toHaveLength(1);
});

it("adds a live arrival without a reload", async () => {
  await mount();
  await emit("gallery:snapshot", page([1]));
  await emit("artifact:published", { revision: 2, total: 2, artifact: art(9) });
  expect([...host.querySelectorAll(".records-caption")].map((c) => c.textContent)).toEqual(["Knot in clay 9", "Knot in clay 1"]);
});

it("on reconnect, closes an open object outside the first page that is gone", async () => {
  control.page.mockResolvedValueOnce(page([2], 1));
  control.artifact.mockRejectedValueOnce(new ApiError(404, "artifact_gone", "gone"));
  await mount();
  await emit("gallery:snapshot", page([1], 1, art(1).id));
  await click("See more records");
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".records-tile")[1].click());
  expect(host.querySelector(".record-title")!.textContent).toBe("Knot in clay 2");
  // the stream drops and comes back with a fresh snapshot of the first page
  await act(async () => FakeSource.current!.onerror?.());
  await act(async () => {
    FakeSource.current!.emit("gallery:snapshot", page([1], 5, art(1).id));
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(control.artifact).toHaveBeenCalledWith(art(2).id);
  expect(host.querySelector(".record-dialog")).toBeNull();
});

it("holds a report's reason and key after a lost reply, even through closing and reopening", async () => {
  control.report.mockRejectedValueOnce(new TypeError("reply lost")).mockResolvedValueOnce({ report_id: "r", status: "queued" });
  await mount();
  await emit("gallery:snapshot", page([1]));
  await act(async () => host.querySelector<HTMLButtonElement>(".records-tile")!.click());
  await click("Report this record");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="spam_scam"]')!.click());
  await click("Send report");
  expect(text()).toContain("We couldn't confirm the report was received.");
  expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
  // close and open the same object again
  await act(async () => {
    host.querySelector(".record-dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 5));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".records-tile")!.click());
  await click("Try again");
  expect(control.report).toHaveBeenCalledTimes(2);
  expect(control.report.mock.calls[1]).toEqual(control.report.mock.calls[0]);
  expect(control.report.mock.calls[0].slice(0, 2)).toEqual([art(1).id, "spam_scam"]);
  expect(text()).toContain("Report received.");
});

it("leaves a definitely refused report editable", async () => {
  control.report.mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many reports for now. Try again later."));
  await mount();
  await emit("gallery:snapshot", page([1]));
  await act(async () => host.querySelector<HTMLButtonElement>(".records-tile")!.click());
  await click("Report this record");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="something_else"]')!.click());
  await click("Send report");
  expect(text()).toContain("Too many reports for now.");
  expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false);
});
