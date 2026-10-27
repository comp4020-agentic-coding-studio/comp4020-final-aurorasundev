import { gsap } from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// The exhibition caption follows the belt (owner, 2026-10-27): as a turn
// leaves, the name and its paper tag fade out; when the belt rests on a
// record, its name and tag rise a little and fade in, the tag first. The
// scene says when a turn starts and ends (onTurning); React only swaps the
// words, so nothing here runs per frame. Reduced motion swaps them at once.

const OUT = { autoAlpha: 0, y: -6, duration: 0.22, ease: "power1.in" } as const;
const IN = { autoAlpha: 1, y: 0, duration: 0.55, ease: "power2.out", stagger: 0.08 } as const;

export function useCaptionFade(caption: RefObject<HTMLElement | null>, focusedId: string | null, still: boolean) {
  const shown = useRef<string | null>(null);
  // the words are faded out and wait for the record the belt rests on
  const waiting = useRef(false);
  const tween = useRef<gsap.core.Animation | null>(null);

  const parts = useCallback(() => (caption.current ? [...caption.current.children] : []), [caption]);

  const fadeIn = useCallback(() => {
    waiting.current = false;
    const els = parts();
    tween.current?.kill();
    if (!els.length) return;
    if (still) {
      gsap.set(els, { autoAlpha: 1, y: 0 });
      return;
    }
    tween.current = gsap.fromTo(els, { autoAlpha: 0, y: 8 }, { ...IN, overwrite: true });
  }, [parts, still]);

  const onTurning = useCallback(
    (turning: boolean, restsOn: string | null) => {
      if (turning) {
        waiting.current = true;
        const els = parts();
        tween.current?.kill();
        if (els.length) tween.current = still ? gsap.set(els, { autoAlpha: 0 }) : gsap.to(els, { ...OUT, overwrite: true });
        return;
      }
      // came back to the record already named: bring its words back now;
      // otherwise the new words fade in when React has put them in place
      if (restsOn === shown.current) fadeIn();
    },
    [parts, still, fadeIn],
  );

  // new words in place: fade them in, unless a turn is still under way
  useLayoutEffect(() => {
    if (focusedId === shown.current) return;
    const first = shown.current === null;
    shown.current = focusedId;
    if (first) return;
    if (waiting.current) gsap.set(parts(), { autoAlpha: 0 });
    fadeIn();
  }, [focusedId, fadeIn, parts]);

  // a tag can appear or go without a turn (opening clears it); it is simply shown
  useEffect(() => () => void tween.current?.kill(), []);

  return onTurning;
}
