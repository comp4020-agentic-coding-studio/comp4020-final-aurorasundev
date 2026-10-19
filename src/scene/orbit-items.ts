// The orbit's collection updates as pure logic, so the drag rules can be
// tested without WebGL.
//
// A removal (a hidden or retired record) applies at once, even under a
// pointer: its sleeve and label must not outlive the hide. Arrivals and
// reordering wait for the gesture to end, so the ring never moves under the
// pointer. Only the latest list is queued: an older one can never restore an
// id a later update removed.

export type OrbitItem = { id: string; image_url: string };

export type OrbitMerge = {
  // what the orbit shows now
  now: OrbitItem[];
  // what it applies when the gesture ends, if anything
  queued: OrbitItem[] | null;
};

export function mergeOrbitItems(current: OrbitItem[], next: OrbitItem[], dragging: boolean): OrbitMerge {
  if (!dragging) return { now: next, queued: null };
  const keep = new Set(next.map((i) => i.id));
  const now = current.filter((i) => keep.has(i.id));
  // the survivors in their current order; anything new or moved waits
  const settled = now.length === next.length && now.every((i, k) => i.id === next[k].id);
  return { now: now.length === current.length ? current : now, queued: settled ? null : next };
}

// Where the focus lands after the list changes: on the same id if it
// survived, otherwise on the nearest survivor at its old position. -1 for an
// empty collection.
export function nextFocusIndex(prev: OrbitItem[], prevIndex: number, now: OrbitItem[]): number {
  if (!now.length) return -1;
  const id = prevIndex >= 0 ? prev[prevIndex]?.id : undefined;
  const same = id ? now.findIndex((i) => i.id === id) : -1;
  if (same >= 0) return same;
  return Math.min(Math.max(prevIndex, 0), now.length - 1);
}
