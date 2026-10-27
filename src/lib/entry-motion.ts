import { gsap } from "gsap";

// The Gallery entry's two timelines (design 2026-10-19 §2, §3; owner
// revision 2026-10-20). Both work on HTML only; the scene and the mist are
// reached through small hooks, so the exhibition behind them can change
// without touching the entry.
//
//   reveal      the title is plain, whole text from the first paint: the mist
//               above it does the revealing. Only the lede and the Scroll
//               hint fade in. No per-letter split, no scramble.
//   transition  p 0 → 1, about 1.6 s: the title flies into the corner and
//               becomes the wordmark (owner, 2026-10-20): its first line is
//               measured against the corner's "The Throwaway Gallery" and lands
//               exactly on it while the old "Throwaway" fades out underneath;
//               then the corner's own text takes over in the same place (no
//               blink: it fades in over the identical, landed title, which
//               only then hides). A title wrapped onto several lines (a
//               phone) cannot land as one line, so it crossfades with the
//               corner over the flight's last third instead. The mist clears
//               fully so the stage plate shows, the exhibition's entrance
//               rises in and its text comes last. Played backwards to return. A label "hold" marks where
//               it waits (at most 1.4 s) for an exhibition that is not ready.
//
// The title stays one real heading with its own text for screen readers.

export const HOLD_AT = 0.55;

export function entryReveal(extras: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.fromTo(extras, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.1 }, 0.5);
  return tl;
}

export type TransitionTargets = {
  title: HTMLElement;
  // the lede, hints and Enter button: they leave first
  extras: HTMLElement[];
  // where the title travels: the corner wordmark's "The Throwaway Gallery"
  // (`name`), replacing its old "Throwaway" (`old`, optional)
  corner: { name: HTMLElement; old?: HTMLElement | null };
  // the exhibition's own HTML (title, caption, controls): it arrives last
  exhibition: HTMLElement;
};

export type TransitionHooks = {
  // the mist's veil strength from its current entry level to `to`
  mist?: { level: { value: number }; from: number; to: number; touch: () => void } | null;
  // the exhibition scene's entrance, 0..1
  scene?: (entry: number) => void;
  // reached the "hold" beat going forward; return true to keep playing
  hold?: (tl: gsap.core.Timeline) => void;
};

// the title's flight into the corner, seconds
export const FLY_SECONDS = 0.85;

// the text's own line boxes (a heading's box is wider than its text);
// falls back to the element's box where ranges have no geometry
const lineRects = (el: HTMLElement): DOMRect[] => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const rects = typeof r.getClientRects === "function" ? [...r.getClientRects()].filter((x) => x.width > 0) : [];
  return rects.length ? rects : [el.getBoundingClientRect()];
};
const textBox = (el: HTMLElement): DOMRect => {
  const r = document.createRange();
  r.selectNodeContents(el);
  return typeof r.getBoundingClientRect === "function" && r.getBoundingClientRect().width > 0 ? r.getBoundingClientRect() : el.getBoundingClientRect();
};
const fontPx = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize) || 0;

// How the title's box maps onto the corner's text: scaled about its top left
// corner by the ratio of the two font sizes (the same face and tracking), and
// moved so the first line's text box lands on the corner's. Pure, so the
// spec can check that it lands exactly.
export type Box = { left: number; top: number };
export function flight(box: Box, firstLine: Box, to: Box, scale: number) {
  return {
    x: to.left - box.left - scale * (firstLine.left - box.left),
    y: to.top - box.top - scale * (firstLine.top - box.top),
    scale,
  };
}

export function entryTransition(t: TransitionTargets, h: TransitionHooks): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
  // where the title goes, read once as the timeline is made
  const box = t.title.getBoundingClientRect();
  const lines = lineRects(t.title);
  const first = lines[0];
  const multi = lines.some((r) => Math.abs(r.top - first.top) > first.height * 0.5);
  const to = textBox(t.corner.name);
  const fromPx = fontPx(t.title);
  const scale = fromPx > 0 && fontPx(t.corner.name) > 0 ? fontPx(t.corner.name) / fromPx : first.height > 0 ? Math.max(0.12, to.height / first.height) : 0.3;
  const fly = flight(box, first, to, scale);

  tl.addLabel("lift", 0);
  tl.fromTo(t.extras, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -8, duration: 0.35, ease: "power2.in", stagger: 0.03 }, "lift");
  tl.fromTo(t.title, { x: 0, y: 0, scale: 1, transformOrigin: "0 0" }, { ...fly, duration: FLY_SECONDS, ease: "power3.inOut" }, "lift");
  // the old "Throwaway" fades out underneath as the title arrives
  if (t.corner.old) tl.fromTo(t.corner.old, { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.in" }, FLY_SECONDS * 0.45);
  if (multi) {
    // several lines cannot land on one: a crossfade over the last third
    tl.fromTo(t.corner.name, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, FLY_SECONDS - 0.3);
    tl.fromTo(t.title, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, ease: "power1.inOut", immediateRender: false }, FLY_SECONDS - 0.28);
  } else {
    // landed: the corner's own text comes up over the identical title, which
    // then hides, so the hand-over is one image and never dips
    tl.fromTo(t.corner.name, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, FLY_SECONDS - 0.02);
    tl.fromTo(t.title, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.01, ease: "none", immediateRender: false }, FLY_SECONDS + 0.11);
  }
  if (h.mist) {
    const m = h.mist;
    tl.fromTo(m.level, { value: m.from }, { value: m.to, duration: 0.95, ease: "power1.inOut", onUpdate: m.touch }, "lift");
  }
  // the first beat ends here; an exhibition that is not ready yet holds it
  tl.addLabel("hold", HOLD_AT);
  tl.call(() => {
    if (!tl.reversed()) h.hold?.(tl);
  }, undefined, "hold");
  const scene = { entry: 0 };
  tl.fromTo(scene, { entry: 0 }, { entry: 1, duration: 0.8, ease: "power2.out", onUpdate: () => h.scene?.(scene.entry) }, HOLD_AT + 0.05);
  tl.fromTo(t.exhibition, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, ease: "power1.out" }, HOLD_AT + 0.6);
  tl.data = { scene } satisfies EntryData;
  return tl;
}

// The transition's own copy of the scene's entrance. A seek with events
// suppressed (a resize re-measuring the flight) can leave the scene hook's
// last call behind this value: a freshly built timeline seeked to its end
// reports entry 0 from its first render while its value is already 1. The
// caller pushes this value to the scene after any silent seek (syncScene).
export type EntryData = { scene: { entry: number } };
export function syncScene(tl: gsap.core.Timeline | null, scene: ((entry: number) => void) | undefined): void {
  const v = (tl?.data as EntryData | undefined)?.scene?.entry;
  if (typeof v === "number") scene?.(v);
}

// The exhibition's HTML at rest, with no transition (fallbacks, skipped entry)
export function settleExhibition(t: Pick<TransitionTargets, "exhibition">, at: 0 | 1) {
  gsap.set(t.exhibition, { autoAlpha: at });
}
