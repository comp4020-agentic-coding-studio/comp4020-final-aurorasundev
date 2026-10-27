import { describe, expect, it } from "vitest";
import {
  BACK_ALPHA,
  BAND_DROP,
  BELT_AY,
  CARD,
  CARD_BEFORE,
  PHONE_CARD_W,
  PHONE_CARD_W_BEFORE,
  backFade,
  beltCards,
  cardPlacement,
  DISC_OF_GLOBE,
  GLOBE_H,
  LABEL_OF_DISC,
  MERIDIAN_OPACITY,
  poleFade,
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
  toWorld,
  turnDir,
  beltVertical,
  horizontalFit,
  PHONE_MAX_W,
  VERTICAL_SHRINK,
  VERT_CARD_W,
} from "../src/scene/belt-layout.ts";
import { RIM_BAND } from "../src/scene/particles-plan.ts";

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
    expect(left.y).toBeGreaterThan(beltPoint(0).y);
    expect(right.y).toBeLessThan(beltPoint(0).y);
    // the band's front rides on the equator, through the record's middle
    expect(BAND_DROP).toBeCloseTo(0, 6);
    expect(Math.abs(beltPoint(0).y)).toBeLessThan(1e-9);
    expect(beltPoint(Math.PI).y).toBeCloseTo(beltPoint(0).y, 12);
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
  // The vertical orbit (design §7e, 2026-10-27) replaces the horizontal phone
  // composition. The trigger is a pure rule of the viewport.
  it("turns vertical when the horizontal belt does not fit the width", () => {
    expect(beltVertical(390, 844)).toBe(true);
    expect(beltVertical(360, 740)).toBe(true);
    // a portrait tablet or slim window: the belt would shrink below 0.6
    expect(beltVertical(700, 1000)).toBe(true);
    expect(beltVertical(768, 1024)).toBe(true);
    // landscape phone, laptops, desktops, and squares that only shrink a little
    expect(beltVertical(844, 390)).toBe(false);
    expect(beltVertical(1366, 768)).toBe(false);
    expect(beltVertical(1920, 1080)).toBe(false);
    expect(beltVertical(1024, 768)).toBe(false);
    expect(beltVertical(1000, 1000)).toBe(false);
    // every phone width is vertical, whatever its height
    expect(beltVertical(PHONE_MAX_W, 400)).toBe(true);
    expect(horizontalFit(700, 1000)).toBeLessThan(VERTICAL_SHRINK);
    expect(horizontalFit(1000, 1000)).toBeGreaterThan(VERTICAL_SHRINK);
  });

  it("fitBelt follows the same rule, the narrow composition always with it", () => {
    for (const [w, h] of [[390, 844], [700, 1000], [844, 390], [1366, 768]] as const) {
      const f = fitBelt({ w, h, bandTop: 100, bandH: h * 0.7 });
      expect(f.vertical).toBe(beltVertical(w, h));
      expect(f.phone).toBe(f.vertical);
      if (f.vertical) expect(f.compact).toBe(false);
    }
  });

  it("toWorld turns belt space a quarter turn clockwise: azimuth 0 on the record, the next card below it", () => {
    const f = fitBelt({ w: 390, h: 844, bandTop: 88, bandH: 560 });
    const front = toWorld(f, beltPoint(0));
    expect(front.x).toBeCloseTo(f.cx, 9);
    expect(Math.abs(front.y - f.disc.y)).toBeLessThan(f.disc.r * 0.05);
    const next = toWorld(f, beltPoint(tileStep(RING_PHONE)));
    const prev = toWorld(f, beltPoint(-tileStep(RING_PHONE)));
    expect(next.y).toBeLessThan(front.y);
    expect(prev.y).toBeGreaterThan(front.y);
    // the S-curve's latitude now shows across the band, mirrored left/right
    expect(Math.sign(next.x - f.cx)).toBe(-Math.sign(prev.x - f.cx));
    // horizontal is unchanged
    const d = fitBelt({ w: 1366, h: 768, bandTop: 104, bandH: 540 });
    const p = beltPoint(0.7);
    expect(toWorld(d, p)).toEqual({ x: d.cx + p.x * d.S, y: d.cy + p.y * d.S });
    expect(turnDir(true, { x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
  });

  for (const v of [
    { w: 390, h: 844, bandTop: 88, bandH: 560 },
    { w: 360, h: 740, bandTop: 88, bandH: 470 },
    { w: 390, h: 480, bandTop: 88, bandH: 220 },
    { w: 700, h: 1000, bandTop: 104, bandH: 700 },
  ]) {
    it(`vertical ${v.w}x${v.h}: the band runs along the stage, the globe, record and front card inside the width, neighbours inside the band`, () => {
      const f = fitBelt(v);
      expect(f.vertical).toBe(true);
      const W = v.w * f.k;
      const css = (y: number) => v.h / 2 - y / f.k;
      const half = (v.bandH * f.k) / 2;
      // the globe's silhouettes (dissolve zones) sit inside the band, top and bottom
      const along = beltPoint(Math.PI / 2).x * f.S;
      expect(along).toBeLessThanOrEqual(half + 1e-9);
      expect(css(f.cy + along)).toBeGreaterThanOrEqual(v.bandTop - 1);
      expect(css(f.cy - along)).toBeLessThanOrEqual(v.bandTop + v.bandH + 1);
      // across: the globe, the front card and the record inside the width
      expect(BELT_AY * f.S).toBeLessThanOrEqual(W / 2);
      expect((f.card * f.S) / 2).toBeLessThanOrEqual(W / 2);
      expect(f.disc.r).toBeLessThanOrEqual(W / 2);
      // the front card is at most 0.44 of the width, and the record shows round it
      expect((f.card * f.S) / W).toBeLessThanOrEqual(VERT_CARD_W + 1e-9);
      expect(2 * f.disc.r).toBeGreaterThan(1.1 * f.card * f.S);
      // the resting neighbours' centres stay inside the band
      const n = beltPoint(tileStep(RING_PHONE)).x * f.S;
      expect(n).toBeLessThan(half * 0.94);
      // and outside the record's rim pulse (u in record radii along the band)
      expect(n / (f.disc.r * Math.cos(f.disc.tilt))).toBeGreaterThan(1 + RIM_BAND);
      // the front card is centred on the record
      expect(f.disc.x).toBe(f.cx);
      expect(f.disc.y).toBe(f.cy);
    });
  }

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
      const cardBottom = css(f.cy + beltPoint(0).y * f.S - (f.card / 2) * f.S);
      expect(cardBottom).toBeLessThanOrEqual(v.bandTop + v.bandH + 1);
      // the record's top stays below the band's top (the header)
      const discTop = css(f.disc.y + f.disc.r * Math.cos(f.disc.tilt));
      expect(discTop).toBeGreaterThanOrEqual(v.bandTop - 1);
    }
  });
});

// Desktop and short-landscape viewports the tests below sweep, and the phone.
const DESKTOPS = [
  { w: 1920, h: 1080, bandTop: 104, bandH: 830 },
  { w: 1366, h: 768, bandTop: 104, bandH: 540 },
  { w: 844, h: 390, bandTop: 50, bandH: 270 },
  { w: 932, h: 430, bandTop: 50, bandH: 310 },
];
const PHONES = [
  { w: 390, h: 844, bandTop: 88, bandH: 560 },
  { w: 360, h: 640, bandTop: 80, bandH: 380 },
];

describe("the composition's hierarchy: the record first, a thin band", () => {
  it("desktop: the record is about 70 % of the globe's height, on the globe's centre", () => {
    for (const v of DESKTOPS) {
      const f = fitBelt(v);
      const globeH = GLOBE_H * f.S;
      expect((2 * f.disc.r) / globeH).toBeCloseTo(DISC_OF_GLOBE, 6);
      expect(DISC_OF_GLOBE).toBeGreaterThanOrEqual(0.65);
      expect(DISC_OF_GLOBE).toBeLessThanOrEqual(0.75);
      expect(f.disc.x).toBeCloseTo(f.cx, 9);
      expect(f.disc.y).toBeCloseTo(f.cy, 9);
      // tilted back a little, less than before (0.52), so the label reads
      expect(f.disc.tilt).toBeGreaterThan(0.1);
      expect(f.disc.tilt).toBeLessThan(0.4);
    }
  });

  it("the globe leaves a margin above and below inside the stage", () => {
    for (const v of DESKTOPS) {
      const f = fitBelt(v);
      const band = v.bandH * f.k;
      const globeH = GLOBE_H * f.S * 1.01;
      expect(globeH).toBeLessThan(band * 0.95);
    }
  });

  it("cards are about 1.5× their earlier size (owner, 2026-10-20)", () => {
    expect(CARD / CARD_BEFORE).toBeCloseTo(1.5, 2);
    // the phone's is clamped a little short of 1.5× so its arc still fits
    expect(PHONE_CARD_W / PHONE_CARD_W_BEFORE).toBeGreaterThanOrEqual(1.3);
    expect(PHONE_CARD_W / PHONE_CARD_W_BEFORE).toBeLessThanOrEqual(1.5);
    for (const v of DESKTOPS) expect(fitBelt(v).card).toBe(CARD);
  });

  it("the band's centre line runs through the record's centre, and the front card covers it but not the whole record", () => {
    for (const v of [...DESKTOPS, ...PHONES]) {
      const f = fitBelt(v);
      const bandY = f.cy + beltPoint(0).y * f.S;
      expect(Math.abs(bandY - f.disc.y)).toBeLessThan(0.05 * f.disc.r);
      const front = f.card * f.S;
      // the record shows round the front card
      expect(front).toBeLessThan(0.9 * 2 * f.disc.r);
      // and the card covers the label's centre
      expect(front / 2).toBeGreaterThan(LABEL_OF_DISC * f.disc.r * 0.5);
    }
  });

  it("front-half cards render in front of the record (their depth is toward the camera from every point of the tilted disc)", () => {
    for (const v of [...DESKTOPS, ...PHONES]) {
      const f = fitBelt(v);
      const ring = ringSize(f.phone, 48);
      // the tilted disc's nearest point to the camera
      const discNear = f.disc.r * Math.sin(f.disc.tilt + 0.16);
      for (const c of beltCards(0, ring, 48)) {
        if (halfOf(c.theta) !== "front" || dissolveAt(c.theta, f.phone) > 0.5) continue;
        const at = cardPlacement(c.theta, f.phone);
        const x = f.cx + at.p.x * f.S;
        const half = (f.card * f.S * at.scale) / 2;
        // a card that overlaps the record on screen is nearer than it
        if (Math.abs(x - f.disc.x) - half < f.disc.r) expect(at.p.z * f.S).toBeGreaterThan(discNear);
      }
    }
  });

  it("at rest neighbouring front cards never overlap each other on screen", () => {
    for (const v of [...DESKTOPS, ...PHONES]) {
      const f = fitBelt(v);
      const ring = ringSize(f.phone, 48);
      // projected half-width of a card at θ: it turns to face out along the
      // flattened sphere, so its width foreshortens by its normal's angle
      const spans = beltCards(0, ring, 48)
        .filter((c) => halfOf(c.theta) === "front" && dissolveAt(c.theta, f.phone) < 0.5)
        .map((c) => {
          const at = cardPlacement(c.theta, f.phone);
          const fr = cardFrame(c.theta);
          const half = ((f.card * f.S * at.scale) / 2) * Math.abs(fr.right.x);
          const x = f.cx + at.p.x * f.S;
          return [x - half, x + half] as const;
        })
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
  });
});

describe("the far half", () => {
  it("has no rise: a far card sits on the band, exactly behind its near twin", () => {
    for (const t of [0.4, 1, 1.4, -0.7]) {
      const near = cardPlacement(t, false).p;
      const far = cardPlacement(Math.PI - t, false).p;
      expect(far.x).toBeCloseTo(near.x, 9);
      expect(far.y).toBeCloseTo(near.y, 9);
      expect(far.z).toBeCloseTo(-near.z, 9);
    }
  });

  it("is a faint, dimmed, smaller silhouette near the sides, gone toward the very back", () => {
    for (const t of [1.7, 2, -1.8]) {
      const at = cardPlacement(t, false);
      expect(at.fade).toBeGreaterThan(0);
      expect(at.fade).toBeLessThanOrEqual(BACK_ALPHA);
      expect(BACK_ALPHA).toBeLessThan(0.5);
      expect(at.tone).toBeLessThan(0.8);
      expect(at.scale).toBeLessThan(cardPlacement(Math.PI - t, false).scale);
    }
    expect(backFade(Math.PI)).toBe(0);
    expect(backFade(2.6)).toBe(0);
    // and continuous where it fades out
    expect(backFade(Math.PI / 2 + 0.01)).toBeGreaterThan(backFade(2));
    // hidden on a phone
    expect(cardPlacement(2, true).fade).toBe(0);
  });
});

describe("the globe recedes", () => {
  it("draws its lines at about 0.35, fading out toward the poles", () => {
    expect(MERIDIAN_OPACITY).toBeGreaterThan(0.25);
    expect(MERIDIAN_OPACITY).toBeLessThanOrEqual(0.4);
    // pole: 0 at a pole, 1 at the equator
    expect(poleFade(0)).toBe(0);
    expect(poleFade(1)).toBe(1);
    expect(poleFade(0.05)).toBeLessThan(0.1);
    expect(poleFade(0.5)).toBe(1);
    let prev = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      const v = poleFade(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
