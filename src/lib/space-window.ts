// How many papers the space shows at once, from the viewport's CSS size only.
// The references keep generous negative space, so the window grows slowly
// with area (with its square root): about 8 on a 1280×800 laptop, 11 on a
// 1920×1080 screen, 5 on a phone. It depends on nothing else: not on the
// pixel ratio, touch support, pointer type or user agent, so DevTools'
// device emulation or a touch laptop sees what an ordinary window of the
// same size sees. It is a rendering budget, not the whole space.

export const MIN_WINDOW = 5;
export const MAX_WINDOW = 12;
const REFERENCE_AREA = 1280 * 800;
const REFERENCE_WINDOW = 8;
/** At or under this width the stage is a phone's: the smallest window. */
export const PHONE_WIDTH = 600;

export function visibleLimit(width: number, height: number): number {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (w <= PHONE_WIDTH) return MIN_WINDOW;
  const n = Math.round(REFERENCE_WINDOW * Math.sqrt((w * h) / REFERENCE_AREA));
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, n));
}
