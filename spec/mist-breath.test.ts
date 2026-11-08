import { expect, it } from "vitest";
import { breath, MIST_BREATH } from "../src/scene/mist.ts";

// The entry mist's density (owner, 2026-11-09): dense from the first frame,
// so someone who scrolls on at once still meets the cloud; it thins to let the
// title surface, then thickens again, on a cycle a third faster than 7 s. The
// same rule for every screen size.

it("starts dense, thins halfway through its cycle and is dense again at its end", () => {
  expect(breath(0)).toBe(1);
  expect(breath(MIST_BREATH / 2)).toBeCloseTo(0, 6);
  expect(breath(MIST_BREATH)).toBeCloseTo(1, 6);
  // never thickening first: it only falls over the first half
  for (let t = 0.1; t < MIST_BREATH / 2; t += 0.1) expect(breath(t)).toBeLessThan(breath(t - 0.1));
});

it("breathes a third faster than the first 7 s cycle", () => {
  expect(MIST_BREATH).toBeCloseTo((7 * 2) / 3, 0);
  expect(MIST_BREATH).toBeLessThan(5);
});
