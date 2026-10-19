import { describe, expect, it } from "vitest";
import {
  beltCards,
  beltPoint,
  cardFrame,
  depthScale,
  dissolveAt,
  dissolveZones,
  fitBelt,
  globeAngle,
  globeSpin,
  halfOf,
  inZone,
  lat,
  LAT_MAX,
  MERIDIAN_STEP,
  ringSize,
  RING_DESKTOP,
  RING_PHONE,
  shownAt,
  swipeTarget,
  tileStep,
} from "../src/scene/belt-layout.ts";

// The record belt's geometry without WebGL (design 2026-10-19 §4, §7): the
// latitude curve, the globe's snapped counter-rotation, front/back halves,
// the dissolve zones at the globe's silhouettes, and how the ring's cards map
// onto the 48-record window so turning on reaches every record.

const deg = (r: number) => (r * 180) / Math.PI;

describe("the belt's latitude curve", () => {
  it("is flat at the front and the back, and peaks at the sides at about 11°", () => {
    expect(lat(0)).toBe(0);
    expect(Math.abs(lat(Math.PI))).toBeLessThan(1e-12);
    expect(lat(Math.PI / 2)).toBeCloseTo(LAT_MAX, 12);
    let max = 0;
    for (let t = -Math.PI; t <= Math.PI; t += 0.001) max = Math.max(max, Math.abs(lat(t)));
    expect(max).toBeCloseTo(0.2, 6);
    expect(deg(max)).toBeGreaterThan(11);
    expect(deg(max)).toBeLessThan(11.6);
  });

  it("is nearly horizontal at the front and runs from upper left to lower right", () => {
    // slope at the front: 0.2·0.3 = 0.06 rad of latitude per radian of azimuth
    const h = 1e-4;
    expect(Math.abs((lat(h) - lat(-h)) / (2 * h))).toBeCloseTo(0.06, 4);
    // a positive latitude shift lowers the point (it turns past the equator)
    const left = beltPoint(-Math.PI / 2);
    const right = beltPoint(Math.PI / 2);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.y).toBeGreaterThan(0);
    expect(right.y).toBeLessThan(0);
    expect(beltPoint(0).y).toBeCloseTo(0, 12);
  });

  it("faces each card outward along the surface, with up perpendicular to the belt", () => {
    for (const t of [-2, -1, 0, 0.7, 1.5, 3]) {
      const f = cardFrame(t);
      const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
      expect(Math.abs(dot(f.out, f.up))).toBeLessThan(1e-9);
      expect(Math.abs(dot(f.out, f.right))).toBeLessThan(1e-9);
      expect(Math.abs(dot(f.up, f.right))).toBeLessThan(1e-9);
      // outward: away from the globe's centre
      expect(dot(f.out, f.p)).toBeGreaterThan(0);
      // up is up-ish everywhere on the band
      expect(f.up.y).toBeGreaterThan(0.9);
    }
    expect(cardFrame(0).out.z).toBeCloseTo(1, 9);
  });
});

describe("the globe's counter-rotation", () => {
  it("moves a whole number of meridian steps per card step, so every rest pose repeats", () => {
    for (const ring of [1, 2, 3, 6, 7, 10, 14]) {
      const perCard = tileStep(ring) * globeSpin(ring);
      const steps = perCard / MERIDIAN_STEP;
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
      // the seven rings look the same every π/7: any whole phase is one pose
      for (const phase of [1, 2, 5, -3, 17]) {
        const turn = globeAngle(phase, ring) / MERIDIAN_STEP;
        expect(Math.abs(turn - Math.round(turn))).toBeLessThan(1e-9);
      }
    }
  });

  it("stays close to the reference ratio of 0.6", () => {
    // the desktop ring: 10 cards; 0.6 · (2π/10) / (π/7) = 0.84 → 1 meridian step
    expect(globeSpin(10)).toBeCloseTo(MERIDIAN_STEP / tileStep(10), 12);
    expect(globeSpin(10)).toBeCloseTo(0.714, 3);
    // the phone ring: 6 cards; 0.6 · (2π/6) / (π/7) = 1.4 → 1 meridian step
    expect(globeSpin(RING_PHONE)).toBeCloseTo(MERIDIAN_STEP / tileStep(6), 12);
  });

  it("turns against the belt", () => {
    // the belt's angle is -phase·step; the globe turns the other way
    expect(globeAngle(1, 10)).toBeGreaterThan(0);
    expect(globeAngle(-1, 10)).toBeLessThan(0);
  });
});

describe("halves and depth", () => {
  it("classifies front and back by facing the camera", () => {
    expect(halfOf(0)).toBe("front");
    expect(halfOf(1.2)).toBe("front");
    expect(halfOf(-1.2)).toBe("front");
    expect(halfOf(Math.PI)).toBe("back");
    expect(halfOf(2)).toBe("back");
    expect(halfOf(-2)).toBe("back");
    expect(halfOf(Math.PI * 2)).toBe("front");
  });

  it("shrinks with depth, the front card largest", () => {
    expect(depthScale(0)).toBe(1);
    expect(depthScale(0.6)).toBeLessThan(1);
    expect(depthScale(Math.PI)).toBeLessThan(depthScale(Math.PI / 2));
  });

  it("hides the back half on a phone", () => {
    expect(shownAt(Math.PI, true)).toBe(false);
    expect(shownAt(Math.PI, false)).toBe(true);
    expect(shownAt(0, true)).toBe(true);
  });
});

describe("dissolve zones", () => {
  it("sit where the belt rounds the globe's left and right silhouettes", () => {
    for (const phone of [false, true]) {
      const zones = dissolveZones(phone);
      expect(zones.map((z) => z.side)).toEqual([-1, 1]);
      for (const z of zones) {
        expect(z.from).toBeLessThan(z.to);
        expect(Math.abs(z.peak)).toBeCloseTo(Math.PI / 2, 9);
        // an ordered range inside one side
        expect(Math.sign(z.from)).toBe(z.side);
        expect(Math.sign(z.to) === z.side || z.to === 0).toBe(true);
      }
    }
  });

  it("dissolve rises to 1 at the silhouette and is 0 at the front and back", () => {
    expect(dissolveAt(0, false)).toBe(0);
    expect(dissolveAt(Math.PI, false)).toBe(0);
    expect(dissolveAt(Math.PI / 2, false)).toBe(1);
    expect(dissolveAt(-Math.PI / 2, false)).toBe(1);
    const a = dissolveAt(1.4, false);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(inZone(1.4, false)).toBe(true);
    expect(inZone(0.3, false)).toBe(false);
    expect(inZone(Math.PI, false)).toBe(false);
    expect(inZone(-1.6, false)).toBe(true);
  });

  it("on a phone ends at the silhouette, on the screen's edges", () => {
    expect(dissolveAt(Math.PI / 2 + 0.01, true)).toBe(1);
    expect(dissolveAt(0.3, true)).toBe(0);
    expect(dissolveAt(1.3, true)).toBeGreaterThan(0);
  });

  it("is continuous through each zone", () => {
    for (const phone of [false, true]) {
      let prev = dissolveAt(0, phone);
      for (let t = 0; t <= (phone ? Math.PI / 2 - 0.001 : Math.PI); t += 0.002) {
        const d = dissolveAt(t, phone);
        expect(Math.abs(d - prev)).toBeLessThan(0.02);
        prev = d;
      }
    }
  });
});

describe("the ring and the window", () => {
  it("shows 10 cards on desktop and 6 on a phone, fewer for a small collection", () => {
    expect(RING_DESKTOP).toBe(10);
    expect(RING_PHONE).toBe(6);
    expect(ringSize(false, 48)).toBe(10);
    expect(ringSize(true, 48)).toBe(6);
    expect(ringSize(false, 4)).toBe(4);
    expect(ringSize(true, 0)).toBe(0);
  });

  it("puts the record at the phase in front, and never shows one record twice", () => {
    for (const [ring, n] of [
      [10, 48],
      [6, 48],
      [4, 4],
      [10, 11],
    ]) {
      for (const phase of [0, 3, 3.4, -7.6, 101]) {
        const cards = beltCards(phase, ring, n);
        expect(cards).toHaveLength(ring);
        expect(new Set(cards.map((c) => c.index)).size).toBe(ring);
        for (const c of cards) {
          expect(c.theta).toBeGreaterThan(-Math.PI - 1e-9);
          expect(c.theta).toBeLessThanOrEqual(Math.PI + 1e-9);
        }
      }
      const front = beltCards(5, ring, n).find((c) => Math.abs(c.theta) < 1e-9);
      expect(front?.index).toBe(5 % n);
    }
  });

  it("turning on past the end of the ring brings the next records in, through the whole window", () => {
    const n = 48;
    const seen = new Set<number>();
    for (let phase = 0; phase < n; phase++) {
      for (const c of beltCards(phase, 10, n)) seen.add(c.index);
      // the record in front at each rest
      expect(beltCards(phase, 10, n).find((c) => c.theta === 0)?.index).toBe(phase % n);
    }
    expect(seen.size).toBe(n);
    // and it wraps: one whole window later the same records are in front
    expect(beltCards(n + 2, 10, n).map((c) => c.index)).toEqual(beltCards(2, 10, n).map((c) => c.index));
    // backwards too
    expect(beltCards(-1, 10, n).find((c) => c.theta === 0)?.index).toBe(n - 1);
  });

  it("swaps a card's record only in the back, out of sight", () => {
    // the card leaving and the card arriving are both at the very back
    // (θ ≈ ±π), where a card is faded right out or, on a phone, hidden
    const before = beltCards(0.99, 10, 48);
    const after = beltCards(1.01, 10, 48);
    const gone = before.filter((c) => !after.some((a) => a.m === c.m));
    const come = after.filter((c) => !before.some((b) => b.m === c.m));
    expect(gone).toHaveLength(1);
    expect(come).toHaveLength(1);
    expect(Math.abs(gone[0].theta)).toBeGreaterThan(Math.PI * 0.99);
    expect(Math.abs(come[0].theta)).toBeGreaterThan(Math.PI * 0.99);
  });
});

describe("a phone swipe", () => {
  it("commits exactly one step from where it began, whatever its distance", () => {
    expect(swipeTarget(4, -40, 0)).toBe(5);
    expect(swipeTarget(4, -900, -3000)).toBe(5);
    expect(swipeTarget(4, 300, 0)).toBe(3);
    expect(swipeTarget(4, 5, 0)).toBe(4);
    // a short, fast flick still counts
    expect(swipeTarget(4, -8, -900)).toBe(5);
  });
});

describe("fitting the viewport", () => {
  it("phone: the band spans the width, the front card about 40 % of it, the record high", () => {
    const f = fitBelt({ w: 390, h: 844, bandTop: 88, bandH: 560 });
    expect(f.phone).toBe(true);
    const W = 390 * f.k;
    // the belt's silhouette reaches the screen's edges
    expect(Math.abs(beltPoint(Math.PI / 2).x * f.S - W / 2)).toBeLessThan(W * 0.01);
    expect((f.card * f.S) / W).toBeCloseTo(0.4, 2);
    // the record's centre in CSS px from the top
    const discCss = 844 / 2 - f.disc.y / f.k;
    expect(discCss / 844).toBeGreaterThan(0.3);
    expect(discCss / 844).toBeLessThan(0.45);
  });

  it("desktop and short landscape fit inside the band", () => {
    for (const v of [
      { w: 1920, h: 1080, bandTop: 104, bandH: 830 },
      { w: 1366, h: 768, bandTop: 104, bandH: 540 },
      { w: 844, h: 390, bandTop: 50, bandH: 270 },
      { w: 932, h: 430, bandTop: 50, bandH: 310 },
    ]) {
      const f = fitBelt(v);
      expect(f.phone).toBe(false);
      expect(f.compact).toBe(v.h <= 540);
      const W = v.w * f.k;
      expect(beltPoint(Math.PI / 2).x * f.S).toBeLessThan(W / 2);
      const css = (y: number) => v.h / 2 - y / f.k;
      // the front card's bottom stays above the band's bottom (the caption)
      const cardBottom = css(f.cy - (f.card / 2) * f.S);
      expect(cardBottom).toBeLessThanOrEqual(v.bandTop + v.bandH + 1);
      // the record's top stays below the band's top (the header)
      const discTop = css(f.disc.y + f.disc.r * Math.cos(f.disc.tilt));
      expect(discTop).toBeGreaterThanOrEqual(v.bandTop - 1);
    }
  });
});
