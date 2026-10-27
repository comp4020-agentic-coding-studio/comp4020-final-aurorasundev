import { describe, expect, it } from "vitest";
import { clampDropTarget, dropReach, FURNACE_HEIGHT, insideOpening, openingRadius, type Furnace } from "../src/scene/furnace-drop.ts";
import { MAX_WINDOW, MIN_WINDOW, visibleLimit } from "../src/lib/space-window.ts";

// The furnace's drop region (plan §5, B01/B05): while dragged, the paper can
// only travel inside the opening, so it never clips through the iron, and
// wherever it can be let go over the furnace counts as inside.
describe("furnace drop region", () => {
  // desktop and phone radii as ritualPlacement() solves them, in world units
  const furnaces: Furnace[] = [0.18, 0.32, 0.4, 0.55].map((radius) => ({
    anchorX: 0,
    anchorZ: 0.3,
    rimY: -0.1 + radius * FURNACE_HEIGHT,
    radius,
  }));
  const ball = 0.06;
  const hearthY = (f: Furnace) => -0.1 + f.radius * FURNACE_HEIGHT * 0.65;

  it("never lets the paper sideways past the opening, however far the pointer goes", () => {
    for (const f of furnaces) {
      for (const x of [-50, -2, -f.radius * 1.5, f.radius * 1.5, 2, 50]) {
        const t = clampDropTarget({ x, y: f.rimY + 0.05 }, f, ball);
        expect(Math.abs(t.x - f.anchorX)).toBeLessThan(openingRadius(f.radius));
        expect(Math.abs(t.x - f.anchorX)).toBeLessThanOrEqual(dropReach(f.radius, ball) + 1e-12);
      }
    }
  });

  it("keeps the paper at the furnace's depth and above the rim, never through it", () => {
    for (const f of furnaces) {
      const t = clampDropTarget({ x: 0, y: -10 }, f, ball);
      expect(t.z).toBe(f.anchorZ);
      expect(t.y).toBeGreaterThan(f.rimY);
    }
  });

  it("counts a drop at the clamped edge as inside the opening", () => {
    for (const f of furnaces) {
      for (const x of [-9, 9]) {
        const t = clampDropTarget({ x, y: f.rimY }, f, ball);
        expect(insideOpening(t, f, hearthY(f))).toBe(true);
      }
    }
  });

  it("follows the furnace: a moved or resized furnace moves the region with it", () => {
    const f: Furnace = { anchorX: 0.7, anchorZ: -0.2, rimY: 0.2, radius: 0.3 };
    const left = clampDropTarget({ x: -100, y: 0.3 }, f, ball);
    const right = clampDropTarget({ x: 100, y: 0.3 }, f, ball);
    expect(left.x).toBeCloseTo(0.7 - dropReach(0.3, ball));
    expect(right.x).toBeCloseTo(0.7 + dropReach(0.3, ball));
    const wider = { ...f, radius: 0.6 };
    expect(clampDropTarget({ x: 100, y: 0.3 }, wider, ball).x).toBeGreaterThan(right.x);
  });

  it("lets a pointer inside the opening place the paper exactly where it is", () => {
    const f = furnaces[2];
    expect(clampDropTarget({ x: 0.05, y: 0.4 }, f, ball)).toEqual({ x: 0.05, y: 0.4, z: f.anchorZ });
  });
});

// How many papers the space shows at once follows the viewport's CSS area,
// and nothing else: not DevTools' emulated pixel ratio, touch or "mobile".
describe("papers on screen", () => {
  it("grows with the viewport, never shrinking on a bigger screen", () => {
    const sizes: [number, number][] = [[390, 844], [800, 600], [1280, 720], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
    const counts = sizes.map(([w, h]) => visibleLimit(w, h));
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(visibleLimit(1920, 1080)).toBeGreaterThan(visibleLimit(1280, 800));
  });

  it("keeps a phone at five and a narrow window near the references", () => {
    expect(visibleLimit(390, 844)).toBe(5);
    expect(visibleLimit(600, 900)).toBe(5);
    expect(visibleLimit(800, 600)).toBeLessThanOrEqual(12);
  });

  it("fills a wide screen: 25 from 1920×1080 up, more than a dozen on any window over 800px", () => {
    expect(visibleLimit(1920, 1080)).toBe(MAX_WINDOW);
    expect(MAX_WINDOW).toBe(25);
    expect(visibleLimit(2560, 1440)).toBe(MAX_WINDOW);
    expect(visibleLimit(1280, 800)).toBeGreaterThan(12);
    expect(visibleLimit(801, 600)).toBeGreaterThanOrEqual(12);
  });

  it("stays within the server's sample bound", () => {
    for (const [w, h] of [[0, 0], [320, 480], [7680, 4320], [601, 200]]) {
      const n = visibleLimit(w, h);
      expect(n).toBeGreaterThanOrEqual(MIN_WINDOW);
      expect(n).toBeLessThanOrEqual(MAX_WINDOW);
    }
    // server/papers.ts MAX_SAMPLE and server/events.ts MAX_WINDOW are 32
    expect(MAX_WINDOW).toBeLessThanOrEqual(32);
  });

  it("depends only on CSS size: the same viewport gives the same count", () => {
    // the function takes no pixel ratio, pointer or touch input at all
    expect(visibleLimit.length).toBe(2);
  });
});
