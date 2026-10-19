// The record belt's geometry as pure functions (design 2026-10-19 §4, §7),
// so the composition can be tested without WebGL. Adapted from the structure
// of goodgrowth.com's globe (an orthographic view of a flattened sphere with a
// belt of cards on its equator, curved by a latitude shift); none of its
// assets are used.
//
// Units: "globe units", where the sphere's radius is GLOBE_R before its x/y
// flattening. The scene multiplies by the fitted scale S (world per unit).
// Azimuth θ: 0 faces the camera, positive turns to the right (+x), ±π is the
// back. The belt's phase counts cards: the card numbered m sits at
// θ = (m - phase) · TILE_STEP, so a higher phase brings cards in from the right.

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// --- the globe --------------------------------------------------------------
export const GLOBE_R = 2.4;
export const GLOBE_SX = 1.7;
export const GLOBE_SY = 0.905;
// the belt rides just outside the globe's lines
export const BELT_LIFT = 1.01;
export const MERIDIANS = 7;
export const MERIDIAN_STEP = Math.PI / MERIDIANS;
// each meridian ring's own turn about the vertical axis
export const meridianAngle = (i: number) => ((i + 0.5) / MERIDIANS) * Math.PI;
// the belt's semi-axes
export const BELT_AX = GLOBE_R * GLOBE_SX * BELT_LIFT;
export const BELT_AY = GLOBE_R * GLOBE_SY * BELT_LIFT;
export const BELT_AZ = GLOBE_R * BELT_LIFT;

// --- the visible ring ---------------------------------------------------------
// The ring shows this many cards; the 48-record window lies underneath and
// turns through it (gallery-state.ts). A smaller collection fills a smaller
// ring, so no record is ever shown twice at once.
export const RING_DESKTOP = 10;
export const RING_PHONE = 6;
export const PHONE_MAX_W = 600;
export const isPhone = (w: number) => w <= PHONE_MAX_W;
export const ringSize = (phone: boolean, n: number) => Math.max(0, Math.min(phone ? RING_PHONE : RING_DESKTOP, n));
export const tileStep = (ring: number) => TAU / Math.max(1, ring);

// The globe counter-rotates against the belt by a ratio snapped so that one
// card step turns the meridians by a whole number of meridian steps: the seven
// rings repeat every π/7, so every rest pose is the same composition.
export function globeSpin(ring: number): number {
  const tile = tileStep(ring);
  return (Math.max(1, Math.round((0.6 * tile) / MERIDIAN_STEP)) * MERIDIAN_STEP) / tile;
}
// the globe's turn for a belt phase: globe.rotation.y = -beltAngle · GLOBE_SPIN,
// where the belt's own angle is -phase · TILE_STEP
export const globeAngle = (phase: number, ring: number) => phase * tileStep(ring) * globeSpin(ring);

// --- the belt's curve --------------------------------------------------------
// A latitude shift, not a tilt: a gentle S from upper left to lower right,
// nearly flat at the front, at most LAT_MAX (0.2 rad, about 11.5°) at the sides.
export const LAT_AMP = 0.2;
export const lat = (theta: number) => {
  const s = Math.sin(theta);
  return LAT_AMP * (0.3 * s + 0.7 * s * s * s);
};
export const LAT_MAX = LAT_AMP;

export type Vec3 = { x: number; y: number; z: number };
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

// the belt's centre line at azimuth θ, in globe units (y up, z toward the camera)
export function beltPoint(theta: number): Vec3 {
  const polar = Math.PI / 2 + lat(theta);
  const r = Math.sin(polar);
  return { x: BELT_AX * r * Math.sin(theta), y: BELT_AY * Math.cos(polar), z: BELT_AZ * r * Math.cos(theta) };
}

// A card's frame on the belt: it faces outward along the surface normal, its
// right edge runs along the belt and its up is the cross of the two.
export type CardFrame = { p: Vec3; right: Vec3; up: Vec3; out: Vec3 };
export function cardFrame(theta: number): CardFrame {
  const p = beltPoint(theta);
  const out = norm({ x: p.x / (BELT_AX * BELT_AX), y: p.y / (BELT_AY * BELT_AY), z: p.z / (BELT_AZ * BELT_AZ) });
  const h = 1e-3;
  const a = beltPoint(theta - h);
  const b = beltPoint(theta + h);
  const along = norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
  const up = norm(cross(out, along));
  const right = cross(up, out);
  return { p, right, up, out };
}

// --- halves, depth and the dissolve zones ------------------------------------
// The front half faces the camera and takes input; the back half is behind the
// globe's front lines (and hidden on a phone).
export const wrapAngle = (theta: number) => {
  const a = mod(theta + Math.PI, TAU) - Math.PI;
  return a === -Math.PI ? Math.PI : a;
};
export type Half = "front" | "back";
export const halfOf = (theta: number): Half => (Math.cos(theta) > 0 ? "front" : "back");
// 1 facing the camera, 0 at the silhouette and on round to the back
export const frontness = (theta: number) => (Math.cos(theta) + 1) / 2;
// orthographic: no perspective, so depth is sold by size and tone
export const DEPTH_SHRINK = 0.4;
export const depthScale = (theta: number) => 1 - DEPTH_SHRINK + DEPTH_SHRINK * frontness(theta);
// how far round the back a card is, 0..1
export const backness = (theta: number) => Math.max(0, -Math.cos(theta));
// the back half dims and fades out toward the very back
export const backTone = (theta: number) => 1 - 0.45 * backness(theta);
export const backFade = (theta: number) => Math.pow(1 - backness(theta), 0.8);
// Orthographic views put the card at π - θ exactly behind the card at θ (same
// x, same latitude), so the far half would hide behind the near half. The far
// half rises a little toward the back, as if seen from slightly above; zero
// (and flat) at the silhouettes, so the near half and its curve are untouched.
export const BACK_RISE = 1.35;
export const backRise = (theta: number) => BACK_RISE * Math.sin((backness(theta) * Math.PI) / 2);

// A dissolve zone is where the belt rounds the globe's left or right
// silhouette: a card's dissolve rises from `from` to 1 at `peak` and falls
// back to 0 at `to` (|θ|, radians). On a phone the back half is hidden, so the
// zone ends at the silhouette, which sits on the screen's edge.
export type Zone = { side: -1 | 1; from: number; peak: number; to: number };
const deg = (d: number) => (d * Math.PI) / 180;
export const ZONE_DESKTOP = { from: deg(76), peak: deg(90), to: deg(104) };
export const ZONE_PHONE = { from: deg(64), peak: deg(90), to: deg(90) };
export function dissolveZones(phone: boolean): Zone[] {
  const z = phone ? ZONE_PHONE : ZONE_DESKTOP;
  return [
    { side: -1, from: -z.to, peak: -z.peak, to: -z.from },
    { side: 1, from: z.from, peak: z.peak, to: z.to },
  ];
}
export const inZone = (theta: number, phone: boolean) => {
  const a = Math.abs(wrapAngle(theta));
  const z = phone ? ZONE_PHONE : ZONE_DESKTOP;
  return a >= z.from && a <= z.to;
};
// A card's dissolve, 0 (whole) .. 1 (gone), from where it is on the belt.
// Step ③ turns this into particles; until then the scene fades by it.
export function dissolveAt(theta: number, phone: boolean): number {
  const a = Math.abs(wrapAngle(theta));
  const z = phone ? ZONE_PHONE : ZONE_DESKTOP;
  if (phone && a >= z.peak) return 1;
  if (a <= z.from || a >= z.to) return 0;
  return a <= z.peak ? smooth((a - z.from) / (z.peak - z.from)) : smooth((z.to - a) / (z.to - z.peak));
}
// whether a card shows at all at θ (the phone hides the back half)
export const shownAt = (theta: number, phone: boolean) => !(phone && halfOf(theta) === "back") && dissolveAt(theta, phone) < 0.999;

// --- slots and records --------------------------------------------------------
// The cards on the ring at a phase: card m sits at θ = (m - phase)·TILE_STEP
// and shows record m mod n, for the `ring` cards with m - phase in
// (-ring/2, ring/2]. The phase is unbounded, so turning on wraps through the
// whole window; with ring ≤ n no record is on the ring twice.
export type BeltCard = { m: number; index: number; theta: number };
export function beltCards(phase: number, ring: number, n: number): BeltCard[] {
  if (!n || !ring) return [];
  const step = tileStep(ring);
  const first = Math.floor(phase - ring / 2) + 1;
  const out: BeltCard[] = [];
  for (let m = first; m < first + ring; m++) out.push({ m, index: mod(m, n), theta: (m - phase) * step });
  return out;
}

// --- the phone's swipe --------------------------------------------------------
// A phone swipe ignores how far it travelled: it commits exactly one step from
// where the gesture began, in its direction, once it is clearly a swipe.
export const SWIPE_MIN_PX = 18;
export const SWIPE_MIN_SPEED = 300;
export function swipeTarget(start: number, dxPx: number, vxPxPerSec: number): number {
  if (Math.abs(dxPx) < SWIPE_MIN_PX && Math.abs(vxPxPerSec) < SWIPE_MIN_SPEED) return start;
  const dir = Math.abs(dxPx) >= SWIPE_MIN_PX ? Math.sign(dxPx) : Math.sign(vxPxPerSec);
  // a drag to the left brings the next card in from the right
  return start - dir;
}

// --- fitting the composition to the viewport ----------------------------------
// The orthographic camera's half-height is CAMERA_HALF world units.
export const CAMERA_HALF = 3;

export type FitInput = { w: number; h: number; bandTop: number; bandH: number };
export type Fit = {
  phone: boolean;
  compact: boolean;
  // world units per CSS pixel
  k: number;
  // the globe and belt's centre (world) and scale (world per globe unit)
  cx: number;
  cy: number;
  S: number;
  // the front card's edge, in globe units
  card: number;
  // the record: centre, radius and its tilt back (world)
  disc: { x: number; y: number; r: number; tilt: number };
};
// wider than a phone but this short: gallery.css's compact landscape layout
export const COMPACT_H = 540;
// the record above the belt, in globe units, so the front of the belt passes
// across its lower edge and the label stays clear
const DISC_Y = 1.3;
const DISC_R = 1.2;

export function fitBelt(i: FitInput): Fit {
  const phone = isPhone(i.w);
  const compact = !phone && i.h <= COMPACT_H;
  const k = (CAMERA_HALF * 2) / i.h;
  const W = i.w * k;
  const toY = (css: number) => (i.h / 2 - css) * k;
  const bandTop = toY(i.bandTop);
  const bandBottom = toY(i.bandTop + i.bandH);
  if (phone) {
    // the globe's silhouette on the screen's edges, the front card about 40 %
    // of the width, the record at about 40 % of the height
    const S = W / 2 / BELT_AX;
    const card = (0.4 * W) / S;
    const r = 0.3 * W;
    const tilt = 0.5;
    let discY = toY(i.h * 0.4);
    let cy = discY - r * Math.cos(tilt) * 1.05;
    // keep the front card inside the band, clear of the caption
    const low = cy - (card * S) / 2;
    if (low < bandBottom) {
      const lift = bandBottom - low;
      cy += lift;
      discY += lift;
    }
    return { phone, compact, k, cx: 0, cy, S, card, disc: { x: 0, y: discY, r, tilt } };
  }
  const tilt = compact ? 0.42 : 0.52;
  const card = compact ? 1.8 : 1.7;
  // the composition's extent in globe units: the belt's width, the globe's
  // bottom (or the front card's) and the record's top
  const halfX = BELT_AX + 0.2;
  const top = Math.max(BELT_AY, DISC_Y + DISC_R * Math.cos(tilt), BACK_RISE + 0.6 * card * (1 - DEPTH_SHRINK)) + 0.04;
  const bottom = Math.max(BELT_AY, card / 2 + LAT_MAX) + 0.04;
  const bandHeight = Math.max(bandTop - bandBottom, 0.5);
  const S = Math.min(((W / 2) * 0.96) / halfX, bandHeight / (top + bottom));
  const cy = (bandTop + bandBottom) / 2 + ((bottom - top) / 2) * S;
  return { phone, compact, k, cx: 0, cy, S, card, disc: { x: 0, y: cy + DISC_Y * S, r: DISC_R * S, tilt } };
}
