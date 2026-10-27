import { describe, expect, it } from "vitest";
import { advanceSpin, dampPhase, spinning, tumbleAt, TUMBLE_X, TUMBLE_Y, wheelItems, wheelSnap, WHEEL_PX_PER_ITEM } from "../src/scene/gallery-motion.ts";
import { closeTimeline, EXIT_SPAN, landing, local, newChoreo, openTimeline, stepTimeline } from "../src/scene/record-timeline.ts";

// The Gallery's motion rules without WebGL: one frame-rate-independent
// damping, wheel gestures that snap only once they settle, a spin clock that
// runs on time rather than frames, and open/close choreography that any
// timeline can take over mid-flight.

// runs `seconds` of frames at a given rate through a step function
function run<T>(x: T, seconds: number, fps: number, stepFn: (x: T, dt: number) => T): T {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) x = stepFn(x, 1 / fps);
  return x;
}

describe("phase damping", () => {
  it("reaches the same place at 30, 60 and 144 frames per second", () => {
    const at = (fps: number) => run(0, 0.5, fps, (p, dt) => dampPhase(p, 30, dt));
    expect(at(30)).toBeCloseTo(at(60), 6);
    expect(at(144)).toBeCloseTo(at(60), 6);
  });

  it("lands exactly on its target instead of creeping forever", () => {
    expect(run(0, 3, 60, (p, dt) => dampPhase(p, 2, dt))).toBe(2);
  });
});

describe("wheel", () => {
  it("passes small trackpad deltas through almost unchanged, so a glide is continuous", () => {
    const small = wheelItems({ deltaX: 0, deltaY: 4, deltaMode: 0 });
    expect(small).toBeCloseTo(4 / WHEEL_PX_PER_ITEM, 3);
    // twice the delta, (nearly) twice the turn: no hard clamp at small sizes
    expect(wheelItems({ deltaX: 0, deltaY: 40, deltaMode: 0 }) / wheelItems({ deltaX: 0, deltaY: 20, deltaMode: 0 })).toBeGreaterThan(1.95);
  });

  it("limits a huge jump softly, and reads line and page modes", () => {
    const huge = wheelItems({ deltaX: 0, deltaY: 5000, deltaMode: 0 });
    expect(huge).toBeLessThan(1);
    expect(wheelItems({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelItems({ deltaX: 0, deltaY: 96, deltaMode: 0 }), 6);
    expect(wheelItems({ deltaX: -30, deltaY: 2, deltaMode: 0 })).toBeLessThan(0);
  });

  it("a single mouse notch reaches the next record; a graze stays; a long glide rounds", () => {
    const notch = wheelItems({ deltaX: 0, deltaY: 100, deltaMode: 0 });
    expect(wheelSnap(4, 4 + notch)).toBe(5);
    expect(wheelSnap(4, 4 - notch)).toBe(3);
    expect(wheelSnap(4, 4.1)).toBe(4);
    expect(wheelSnap(4, 6.4)).toBe(6);
    expect(wheelSnap(4, 6.6)).toBe(7);
  });

  it("a fast trackpad flick, inertia tail included, crosses several records with no cap", () => {
    // a flick: a few strong frames, then the OS inertia tail decaying at 60 Hz
    let target = 4;
    let d = 90;
    while (d > 0.5) {
      target += wheelItems({ deltaX: 0, deltaY: d, deltaMode: 0 });
      d *= 0.95;
    }
    const landed = wheelSnap(4, target);
    expect(landed - 4).toBeGreaterThanOrEqual(4);
    // the same flick backwards lands as far the other way
    expect(wheelSnap(4, 4 - (target - 4))).toBe(4 - (landed - 4));
  });
});

describe("spin clock", () => {
  const idle = -0.24;
  it("idles at the same angular speed whatever the frame rate", () => {
    const at = (fps: number) => run({ angle: 0, boost: 0 }, 2, fps, (s, dt) => advanceSpin(s, dt, { idle, phaseVelocity: 0, gain: -1, response: 5 })).angle;
    expect(at(30)).toBeCloseTo(idle * 2, 6);
    expect(at(120)).toBeCloseTo(idle * 2, 6);
  });

  it("speeds up while the orbit turns and decays back to idle", () => {
    let s = { angle: 0, boost: 0 };
    s = run(s, 0.5, 60, (x, dt) => advanceSpin(x, dt, { idle, phaseVelocity: 2, gain: -1, response: 5 }));
    expect(s.boost).toBeLessThan(-1.5);
    s = run(s, 2, 60, (x, dt) => advanceSpin(x, dt, { idle, phaseVelocity: 0, gain: -1, response: 5 }));
    expect(Math.abs(s.boost)).toBeLessThan(0.002);
    // same boost history at a different frame rate: same angle
    const at = (fps: number) =>
      run(run({ angle: 0, boost: 0 }, 0.5, fps, (x, dt) => advanceSpin(x, dt, { idle, phaseVelocity: 2, gain: -1, response: 5 })), 0.5, fps, (x, dt) =>
        advanceSpin(x, dt, { idle, phaseVelocity: 0, gain: -1, response: 5 }),
      ).angle;
    expect(at(30)).toBeCloseTo(at(144), 4);
  });

  it("reduced motion (no idle) stops asking for frames once a boost has died", () => {
    expect(spinning({ angle: 1, boost: 0 }, 0)).toBe(false);
    expect(spinning({ angle: 1, boost: 0.2 }, 0)).toBe(true);
    expect(spinning({ angle: 1, boost: 0 }, idle)).toBe(true);
  });
});

describe("open and close choreography", () => {
  it("the other sleeves leave one after another, nearest first, and return nearest first", () => {
    const mid = 0.35;
    const out = [1, 2, 3, 4].map((r) => local(mid, r, 1));
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
    const back = [1, 2, 3, 4].map((r) => local(mid, r, -1));
    // on the way back (exit falling) the nearest has the least left to travel
    expect(back[0]).toBeLessThan(back[3]);
    expect(local(0, 3)).toBe(0);
    expect(local(1, 3)).toBe(1);
    expect(local(1, 3, -1)).toBe(1);
  });

  it("an open ends with everything forward and the record upright", () => {
    const c = newChoreo();
    const spin = { angle: -2.3, boost: 0.4 };
    const tl = openTimeline(c, spin, { phone: false });
    tl.progress(1);
    expect(c).toMatchObject({ exit: 1, hero: 1, tuck: 1, slide: 1, idle: 0 });
    expect(spin.angle % (Math.PI * 2)).toBeCloseTo(0, 6);
    expect(spin.angle).toBeLessThan(-2.3 - Math.PI * 2 + 1e-6);
    expect(spin.boost).toBe(0);
    expect(tl.duration()).toBeGreaterThan(EXIT_SPAN * 0.9);
    tl.kill();
  });

  it("on a phone the record slides out of the sleeve too (the stacked layout, 2026-10-27)", () => {
    const c = newChoreo();
    const tl = openTimeline(c, { angle: 0, boost: 0 }, { phone: true });
    tl.progress(1);
    expect(c.slide).toBe(1);
    expect(c.tuck).toBe(1);
    tl.kill();
  });

  it("a close started mid-open carries on from where the open was, without a jump", () => {
    const c = newChoreo();
    const spin = { angle: 0, boost: 0 };
    const open = openTimeline(c, spin, { phone: false });
    // part-way through the neighbours' exit
    open.time(EXIT_SPAN * 0.6);
    const at = { ...c };
    open.kill();
    const close = closeTimeline(c);
    close.progress(0.001);
    for (const k of ["exit", "hero", "tuck", "slide", "idle"] as const) expect(Math.abs(c[k] - at[k])).toBeLessThan(0.02);
    // an interrupted open keeps its stagger order on the way back
    expect(c.order).toBe(1);
    close.progress(1);
    expect(c).toMatchObject({ exit: 0, hero: 0, tuck: 0, slide: 0, idle: 1 });
    close.kill();
  });

  it("a finished open closes nearest-first, and a step finishes any open and lands upright", () => {
    const c = newChoreo();
    const spin = { angle: 0, boost: 0 };
    openTimeline(c, spin, { phone: false }).progress(1).kill();
    closeTimeline(c).progress(0.2).kill();
    expect(c.order).toBe(-1);
    const step = stepTimeline(c, spin, { phone: false });
    step.progress(1);
    expect(c).toMatchObject({ exit: 1, hero: 1, tuck: 1, slide: 1, idle: 0 });
    // upright: a whole number of turns (compared by turns, so a float
    // remainder just under a whole turn counts as upright)
    const turns = spin.angle / (Math.PI * 2);
    expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-6);
    step.kill();
  });

  it("lands on the next upright angle at least one turn on", () => {
    const TAU = Math.PI * 2;
    expect(landing(-0.5, 1)).toBeCloseTo(-2 * TAU, 9);
    expect(landing(-TAU, 1)).toBeCloseTo(-2 * TAU, 9);
  });
});

describe("the record's 3D tumble", () => {
  it("turns in space on more than its spindle, gently and continuously, and is still at weight 0", () => {
    let maxX = 0;
    let maxY = 0;
    let prev = tumbleAt(0);
    for (let t = 0; t < 120; t += 1 / 60) {
      const a = tumbleAt(t);
      maxX = Math.max(maxX, Math.abs(a.x));
      maxY = Math.max(maxY, Math.abs(a.y));
      // continuous: never a jump between frames
      expect(Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y) + Math.abs(a.z - prev.z)).toBeLessThan(0.02);
      prev = a;
    }
    // visibly tilts on x and y (±0.35–0.6 rad), never rolls over
    expect(maxX).toBeGreaterThan(0.34);
    expect(maxY).toBeGreaterThan(0.34);
    expect(Math.max(TUMBLE_X, TUMBLE_Y)).toBeLessThanOrEqual(0.6);
    expect(tumbleAt(37.2, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is blended out over the open's tuck and back in on the close", () => {
    const c = newChoreo();
    expect(c.tumble).toBe(1);
    const open = openTimeline(c, { angle: 0, boost: 0 }, { phone: false });
    open.time(0.5);
    expect(c.tumble).toBeGreaterThan(0);
    expect(c.tumble).toBeLessThan(1);
    open.progress(1).kill();
    expect(c.tumble).toBe(0);
    const close = closeTimeline(c);
    close.progress(1).kill();
    expect(c.tumble).toBe(1);
  });
});
