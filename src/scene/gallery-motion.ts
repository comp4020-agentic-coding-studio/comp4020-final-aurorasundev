// The Gallery's motion rules as pure functions, so the feel can be tested
// without WebGL and reused by any layout that turns records on one phase:
// one frame-rate-independent damping for the phase, wheel gestures that snap
// only after the wheel goes quiet, and the record's spin clock.

// Exponential approach: the same curve whatever the frame rate.
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

// The one damping layer: the shared phase eases toward its target. Poses are
// pure functions of the phase and the choreography's values, never damped
// again on their own.
export const PHASE_RATE = 9;
export function dampPhase(phase: number, target: number, dt: number, rate = PHASE_RATE): number {
  const next = damp(phase, target, rate, dt);
  return Math.abs(target - next) < 1e-4 ? target : next;
}

// --- wheel ------------------------------------------------------------------

// A gesture snaps once the wheel has been quiet this long, so a trackpad's
// inertia tail carries the turn instead of fighting a snap mid-glide.
export const WHEEL_QUIET_MS = 220;
// pixels of wheel per item
export const WHEEL_PX_PER_ITEM = 320;
// A soft limit instead of a hard per-event clamp: small trackpad deltas pass
// almost unchanged (continuous), a mouse notch still moves about a third of an
// item, and a page-sized jump cannot fling the ring.
const WHEEL_SOFT = 260;

export type WheelLike = { deltaX: number; deltaY: number; deltaMode: number };

// How many items one wheel event turns, signed.
export function wheelItems(e: WheelLike): number {
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
  const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
  return (WHEEL_SOFT * Math.tanh(d / WHEEL_SOFT)) / WHEEL_PX_PER_ITEM;
}

// Where a settled wheel gesture lands, from the whole item it began on. A
// deliberate nudge (one mouse notch) always reaches the next record; a long
// glide rounds to the nearest; a graze stays put.
export function wheelSnap(start: number, target: number): number {
  const moved = target - start;
  if (Math.abs(moved) < 0.15) return start;
  return start + Math.sign(moved) * Math.max(1, Math.round(Math.abs(moved)));
}

// --- the record's spin ----------------------------------------------------

export type Spin = { angle: number; boost: number };
export type SpinOptions = {
  // radians per second while nothing moves (0 under reduced motion)
  idle: number;
  // the phase's speed, items per second (signed)
  phaseVelocity: number;
  // radians per second added per item per second of phase motion
  gain: number;
  // how fast the boost follows the phase and decays back (1/s)
  response: number;
};

export const SPIN_IDLE = -(Math.PI * 2) / 26;
export const SPIN_GAIN = -(Math.PI * 2) / 6;
export const SPIN_RESPONSE = 5;

// Advances the spin clock by dt seconds. Time-based, so the record turns at
// the same speed at 30, 60 or 120 frames per second, and a turn of the orbit
// adds a boost that decays back to the idle speed.
export function advanceSpin(s: Spin, dt: number, o: SpinOptions): Spin {
  const want = o.phaseVelocity * o.gain;
  const boost = damp(s.boost, want, o.response, dt);
  // the boost's exact integral over the step, so long frames lose nothing
  const k = o.response > 0 ? (1 - Math.exp(-o.response * dt)) / o.response : dt;
  const angle = s.angle + o.idle * dt + want * dt + (s.boost - want) * k;
  return { angle: angle % (Math.PI * 2000), boost };
}

// Whether the spin still needs frames: idle turning, or a boost dying out.
export function spinning(s: Spin, idle: number): boolean {
  return idle !== 0 || Math.abs(s.boost) > 1e-3;
}
