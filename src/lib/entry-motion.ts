import { gsap } from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { SplitText } from "gsap/SplitText";

// The Gallery entry's two timelines (design 2026-10-19 §2, §3). Both work on
// HTML only; the scene and the mist are reached through small hooks, so step
// ② can swap the exhibition behind them without touching the entry.
//
//   reveal      the title's letters slide up out of a mask, then the last
//               word settles through a short scramble
//   transition  p 0 → 1, about 1.6 s: the letters lift and fade, the title
//               travels into the corner wordmark, the mist thins, the
//               exhibition's entrance rises in and its text comes last.
//               Played backwards to return. A label "hold" marks where it
//               waits (at most 1.4 s) for an exhibition that is not ready.
//
// The title keeps its whole text for screen readers: SplitText's aria "auto"
// labels the heading and hides the letters. The split lives for the page.

gsap.registerPlugin(SplitText, ScrambleTextPlugin);

export const REVEAL_STAGGER = 0.02;
export const REVEAL_DURATION = 0.6;
export const LIFT_STAGGER = 0.015;
export const HOLD_AT = 0.55;

export type EntrySplit = { chars: HTMLElement[]; last: HTMLElement[]; revert: () => void };

// Splits the title into masked letters; the last word's letters are kept
// apart for the scramble.
export function splitTitle(title: HTMLElement): EntrySplit {
  const split = SplitText.create(title, { type: "words,chars", mask: "chars", charsClass: "entry-char", wordsClass: "entry-word", aria: "auto" });
  const words = split.words as HTMLElement[];
  const lastWord = words[words.length - 1];
  const chars = split.chars as HTMLElement[];
  return { chars, last: lastWord ? chars.filter((c) => lastWord.contains(c)) : [], revert: () => split.revert() };
}

export function entryReveal(split: EntrySplit, extras: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.fromTo(split.chars, { yPercent: 115 }, { yPercent: 0, duration: REVEAL_DURATION, ease: "power3.out", stagger: REVEAL_STAGGER }, 0);
  // the last word settles: each letter flickers briefly and lands on itself
  const settleAt = REVEAL_DURATION * 0.6 + REVEAL_STAGGER * split.chars.length;
  split.last.forEach((c, i) => {
    const letter = c.textContent ?? "";
    tl.to(c, { duration: 0.42, ease: "none", scrambleText: { text: letter, chars: "lowerCase", speed: 0.6, revealDelay: 0.1 } }, settleAt - 0.25 + i * 0.035);
  });
  tl.fromTo(extras, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.08 }, REVEAL_DURATION * 0.8);
  return tl;
}

export type TransitionTargets = {
  title: HTMLElement;
  chars: HTMLElement[];
  // the lede, hints and Enter button: they leave first
  extras: HTMLElement[];
  // where the title travels: the corner wordmark
  corner: HTMLElement;
  // the exhibition's own HTML (title, caption, controls): it arrives last
  exhibition: HTMLElement;
};

export type TransitionHooks = {
  // the mist's tuft strength from 1 to `to`
  mist?: { level: { value: number }; to: number; touch: () => void } | null;
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
  tl.fromTo(t.chars, { yPercent: 0, autoAlpha: 1 }, { yPercent: -60, autoAlpha: 0, duration: 0.5, ease: "power2.in", stagger: LIFT_STAGGER }, "lift");
  tl.fromTo(t.title, { x: 0, y: 0, scale: 1, transformOrigin: "0 0" }, { x: dx, y: dy, scale, duration: 0.8, ease: "power3.inOut" }, "lift");
  if (h.mist) {
    const m = h.mist;
    tl.fromTo(m.level, { value: 1 }, { value: m.to, duration: 0.95, ease: "power1.inOut", onUpdate: m.touch }, "lift");
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
