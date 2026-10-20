import { describe, expect, it } from "vitest";
import { mergeOrbitItems, nextFocusIndex, type OrbitItem } from "../src/scene/orbit-items.ts";

// The orbit's collection updates without WebGL: a hidden record leaves at
// once even mid-drag, arrivals wait for the gesture to end, and a queued
// older list can never bring a removed record back.

const item = (n: number): OrbitItem => ({ id: `r${n}`, image_url: `/api/gallery/r${n}/image` });
const list = (...ns: number[]) => ns.map(item);
const ids = (xs: OrbitItem[] | null) => xs?.map((x) => x.id) ?? null;

// The orbit's setItems/drag-end sequence over the pure merge.
function orbit(initial: OrbitItem[]) {
  let items = initial;
  let queued: OrbitItem[] | null = null;
  let dragging = false;
  return {
    get items() {
      return items;
    },
    get queued() {
      return queued;
    },
    press() {
      dragging = true;
    },
    set(next: OrbitItem[]) {
      const m = mergeOrbitItems(items, next, dragging);
      items = m.now;
      queued = m.queued;
    },
    release() {
      dragging = false;
      if (queued) {
        items = queued;
        queued = null;
      }
    },
  };
}

describe("orbit collection updates", () => {
  it("applies everything at once when no gesture is held", () => {
    expect(mergeOrbitItems(list(1, 2), list(3, 1), false)).toEqual({ now: list(3, 1), queued: null });
  });

  it("removes a hidden record immediately while the pointer is held", () => {
    const o = orbit(list(1, 2, 3));
    o.press();
    o.set(list(1, 3));
    expect(ids(o.items)).toEqual(["r1", "r3"]);
    expect(o.queued).toBeNull();
  });

  it("defers an arrival until the gesture ends, but still removes at once", () => {
    const o = orbit(list(1, 2, 3));
    o.press();
    o.set(list(9, 1, 3));
    expect(ids(o.items)).toEqual(["r1", "r3"]);
    expect(ids(o.queued)).toEqual(["r9", "r1", "r3"]);
    o.release();
    expect(ids(o.items)).toEqual(["r9", "r1", "r3"]);
  });

  it("a queued older list cannot restore a record hidden later in the same gesture", () => {
    const o = orbit(list(1, 2, 3));
    o.press();
    // an arrival is queued while 2 is still listed, then 2 is hidden
    o.set(list(9, 1, 2, 3));
    expect(ids(o.items)).toEqual(["r1", "r2", "r3"]);
    o.set(list(9, 1, 3));
    expect(ids(o.items)).toEqual(["r1", "r3"]);
    o.release();
    expect(ids(o.items)).toEqual(["r9", "r1", "r3"]);
    expect(ids(o.items)).not.toContain("r2");
  });

  it("an empty collection empties the orbit at once", () => {
    const o = orbit(list(1));
    o.press();
    o.set([]);
    expect(o.items).toEqual([]);
    o.release();
    expect(o.items).toEqual([]);
  });
});

describe("the focus after an update", () => {
  it("stays on a surviving id even when its index moves", () => {
    expect(nextFocusIndex(list(1, 2, 3), 2, list(1, 3))).toBe(1);
    expect(nextFocusIndex(list(1, 2, 3), 1, list(9, 1, 2, 3))).toBe(2);
  });

  it("hands a removed focus to the nearest survivor", () => {
    expect(nextFocusIndex(list(1, 2, 3), 1, list(1, 3))).toBe(1);
    expect(nextFocusIndex(list(1, 2, 3), 2, list(1, 2))).toBe(1);
  });

  it("is -1 for an empty collection", () => {
    expect(nextFocusIndex(list(1), 0, [])).toBe(-1);
  });
});
