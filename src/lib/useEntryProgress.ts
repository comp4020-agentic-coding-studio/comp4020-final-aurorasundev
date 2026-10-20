import { gsap } from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MIST_BEHIND, MIST_ENTRY, type Mist } from "../scene/mist.ts";
import { entryReveal, entryTransition } from "./entry-motion.ts";
import { isAdvanceKey, progress, returnGesture, swipeDirection, wheelDirection, type Gate, type ProgressEvent, type ReturnArm, type Stage } from "./gallery-progress.ts";

// The Gallery's entry and its virtual progress p (design 2026-10-19 §1–§3),
// wired to the page. The document never scrolls: wheel, swipe and keys are
// read here and each gesture plays one GSAP timeline toward an end. React
// only hears the four stage changes, never a frame.
//
// The exhibition behind the entry is reached through small hooks (its
// entrance, its readiness gate, whether it is at rest), so a different scene
// can be plugged in later without touching the entry.

// a wheel gesture is one burst: a new one starts after this much quiet, so a
// trackpad's inertia tail stays part of the gesture it belongs to
export const GESTURE_GAP_MS = 220;

export type EntryRefs = {
  root: RefObject<HTMLElement | null>;
  title: RefObject<HTMLElement | null>;
  lede: RefObject<HTMLElement | null>;
  enter: RefObject<HTMLElement | null>;
  // the corner wordmark: the Gallery's name the title lands on, and the old
  // "Throwaway" it replaces
  corner: RefObject<HTMLElement | null>;
  cornerOld: RefObject<HTMLElement | null>;
  exhibition: RefObject<HTMLElement | null>;
};

type Options = {
  enabled: boolean;
  recordOpen: boolean;
  refs: EntryRefs;
  mist: RefObject<Mist | null>;
  gate: Gate;
  // the exhibition scene: its entrance (0..1) and whether it is turning
  sceneEntry: (value: number) => void;
  atRest: () => boolean;
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function useEntryProgress(o: Options) {
  const [stage, setStage] = useState<Stage>(o.enabled ? "entry" : "exhibition");
  const stageRef = useRef(stage);
  const opts = useRef(o);
  opts.current = o;
  const reveal = useRef<gsap.core.Timeline | null>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  const dispatch = useCallback((e: ProgressEvent) => {
    const next = progress(stageRef.current, e);
    if (next !== stageRef.current) {
      stageRef.current = next;
      setStage(next);
    }
    return next;
  }, []);

  const build = useCallback((): gsap.core.Timeline | null => {
    const { refs, gate } = opts.current;
    const title = refs.title.current;
    const name = refs.corner.current;
    const corner = name ? { name, old: refs.cornerOld.current } : null;
    const exhibition = refs.exhibition.current;
    if (!title || !corner || !exhibition) return null;
    const extras = [refs.lede.current, refs.enter.current].filter((e): e is HTMLElement => !!e);
    const m = opts.current.mist.current;
    const next = entryTransition(
      { title, extras, corner, exhibition },
      {
        mist: m ? { level: m.level, from: MIST_ENTRY, to: MIST_BEHIND, touch: m.touch } : null,
        scene: (v) => opts.current.sceneEntry(v),
        // the first beat is over; an exhibition still loading holds it here
        // (at most 1.4 s) rather than arriving half-built
        hold: (t) => {
          if (gate.ready) return;
          t.pause();
          void gate.wait().then(() => {
            if (tl.current === t && stageRef.current === "advancing" && t.paused()) t.play();
          });
        },
      },
    );
    next.eventCallback("onComplete", () => {
      if (tl.current !== next) return;
      opts.current.mist.current?.setBackground(true);
      const was = document.activeElement;
      dispatch({ type: "settled", at: 1 });
      // the Enter hint has gone: the keyboard lands in the exhibition
      if (was && refs.root.current?.contains(was)) refs.exhibition.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
    });
    next.eventCallback("onReverseComplete", () => {
      if (tl.current !== next) return;
      const was = document.activeElement;
      dispatch({ type: "settled", at: 0 });
      // (the corner wordmark that asked for the return hands focus on too)
      if (!was || was === document.body || refs.exhibition.current?.contains(was) || (was as HTMLElement).closest?.(".gallery-wordmark")) refs.enter.current?.focus({ preventScroll: true });
    });
    return next;
  }, [dispatch]);

  const advance = useCallback(() => {
    const s = stageRef.current;
    if (s !== "entry" && s !== "returning") return;
    // any advance skips the entry's reveal at once
    reveal.current?.progress(1);
    if (!tl.current) tl.current = build();
    if (!tl.current) return;
    opts.current.mist.current?.setBackground(false);
    dispatch({ type: "advance" });
    tl.current.play();
  }, [build, dispatch]);

  // `force`: the corner wordmark, which closes an open record itself first
  const back = useCallback((force = false) => {
    const s = stageRef.current;
    if ((opts.current.recordOpen && !force) || (s !== "exhibition" && s !== "advancing") || !tl.current) return;
    opts.current.mist.current?.setBackground(false);
    dispatch({ type: "back", recordOpen: false });
    tl.current.reverse();
  }, [dispatch]);

  // the entry's quiet reveal (the lede and hint; the title is whole text the
  // mist reveals): on every visit, before the first paint
  useLayoutEffect(() => {
    if (!o.enabled) return;
    const { title, lede, enter, exhibition, corner, cornerOld } = o.refs;
    if (!title.current || !exhibition.current) return;
    gsap.set(exhibition.current, { autoAlpha: 0 });
    reveal.current = entryReveal([lede.current, enter.current].filter((e): e is HTMLElement => !!e));
    const els = [title.current, lede.current, enter.current, exhibition.current, corner.current, cornerOld.current].filter((e): e is HTMLElement => !!e);
    return () => {
      reveal.current?.kill();
      reveal.current = null;
      tl.current?.kill();
      tl.current = null;
      gsap.set(els, { clearProps: "all" });
    };
  }, [o.enabled, o.refs]);

  // a page that loses its entry (a lost scene) settles on the exhibition
  useEffect(() => {
    if (o.enabled || stageRef.current === "exhibition") return;
    stageRef.current = "exhibition";
    setStage("exhibition");
    const m = opts.current.mist.current;
    if (m) {
      // the veil clears, so it never covers the exhibition
      m.level.value = MIST_BEHIND;
      m.setBackground(true);
    }
  }, [o.enabled]);

  // gestures: wheel, swipe and keys, read before the scene sees them
  useEffect(() => {
    if (!o.enabled) return;
    let arm: ReturnArm = { armedAt: null };
    let gesture: { page: boolean; last: number } | null = null;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const now = e.timeStamp || performance.now();
      if (!gesture || now - gesture.last > GESTURE_GAP_MS) {
        const s = stageRef.current;
        const dir = wheelDirection(e);
        let page = true;
        if (s === "entry" || s === "returning") {
          if (dir === 1) advance();
        } else if (s === "advancing") {
          if (dir === -1) back();
        } else if (opts.current.recordOpen) {
          page = false;
        } else if (dir === -1) {
          // only a wheel-up that *starts* while the exhibition is at rest
          // counts: the first arms, a second plays the return. A flick's tail
          // or a turn still settling belongs to the scene.
          const r = returnGesture(arm, now, opts.current.atRest());
          arm = r.arm;
          page = r.result !== "ignore";
          if (r.result === "return") back();
        } else {
          arm = { armedAt: null };
          page = false;
        }
        gesture = { page, last: now };
      } else gesture.last = now;
      if (gesture.page) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t0 = touch;
      touch = null;
      const t = e.changedTouches[0];
      if (!t0 || !t) return;
      const dir = swipeDirection(t.clientX - t0.x, t.clientY - t0.y);
      if (!dir) return;
      const s = stageRef.current;
      if (s === "entry" || s === "returning") {
        if (dir === 1) advance();
      } else if (s === "advancing") {
        if (dir === -1) back();
      } else if (!opts.current.recordOpen && dir === -1) {
        const r = returnGesture(arm, e.timeStamp || performance.now(), opts.current.atRest());
        arm = r.arm;
        if (r.result === "return") back();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      // keys inside an opened record are the record's (its Escape closes it)
      if ((e.target as HTMLElement | null)?.closest?.("dialog")) return;
      const s = stageRef.current;
      if (s === "entry" || s === "returning") {
        if (!isAdvanceKey(e.key)) return;
        // Space on a focused control is that control's
        if (e.key === " " && (e.target as HTMLElement | null)?.closest?.("button, a")) return;
        e.preventDefault();
        advance();
      } else if (e.key === "Escape" && !opts.current.recordOpen) {
        e.preventDefault();
        back();
      }
    };

    let resizeRaf = 0;
    const onResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        // the title's path to the corner is measured once; at rest it is
        // measured again for the new viewport
        const t = tl.current;
        if (!t || t.isActive() || t.paused()) return;
        const at = t.progress();
        t.progress(0, true);
        t.kill();
        tl.current = build();
        tl.current?.progress(at, true);
        if (at === 1) tl.current?.pause();
      });
    };

    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [o.enabled, advance, back, build]);

  // the corner wordmark: back to the entry from anywhere past it. Returns
  // whether it was handled in place (false: no entry on this page)
  const home = useCallback((): boolean => {
    if (!opts.current.enabled) return false;
    back(true);
    return true;
  }, [back]);

  return { stage, advance, back, home };
}
