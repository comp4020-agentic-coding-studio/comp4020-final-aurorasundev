import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";

// The opened record's HTML coming in, as a timeline the scene nests into its
// own open choreography, so the text can never run ahead of (or behind) the
// sleeve and record it belongs to (design 2026-10-19 §5): the title letter by
// letter, then the caption, the report link, and the controls and arrows.
//
// The title is split only while it animates: screen readers get the whole
// title (SplitText's aria "auto" labels the heading and hides the letters),
// and the split is reverted when the reveal ends or is cut short, so React
// only ever sees its own text. Reduced motion gets no per-letter reveal.

gsap.registerPlugin(SplitText);

export const TITLE_STAGGER = 0.025;
// each element's own fade (owner, 2026-10-20: calmer)
export const REVEAL_ITEM = 0.55;
export const TITLE_LETTER = 0.5;
// where the copy below the title, and then the controls, begin
export const BODY_AT = 0.3;
export const BODY_STAGGER = 0.08;
export const CHROME_AT = 0.55;
// a long title spreads its letters over at most TITLE_SPAN, so the open's
// hand-over never waits on the title's length
export const TITLE_SPAN = 0.5;
export const titleStagger = (letters: number) => Math.min(TITLE_STAGGER, TITLE_SPAN / Math.max(1, letters - 1));

export function recordReveal(dialog: HTMLElement): gsap.core.Timeline | null {
  const text = dialog.querySelector<HTMLElement>(".record-text");
  if (!text) return null;
  const chrome = [".record-back", ".record-close", ".record-steps"].map((s) => dialog.querySelector<HTMLElement>(s)).filter((e): e is HTMLElement => !!e);
  const title = text.querySelector<HTMLElement>(".record-title");
  const body = [...text.children].filter((e) => e !== title) as HTMLElement[];
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // fromTo renders its start at once, so nothing shows before its beat. The
  // controls only fade: one of them is centred with a CSS transform.
  const tl = gsap.timeline({ defaults: { duration: REVEAL_ITEM, ease: "power2.out" } });
  // from here on the dialog's own CSS no longer holds the text back
  tl.call(() => dialog.setAttribute("data-revealed", ""), undefined, 0);
  tl.fromTo(body, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, stagger: BODY_STAGGER, clearProps: "transform" }, BODY_AT);
  tl.fromTo(chrome, { autoAlpha: 0 }, { autoAlpha: 1, stagger: 0.06 }, CHROME_AT);
  if (title) {
    if (still) {
      tl.fromTo(title, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0);
    } else {
      const split = SplitText.create(title, { type: "words,chars", aria: "auto" });
      tl.fromTo(split.chars, { autoAlpha: 0, yPercent: 40 }, { autoAlpha: 1, yPercent: 0, duration: TITLE_LETTER, ease: "power3.out", stagger: titleStagger(split.chars.length) }, 0);
      // whoever ends the reveal (completion, or the scene cutting it short)
      // gets React's own text node back
      tl.eventCallback("onComplete", () => split.revert());
      tl.data = { revert: () => split.revert() };
    }
  }
  return tl;
}
