import { describe, expect, it } from "vitest";
import { initialSpace, MAX_ENDED, spaceReducer, type Space, type SpaceAction } from "../src/lib/space.ts";

// The page's own bookkeeping for the order in which a creation reply and the
// stream's events can arrive (F2). No server needed.

const run = (...actions: SpaceAction[]): Space => actions.reduce(spaceReducer, initialSpace);
const ready: SpaceAction = {
  type: "snapshot",
  snapshot: { revision: 10, active_total: 3, window: [{ id: "a", version: 1 }], known: [] },
  limit: 8,
  reading: null,
};
const arrived = (id: string, revision: number, total: number, status?: string): SpaceAction => ({
  type: "arrived",
  id,
  status,
  revision,
  total,
  limit: 8,
  reading: null,
});

describe("a creation reply that arrives late", () => {
  it("does not bring back a paper the stream already said was destroyed", () => {
    const space = run(
      ready,
      { type: "counted", revision: 11, total: 4 }, // own creation echo
      { type: "removed", id: "mine", revision: 12, total: 3, reading: null }, // someone let it go
      arrived("mine", 11, 4), // the held reply finally lands
    );
    expect(space.ids).not.toContain("mine");
    expect(space.total).toBe(3);
    expect(space.revision).toBe(12);
  });

  it("does not admit a reply that itself says the paper is gone", () => {
    const space = run(ready, arrived("old", 13, 2, "destroyed"));
    expect(space.ids).not.toContain("old");
    expect(space.ended).toContain("old");
    expect(space.total).toBe(2);
  });

  it("still admits the page's own paper when its echo came first", () => {
    const space = run(ready, { type: "counted", revision: 11, total: 4 }, arrived("mine", 11, 4, "active"));
    expect(space.ids).toEqual(["a", "mine"]);
    expect(space.total).toBe(4);
  });

  it("never lets an older reply's total undo a newer one", () => {
    const space = run(ready, { type: "counted", revision: 15, total: 7 }, arrived("mine", 11, 4));
    expect(space.ids).toContain("mine");
    expect(space.total).toBe(7);
  });
});

describe("terminal facts from a snapshot or a sample", () => {
  it("keeps a snapshot's destroyed paper from being revived by a later sample", () => {
    const space = run(
      ready,
      {
        type: "snapshot",
        snapshot: { revision: 20, active_total: 2, window: [], known: [{ id: "gone", status: "quarantined", version: 3 }] },
        limit: 8,
        reading: null,
      },
      { type: "sampled", ids: ["gone", "b"], revision: 19, total: 3, limit: 8, reading: null, replace: true },
    );
    expect(space.ids).toEqual(["b"]);
    expect(space.total).toBe(2);
  });

  it("keeps the paper being read when exploring replaces the rest", () => {
    const space = run(ready, { type: "sampled", ids: ["b", "c"], revision: 11, total: 3, limit: 2, reading: "a", replace: true });
    expect(space.ids).toEqual(["a", "b"]);
  });

  it("stays put when a sample brings nothing new", () => {
    const space = run(ready, { type: "sampled", ids: [], revision: 11, total: 3, limit: 8, reading: null, replace: true });
    expect(space.ids).toEqual(["a"]);
  });

  it("bounds what it remembers about ended papers", () => {
    const removals = Array.from({ length: MAX_ENDED + 50 }, (_, i): SpaceAction => ({
      type: "removed",
      id: `p${i}`,
      revision: 11 + i,
      total: 0,
      reading: null,
    }));
    const space = run(ready, ...removals);
    expect(space.ended).toHaveLength(MAX_ENDED);
    expect(space.ended.at(-1)).toBe(`p${MAX_ENDED + 49}`);
  });
});
