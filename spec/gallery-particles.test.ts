import { describe, expect, it } from "vitest";
import { beltCards, dissolveAt, fitBelt, ringSize, tileStep, ZONE_DESKTOP, ZONE_PHONE } from "../src/scene/belt-layout.ts";
import {
  BUDGET_DESKTOP,
  BREAK_SECONDS,
  BUDGET_PHONE,
  easeDissolve,
  GATHER_BACK_SECONDS,
  HOLD_SECONDS,
  paced,
  CROSS_IN,
  CROSS_OUT,
  driftSign,
  fastTurn,
  FAST_OFF,
  FAST_ON,
  GRID_DESKTOP,
  GRID_PHONE,
  hideStart,
  HIDE_SECONDS,
  GATHER_SECONDS,
  meshAlpha,
  imageShown,
  particleAlpha,
  planParticles,
  POOL,
  RELEASE_FROM,
  RIM_BAND,
  RIM_PEAK,
  rimPulse,
  rimU,
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
  it("a card changes record only out of sight, and the new record's image first shows while it gathers in the arriving zone", () => {
    for (const phone of [false, true]) {
      const ring = phone ? 6 : 10;
      const z = phone ? ZONE_PHONE : ZONE_DESKTOP;
      const before = beltCards(0.99, ring, 48);
      const after = beltCards(1.01, ring, 48);
      const come = after.find((c) => !before.some((b) => b.m === c.m))!;
      // the swap itself is at the very back
      expect(Math.abs(come.theta)).toBeGreaterThan(Math.PI * 0.99);
      // follow the newcomer round toward the front
      let first: { theta: number; dissolve: number } | null = null;
      for (let phase = 1.01; phase < 1.01 + ring / 2; phase += 0.005) {
        const theta = (come.m - phase) * tileStep(ring);
        if (imageShown(theta, phone)) {
          first = { theta: Math.abs(theta), dissolve: dissolveAt(theta, phone) };
          break;
        }
      }
      expect(first).not.toBeNull();
      // inside the arriving zone, just in front of its peak...
      expect(first!.theta).toBeLessThan(z.peak);
      expect(first!.theta).toBeGreaterThan(z.from);
      // ...where the card is still dispersed, so the image arrives by gathering
      expect(first!.dissolve).toBeGreaterThan(0.95);
    }
  });

  it("the image never shows beyond the peak, so the far half and the swap stay blank stock", () => {
    expect(imageShown(0, false)).toBe(true);
    expect(imageShown(deg(85), false)).toBe(true);
    expect(imageShown(deg(95), false)).toBe(false);
    expect(imageShown(deg(-120), false)).toBe(false);
    expect(imageShown(Math.PI, true)).toBe(false);
    // the switch point is where the zone is fully dispersed
    expect(dissolveAt(deg(90), false)).toBe(1);
    expect(dissolveAt(deg(90), true)).toBe(1);
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

  it("take about a second and a half, with the record that shifts into the place gathering a little faster", () => {
    expect(HIDE_SECONDS).toBeGreaterThanOrEqual(1);
    expect(HIDE_SECONDS).toBeLessThanOrEqual(2);
    expect(GATHER_SECONDS).toBeLessThanOrEqual(HIDE_SECONDS);
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

describe("the record's rim (revision two)", () => {
  // the band the scene fits into, as gallery.css lays it out (header and
  // foot taken off), close enough for the composition's proportions
  const fits = {
    "1920x1080": fitBelt({ w: 1920, h: 1080, bandTop: 104, bandH: 1080 - 104 - 150 }),
    "1366x768": fitBelt({ w: 1366, h: 768, bandTop: 104, bandH: 768 - 104 - 150 }),
    "390x844": fitBelt({ w: 390, h: 844, bandTop: 88, bandH: 844 - 88 - 190 }),
    "844x390": fitBelt({ w: 844, h: 390, bandTop: 50, bandH: 390 - 50 - 70 }),
  };

  it("a card crossing the record's edge pulses to about 0.6-0.8 and back, never disappearing", () => {
    expect(RIM_PEAK).toBeGreaterThanOrEqual(0.6);
    expect(RIM_PEAK).toBeLessThanOrEqual(0.8);
    expect(rimPulse(1, 0.3, true)).toBeCloseTo(RIM_PEAK, 9);
    expect(rimPulse(1 + RIM_BAND, 0.3, true)).toBe(0);
    expect(rimPulse(1 - RIM_BAND, 0.3, true)).toBe(0);
    for (let u = 0; u <= 3; u += 0.01) expect(rimPulse(u, 0.3, true)).toBeLessThanOrEqual(RIM_PEAK + 1e-9);
  });

  for (const [name, fit] of Object.entries(fits)) {
    it(`${name}: turning one step, each card that crosses the rim rises and falls once, entering and again leaving; at rest no card is mid-pulse`, () => {
      const ring = ringSize(fit.phone, 18);
      const step = tileStep(ring);
      // at every rest pose every card is clear of the band
      for (const bc of beltCards(0, ring, 18)) expect(rimPulse(rimU(bc.theta, fit), bc.theta, true), `rest θ=${bc.theta.toFixed(2)}`).toBe(0);
      // a step: the front card leaves the record (one pulse), the next comes in (one pulse)
      const pulses = (theta0: number) => {
        let rises = 0;
        let up = false;
        let peak = 0;
        let prev = 0;
        for (let t = 0; t <= 1.0001; t += 0.002) {
          const theta = theta0 - t * step;
          const v = rimPulse(rimU(theta, fit), theta, true);
          if (v > prev + 1e-9 && !up) {
            up = true;
            rises++;
          }
          if (v < prev - 1e-9) up = false;
          peak = Math.max(peak, v);
          prev = v;
        }
        return { rises, peak, end: prev };
      };
      const leaving = pulses(0);
      expect(leaving.rises).toBe(1);
      expect(leaving.peak).toBeGreaterThan(RIM_PEAK * 0.95);
      expect(leaving.end).toBe(0);
      const entering = pulses(step);
      expect(entering.rises).toBe(1);
      expect(entering.end).toBe(0);
    });
  }

  it("is a zone candidate: it respects the budget and the fast-turn fallback", () => {
    // four cards mid-pulse plus a zone card at the sides on a phone: only three in grain
    const cands = ["a", "b", "c", "d"].map((k) => zone(k, RIM_PEAK));
    expect(particles(planParticles(cands, { ...base, phone: true }))).toHaveLength(3);
    // a fast turn sends a new pulse to the alpha fade
    expect(planParticles([zone("a", 0.4)], { ...base, fast: true }).get("a")).toBe("alpha");
  });

  it("never pulses under reduced motion, while a record is open, or on the far half", () => {
    expect(rimPulse(1, 0.3, false)).toBe(0);
    expect(rimPulse(1, Math.PI - 0.3, true)).toBe(0);
    // and reduced motion plans alpha anyway
    expect(planParticles([zone("a", 0.5)], { ...base, reduced: true }).get("a")).toBe("alpha");
  });
});

describe("pace (owner, 2026-10-20: slower, so it can be seen)", () => {
  // a rim crossing during one arrow step: the target rises to the peak and
  // back within ~0.15 s, as the card passes
  const target = (t: number) => (t < 0.15 ? RIM_PEAK * Math.sin((Math.PI * t) / 0.15) : 0);
  const run = (fps: number, seconds: number) => {
    const dt = 1 / fps;
    let p = paced();
    let peak = 0;
    let visible = 0;
    for (let t = 0; t < seconds; t += dt) {
      p = easeDissolve(p, target(t), dt);
      peak = Math.max(peak, p.shown);
      if (p.shown > 0.08) visible += dt;
    }
    return { shown: p.shown, peak, visible };
  };

  it("turns a quick crossing into a break-up, a hold and a slow re-forming that can be seen", () => {
    const r = run(60, 4);
    // it still breaks up nearly as far as the crossing asked
    expect(r.peak).toBeGreaterThan(RIM_PEAK * 0.85);
    // the grain is visible for over a second, not the 0.15 s of the crossing
    expect(r.visible).toBeGreaterThan(1);
    expect(r.visible).toBeLessThan(2.5);
    // and the card is whole again afterwards
    expect(r.shown).toBeLessThan(0.005);
  });

  it("gathers back more slowly than it breaks, holding first, at the same pace at any frame rate", () => {
    expect(GATHER_BACK_SECONDS).toBeGreaterThan(BREAK_SECONDS);
    expect(HOLD_SECONDS).toBeGreaterThan(0);
    const a = run(30, 3);
    const b = run(120, 3);
    expect(Math.abs(a.visible - b.visible)).toBeLessThan(0.08);
  });

  it("follows at once when asked (reduced motion, an open)", () => {
    expect(easeDissolve({ shown: 0.6, held: 0.6, hold: 0.2 }, 0, 1 / 60, true).shown).toBe(0);
  });
});
