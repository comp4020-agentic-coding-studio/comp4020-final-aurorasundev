// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import type { GalleryPage, PublicArtifact } from "../src/lib/gallery-api.ts";
import { composeMusicScore } from "../shared/music-score.ts";

// The record player in jsdom with Web Audio, the score route and the synth
// module faked (ADR 006, music-design §6): nothing audible or loaded before
// an explicit Play; Play fetches, renders once and plays; Pause/Resume reuse
// the buffer; stepping, closing, reporting, hiding and backgrounding stop it;
// a late render for one record never sounds for another; a record without a
// score, or a server with music off, shows the honest no-sound copy.

const control = vi.hoisted(() => ({
  page: vi.fn(),
  artifact: vi.fn(),
  config: vi.fn(),
  report: vi.fn(),
  score: vi.fn(),
  render: vi.fn(),
  synthLoaded: 0,
}));
vi.mock("../src/lib/gallery-api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/gallery-api.ts")>()),
  getGalleryPage: control.page,
  getArtifact: control.artifact,
  getGalleryConfig: control.config,
  reportArtifact: control.report,
  getScore: control.score,
}));
vi.mock("../src/lib/gallery-synth.ts", async () => {
  control.synthLoaded++;
  const { parseMusicScore } = await import("../shared/music-score.ts");
  return { parseMusicScore, renderScore: control.render };
});

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

// --- a minimal Web Audio double ------------------------------------------------
const param = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
type Node = { connect: (n: Node) => Node; disconnect: () => void };
const node = (): Node => ({ connect: (n: Node) => n, disconnect: vi.fn() });
const sources: { buffer: unknown; started: [number, number] | null; stopped: boolean; onended: (() => void) | null }[] = [];
const contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  destination = node();
  onstatechange: (() => void) | null = null;
  resumedInGesture = false;
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    contexts.push(this);
  }
  createGain() {
    return { ...node(), gain: param() };
  }
  createBufferSource() {
    const s = {
      ...node(),
      buffer: null as unknown,
      started: null as [number, number] | null,
      stopped: false,
      onended: null as (() => void) | null,
      start(_when: number, offset: number) {
        s.started = [_when, offset];
      },
      stop() {
        s.stopped = true;
      },
    };
    sources.push(s);
    return s;
  }
}
class FakeOffline {}

const SCORE = composeMusicScore(
  { metaphor: "thread", relation: "connected", motion: "drifting", space: "open", music: { timbre: "felt_piano", pulse: "slow", density: "sparse", ending: "settled" } },
  "deadbeef",
);
const BUFFER = { duration: 24, getChannelData: () => new Float32Array(1) };

const art = (n: number, music: PublicArtifact["music"] | null = { status: "ready", score_version: 1, duration_ms: 24000 }): PublicArtifact => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  version: 1,
  image_url: `/api/gallery/x${n}/image`,
  width: 1024,
  height: 1024,
  title: `Knot in clay ${n}`,
  alt: `An abstract object ${n}.`,
  ...(music ? { music } : {}),
});
const page = (items: PublicArtifact[]): GalleryPage => ({ revision: 1, items, next_cursor: null, total: items.length });

let host: HTMLDivElement;
let root: Root;
const dialog = () => host.querySelector(".record-dialog");
const playButton = () => host.querySelector<HTMLButtonElement>(".player-button")!;
const playerState = () => host.querySelector(".record-player")?.getAttribute("data-state");
const sounding = () => sources.filter((s) => s.started && !s.stopped);

async function mount(items: PublicArtifact[], music = true) {
  control.config.mockResolvedValue({ generation_enabled: true, music_enabled: music });
  const { GalleryApp } = await import("../src/GalleryApp.tsx");
  await act(async () => root.render(createElement(GalleryApp)));
  await act(async () => FakeSource.current!.emit("gallery:snapshot", page(items)));
}
async function openTile(i = 0) {
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".records-tile")[i].click());
}
async function press() {
  await act(async () => playButton().click());
}
// lets fetch → import → render → resume chains (and the 200 ms fade) settle
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 60 && !check(); i++) await settle(10);
  expect(check(), label).toBe(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  sources.length = 0;
  contexts.length = 0;
  control.synthLoaded = 0;
  control.score.mockImplementation(async (id: string) => ({ artifact_id: id, artifact_version: 1, score: SCORE }));
  control.render.mockResolvedValue(BUFFER);
  FakeSource.current = null;
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    EventSource: FakeSource,
    AudioContext: FakeAudioContext,
    OfflineAudioContext: FakeOffline,
  });
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

it("makes no sound, context, score request or synth load before Play: not on entry, browsing or opening", async () => {
  await mount([art(1), art(2)]);
  await openTile();
  expect(dialog()!.textContent).toContain("AI-directed generative instrumental");
  expect(playButton().disabled).toBe(false);
  expect(playButton().textContent).toContain("Listen");
  expect(contexts).toHaveLength(0);
  expect(control.score).not.toHaveBeenCalled();
  expect(control.render).not.toHaveBeenCalled();
  expect(control.synthLoaded).toBe(0);
  expect(host.querySelector("audio")).toBeNull();
});

it("Play resumes the context inside the click, fetches, renders once, then plays; Pause and Resume reuse the buffer", async () => {
  await mount([art(1)]);
  await openTile();
  await act(async () => {
    playButton().click();
    // created and resumed synchronously, before any await
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
  });
  expect(control.score).toHaveBeenCalledWith(art(1).id, expect.anything());
  await until(() => playerState() === "playing", "playing");
  expect(control.render).toHaveBeenCalledTimes(1);
  expect(control.render.mock.calls[0][0]).toEqual(SCORE);
  expect(sounding()).toHaveLength(1);
  expect(sounding()[0].buffer).toBe(BUFFER);
  expect(sounding()[0].started![1]).toBe(0);
  expect(playButton().textContent).toContain("Pause");
  expect(dialog()!.textContent).toContain("/ 0:24");
  expect(host.querySelector<HTMLInputElement>(".player-volume input")!.value).toBe("0.35");

  contexts[0].currentTime = 5;
  await press();
  expect(playerState()).toBe("paused");
  expect(playButton().textContent).toContain("Resume");
  await until(() => sounding().length === 0, "paused source stopped");

  await press();
  await until(() => playerState() === "playing", "resumed");
  // the same buffer, from the offset at the end of the 200 ms fade
  expect(control.render).toHaveBeenCalledTimes(1);
  expect(sources).toHaveLength(2);
  expect(sources[1].buffer).toBe(BUFFER);
  expect(sources[1].started![1]).toBeCloseTo(5.2, 5);
  expect(contexts).toHaveLength(1);

  // the natural end: Play again, from zero, no loop
  await act(async () => sources[1].onended?.());
  expect(playerState()).toBe("ended");
  expect(playButton().textContent).toContain("Play again");
  expect(sources).toHaveLength(2);
  await press();
  await until(() => playerState() === "playing", "replayed");
  expect(sources[2].started![1]).toBe(0);
  expect(control.render).toHaveBeenCalledTimes(1);
});

it("stepping to another record stops the sound and drops the old buffer", async () => {
  await mount([art(1), art(2)]);
  await openTile();
  await press();
  await until(() => playerState() === "playing", "playing");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Next record")!.click());
  expect(dialog()!.querySelector("h2")!.textContent).toBe("Knot in clay 2");
  expect(sources[0].stopped).toBe(true);
  expect(playerState()).toBe("ready");
  // nothing starts for the new record without a click
  await settle(250);
  expect(sounding()).toHaveLength(0);
  await press();
  await until(() => playerState() === "playing", "B plays");
  expect(control.render).toHaveBeenCalledTimes(2);
  expect(control.score).toHaveBeenLastCalledWith(art(2).id, expect.anything());
});

it("closing the record, or opening its report form, stops the sound", async () => {
  await mount([art(1)]);
  await openTile();
  await press();
  await until(() => playerState() === "playing", "playing");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Report this record")!.click());
  expect(sources[0].stopped).toBe(true);
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click());
  expect(playerState()).toBe("ready");
  await press();
  await until(() => playerState() === "playing", "playing again");
  await act(async () => host.querySelector<HTMLButtonElement>(".record-dialog .record-back")!.click());
  expect(dialog()).toBeNull();
  expect(sources[1].stopped).toBe(true);
  expect(sounding()).toHaveLength(0);
});

it("a hide while playing stops it; hiding the tab stops it and never resumes", async () => {
  await mount([art(1), art(2)]);
  await openTile();
  await press();
  await until(() => playerState() === "playing", "playing");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(sources[0].stopped).toBe(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle(250);
  expect(sounding()).toHaveLength(0);
  expect(playerState()).toBe("ready");

  await press();
  await until(() => playerState() === "playing", "playing");
  await act(async () => FakeSource.current!.emit("artifact:hidden", { revision: 2, total: 1, id: art(1).id, version: 2 }));
  expect(dialog()).toBeNull();
  expect(sounding()).toHaveLength(0);
});

it("a render for record A that finishes after B is opened never sounds", async () => {
  let finish!: (b: unknown) => void;
  control.render.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  await mount([art(1), art(2)]);
  await openTile();
  await press();
  await until(() => control.render.mock.calls.length === 1, "A rendering");
  expect(playerState()).toBe("rendering");
  expect(dialog()!.textContent).toContain("Preparing sound…");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Next record")!.click());
  await act(async () => finish(BUFFER));
  await settle(250);
  expect(sources).toHaveLength(0);
  expect(playerState()).toBe("ready");
});

it("a record without a score, or a server with music off, shows the honest no-sound copy", async () => {
  await mount([art(1, null), art(2, { status: "unavailable" })]);
  for (const i of [0, 1]) {
    await openTile(i);
    expect(playButton().disabled).toBe(true);
    expect(dialog()!.textContent).toContain("There is no sound for this record yet.");
    expect(dialog()!.textContent).not.toMatch(/instrumental|\d:\d\d/);
    await act(async () => host.querySelector<HTMLButtonElement>(".record-dialog .record-back")!.click());
  }
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount([art(3)], false);
  await openTile();
  expect(playButton().disabled).toBe(true);
  expect(dialog()!.textContent).toContain("There is no sound for this record yet.");
  expect(contexts).toHaveLength(0);
});

it("a score that is gone by Play falls back to no sound; a failed render offers a retry", async () => {
  control.score.mockRejectedValueOnce(new ApiError(404, "artifact_gone", "This object is no longer here."));
  await mount([art(1), art(2)]);
  await openTile();
  await press();
  await until(() => playerState() === "none", "gone");
  expect(dialog()!.textContent).toContain("There is no sound for this record yet.");
  await act(async () => host.querySelector<HTMLButtonElement>(".record-dialog .record-back")!.click());
  control.render.mockRejectedValueOnce(new Error("render_silent"));
  await openTile(1);
  await press();
  await until(() => playerState() === "failed", "failed");
  expect(dialog()!.textContent).toContain("Sound could not start. Try again.");
  expect(playButton().textContent).toContain("Try again");
  await press();
  await until(() => playerState() === "playing", "retried");
});

it("says sound isn't supported when there is no Web Audio, and the image still works", async () => {
  Object.assign(globalThis, { AudioContext: undefined, OfflineAudioContext: undefined });
  await mount([art(1)]);
  await openTile();
  expect(playButton().disabled).toBe(true);
  expect(dialog()!.textContent).toContain("Sound is not supported in this browser.");
  expect(dialog()!.querySelector("img.sleeve-image")).not.toBeNull();
});
