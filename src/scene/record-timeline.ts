import { gsap } from "gsap";
import type { ExitSlot, Kind, Mode } from "./particles-plan.ts";

// The record's open/close choreography as data a GSAP timeline drives (design
// 2026-10-19 §5). A layout reads these values every frame and turns them into
// poses and dissolves with pure functions; nothing here knows about Three.js,
// the belt or React.
//
//   exit   0→1  the other cards break into grain one after another, nearest
//               first (see local()); 1→0 they gather back
//   hero   0→1  the chosen sleeve comes forward to the HTML art frame (and the
//               globe dims and holds still by the same value)
//   tuck   0→1  the record goes into the chosen sleeve
//   slide  0→1  the record slides out of the sleeve to the HTML disc frame
//   idle   1→0  the record's idle turning (held still while a record is open)
//
// A step inside an open record swaps who is in the hero frame (Swap): the
// outgoing sleeve breaks up in place there and the incoming one gathers in
// its place, so two sleeves never sit whole in the frame at once. The belt
// behind turns by one card with every other card still dispersed.
//
// The record's spin angle is driven by the same timelines through `spin`,
// which the layout owns: an open lands it upright so the still HTML record can
// take over without a jump.
//
// Every builder tweens from wherever the values are now, so any timeline can
// replace any other mid-flight without a jump.

export type Choreo = { exit: number; hero: number; tuck: number; slide: number; idle: number; order: 1 | -1 };
export type SpinClock = { angle: number; boost: number };
// The hero frame's swap: `incoming.v` is the dissolve of the sleeve now in the
// frame (1 dispersed .. 0 whole); `outgoing` are sleeves leaving it, each
// breaking up toward 1, keyed by their belt place m.
export type Swap = { incoming: { v: number }; outgoing: { m: number; v: number }[] };

export const newChoreo = (): Choreo => ({ exit: 0, hero: 0, tuck: 0, slide: 0, idle: 1, order: 1 });
export const newSwap = (): Swap => ({ incoming: { v: 0 }, outgoing: [] });

// --- the main durations, seconds (the owner judges them on real hardware) ---
// each card's own dissolve, and the stagger between one card and the next,
// nearest the focus first
export const EXIT_ITEM = 0.7;
export const EXIT_STAGGER = 0.06;
// beyond this rank (the far half's faint silhouettes) cards are out of sight
export const MAX_RANK = 5;
export const EXIT_SPAN = EXIT_ITEM + EXIT_STAGGER * MAX_RANK;
// the sleeve's walk forward to the art frame, after the first neighbours begin
export const HERO_AT = 0.2;
export const HERO_SECONDS = 0.7;
export const TUCK_SECONDS = 0.45;
// the record sliding out of the sleeve (desktop; a phone keeps it tucked)
export const SLIDE_AT = 0.55;
export const SLIDE_SECONDS = 0.6;
// where the HTML reveal (title letters, then caption, report link, arrows)
// begins, and the record's spin-up to its upright landing
export const LAND_AT = 0.75;
export const LAND_AT_PHONE = 0.65;
export const SPIN_SECONDS = 0.7;
// close: the disc goes back, the sleeve returns, then the cards gather
export const CLOSE_SLIDE_SECONDS = 0.5;
export const CLOSE_HERO_AT = 0.15;
export const CLOSE_HERO_SECONDS = 0.6;
export const CLOSE_GATHER_AT = 0.4;
// a step inside an open record: the outgoing sleeve breaks up in place, the
// incoming gathers a little after, and the record turns once
export const STEP_OUT_SECONDS = 0.55;
export const STEP_IN_AT = 0.3;
export const STEP_IN_SECONDS = 0.65;
export const STEP_SPIN_SECONDS = 0.9;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = gsap.parseEase("power2.inOut");

// One card's eased progress at the shared `exit` value. `rank` is its place in
// the exit order (0 = the nearest neighbour, particles-plan.ts planExit). With
// order 1 the nearest moves first; with -1 the farthest does (so on the way
// back, exit falling, the nearest gathers first). A pure function, so a card
// removed mid-timeline just stops being asked and the rest keep their places.
export function local(exit: number, rank: number, order: 1 | -1 = 1): number {
  const r = Math.min(Math.max(rank, 0), MAX_RANK);
  const delay = EXIT_STAGGER * (order === 1 ? r : MAX_RANK - r);
  return inOut(clamp01((exit * EXIT_SPAN - delay) / EXIT_ITEM));
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

// --- who is in the hero frame ------------------------------------------------
// Move the hero frame to belt place `next`. While anything of an open shows,
// the sleeve there now leaves it breaking up from wherever its own dissolve
// is, and the incoming one gathers: from where it was leaving, if it was
// (a step straight back), else from its dissolve on the belt now (`belt`,
// fully dispersed when the exit has finished). Fully closed, nothing is in
// the frame and the place simply changes. Returns the new place.
export function retarget(swap: Swap, c: Choreo, hero: number, next: number, belt = 1): number {
  if (next === hero) return hero;
  if (c.hero > 0.001 || c.exit > 0.001) {
    const back = swap.outgoing.findIndex((o) => o.m === next);
    const from = back >= 0 ? swap.outgoing.splice(back, 1)[0].v : belt;
    swap.outgoing.push({ m: hero, v: swap.incoming.v });
    swap.incoming.v = from;
  } else {
    swap.outgoing.length = 0;
    swap.incoming.v = 0;
  }
  return next;
}
// sleeves that have finished leaving are forgotten
export function pruneSwap(swap: Swap): void {
  for (let i = swap.outgoing.length - 1; i >= 0; i--) if (swap.outgoing[i].v >= 0.999) swap.outgoing.splice(i, 1);
}
// Every place the hero frame shifts by when the list underneath re-indexes
// (an arrival or a removal moves every belt place by the same whole step).
export function shiftSwap(swap: Swap, by: number): void {
  for (const o of swap.outgoing) o.m += by;
}

// --- one card's part in the ritual, per frame ----------------------------------
// The hero frame's sleeves (outgoing and incoming) sit in the frame by `hero`
// and dissolve in place by their own value; every other card dissolves by the
// exit at its rank, toward the back along the band (or the alpha fade where
// planExit gave it none). Pure, so the belt and the tests read the same thing.
export type Ritual = {
  // how far toward the HTML art frame, 0..1
  heroW: number;
  // the ritual's own dissolve (the belt's zone combines with it)
  dissolve: number;
  mode: Mode;
  // false: this card's exit is the alpha fade, never a particle slot
  particles: boolean;
  kind: Kind;
  // priority within the particle budget (higher first)
  weight: number;
};
export function cardRitual(m: number, hero: number, c: Choreo, swap: Swap, exits: ReadonlyMap<number, ExitSlot>, closing: boolean): Ritual {
  const leaving = swap.outgoing.find((o) => o.m === m);
  if (leaving) return { heroW: c.hero, dissolve: leaving.v, mode: "inplace", particles: true, kind: "request", weight: 3 };
  if (m === hero) return { heroW: c.hero, dissolve: swap.incoming.v, mode: "inplace", particles: true, kind: "request", weight: 2.5 };
  const slot = exits.get(m - hero);
  const rank = slot ? slot.rank : MAX_RANK;
  return {
    heroW: 0,
    dissolve: local(c.exit, rank, c.order),
    mode: closing ? "gather" : "leave",
    particles: slot ? slot.particles : false,
    kind: "request",
    // nearest first within the budget
    weight: 2 - rank * 0.1,
  };
}

// The hero frame's leftovers from any earlier swap settle in every timeline:
// leaving sleeves finish breaking up, the one in the frame finishes gathering.
function settleSwap(tl: gsap.core.Timeline, swap: Swap, outAt: number, inAt: number, inSeconds: number) {
  const out = swap.outgoing.filter((o) => o.v < 1);
  if (out.length) tl.to(out, { v: 1, duration: STEP_OUT_SECONDS, ease: "power1.in" }, outAt);
  if (swap.incoming.v > 0) tl.to(swap.incoming, { v: 0, duration: inSeconds, ease: "power2.out" }, inAt);
}

type Opts = { phone: boolean };

// --- the scene's halves of the choreography -------------------------------

export function openTimeline(c: Choreo, spin: SpinClock, o: Opts, swap: Swap = newSwap()): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  // an interrupted close keeps its order, so no card jumps
  if (c.exit <= 0.001) c.order = 1;
  tl.addLabel("aside", 0)
    .to(c, { exit: 1, duration: EXIT_SPAN * (1 - c.exit), ease: "none" }, "aside")
    .to(c, { idle: 0, duration: 0.45, ease: "power1.out" }, "aside")
    .to(c, { hero: 1, duration: HERO_SECONDS, ease: "power3.inOut" }, HERO_AT)
    .to(c, { tuck: 1, duration: TUCK_SECONDS }, "aside");
  settleSwap(tl, swap, 0, HERO_AT, HERO_SECONDS);
  if (o.phone) {
    // the phone's opened record is the sleeve alone: the disc stays tucked
    tl.addLabel("land", LAND_AT_PHONE);
  } else {
    // the record clears the sleeve, then spins up and settles upright, so the
    // still HTML record takes over without a jump
    tl.to(c, { slide: 1, duration: SLIDE_SECONDS }, SLIDE_AT).addLabel("land", LAND_AT);
    tl.to(spin, { angle: () => landing(spin.angle, 1), boost: 0, duration: SPIN_SECONDS, ease: "power3.out" }, "land");
  }
  return tl;
}

// The close: the disc goes back into the sleeve, the sleeve returns to its
// place on the belt, then the other cards gather from grain, nearest first.
// `onHandBack` is the timeline's last beat, so the browsing page returns only
// once every card is whole; a killed close never calls it.
export function closeTimeline(c: Choreo, swap: Swap = newSwap(), onHandBack?: () => void): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  // after a finished open the nearest cards come back first
  if (c.exit >= 0.999) c.order = -1;
  const slideFor = CLOSE_SLIDE_SECONDS * c.slide;
  tl.to(c, { slide: 0, duration: slideFor + 0.001 }, 0)
    .to(c, { hero: 0, duration: CLOSE_HERO_SECONDS, ease: "power3.inOut" }, CLOSE_HERO_AT * Math.min(1, c.slide + 0.3))
    .to(c, { tuck: 0, duration: 0.5 }, 0.9 * slideFor + 0.05)
    .to(c, { exit: 0, duration: EXIT_SPAN * c.exit, ease: "none" }, CLOSE_GATHER_AT * Math.min(1, c.hero + 0.2))
    .to(c, { idle: 1, duration: 0.6, ease: "power1.in" }, 0.5);
  settleSwap(tl, swap, 0, 0, 0.5);
  // at the very end (">" would be the end of the last tween added, not the
  // last to finish)
  if (onHandBack) tl.call(onHandBack, undefined, tl.duration());
  return tl;
}

// Stepping inside an open record (after retarget()): finish any open still
// under way, swap the sleeves in the hero frame, and turn the record once to
// its next upright while the belt carries the next card round behind.
export function stepTimeline(c: Choreo, spin: SpinClock, o: Opts, swap: Swap = newSwap()): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut", duration: 0.45 } });
  // a finished exit has no stagger left to keep; a partial one keeps its order
  if (c.exit >= 0.999 || c.exit <= 0.001) c.order = 1;
  tl.to(c, { exit: 1, duration: EXIT_SPAN * (1 - c.exit) + 0.001, ease: "none" }, 0);
  tl.to(c, { hero: 1, tuck: 1, idle: 0 }, 0);
  settleSwap(tl, swap, 0, STEP_IN_AT, STEP_IN_SECONDS);
  if (!o.phone) {
    tl.to(c, { slide: 1 }, 0);
    tl.to(spin, { angle: () => landing(spin.angle, 1), boost: 0, duration: STEP_SPIN_SECONDS, ease: "power2.inOut" }, 0);
  }
  return tl;
}
