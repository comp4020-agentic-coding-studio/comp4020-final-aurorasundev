// How many papers the space shows at once, from the viewport's CSS size only.
// It grows with the square root of the area. A phone keeps five and a narrow
// window up to 800px stays near the references' generous negative space;
// wider than that the space reads busier (owner, 2026-10-27: a fuller stage
// shows the space is in use): about 18 on a 1280×800 laptop, 25 on a
// 1920×1080 screen and above. It depends on nothing else: not on the pixel
// ratio, touch support, pointer type or user agent, so DevTools' device
// emulation or a touch laptop sees what an ordinary window of the same size
// sees. It is a rendering budget, not the whole space.

export const MIN_WINDOW = 5;
export const MAX_WINDOW = 25;
/** At or under this width the stage is a phone's: the smallest window. */
export const PHONE_WIDTH = 600;
/** Above this width the fuller window applies. */
export const WIDE_WIDTH = 800;
const REFERENCE_AREA = 1280 * 800;
// up to WIDE_WIDTH: about 8 at the reference area, at most NARROW_MAX
const NARROW_SCALE = 8;
const NARROW_MAX = 12;
// wider: 25 from a 1920×1080 screen, never fewer than NARROW_MAX
const WIDE_SCALE = 17.5;

export function visibleLimit(width: number, height: number): number {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (w <= PHONE_WIDTH) return MIN_WINDOW;
  const area = Math.sqrt((w * h) / REFERENCE_AREA);
  if (w <= WIDE_WIDTH) return Math.min(NARROW_MAX, Math.max(MIN_WINDOW, Math.round(NARROW_SCALE * area)));
  return Math.min(MAX_WINDOW, Math.max(NARROW_MAX, Math.round(WIDE_SCALE * area)));
}
