// The Gallery's virtual progress p, from 0 (the entry) to 1 (the
// exhibition), as pure rules the page and the tests share. The document
// never scrolls: each gesture plays one GSAP timeline toward an end, and
// these rules decide which gestures count. Nothing here touches the DOM.
//
//   entry       p = 0, the title and the mist; the exhibition takes no input
//   advancing   the transition playing toward p = 1
//   exhibition  p = 1, the orbit (or the honest empty state) has the input
//   returning   the transition playing back toward p = 0

export type Stage = "entry" | "advancing" | "exhibition" | "returning";

export type ProgressEvent =
  // wheel down, swipe up, Space, PageDown, ArrowDown or the Enter hint
  | { type: "advance" }
  // Escape or the corner wordmark (or wheel-up while still advancing); refused
  // while a record is open
  | { type: "back"; recordOpen: boolean }
  // the transition's timeline reached one of its ends
  | { type: "settled"; at: 0 | 1 };

export function progress(stage: Stage, e: ProgressEvent): Stage {
  switch (e.type) {
    case "advance":
      // a second advance while advancing changes nothing; one during a
      // return turns the same timeline forward again
      return stage === "entry" || stage === "returning" ? "advancing" : stage;
    case "back":
      if (e.recordOpen) return stage;
      return stage === "exhibition" || stage === "advancing" ? "returning" : stage;
    case "settled":
      if (e.at === 1) return stage === "advancing" ? "exhibition" : stage;
      return stage === "returning" ? "entry" : stage;
  }
}

// Only the settled exhibition gives the orbit (and its controls) input.
export const takesInput = (stage: Stage): boolean => stage === "exhibition";

// The exhibition never returns to the entry by wheel or swipe: there both
// directions turn the belt (owner, 2026-10-20). Escape and the corner
// wordmark send a "back".

// --- load gating ------------------------------------------------------------
// The entry is visible while the exhibition decodes its textures, compiles
// and renders its warm-up frames. An advance is accepted at once; if the
// exhibition is not ready, the transition holds after its first beat, for at
// most GATE_CAP_MS, rather than showing a half-built scene.

export const GATE_CAP_MS = 1400;

export type Gate = {
  readonly ready: boolean;
  set: (ready: boolean) => void;
  // resolves true once ready, or false when the cap runs out first
  wait: (capMs?: number) => Promise<boolean>;
};

export function createGate(): Gate {
  let ready = false;
  let waiters: ((ok: boolean) => void)[] = [];
  return {
    get ready() {
      return ready;
    },
    set(next) {
      ready = next;
      if (!next) return;
      const now = waiters;
      waiters = [];
      for (const w of now) w(true);
    },
    wait(capMs = GATE_CAP_MS) {
      if (ready) return Promise.resolve(true);
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          waiters = waiters.filter((w) => w !== finish);
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), Math.min(capMs, GATE_CAP_MS));
        waiters.push(finish);
      });
    },
  };
}

// --- which gestures advance ---------------------------------------------------

export const SWIPE_PX = 40;

// a key that advances from the entry
export const isAdvanceKey = (key: string): boolean => key === " " || key === "Spacebar" || key === "PageDown" || key === "ArrowDown";

// the dominant direction of a wheel event: +1 down (advance), -1 up (return)
export function wheelDirection(e: { deltaX: number; deltaY: number }): 1 | -1 | 0 {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.deltaY === 0) return 0;
  return e.deltaY > 0 ? 1 : -1;
}

// a finished touch: +1 swipe up (advance), -1 swipe down (return)
export function swipeDirection(dx: number, dy: number, min = SWIPE_PX): 1 | -1 | 0 {
  if (Math.abs(dy) < min || Math.abs(dy) < Math.abs(dx) * 1.2) return 0;
  return dy < 0 ? 1 : -1;
}
