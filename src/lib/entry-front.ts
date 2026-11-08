import type { PublicArtifact } from "./gallery-api.ts";

// Which records stand in the belt's front three places when the Gallery
// opens (owner, 2026-11-08): records this browser has not opened, recent ones
// first. Only the entry is arranged; turning, paging and live arrivals keep
// their own rules after it. Pure, so the choice is tested without a scene.
//
// The front three are the focused place and its two neighbours, so with
// fronts [a, b, c] the belt reads b · a · c from left to right, focus on a.

export const FRONT_SIZE = 3;

type Candidate = Pick<PublicArtifact, "id" | "recent">;

// The front choice, best first. Ties keep `pool` order (the server's id order),
// so nothing about arrival time is implied beyond the recent yes.
export function frontChoice<T extends Candidate>(pool: readonly T[], opened: ReadonlySet<string>): T[] {
  const rank = (a: T) => (opened.has(a.id) ? 2 : 0) + (a.recent ? 0 : 1);
  const seen = new Set<string>();
  const unique = pool.filter((a) => !seen.has(a.id) && seen.add(a.id));
  return unique
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .slice(0, FRONT_SIZE)
    .map((x) => x.a);
}

// Enough unopened records to fill the front, or nothing more to read.
export const frontSettled = (pool: readonly Candidate[], opened: ReadonlySet<string>, exhausted: boolean): boolean =>
  exhausted || pool.filter((a) => !opened.has(a.id)).length >= FRONT_SIZE;

// The window with the chosen fronts at indices 0, 1 and n-1 and everything
// else in its own order between them; ids that left the window are skipped.
export function withFront<T extends { id: string }>(items: readonly T[], front: readonly string[]): T[] {
  const byId = new Map(items.map((a) => [a.id, a]));
  const chosen = front.map((id) => byId.get(id)).filter((a): a is T => a !== undefined);
  if (!chosen.length) return [...items];
  const taken = new Set(chosen.map((a) => a.id));
  const rest = items.filter((a) => !taken.has(a.id));
  const [first, second, third] = chosen;
  const head = second ? [first, second] : [first];
  return third ? [...head, ...rest, third] : [...head, ...rest];
}

// After the entry, the window changes as before (pages, arrivals, hides) and
// the belt keeps the arrangement it already shows: ids still present keep
// their order in `shown`, a new id takes the place the window gives it,
// right after the id it follows there (or first, if it leads the window).
export function keepArrangement<T extends { id: string }>(shown: readonly { id: string }[], items: readonly T[]): T[] {
  const byId = new Map(items.map((a) => [a.id, a]));
  const order = shown.map((a) => a.id).filter((id) => byId.has(id));
  const placed = new Set(order);
  items.forEach((a, i) => {
    if (placed.has(a.id)) return;
    const after = i > 0 ? items[i - 1].id : null;
    const at = after === null ? 0 : order.indexOf(after) + 1;
    order.splice(at, 0, a.id);
    placed.add(a.id);
  });
  return order.map((id) => byId.get(id)!);
}
