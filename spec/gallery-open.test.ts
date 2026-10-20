import { describe, expect, it, vi } from "vitest";
import { halfOf, tileStep } from "../src/scene/belt-layout.ts";
import { planExit, planParticles, BUDGET_DESKTOP, BUDGET_PHONE, type Candidate, type ExitSlot, type Render } from "../src/scene/particles-plan.ts";
import {
  cardRitual,
  closeTimeline,
  EXIT_STAGGER,
  HERO_AT,
  HERO_SECONDS,
  local,
  SLIDE_AT,
  SLIDE_SECONDS,
  TURN_AT,
  TURN_SECONDS,
  TUCK_SECONDS,
  newChoreo,
  newSwap,
  openTimeline,
  pruneSwap,
  retarget,
  stepTimeline,
  type Choreo,
  type Swap,
} from "../src/scene/record-timeline.ts";
import { BODY_AT, BODY_STAGGER, CHROME_AT, REVEAL_ITEM, TITLE_LETTER, titleStagger, TITLE_SPAN } from "../src/lib/record-reveal.ts";

// Opening a record on the belt (design 2026-10-19 §5), without WebGL: the
// scene turns these pure values into poses and particle draws every frame
// (gallery-belt.ts cardPose), so the tests drive the same timelines and ask
// the same questions the frame loop asks: who breaks into grain, in what
// order, what sits in the hero frame, and what is left in particle form once
// a timeline is done or cut short.

// One frame of the belt's particle bookkeeping for the ring round `hero`: the
// ritual's candidates (as gallery-belt.ts builds them, zones aside) and the
// plan's answer. `previous` carries the sticky set from frame to frame.
type Frame = { renders: Map<number, Render>; dissolve: Map<number, number>; framed: number[] };
function frameAt(o: { ring: number; phone: boolean; hero: number; c: Choreo; swap: Swap; exits: Map<number, ExitSlot>; closing?: boolean; reduced?: boolean; previous: Set<string> }): Frame {
  const cands: Candidate[] = [];
  const dissolve = new Map<number, number>();
  const fades = new Set<number>();
  const framed: number[] = [];
  const places = new Set<number>();
  for (let k = Math.floor(-o.ring / 2) + 1; k <= Math.floor(o.ring / 2); k++) places.add(o.hero + k);
  for (const out of o.swap.outgoing) places.add(out.m);
  for (const m of places) {
    const r = cardRitual(m, o.hero, o.c, o.swap, o.exits, !!o.closing);
    dissolve.set(m, r.dissolve);
    if (r.heroW > 0) framed.push(m);
    if (r.dissolve > 0.001 && !r.particles) fades.add(m);
    else if (r.dissolve > 0.001) cands.push({ key: `c${m}`, dissolve: r.dissolve, kind: r.kind, weight: r.weight });
  }
  const plan = planParticles(cands, { phone: o.phone, reduced: !!o.reduced, fast: false, previous: o.previous });
  o.previous.clear();
  const renders = new Map<number, Render>();
  for (const m of places) renders.set(m, fades.has(m) ? "alpha" : (plan.get(`c${m}`) ?? "mesh"));
  for (const [k, r] of plan) if (r === "particles") o.previous.add(k);
  return { renders, dissolve, framed };
}
const inParticles = (f: Frame) => [...f.renders].filter(([, r]) => r === "particles").map(([m]) => m);

describe("the open's exit order", () => {
  it("ranks every other card nearest the focus first, and gives particles to the visible front-half neighbours", () => {
    for (const [ring, phone, budget] of [
      [10, false, BUDGET_DESKTOP],
      [6, true, BUDGET_PHONE],
    ] as const) {
      const plan = planExit(ring, phone);
      expect(plan.size).toBe(ring - 1);
      const byRank = [...plan].sort((a, b) => a[1].rank - b[1].rank).map(([k]) => Math.abs(k));
      // nearest first, never a farther card before a nearer one
      for (let i = 1; i < byRank.length; i++) expect(byRank[i]).toBeGreaterThanOrEqual(byRank[i - 1]);
      const withParticles = [...plan].filter(([, s]) => s.particles).map(([k]) => k);
      expect(withParticles.length).toBeLessThanOrEqual(budget);
      // only front-half cards; the far half's silhouettes fade
      for (const k of withParticles) expect(halfOf(k * tileStep(ring))).toBe("front");
      for (const [k, s] of plan) if (halfOf(k * tileStep(ring)) === "back") expect(s.particles).toBe(false);
    }
    // the phone shows two neighbours, and both break into grain
    expect([...planExit(6, true)].filter(([, s]) => s.particles).map(([k]) => k).sort()).toEqual([-1, 1]);
    // the desktop's four front neighbours: ±1, then ±2
    expect([...planExit(10, false)].filter(([, s]) => s.particles).map(([k]) => Math.abs(k))).toEqual([1, 1, 2, 2]);
  });

  it("past the budget the farther cards take the alpha fade, never the nearest", () => {
    // a wide ring with more front neighbours than slots
    const plan = planExit(16, false);
    const front = [...plan].filter(([k]) => halfOf(k * tileStep(16)) === "front");
    expect(front.length).toBeGreaterThan(BUDGET_DESKTOP);
    const given = front.filter(([, s]) => s.particles).map(([, s]) => s.rank);
    const faded = front.filter(([, s]) => !s.particles).map(([, s]) => s.rank);
    expect(given).toHaveLength(BUDGET_DESKTOP);
    expect(Math.max(...given)).toBeLessThan(Math.min(...faded));
  });

  it("the neighbours begin one after another, about 0.1 s apart, nearest first", () => {
    expect(EXIT_STAGGER).toBeCloseTo(0.1, 2);
    const c = newChoreo();
    const tl = openTimeline(c, { angle: 0, boost: 0 }, { phone: false });
    const exits = planExit(10, false);
    const starts = new Map<number, number>();
    for (let t = 0; t <= tl.duration(); t += 0.005) {
      tl.time(t);
      for (const [k] of exits) if (!starts.has(k) && local(c.exit, exits.get(k)!.rank, c.order) > 0.001) starts.set(k, t);
    }
    tl.kill();
    const order = [...starts].sort((a, b) => a[1] - b[1]).map(([k]) => Math.abs(k));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    const t1 = starts.get(1)!;
    const t2 = starts.get(-1)!;
    expect(t2 - t1).toBeGreaterThan(0.07);
    expect(t2 - t1).toBeLessThan(0.14);
  });

  it("an open requests particle exits for the visible neighbours, nearest first, within the budget", () => {
    for (const [ring, phone] of [
      [10, false],
      [6, true],
    ] as const) {
      const c = newChoreo();
      const swap = newSwap();
      const exits = planExit(ring, phone);
      const previous = new Set<string>();
      const tl = openTimeline(c, { angle: 0, boost: 0 }, { phone }, swap);
      const firstInGrain: number[] = [];
      for (let t = 0; t <= tl.duration() + 0.01; t += 1 / 60) {
        tl.time(t);
        const f = frameAt({ ring, phone, hero: 0, c, swap, exits, previous });
        for (const m of inParticles(f)) if (!firstInGrain.includes(m)) firstInGrain.push(m);
        expect(inParticles(f).length).toBeLessThanOrEqual(phone ? BUDGET_PHONE : BUDGET_DESKTOP);
        // the focused sleeve never dissolves and comes forward into the frame
        expect(f.dissolve.get(0)).toBe(0);
      }
      const want = [...exits].filter(([, s]) => s.particles).sort((a, b) => a[1].rank - b[1].rank).map(([k]) => k);
      expect(firstInGrain).toEqual(want);
      // at the end everyone else is gone and no slot is held
      const end = frameAt({ ring, phone, hero: 0, c, swap, exits, previous });
      expect(inParticles(end)).toEqual([]);
      for (const [m, d] of end.dissolve) expect(d).toBe(m === 0 ? 0 : 1);
      expect(c).toMatchObject({ exit: 1, hero: 1 });
      tl.kill();
    }
  });

  it("the desktop open is slow and calm: about 4–5 s to the hand-over, each beat perceptible (owner, 2026-10-20)", () => {
    const c = newChoreo();
    const spin = { angle: 0, boost: 0 };
    const tl = openTimeline(c, spin, { phone: false });
    // the HTML reveal is nested at "land": title letters, copy, then controls
    const reveal = Math.max(CHROME_AT + REVEAL_ITEM + 0.06 * 2, BODY_AT + BODY_STAGGER * 4 + REVEAL_ITEM, TITLE_SPAN + TITLE_LETTER);
    const handover = Math.max(tl.duration(), tl.labels.land + reveal);
    expect(handover).toBeGreaterThanOrEqual(3.5);
    expect(handover).toBeLessThanOrEqual(5.5);
    // the record turns one full revolution behind the sleeve, slowly enough
    // to follow, after it has tucked in and before it slides out
    expect(TURN_SECONDS).toBeGreaterThanOrEqual(1.2);
    expect(TURN_SECONDS).toBeLessThanOrEqual(1.6);
    expect(tl.labels.turn).toBeCloseTo(TURN_AT, 9);
    expect(TURN_AT).toBeGreaterThanOrEqual(TUCK_SECONDS - 0.05);
    expect(TURN_AT).toBeGreaterThanOrEqual(HERO_AT + HERO_SECONDS - 0.1);
    expect(SLIDE_AT).toBeGreaterThanOrEqual(TURN_AT + TURN_SECONDS - 1e-9);
    tl.time(TURN_AT);
    const before = spin.angle;
    expect(c.slide).toBe(0);
    tl.time(TURN_AT + TURN_SECONDS);
    expect(before - spin.angle).toBeCloseTo(Math.PI * 2, 6);
    expect(c.slide).toBe(0);
    // the slide out is much slower than before (0.6 s)
    expect(SLIDE_SECONDS).toBeGreaterThanOrEqual(1.4);
    expect(SLIDE_SECONDS).toBeLessThanOrEqual(1.8);
    // the tumble has gone by the time the record turns in the sleeve
    expect(c.tumble).toBe(0);
    expect(titleStagger(80) * 79).toBeLessThanOrEqual(TITLE_SPAN + 1e-9);
    expect(titleStagger(5)).toBe(0.025);
    tl.kill();
  });

  it("the close is calmer too, about 60–70 % of the open; a step stays moderate", () => {
    const c = newChoreo();
    const spin = { angle: 0, boost: 0 };
    const open = openTimeline(c, spin, { phone: false });
    const openSeconds = open.duration();
    open.progress(1).kill();
    const close = closeTimeline(c);
    expect(close.duration() / openSeconds).toBeGreaterThanOrEqual(0.55);
    expect(close.duration() / openSeconds).toBeLessThanOrEqual(0.75);
    close.progress(1).kill();
    expect(c).toMatchObject({ tumble: 1, backdrop: 0 });
    openTimeline(c, spin, { phone: false }).progress(1).kill();
    const step = stepTimeline(c, spin, { phone: false });
    expect(step.duration()).toBeGreaterThanOrEqual(1.1);
    expect(step.duration()).toBeLessThanOrEqual(1.6);
    step.kill();
  });

  it("the phone's open is calmer as well, its record staying tucked", () => {
    const c = newChoreo();
    const tl = openTimeline(c, { angle: 0, boost: 0 }, { phone: true });
    expect(tl.duration()).toBeGreaterThanOrEqual(1.5);
    tl.progress(1);
    expect(c).toMatchObject({ tuck: 1, slide: 0, backdrop: 1, tumble: 0 });
    const close = closeTimeline(c);
    expect(close.duration()).toBeLessThanOrEqual(tl.duration() * 1.3);
    tl.kill();
    close.kill();
  });
});

describe("the close", () => {
  it("gathers every card back, nearest first, and hands back only after the last one is whole", () => {
    const c = newChoreo();
    const swap = newSwap();
    const exits = planExit(10, false);
    const previous = new Set<string>();
    openTimeline(c, { angle: 0, boost: 0 }, { phone: false }, swap).progress(1).kill();
    const handBack = vi.fn();
    const tl = closeTimeline(c, swap, handBack);
    const whole = new Map<number, number>();
    let handedAt = -1;
    for (let t = 0; t <= tl.duration() + 0.02; t += 1 / 60) {
      tl.time(Math.min(t, tl.duration()));
      const f = frameAt({ ring: 10, phone: false, hero: 0, c, swap, exits, closing: true, previous });
      for (const [m, d] of f.dissolve) if (m !== 0 && d < 1 && !whole.has(m)) whole.set(m, t);
      if (handBack.mock.calls.length && handedAt < 0) {
        handedAt = t;
        // nothing is still dispersed when the page comes back
        for (const d of f.dissolve.values()) expect(d).toBe(0);
      }
      if (handedAt < 0) expect(handBack).not.toHaveBeenCalled();
    }
    expect(handBack).toHaveBeenCalledTimes(1);
    // the nearest cards gather first (a nearer card never starts later; the
    // far half's silhouettes past MAX_RANK start together)
    for (const [a, ta] of whole) for (const [b, tb] of whole) if (Math.abs(a) < Math.abs(b)) expect(ta).toBeLessThanOrEqual(tb);
    expect(whole.get(1)!).toBeLessThan(whole.get(2)!);
    expect(c).toMatchObject({ exit: 0, hero: 0, tuck: 0, slide: 0, idle: 1 });
    expect(inParticles(frameAt({ ring: 10, phone: false, hero: 0, c, swap, exits, previous }))).toEqual([]);
    tl.kill();
  });

  it("a close that is cut short never hands back", () => {
    const c = newChoreo();
    openTimeline(c, { angle: 0, boost: 0 }, { phone: false }).progress(1).kill();
    const handBack = vi.fn();
    const close = closeTimeline(c, newSwap(), handBack);
    close.progress(0.5);
    close.kill();
    expect(handBack).not.toHaveBeenCalled();
  });
});

describe("arrows inside an open record", () => {
  it("swap the record in the hero frame without leaving the open state, never two whole sleeves at once", () => {
    for (const phone of [false, true]) {
      const ring = phone ? 6 : 10;
      const c = newChoreo();
      const swap = newSwap();
      const exits = planExit(ring, phone);
      const previous = new Set<string>();
      const spin = { angle: 0, boost: 0 };
      openTimeline(c, spin, { phone }, swap).progress(1).kill();
      let hero = 0;
      // two arrows, the second while the first is still under way
      hero = retarget(swap, c, hero, 1, cardRitual(1, hero, c, swap, exits, false).dissolve);
      let tl = stepTimeline(c, spin, { phone }, swap);
      const check = () => {
        const f = frameAt({ ring, phone, hero, c, swap, exits, previous });
        // whatever sits in the frame: at most one of its sleeves is more than
        // faintly solid, and their solidity never adds up past one
        const solid = f.framed.map((m) => 1 - f.dissolve.get(m)!);
        expect(solid.filter((s) => s > 0.5).length).toBeLessThanOrEqual(1);
        expect(solid.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.05);
        // the open state holds: the frame is full, the belt behind dispersed
        expect(c.hero).toBe(1);
        for (const [m, d] of f.dissolve) if (!f.framed.includes(m)) expect(d).toBe(1);
        expect(inParticles(f).length).toBeLessThanOrEqual(phone ? BUDGET_PHONE : BUDGET_DESKTOP);
        pruneSwap(swap);
      };
      for (let t = 0; t < 0.25; t += 1 / 60) {
        tl.time(t);
        check();
      }
      tl.kill();
      hero = retarget(swap, c, hero, 2, cardRitual(2, hero, c, swap, exits, false).dissolve);
      tl = stepTimeline(c, spin, { phone }, swap);
      for (let t = 0; t <= tl.duration() + 0.02; t += 1 / 60) {
        tl.time(Math.min(t, tl.duration()));
        check();
      }
      tl.kill();
      pruneSwap(swap);
      // settled: only the new record, whole, in the frame
      const f = frameAt({ ring, phone, hero, c, swap, exits, previous });
      expect(f.framed).toEqual([2]);
      expect(f.dissolve.get(2)).toBe(0);
      expect(swap.outgoing).toEqual([]);
      // and a close from here gathers the belt round the new focus
      const close = closeTimeline(c, swap);
      close.progress(1);
      const after = frameAt({ ring, phone, hero, c, swap, exits, previous });
      for (const d of after.dissolve.values()) expect(d).toBe(0);
      expect(inParticles(after)).toEqual([]);
      close.kill();
    }
  });

  it("stepping straight back takes the leaving sleeve back from where it was", () => {
    const c = newChoreo();
    const swap = newSwap();
    openTimeline(c, { angle: 0, boost: 0 }, { phone: false }, swap).progress(1).kill();
    let hero = retarget(swap, c, 0, 1);
    swap.outgoing[0].v = 0.4;
    swap.incoming.v = 0.6;
    hero = retarget(swap, c, hero, 0);
    expect(hero).toBe(0);
    expect(swap.incoming.v).toBe(0.4);
    expect(swap.outgoing).toEqual([{ m: 1, v: 0.6 }]);
  });

  it("with nothing open the hero frame just moves", () => {
    const c = newChoreo();
    const swap = newSwap();
    expect(retarget(swap, c, 0, 3)).toBe(3);
    expect(swap.outgoing).toEqual([]);
    expect(swap.incoming.v).toBe(0);
  });
});

describe("interruptions", () => {
  const run = (tl: gsap.core.Timeline, upTo: number, frame: () => void) => {
    for (let t = 0; t <= upTo; t += 1 / 60) {
      tl.time(t);
      frame();
    }
  };

  it("close during open, open during close and a step during open all end with every slot released", () => {
    const ring = 10;
    const phone = false;
    const c = newChoreo();
    const swap = newSwap();
    const exits = planExit(ring, phone);
    const previous = new Set<string>();
    const spin = { angle: 0, boost: 0 };
    let hero = 0;
    let closing = false;
    const frame = () => {
      const f = frameAt({ ring, phone, hero, c, swap, exits, previous, closing });
      expect(inParticles(f).length).toBeLessThanOrEqual(BUDGET_DESKTOP);
      pruneSwap(swap);
      return f;
    };
    const handBack = vi.fn();
    // open, cut by a close, cut by a reopen, cut by a step, then a full close
    let tl = openTimeline(c, spin, { phone }, swap);
    run(tl, 0.35, frame);
    const before = { ...c };
    tl.kill();
    closing = true;
    tl = closeTimeline(c, swap, handBack);
    tl.time(0);
    // it carries on from where the open was, no jump
    for (const k of ["exit", "hero", "tuck", "slide"] as const) expect(Math.abs(c[k] - before[k])).toBeLessThan(0.02);
    run(tl, 0.3, frame);
    tl.kill();
    closing = false;
    tl = openTimeline(c, spin, { phone }, swap);
    run(tl, 0.3, frame);
    tl.kill();
    hero = retarget(swap, c, hero, 1, cardRitual(1, hero, c, swap, exits, false).dissolve);
    tl = stepTimeline(c, spin, { phone }, swap);
    run(tl, 0.2, frame);
    tl.kill();
    closing = true;
    tl = closeTimeline(c, swap, handBack);
    tl.progress(1);
    tl.kill();
    // only the last close handed back
    expect(handBack).toHaveBeenCalledTimes(1);
    pruneSwap(swap);
    const end = frame();
    expect(inParticles(end)).toEqual([]);
    expect(previous.size).toBe(0);
    for (const d of end.dissolve.values()) expect(d).toBe(0);
    expect(swap.outgoing).toEqual([]);
  });

  it("an operator hide's in-place dissolve takes a slot ahead of the ritual's exits", () => {
    const cands: Candidate[] = [1, -1, 2, -2].map((k, i) => ({ key: `c${k}`, dissolve: 0.5, kind: "request", weight: 2 - i * 0.1 }));
    cands.push({ key: "g0", dissolve: 0.3, kind: "hide", weight: 1 });
    const plan = planParticles(cands, { phone: false, reduced: false, fast: false, previous: new Set(["c1", "c-1", "c2", "c-2"]) });
    expect(plan.get("g0")).toBe("particles");
    // the farthest exit gives way
    expect(plan.get("c-2")).toBe("alpha");
    expect(plan.get("c1")).toBe("particles");
  });
});

describe("reduced motion", () => {
  it("the open's exit, the close's gather and a step's swap are the alpha fade, never particles", () => {
    const c = newChoreo();
    const swap = newSwap();
    const exits = planExit(10, false);
    const previous = new Set<string>();
    const spin = { angle: 0, boost: 0 };
    const open = openTimeline(c, spin, { phone: false }, swap);
    for (let t = 0; t <= open.duration(); t += 1 / 30) {
      open.time(t);
      expect(inParticles(frameAt({ ring: 10, phone: false, hero: 0, c, swap, exits, previous, reduced: true }))).toEqual([]);
    }
    open.kill();
    const hero = retarget(swap, c, 0, 1);
    const step = stepTimeline(c, spin, { phone: false }, swap);
    step.time(0.3);
    const f = frameAt({ ring: 10, phone: false, hero, c, swap, exits, previous, reduced: true });
    expect(inParticles(f)).toEqual([]);
    expect([...f.renders.values()].some((r) => r === "alpha")).toBe(true);
    step.kill();
  });
});
