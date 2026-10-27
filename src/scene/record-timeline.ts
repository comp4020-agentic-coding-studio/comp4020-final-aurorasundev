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
//   tuck   0→1  the record goes into the chosen sleeve (on a desktop it
//               rests there part-way out, so it can be seen turning)
//   slide  0→1  the record slides out of the sleeve, behind it, until it has
//               cleared the sleeve's edge; there (nothing overlapping) it
//               steps in front, and comes back over the edge to the HTML
//               disc frame (discSlide)
//   idle   1→0  the record's idle turning (held still while a record is open)
//   tumble 1→0  the record's slow 3D tumble at rest, blended out over the
//               tuck so it meets the sleeve square, and back in on close
//   backdrop 0→1  the opened record's mineral surface behind the scene
//
// Owner, 2026-10-20: the open is slow and calm, one continuous gesture whose
// beats can each be followed: the neighbours dissolve, the sleeve comes
// forward, the record tucks into it, turns one full revolution there in
// plain sight, slides slowly out to its place, settles, and the text comes.
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

export type Choreo = { exit: number; hero: number; tuck: number; slide: number; idle: number; tumble: number; backdrop: number; order: 1 | -1 };
export type SpinClock = { angle: number; boost: number };
// The hero frame's swap: `incoming.v` is the dissolve of the sleeve now in the
// frame (1 dispersed .. 0 whole); `outgoing` are sleeves leaving it, each
// breaking up toward 1, keyed by their belt place m.
export type Swap = { incoming: { v: number }; outgoing: { m: number; v: number }[] };

export const newChoreo = (): Choreo => ({ exit: 0, hero: 0, tuck: 0, slide: 0, idle: 1, tumble: 1, backdrop: 0, order: 1 });
export const newSwap = (): Swap => ({ incoming: { v: 0 }, outgoing: [] });

// --- the main durations, seconds (owner, 2026-10-20: slow and calm; judged
// on real hardware) ---
// each card's own dissolve, and the stagger between one card and the next,
// nearest the focus first
export const EXIT_ITEM = 1.0;
export const EXIT_STAGGER = 0.1;
// beyond this rank (the far half's faint silhouettes) cards are out of sight
export const MAX_RANK = 5;
export const EXIT_SPAN = EXIT_ITEM + EXIT_STAGGER * MAX_RANK;
// the record's idle turning eases out from the first beat
export const IDLE_OUT_SECONDS = 0.9;
// the sleeve's walk forward to the art frame, after the first neighbours begin
export const HERO_AT = 0.25;
export const HERO_SECONDS = 1.15;
// the record goes into the sleeve as it walks (the tumble blends out with it)
export const TUCK_SECONDS = 1.3;
// desktop: the record, part-way out of the sleeve, turns one full revolution
// there, slowly enough to follow
export const TURN_AT = HERO_AT + HERO_SECONDS - 0.05;
export const TURN_SECONDS = 1.3;
// then slides out of the sleeve past its edge and back in front of it to its
// resting place, on a soft ease (owner, 2026-10-20, revision two: the
// out-and-back added 0.7 s; 2026-10-27: the stacked layout slides up too)
export const SLIDE_AT = TURN_AT + TURN_SECONDS;
export const SLIDE_SECONDS = 2.2;
// linear: discSlide eases each leg itself (out, a rest at the sleeve's edge,
// and back), so the slide's own tween adds no second ease
export const SLIDE_EASE = "none";
// as it comes in to land it spins up gently and settles upright (half to
// one and a half turns on), so the still HTML record can take over without a
// jump
export const SPIN_AT = SLIDE_AT + SLIDE_SECONDS * 0.65;
export const SPIN_SECONDS = 1.3;
export const SPIN_TURNS = 0.5;
// where the HTML reveal (title letters, then caption, report link, arrows)
// begins: as the record settles
export const LAND_AT = SLIDE_AT + SLIDE_SECONDS * 0.65;
// the mineral surface comes up behind the sleeve as it walks forward
export const BACKDROP_AT = HERO_AT;
export const BACKDROP_SECONDS = HERO_SECONDS + 0.4;
// close (about 60–70 % of the open): the disc goes back, the sleeve returns,
// then the cards gather and the tumble returns
export const CLOSE_SLIDE_SECONDS = 1.3;
export const CLOSE_HERO_AT = 0.5;
export const CLOSE_HERO_SECONDS = 1.0;
export const CLOSE_TUCK_SECONDS = 0.9;
export const CLOSE_GATHER_AT = 1.6;
export const CLOSE_IDLE_SECONDS = 1.0;
export const CLOSE_TUMBLE_SECONDS = 1.5;
// a step inside an open record: the outgoing sleeve breaks up in place, the
// incoming gathers a little after, and the record turns once
export const STEP_SECONDS = 0.7;
export const STEP_OUT_SECONDS = 0.8;
export const STEP_IN_AT = 0.5;
export const STEP_IN_SECONDS = 0.85;
export const STEP_SPIN_SECONDS = 1.3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = gsap.parseEase("power2.inOut");
const sineInOut = gsap.parseEase("sine.inOut");

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

// --- the slide out of the sleeve (owner, 2026-10-20, revision two) ---------
// A record that rests in front of the sleeve (the desktop's HTML record
// overlaps the sleeve's left edge, in front) must not pop from behind it to
// in front. So the slide is out and back: behind the sleeve it slides out
// past the sleeve's edge until it clears it (SLIDE_CLEAR of the slide);
// there, with nothing overlapping, it steps in front (an invisible change),
// and it comes back over the edge to rest exactly on the HTML disc frame.
// A record that rests behind the sleeve (the compact layout) just slides
// there and stays behind. Close runs the same path backwards.
export const SLIDE_CLEAR = 0.55;
// the gap left between the record's rim and the sleeve's paper at the
// turn, as a share of the record's radius
export const CLEAR_GAP = 0.04;
export type Disc = { x: number; y: number; r: number };
// sleeve: its centre and half its visible width (the frame's paper)
// screenLeft (optional): the viewport's edge on the side the record goes, so
// at the turn it stays on screen (it may be up to CLEAR_SHRINK smaller there,
// and grows to its rest size as it comes forward over the sleeve)
// axis (optional): the direction the record leaves the sleeve in. "x" (the
// default) is the side-by-side layout; "y" the stacked one (owner,
// 2026-10-27), where the record slides up out of the sleeve to rest above it
// and screenEdge is the edge on that side in y.
export type SlideGeometry = { tucked: Disc; rest: Disc; sleeve: { x: number; y: number; half: number }; restInFront: boolean; screenEdge?: number; axis?: "x" | "y" };
export const CLEAR_SHRINK = 0.15;
export const SCREEN_MARGIN = 0.02;
export type SlidePose = Disc & { inFront: boolean; turn: number; settle: number };
const swapXY = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.y, y: p.x });
export function discSlide(slide: number, g: SlideGeometry): SlidePose {
  if (g.axis === "y") {
    // the same path with the two axes exchanged
    const p = slideAlongX(slide, { ...g, axis: "x", tucked: swapXY(g.tucked), rest: swapXY(g.rest), sleeve: swapXY(g.sleeve) });
    return swapXY(p);
  }
  return slideAlongX(slide, g);
}
function slideAlongX(slide: number, g: SlideGeometry): SlidePose {
  const t = clamp01(slide);
  if (!g.restInFront) {
    const k = inOut(t);
    return { x: g.tucked.x + (g.rest.x - g.tucked.x) * k, y: g.tucked.y + (g.rest.y - g.tucked.y) * k, r: g.tucked.r + (g.rest.r - g.tucked.r) * k, inFront: false, turn: k, settle: k };
  }
  const side = Math.sign(g.rest.x - g.sleeve.x) || -1;
  // the radius at the turn: the rest size, unless that would leave the screen
  const room = g.screenEdge === undefined ? Infinity : (Math.abs(g.screenEdge - g.sleeve.x) - g.sleeve.half - SCREEN_MARGIN) / (2 + CLEAR_GAP);
  const rc = Math.max(g.rest.r * (1 - CLEAR_SHRINK), Math.min(g.rest.r, room));
  const clearX = g.sleeve.x + side * (g.sleeve.half + rc * (1 + CLEAR_GAP));
  const turn = inOut(clamp01(t / SLIDE_CLEAR));
  const settle = inOut(clamp01((t - SLIDE_CLEAR) / (1 - SLIDE_CLEAR)));
  // height and size move once, over the whole slide (a soft ease)
  const k = sineInOut(t);
  const x = t < SLIDE_CLEAR ? g.tucked.x + (clearX - g.tucked.x) * turn : clearX + (g.rest.x - clearX) * settle;
  // the size reaches the turn's size by the turn, so the clearing is real,
  // then the rest size as it comes forward
  const r = t < SLIDE_CLEAR ? g.tucked.r + (rc - g.tucked.r) * turn : rc + (g.rest.r - rc) * settle;
  return { x, y: g.tucked.y + (g.rest.y - g.tucked.y) * k, r, inFront: t >= SLIDE_CLEAR, turn, settle };
}
// whether a round record of this pose overlaps the sleeve's square
export function overlapsSleeve(d: Disc, sleeve: SlideGeometry["sleeve"]): boolean {
  const dx = Math.max(Math.abs(d.x - sleeve.x) - sleeve.half, 0);
  const dy = Math.max(Math.abs(d.y - sleeve.y) - sleeve.half, 0);
  return dx * dx + dy * dy < d.r * d.r;
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

// (the layout no longer changes the timelines: every layout's record slides
// out of its sleeve; kept as an options bag for callers)
type Opts = { phone?: boolean };

// --- the scene's halves of the choreography -------------------------------

export function openTimeline(c: Choreo, spin: SpinClock, _o: Opts, swap: Swap = newSwap()): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  // an interrupted close keeps its order, so no card jumps
  if (c.exit <= 0.001) c.order = 1;
  tl.addLabel("aside", 0)
    .to(c, { exit: 1, duration: EXIT_SPAN * (1 - c.exit), ease: "none" }, "aside")
    .to(c, { idle: 0, duration: IDLE_OUT_SECONDS, ease: "power1.out" }, "aside")
    .to(c, { hero: 1, duration: HERO_SECONDS, ease: "power3.inOut" }, HERO_AT)
    .to(c, { tuck: 1, duration: TUCK_SECONDS }, "aside")
    // the tumble leaves over the tuck, from wherever it is, so the record
    // meets the sleeve square
    .to(c, { tumble: 0, duration: TUCK_SECONDS, ease: "power2.inOut" }, "aside")
    .to(c, { backdrop: 1, duration: BACKDROP_SECONDS, ease: "power1.inOut" }, BACKDROP_AT);
  settleSwap(tl, swap, 0, HERO_AT, HERO_SECONDS);
  // part-way out of the sleeve the record turns once, in plain sight; then it
  // slides slowly out, lands, spins up gently and settles upright. Every
  // layout (2026-10-27: the stacked layout's record slides up out of the
  // sleeve to rest above it, replacing the phone's tucked record)
  tl.addLabel("turn", TURN_AT);
  tl.to(spin, { angle: () => spin.angle - Math.PI * 2, boost: 0, duration: TURN_SECONDS, ease: "sine.inOut" }, "turn");
  tl.to(c, { slide: 1, duration: SLIDE_SECONDS, ease: SLIDE_EASE }, SLIDE_AT).addLabel("land", LAND_AT);
  tl.to(spin, { angle: () => landing(spin.angle, SPIN_TURNS), boost: 0, duration: SPIN_SECONDS, ease: "sine.inOut" }, SPIN_AT);
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
  const tuckAt = 0.9 * slideFor + 0.05;
  tl.to(c, { slide: 0, duration: slideFor + 0.001, ease: SLIDE_EASE }, 0)
    .to(c, { hero: 0, duration: CLOSE_HERO_SECONDS, ease: "power3.inOut" }, CLOSE_HERO_AT * Math.min(1, c.slide + 0.3))
    .to(c, { tuck: 0, duration: CLOSE_TUCK_SECONDS }, tuckAt)
    .to(c, { backdrop: 0, duration: CLOSE_HERO_SECONDS + 0.3, ease: "power1.inOut" }, CLOSE_HERO_AT * Math.min(1, c.slide + 0.3))
    // (with no slide to undo, a phone's, the gather begins sooner)
    .to(c, { exit: 0, duration: EXIT_SPAN * c.exit, ease: "none" }, CLOSE_GATHER_AT * Math.min(1, c.hero + 0.2) * (0.5 + 0.5 * c.slide))
    .to(c, { idle: 1, duration: CLOSE_IDLE_SECONDS, ease: "power1.in" }, tuckAt)
    // the tumble comes back as the record leaves the sleeve
    .to(c, { tumble: 1, duration: CLOSE_TUMBLE_SECONDS, ease: "power2.inOut" }, tuckAt);
  settleSwap(tl, swap, 0, 0, 0.8);
  // at the very end (">" would be the end of the last tween added, not the
  // last to finish)
  if (onHandBack) tl.call(onHandBack, undefined, tl.duration());
  return tl;
}

// Stepping inside an open record (after retarget()): finish any open still
// under way, swap the sleeves in the hero frame, and turn the record once to
// its next upright while the belt carries the next card round behind.
export function stepTimeline(c: Choreo, spin: SpinClock, _o: Opts, swap: Swap = newSwap()): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut", duration: STEP_SECONDS } });
  // a finished exit has no stagger left to keep; a partial one keeps its order
  if (c.exit >= 0.999 || c.exit <= 0.001) c.order = 1;
  tl.to(c, { exit: 1, duration: EXIT_SPAN * (1 - c.exit) + 0.001, ease: "none" }, 0);
  tl.to(c, { hero: 1, tuck: 1, idle: 0, tumble: 0, backdrop: 1 }, 0);
  settleSwap(tl, swap, 0, STEP_IN_AT, STEP_IN_SECONDS);
  tl.to(c, { slide: 1 }, 0);
  tl.to(spin, { angle: () => landing(spin.angle, 1), boost: 0, duration: STEP_SPIN_SECONDS, ease: "power2.inOut" }, 0);
  return tl;
}
