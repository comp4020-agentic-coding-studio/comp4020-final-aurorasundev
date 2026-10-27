import { describe, expect, it } from "vitest";
import { envelope, impulse, limitPeak, midiToHz, PEAK_LIMIT, PRESETS } from "../src/lib/gallery-synth.ts";

// The renderer's pure parts (throwaway-synth-v1): bounded presets, envelopes
// that start and end silent, a reverb impulse fixed by the score's seed, and
// a limiter that attenuates loud output, never boosts quiet output, and
// refuses non-finite or silent renders. The audio graph itself needs a real
// browser and is not exercised here.

describe("throwaway-synth-v1", () => {
  it("has exactly the three server-owned timbres, with the designed filters and attacks", () => {
    expect(Object.keys(PRESETS).sort()).toEqual(["felt_piano", "soft_glass", "warm_pad"]);
    expect(PRESETS.felt_piano).toMatchObject({ attackS: 0.01, lowpassHz: 1800 });
    expect(PRESETS.soft_glass).toMatchObject({ attackS: 0.02, lowpassHz: 3500 });
    expect(PRESETS.warm_pad).toMatchObject({ attackS: 0.25, releaseS: 0.25, lowpassHz: 1600 });
    expect(PRESETS.warm_pad.partials).toHaveLength(2);
    expect(midiToHz(69)).toBe(440);
  });

  it("every envelope starts and ends at zero inside its note, with a bounded peak", () => {
    for (const preset of Object.values(PRESETS)) {
      for (const note of [
        { at_ms: 0, duration_ms: 120, midi: 60, velocity: 0.7 },
        { at_ms: 0, duration_ms: 2400, midi: 60, velocity: 0.12 },
      ]) {
        const points = envelope(note, preset);
        expect(points[0]).toEqual([0, 0]);
        expect(points.at(-1)).toEqual([note.duration_ms / 1000, 0]);
        for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0]);
        expect(Math.max(...points.map((p) => p[1]))).toBeLessThanOrEqual(0.7 * 0.4 + 1e-9);
      }
    }
  });

  it("the reverb impulse is fixed by the seed", () => {
    expect(impulse("deadbeef", 8000)).toEqual(impulse("deadbeef", 8000));
    expect(impulse("deadbeef", 8000)).not.toEqual(impulse("deadbeee", 8000));
    expect(impulse("deadbeef", 8000).every(Number.isFinite)).toBe(true);
  });

  it("attenuates output above the peak limit and leaves quiet output alone", () => {
    const loud = Float32Array.from([0, 1.4, -0.7]);
    limitPeak(loud);
    expect(Math.max(...loud.map(Math.abs))).toBeCloseTo(PEAK_LIMIT, 5);
    const quiet = Float32Array.from([0, 0.2, -0.1]);
    limitPeak(quiet);
    expect([...quiet]).toEqual([...Float32Array.from([0, 0.2, -0.1])]);
    expect(() => limitPeak(new Float32Array(10))).toThrow("render_silent");
    expect(() => limitPeak(Float32Array.from([0.1, Number.NaN]))).toThrow("render_not_finite");
  });
});
