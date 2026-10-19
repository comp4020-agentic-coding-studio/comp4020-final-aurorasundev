import { describe, expect, it } from "vitest";
import { beltCards, dissolveAt, tileStep, ZONE_DESKTOP, ZONE_PHONE } from "../src/scene/belt-layout.ts";
import {
  arrivalDissolve,
  BUDGET_DESKTOP,
  BUDGET_PHONE,
  CROSS_IN,
  CROSS_OUT,
  driftSign,
  fastTurn,
  FAST_OFF,
  FAST_ON,
  GRID_DESKTOP,
  GRID_PHONE,
  hideStart,
  meshAlpha,
  onScreen,
  particleAlpha,
  planParticles,
  POOL,
  RELEASE_FROM,
  zoneMode,
  type Candidate,
} from "../src/scene/particles-plan.ts";

// The particle dissolve's decisions without WebGL (design 2026-10-19 §4):
// who breaks into grain this frame, the budget and the fast-turn fallback,
// which way the grain goes, the crossfade with the mesh, replacement in the
// arriving zone, operator hides in place, and reduced motion.

const deg = (d: number) => (d * Math.PI) / 180;
const zone = (key: string, dissolve: number, weight = dissolve): Candidate => ({ key, dissolve, kind: "zone", weight });
const none = new Set<string>();
const base = { phone: false, reduced: false, fast: false, previous: none };
const particles = (m: Map<string, string>) => [...m].filter(([, r]) => r === "particles").map(([k]) => k);

describe("counts and budget", () => {
  it("draws about 64×64 points per card on desktop and 40×40 on a phone, with a pool for the larger budget", () => {
    expect(GRID_DESKTOP).toBe(64);
    expect(GRID_PHONE).toBe(40);
    expect(BUDGET_DESKTOP).toBe(4);
    expect(BUDGET_PHONE).toBe(3);
    expect(POOL).toBe(BUDGET_DESKTOP);
  });

  it("puts zone cards under way into particle form", () => {
    const m = planParticles([zone("a", 0.4), zone("b", 0)], base);
    expect(m.get("a")).toBe("particles");
    expect(m.get("b")).toBe("mesh");
  });

  it("never exceeds the budget: 4 on desktop, 3 on a phone, the rest alpha", () => {
    const cands = ["a", "b", "c", "d", "e", "f"].map((k, i) => zone(k, 0.2 + i * 0.1));
    const desk = planParticles(cands, base);
    expect(particles(desk)).toHaveLength(4);
    expect([...desk.values()].filter((r) => r === "alpha")).toHaveLength(2);
    const phone = planParticles(cands, { ...base, phone: true });
    expect(particles(phone)).toHaveLength(3);
  });

  it("keeps cards already in particle form ahead of newcomers, so none switches mid-dissolve", () => {
    const cands = ["a", "b", "c", "d", "e"].map((k) => zone(k, 0.5));
    const m = planParticles(cands, { ...base, phone: true, previous: new Set(["d", "e"]) });
    expect(m.get("d")).toBe("particles");
    expect(m.get("e")).toBe("particles");
    expect(particles(m)).toHaveLength(3);
  });

  it("gives an operator hide a particle slot before any zone card", () => {
    const cands = [zone("a", 0.5), zone("b", 0.5), zone("c", 0.5), { key: "h", dissolve: 0.3, kind: "hide" as const, weight: 0 }];
    const m = planParticles(cands, { ...base, phone: true, previous: new Set(["a", "b", "c"]) });
    expect(m.get("h")).toBe("particles");
    expect(particles(m)).toHaveLength(3);
  });
});

describe("fast turns", () => {
  it("switch to alpha above FAST_ON and back below FAST_OFF, with hysteresis between", () => {
    expect(FAST_OFF).toBeLessThan(FAST_ON);
    expect(fastTurn(FAST_ON + 1, false)).toBe(true);
    expect(fastTurn(FAST_ON - 1, false)).toBe(false);
    // between the two thresholds the last state holds
    const mid = (FAST_ON + FAST_OFF) / 2;
    expect(fastTurn(mid, true)).toBe(true);
    expect(fastTurn(mid, false)).toBe(false);
    expect(fastTurn(FAST_OFF - 1, true)).toBe(false);
    expect(fastTurn(-(FAST_ON + 1), false)).toBe(true);
  });

  it("a single damped arrow step stays under the threshold; a multi-card flick does not", () => {
    // the phase's damped approach peaks at rate × distance cards per second
    expect(9 * 1).toBeLessThan(FAST_ON);
    expect(9 * 3).toBeGreaterThan(FAST_ON);
  });

  it("send new zone cards to alpha during a fast turn, but let cards already in particles finish", () => {
    const m = planParticles([zone("new", 0.3), zone("old", 0.6)], { ...base, fast: true, previous: new Set(["old"]) });
    expect(m.get("new")).toBe("alpha");
    expect(m.get("old")).toBe("particles");
  });

  it("do not stop an operator hide from using particles", () => {
    const m = planParticles([{ key: "h", dissolve: 0.4, kind: "hide", weight: 0 }], { ...base, fast: true });
    expect(m.get("h")).toBe("particles");
  });
});

describe("leaving and arriving", () => {
  it("a card moving away from the front is leaving; one coming toward it is gathering", () => {
    expect(zoneMode(deg(85), deg(80))).toBe("leave");
    expect(zoneMode(deg(80), deg(85))).toBe("gather");
    expect(zoneMode(deg(-85), deg(-80))).toBe("leave");
    expect(zoneMode(deg(-80), deg(-85))).toBe("gather");
    // still: keeps what it was
    expect(zoneMode(deg(80), deg(80), "gather")).toBe("gather");
  });

  it("on a turn the leaving side and the arriving side are opposite", () => {
    // phase rising brings cards in from the right: θ falls for every card
    const step = tileStep(10);
    const right = deg(95);
    const left = -deg(85);
    expect(zoneMode(right - step * 0.1, right)).toBe("gather");
    expect(zoneMode(left - step * 0.1, left)).toBe("leave");
  });

  it("the grain always lies toward the back along the band, whichever way the card moves", () => {
    expect(driftSign(deg(80))).toBe(1);
    expect(driftSign(deg(-80))).toBe(-1);
    expect(driftSign(deg(100))).toBe(1);
    expect(driftSign(deg(-100))).toBe(-1);
  });
});

describe("the crossfade", () => {
  it("never draws the mesh and full-opacity particles at once", () => {
    for (let d = 0; d <= 1; d += 0.005) {
      const sum = particleAlpha(d) + meshAlpha(d, "particles");
      // both fully opaque together never happens
      expect(particleAlpha(d) > 0.99 && meshAlpha(d, "particles") > 0.99).toBe(false);
      // and the swap never drops the card out (no pop)
      expect(sum).toBeGreaterThan(0.95);
    }
    expect(CROSS_IN[0]).toBeGreaterThanOrEqual(0.03);
    expect(CROSS_OUT[1]).toBeLessThanOrEqual(0.16);
    // the grain holds the card's shape until the mesh has gone
    expect(RELEASE_FROM).toBeGreaterThanOrEqual(CROSS_OUT[1] - 0.01);
    expect(meshAlpha(0, "particles")).toBe(1);
    expect(meshAlpha(0.2, "particles")).toBe(0);
    expect(particleAlpha(0)).toBe(0);
  });

  it("alpha mode is the plain fade by dissolve", () => {
    expect(meshAlpha(0.3, "alpha")).toBeCloseTo(0.7, 9);
    expect(meshAlpha(0, "mesh")).toBe(1);
  });
});

describe("replacement", () => {
  it("a card changes record only out of sight, and the new record becomes visible only in the arriving zone", () => {
    for (const phone of [false, true]) {
      const ring = phone ? 6 : 10;
      const z = phone ? ZONE_PHONE : ZONE_DESKTOP;
      // turn slowly on past the wrap; a newly placed card's record
      const before = beltCards(0.99, ring, 48);
      const after = beltCards(1.01, ring, 48);
      const come = after.find((c) => !before.some((b) => b.m === c.m))!;
      expect(Math.abs(come.theta)).toBeGreaterThan(Math.PI * 0.99);
      // follow it round toward the front, never seen before
      let firstShown: number | null = null;
      for (let phase = 1.01; phase < 1.01 + ring / 2; phase += 0.01) {
        const theta = (come.m - phase) * tileStep(ring);
        const raw = phone && Math.cos(theta) <= 0 ? 1 : dissolveAt(theta, phone);
        const d = arrivalDissolve(theta, phone, raw, false);
        if (d < 0.999) {
          firstShown = Math.abs(theta);
          break;
        }
      }
      expect(firstShown).not.toBeNull();
      // it first shows inside the arriving zone, between the peak and the front edge
      expect(firstShown!).toBeLessThanOrEqual(z.peak + 1e-9);
      expect(firstShown!).toBeGreaterThanOrEqual(z.from);
    }
  });

  it("a card already on screen keeps the zone's own dissolve", () => {
    expect(arrivalDissolve(deg(100), false, dissolveAt(deg(100), false), true)).toBeCloseTo(dissolveAt(deg(100), false), 12);
    expect(arrivalDissolve(deg(100), false, dissolveAt(deg(100), false), false)).toBe(1);
  });

  it("a card is remembered once it shows and forgotten once it is gone", () => {
    expect(onScreen(1, 0.5)).toBe(true);
    expect(onScreen(1, 1)).toBe(false);
    expect(onScreen(0, 0)).toBe(false);
  });
});

describe("operator hides", () => {
  it("start in place from wherever the card is, already in grain form", () => {
    // a solid front card takes over at the release point: the mesh gone, the grain whole
    expect(hideStart(0)).toBe(RELEASE_FROM);
    expect(meshAlpha(hideStart(0), "particles")).toBe(0);
    expect(particleAlpha(hideStart(0))).toBe(1);
    // a card already part-dissolved keeps going from there
    expect(hideStart(0.6)).toBe(0.6);
  });

  it("dissolve in place with a particle slot, even at the front", () => {
    const m = planParticles([{ key: "front", dissolve: hideStart(0), kind: "hide", weight: 1 }], base);
    expect(m.get("front")).toBe("particles");
  });
});

describe("reduced motion", () => {
  it("uses the alpha fade only, never particles", () => {
    const cands: Candidate[] = [zone("a", 0.4), { key: "h", dissolve: 0.5, kind: "hide", weight: 0 }, { key: "r", dissolve: 0.5, kind: "request", weight: 0 }];
    const m = planParticles(cands, { ...base, reduced: true });
    expect(particles(m)).toHaveLength(0);
    expect(m.get("a")).toBe("alpha");
    expect(m.get("h")).toBe("alpha");
  });
});
