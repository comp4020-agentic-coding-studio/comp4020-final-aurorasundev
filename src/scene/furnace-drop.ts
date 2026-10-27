// Where the held paper may go while it is dragged over the furnace (B01/B05).
// Pure world-unit rules, shared by the scene (paper-scene.js) and the furnace
// (fire/furnace.js), so a paper can only travel inside the opening and a drop
// anywhere it can reach counts as inside. Never pixels: the furnace's radius
// is solved per viewport, so the clamp holds at every size.

/** The furnace's wall is a tenth of its radius (fire/furnace.js). */
export const FURNACE_WALL = 0.1;
/** The opening's inner radius as a share of the furnace's outer radius. */
export const FURNACE_INNER = 1 - FURNACE_WALL;
/** furnace.contains() accepts this share of the inner radius. */
export const OPENING_SHARE = 0.92;
/** The rim's height as a share of the radius (fire/furnace.js). */
export const FURNACE_HEIGHT = 0.64;

export type Furnace = {
  /** world x of the furnace's centre */
  anchorX: number;
  /** world z of the furnace's centre (the drag plane's depth) */
  anchorZ: number;
  /** world y of the rim's top */
  rimY: number;
  /** the furnace's outer radius, world units */
  radius: number;
};

/** How far from the centre the opening accepts a point (world units). */
export const openingRadius = (radius: number): number => radius * FURNACE_INNER * OPENING_SHARE;

/**
 * How far from the centre the held paper's centre may travel sideways: the
 * opening less the paper's own radius (so its side doesn't sink into the
 * rim), never under half the opening, and always strictly inside it.
 */
export function dropReach(radius: number, ballRadius: number): number {
  const opening = openingRadius(radius);
  return Math.max(opening - ballRadius, opening * 0.5) * 0.98;
}

/**
 * The dragged paper's target for a pointer's hit on the drag plane: sideways
 * it stays within the opening, its depth is the furnace's, and it rides just
 * above the rim rather than through it. Upward it is free.
 */
export function clampDropTarget(
  hit: { x: number; y: number },
  furnace: Furnace,
  ballRadius: number,
): { x: number; y: number; z: number } {
  const reach = dropReach(furnace.radius, ballRadius);
  const x = Math.min(Math.max(hit.x, furnace.anchorX - reach), furnace.anchorX + reach);
  const y = Math.max(hit.y, furnace.rimY + ballRadius * 0.3);
  return { x, y, z: furnace.anchorZ };
}

/**
 * The same test as furnace.contains() for an unscaled, unrotated furnace at
 * floor height `floorY`: inside the opening and between the hearth and half
 * a radius over the rim.
 */
export function insideOpening(point: { x: number; y: number; z: number }, furnace: Furnace, hearthY: number): boolean {
  const r = Math.hypot(point.x - furnace.anchorX, point.z - furnace.anchorZ);
  return r < openingRadius(furnace.radius) && point.y > hearthY && point.y < furnace.rimY + furnace.radius * 0.5;
}
