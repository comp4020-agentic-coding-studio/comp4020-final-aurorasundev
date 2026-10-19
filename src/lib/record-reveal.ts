import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";

// The opened record's HTML coming in, as a timeline the scene nests into its
// own open choreography, so the text can never run ahead of (or behind) the
// sleeve and record it belongs to. The controls first, then the copy, and the
// title letter by letter as the last beat.
//
// The title is split only while it animates: screen readers get the whole
// title (SplitText's aria "auto" labels the heading and hides the letters),
// and the split is reverted when the reveal ends or is cut short, so React
// only ever sees its own text. Reduced motion gets no per-letter reveal.

gsap.registerPlugin(SplitText);

export const TITLE_STAGGER = 0.02;

export function recordReveal(dialog: HTMLElement): gsap.core.Timeline | null {
  const text = dialog.querySelector<HTMLElement>(".record-text");
  if (!text) return null;
  const chrome = [".record-back", ".record-close", ".record-steps"].map((s) => dialog.querySelector<HTMLElement>(s)).filter((e): e is HTMLElement => !!e);
  const title = text.querySelector<HTMLElement>(".record-title");
  const body = [...text.children].filter((e) => e !== title) as HTMLElement[];
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // fromTo renders its start at once, so nothing shows before its beat. The
  // controls only fade: one of them is centred with a CSS transform.
  const tl = gsap.timeline({ defaults: { duration: 0.42, ease: "power2.out" } });
  // from here on the dialog's own CSS no longer holds the text back
  tl.call(() => dialog.setAttribute("data-revealed", ""), undefined, 0);
  tl.fromTo(chrome, { autoAlpha: 0 }, { autoAlpha: 1, stagger: 0.06 }, 0);
  tl.fromTo(body, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, stagger: 0.07, clearProps: "transform" }, 0.08);
  if (title) {
    if (still) {
      tl.fromTo(title, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.12);
    } else {
      const split = SplitText.create(title, { type: "words,chars", aria: "auto" });
      tl.fromTo(split.chars, { autoAlpha: 0, yPercent: 40 }, { autoAlpha: 1, yPercent: 0, duration: 0.36, ease: "power3.out", stagger: TITLE_STAGGER }, 0.16);
      // whoever ends the reveal (completion, or the scene cutting it short)
      // gets React's own text node back
      tl.eventCallback("onComplete", () => split.revert());
      tl.data = { revert: () => split.revert() };
    }
  }
  return tl;
}
