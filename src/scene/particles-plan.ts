// The particle dissolve's decisions as pure functions (design 2026-10-19 §4),
// so they can be tested without WebGL: which cards break into particles this
// frame and which fall back to a plain alpha fade, how the mesh and the
// particles crossfade, which way the grain drifts, and when a card that came
// round from out of sight may show itself again.
//
// One value drives a card's particles: `dissolve`, 0 (the solid sleeve) .. 1
// (fully dispersed). The belt's dissolve zones (belt-layout.ts dissolveAt)
// give it from where the card is; an operator hide tweens it in place; the
// open's exit and the close's gather (planExit, record-timeline.ts) hand in
// their own value with a mode. Nothing here knows about Three.js.

import { beltPoint, DISC_YAW, halfOf, tileStep, wrapAngle, ZONE_DESKTOP, ZONE_PHONE, type Fit } from "./belt-layout.ts";

// --- counts and budget --------------------------------------------------------
// each card in particle form is a grid of GRID² points sampling its image
export const GRID_DESKTOP = 64;
export const GRID_PHONE = 40;
export const gridSize = (phone: boolean) => (phone ? GRID_PHONE : GRID_DESKTOP);
// at most this many cards in particle form at once; the pool is allocated
// once at the larger size
export const BUDGET_DESKTOP = 4;
export const BUDGET_PHONE = 3;
export const POOL = BUDGET_DESKTOP;
export const particleBudget = (phone: boolean) => (phone ? BUDGET_PHONE : BUDGET_DESKTOP);

// --- the crossfade --------------------------------------------------------
// The mesh and full-opacity particles never draw at once: the particles come
// in over CROSS_IN, while they still hold the card's shape, and the mesh goes
// out over CROSS_OUT, slightly later, so the swap reads as one image.
export const CROSS_IN: readonly [number, number] = [0.04, 0.12];
export const CROSS_OUT: readonly [number, number] = [0.07, 0.15];
// below this dissolve the particles have not left the card yet (they start to
// move only once the mesh has gone): the shader remaps dissolve from here
export const RELEASE_FROM = 0.15;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// the particles' opacity at a dissolve (before the card's own fade)
export const particleAlpha = (d: number) => smooth(CROSS_IN[0], CROSS_IN[1], d);
// the mesh's opacity at a dissolve, by how the card is drawn this frame
export type Render = "mesh" | "particles" | "alpha";
export function meshAlpha(d: number, render: Render): number {
  if (render === "particles") return 1 - smooth(CROSS_OUT[0], CROSS_OUT[1], d);
  return 1 - clamp01(d);
}

// --- fast turns ----------------------------------------------------------
// Above FAST_ON cards per second a card entering a zone uses the cheap alpha
// fade, so a hard flick never fills the screen with grain; below FAST_OFF
// particles come back. An arrow step's damped turn peaks at about 9 cards per
// second (gallery-motion.ts PHASE_RATE), so a single step always uses
// particles; two or more steps at once, or a hard drag throw, do not.
export const FAST_ON = 13;
export const FAST_OFF = 8;
export function fastTurn(speed: number, wasFast: boolean): boolean {
  const s = Math.abs(speed);
  return wasFast ? s > FAST_OFF : s > FAST_ON;
}

// --- modes and direction -----------------------------------------------------
// leave: the card breaks up as it goes round to the back
// gather: it comes from the back and collects into its sleeve
// inplace: an operator hide; it breaks up where it is, lifting a little
export type Mode = "leave" | "gather" | "inplace";

// A zone card is leaving when it moves away from the front (|θ| grows), and
// arriving when it moves toward it. Standing still keeps the last mode.
export function zoneMode(theta: number, prevTheta: number, last: Mode = "leave"): Mode {
  const a = Math.abs(wrapAngle(theta));
  const b = Math.abs(wrapAngle(prevTheta));
  if (Math.abs(a - b) < 1e-6) return last;
  return a > b ? "leave" : "gather";
}

// Which way the grain lies along the band, in azimuth: always toward the
// back. A leaving card's grain drifts back along the band's tangent; an
// arriving card's grain comes from there and closes in. So the drift depends
// only on where the card is, never on how it moves, and a turn reversed
// mid-zone never makes the grain jump.
export const driftSign = (theta: number): 1 | -1 => (wrapAngle(theta) >= 0 ? 1 : -1);

// How far round the band the grain travels at full dissolve, radians.
export const DRIFT_SPAN = (16 * Math.PI) / 180;

// --- choosing who gets particles ------------------------------------------------
// A candidate is any card whose dissolve is under way: a zone card, a hidden
// card dissolving in place, or a caller's request.
export type Kind = "zone" | "hide" | "request";
export type Candidate = { key: string; dissolve: number; kind: Kind; weight: number };
export type PlanInput = {
  phone: boolean;
  reduced: boolean;
  fast: boolean;
  // the keys drawn as particles last frame: they keep their form until done,
  // so a card never switches from particles to alpha mid-dissolve
  previous: ReadonlySet<string>;
};

const KIND_RANK: Record<Kind, number> = { hide: 0, request: 1, zone: 2 };

// Each candidate's render. Reduced motion: alpha only. Otherwise hides come
// first, then requests, then zone cards; a card already in particle form
// keeps them (even through a fast turn); a new zone card in a fast turn
// takes alpha; and no more than the budget are particles at once. Solid
// (dissolve 0) or gone (1) candidates are plain mesh/alpha.
export function planParticles(cands: readonly Candidate[], o: PlanInput): Map<string, Render> {
  const out = new Map<string, Render>();
  const live: Candidate[] = [];
  for (const c of cands) {
    if (c.dissolve <= 0.001) out.set(c.key, "mesh");
    else if (o.reduced || c.dissolve >= 0.999) out.set(c.key, "alpha");
    else live.push(c);
  }
  live.sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k) return k;
    const s = Number(o.previous.has(b.key)) - Number(o.previous.has(a.key));
    if (s) return s;
    return b.weight - a.weight;
  });
  let left = particleBudget(o.phone);
  for (const c of live) {
    const sticky = o.previous.has(c.key);
    const allowed = c.kind !== "zone" || sticky || !o.fast;
    if (allowed && left > 0) {
      out.set(c.key, "particles");
      left--;
    } else out.set(c.key, "alpha");
  }
  return out;
}

// --- arrivals and replacement ------------------------------------------------------
// A card changes record only at the very back, out of sight (belt-layout.ts
// beltCards). The visible moment a different record arrives is the arriving
// zone: beyond the zone's peak (the far side of the globe's silhouette) a
// card shows the blank paper stock, never its image, and in front of the peak
// its image. At the peak a card is fully dispersed, so the switch is never
// seen: a record that came round from the back first shows its image while
// it gathers from particles in the arriving zone. A card leaving the same way
// loses its image at the peak, and its faint far-half silhouette (desktop) is
// blank stock. On a phone the far half is hidden anyway.
export function imageShown(theta: number, phone: boolean): boolean {
  return Math.abs(wrapAngle(theta)) < (phone ? ZONE_PHONE : ZONE_DESKTOP).peak;
}

// A late image fades in over this long once it has decoded (the card
// gathers into blank stock first).
export const IMAGE_FADE_SECONDS = 0.5;

// --- the open's exit (step ④, design §5) --------------------------------------
// When a record opens, every other card on the ring leaves, staggered outward
// from the focus: the nearest first, one after another (record-timeline.ts
// spaces them EXIT_STAGGER apart by rank). The front-half cards break into
// grain that drifts back along the band, the nearest first within the
// budget; the far half's faint silhouettes, and any front card past the
// budget, take the plain alpha fade. A card's form is fixed for the whole
// ritual, so none switches from alpha to particles when a slot frees. On a
// close the same order gathers them back (nearest first again).
//
// Keyed by the card's offset from the focused place (m - focus), for every
// other place on a ring of `ring` cards: offsets in (-ring/2, ring/2].
export type ExitSlot = { rank: number; particles: boolean };
export function planExit(ring: number, phone: boolean): Map<number, ExitSlot> {
  const offs: number[] = [];
  for (let k = Math.floor(-ring / 2) + 1; k <= Math.floor(ring / 2); k++) if (k !== 0) offs.push(k);
  // nearest first; of a pair at the same distance, the right-hand one first
  offs.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
  const out = new Map<number, ExitSlot>();
  let left = particleBudget(phone);
  offs.forEach((k, rank) => {
    const front = halfOf(k * tileStep(ring)) === "front";
    const particles = front && left > 0;
    if (particles) left--;
    out.set(k, { rank, particles });
  });
  return out;
}

// --- the record's rim (owner, 2026-10-20, revision two) ---------------------
// As the belt turns, a front-half card crossing the record's silhouette edge,
// on its way in front of the record and again on its way out, breaks briefly
// into grain and re-forms, as if it passed through a veil at the record's
// rim. It never disappears: the dissolve rises to RIM_PEAK and back to 0 over
// the crossing, drawn in place (mode "inplace") through the same particle
// path and budget as the zones (kind "zone", so a fast turn takes the alpha
// fade, hides and requests come first, and the nearest the front win a slot).
//
// Measured in the record's horizontal radii from its centre (`u`): the band's
// centre line runs through the record's middle, so a card's centre crosses
// the silhouette at u = 1. The pulse spans u in 1 ± RIM_BAND. In these units
// the composition is the same at every desktop size (the record and the belt
// scale together), and on a phone the same at every width; the resting
// neighbours sit at u ≈ 1.59 (desktop, 36°) and 1.45 (phone, 60°), outside
// the band, and the front card at 0, so no card rests mid-pulse.
export const RIM_PEAK = 0.62;
// wide enough that the pulse's target holds while a step carries the card
// across the rim (owner, 2026-10-20: the crossing read as too quick)
export const RIM_BAND = 0.4;
// a card's centre from the record's centre, in the record's on-screen
// horizontal radii (the record turned DISC_YAW on a desktop is a little
// narrower; its slow tumble is ignored)
export function rimU(theta: number, fit: Pick<Fit, "phone" | "cx" | "S" | "disc">): number {
  const x = fit.cx + beltPoint(theta).x * fit.S;
  const half = fit.disc.r * (fit.phone ? 1 : Math.cos(DISC_YAW));
  return Math.abs(x - fit.disc.x) / Math.max(half, 1e-6);
}
// the pulse at u (0 outside the band, RIM_PEAK on the rim, a smooth bump),
// for front-half cards only, and never while a record is open or under
// reduced motion (`active` false)
export function rimPulse(u: number, theta: number, active: boolean): number {
  if (!active || halfOf(theta) !== "front") return 0;
  const d = Math.abs(u - 1) / RIM_BAND;
  if (d >= 1) return 0;
  return RIM_PEAK * 0.5 * (1 + Math.cos(Math.PI * d));
}

// --- pace ---------------------------------------------------------------------
// The zones and the rim give a card's dissolve as a function of where it is,
// so on their own a step (a card crosses a zone in ~0.15 s) is over before
// anyone sees it. The shown dissolve follows that target in time instead
// (owner, 2026-10-20: "slow the whole process down"): it breaks up quickly
// to what the target reached, holds there a moment, then gathers back
// slowly, so a card that has already passed finishes re-forming as it goes.
// Exponential, so the same at any frame rate.
export const BREAK_SECONDS = 0.12;
export const HOLD_SECONDS = 0.25;
export const GATHER_BACK_SECONDS = 0.6;
export type Paced = { shown: number; held: number; hold: number };
export const paced = (): Paced => ({ shown: 0, held: 0, hold: 0 });
export function easeDissolve(p: Paced, target: number, dt: number, instant = false): Paced {
  if (instant) return { shown: target, held: target, hold: 0 };
  let want = target;
  let { held, hold } = p;
  if (target >= held) {
    held = target;
    hold = HOLD_SECONDS;
  } else if ((hold -= dt) > 0) want = held;
  else held = target;
  const tau = want > p.shown ? BREAK_SECONDS : GATHER_BACK_SECONDS;
  let shown = want + (p.shown - want) * Math.exp(-dt / tau);
  if (Math.abs(shown - want) < 1e-3) shown = want;
  return { shown, held, hold };
}
// whether it still needs frames
export const settling = (p: Paced, target: number) => p.hold > 0 || Math.abs(p.shown - target) > 1e-3;

// --- hides ------------------------------------------------------------------
// A hidden card dissolves in place: it takes over from the mesh already
// opaque (at RELEASE_FROM the particles are whole and the mesh gone) and
// breaks up over HIDE_SECONDS. Under reduced motion it leaves at once.
export const HIDE_SECONDS = 1.4;
// a record that shifts into a hidden one's place gathers in over this long
export const GATHER_SECONDS = 1.1;
export const hideStart = (current: number) => Math.max(RELEASE_FROM, Math.min(1, current));
