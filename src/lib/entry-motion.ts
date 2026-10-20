import { gsap } from "gsap";

// The Gallery entry's two timelines (design 2026-10-19 §2, §3; owner
// revision 2026-10-20). Both work on HTML only; the scene and the mist are
// reached through small hooks, so the exhibition behind them can change
// without touching the entry.
//
//   reveal      the title is plain, whole text from the first paint: the mist
//               above it does the revealing. Only the lede and the Scroll
//               hint fade in. No per-letter split, no scramble.
//   transition  p 0 → 1, about 1.6 s: the title fades as it travels into the
//               corner wordmark, the mist clears fully so the stage plate
//               shows, the exhibition's entrance rises in and its text comes
//               last. Played backwards to return. A label "hold" marks where
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
  // where the title travels: the corner wordmark
  corner: HTMLElement;
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

export function entryTransition(t: TransitionTargets, h: TransitionHooks): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
  // where the title goes, read once as the timeline is made
  const from = t.title.getBoundingClientRect();
  const to = t.corner.getBoundingClientRect();
  const scale = from.height > 0 ? Math.max(0.12, to.height / from.height) : 0.3;
  const dx = to.left - from.left;
  const dy = to.top + to.height / 2 - (from.top + (from.height * scale) / 2);

  tl.addLabel("lift", 0);
  tl.fromTo(t.extras, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -8, duration: 0.35, ease: "power2.in", stagger: 0.03 }, "lift");
  tl.fromTo(t.title, { x: 0, y: 0, scale: 1, transformOrigin: "0 0" }, { x: dx, y: dy, scale, duration: 0.8, ease: "power3.inOut" }, "lift");
  // the whole title fades on its way, so the corner wordmark takes over
  tl.fromTo(t.title, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.55, ease: "power2.in", immediateRender: false }, "lift+=0.1");
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
  return tl;
}

// The exhibition's HTML at rest, with no transition (fallbacks, skipped entry)
export function settleExhibition(t: Pick<TransitionTargets, "exhibition">, at: 0 | 1) {
  gsap.set(t.exhibition, { autoAlpha: at });
}
