import { gsap } from "gsap";

// The record's open/close choreography as data a GSAP timeline drives. A
// layout reads these values every frame and turns them into poses with pure
// functions; nothing here knows about Three.js, the orbit or React, so a
// different arrangement of sleeves (a belt, a grid) can reuse the same beats.
//
//   exit   0→1  the other sleeves step aside, one after another (see local())
//   hero   0→1  the chosen sleeve comes forward to the HTML art frame
//   tuck   0→1  the record goes into the chosen sleeve
//   slide  0→1  the record slides out of the sleeve to the HTML disc frame
//   idle   1→0  the record's idle turning (held still while a record is open)
//
// The record's spin angle is driven by the same timelines through `spin`,
// which the layout owns: an open lands it upright so the still HTML record can
// take over without a jump.

export type Choreo = { exit: number; hero: number; tuck: number; slide: number; idle: number; order: 1 | -1 };
export type SpinClock = { angle: number; boost: number };

export const newChoreo = (): Choreo => ({ exit: 0, hero: 0, tuck: 0, slide: 0, idle: 1, order: 1 });

// stagger: each sleeve moves for ITEM seconds, STAGGER after the one before
export const ITEM = 0.5;
export const STAGGER = 0.065;
// beyond this many places from the front the sleeves are out of sight anyway
export const MAX_RANK = 6;
export const EXIT_SPAN = ITEM + STAGGER * MAX_RANK;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = gsap.parseEase("power2.inOut");

// One sleeve's eased progress at the shared `exit` value. `rank` is its place
// counted from the front (0 = the chosen one). With order 1 the nearest moves
// first; with -1 the farthest does (so on the way back the nearest return
// first). A pure function, so a sleeve removed mid-timeline just stops being
// asked and the rest keep their places.
export function local(exit: number, rank: number, order: 1 | -1 = 1): number {
  const r = Math.min(Math.max(rank, 0), MAX_RANK);
  const delay = STAGGER * (order === 1 ? r : MAX_RANK - r);
  return inOut(clamp01((exit * EXIT_SPAN - delay) / ITEM));
}

// Where along the slide the record is: first out through the sleeve's edge,
// still at the sleeve's depth, then forward and onto its resting place.
export const SLIDE_OUT = 0.58;
export function slideStages(slide: number): { out: number; settle: number } {
  return {
    out: inOut(clamp01(slide / SLIDE_OUT)),
    settle: inOut(clamp01((slide - SLIDE_OUT) / (1 - SLIDE_OUT))),
  };
}

// the next upright angle at least `turns` revolutions further on (spin runs
// negative, clockwise on screen)
export function landing(angle: number, turns: number): number {
  const TAU = Math.PI * 2;
  return Math.floor((angle - turns * TAU) / TAU) * TAU;
}

type Opts = { phone: boolean };

// --- the scene's halves of the choreography -------------------------------
// Each builder tweens from wherever the values are now, so any timeline can
// replace any other mid-flight without a jump.

export function openTimeline(c: Choreo, spin: SpinClock, o: Opts): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  // an interrupted close keeps its order, so no sleeve jumps
  if (c.exit <= 0.001) c.order = 1;
  tl.addLabel("aside", 0)
    .to(c, { exit: 1, duration: EXIT_SPAN * (1 - c.exit), ease: "none" }, "aside")
    .to(c, { idle: 0, duration: 0.45, ease: "power1.out" }, "aside")
    .to(c, { hero: 1, duration: 0.65, ease: "power3.inOut" }, "aside+=0.06")
    .to(c, { tuck: 1, duration: 0.45 }, "aside")
    .addLabel("slide", 0.4);
  if (o.phone) {
    // the phone's opened record is the sleeve alone: the disc stays tucked
    tl.addLabel("land", 0.5);
  } else {
    // the record clears the sleeve, then spins up and settles upright, so the
    // still HTML record takes over without a jump
    tl.to(c, { slide: 1, duration: 0.6 }, "slide").addLabel("land", "slide+=0.3");
    tl.to(spin, { angle: () => landing(spin.angle, 1), boost: 0, duration: 0.7, ease: "power3.out" }, "land");
  }
  return tl;
}

export function closeTimeline(c: Choreo): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  // after a finished open the nearest sleeves come back first
  if (c.exit >= 0.999) c.order = -1;
  tl.to(c, { slide: 0, duration: 0.5 * c.slide + 0.001 }, 0)
    .to(c, { hero: 0, duration: 0.6, ease: "power3.inOut" }, 0.3)
    .to(c, { tuck: 0, duration: 0.5 }, 0.45 * c.slide + 0.05)
    .to(c, { exit: 0, duration: EXIT_SPAN * c.exit, ease: "none" }, 0.25)
    .to(c, { idle: 1, duration: 0.6, ease: "power1.in" }, 0.5);
  return tl;
}

// Stepping inside an open record: finish any open still under way, and turn
// the record once to its next upright while the orbit carries the next sleeve.
export function stepTimeline(c: Choreo, spin: SpinClock, o: Opts): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut", duration: 0.45 } });
  c.order = 1;
  tl.to(c, { exit: 1, hero: 1, tuck: 1, idle: 0 }, 0);
  if (!o.phone) {
    tl.to(c, { slide: 1 }, 0);
    tl.to(spin, { angle: () => landing(spin.angle, 1), boost: 0, duration: 0.9, ease: "power2.inOut" }, 0);
  }
  return tl;
}
