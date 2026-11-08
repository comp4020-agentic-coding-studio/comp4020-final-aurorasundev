import { describe, expect, it } from "vitest";
import { FRONT_SIZE, frontChoice, frontSettled, keepArrangement, withFront } from "../src/lib/entry-front.ts";

// The Gallery's entry puts three records this browser has not opened, recent
// ones first, in the belt's front three places; after that the belt keeps its
// arrangement (owner, 2026-11-08).

const rec = (id: string, recent = false) => (recent ? { id, recent: true as const } : { id });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("which three come to the front", () => {
  it("prefers recent unopened, then unopened, then recent opened, then the rest", () => {
    const pool = [rec("a"), rec("b", true), rec("c"), rec("d", true), rec("e")];
    const opened = new Set(["a", "d"]);
    expect(ids(frontChoice(pool, opened))).toEqual(["b", "c", "e"]);
    expect(ids(frontChoice(pool, new Set(["b", "c", "e"])))).toEqual(["d", "a", "b"]);
  });

  it("keeps the server's order inside each group, so nothing is random", () => {
    const pool = [rec("m"), rec("k"), rec("z")];
    expect(ids(frontChoice(pool, new Set()))).toEqual(["m", "k", "z"]);
    expect(ids(frontChoice(pool, new Set()))).toEqual(ids(frontChoice(pool, new Set())));
  });

  it("counts a record listed twice once", () => {
    expect(ids(frontChoice([rec("a", true), rec("a"), rec("b")], new Set()))).toEqual(["a", "b"]);
  });

  it("is settled with three unopened records, or when there is nothing more to read", () => {
    const pool = [rec("a"), rec("b"), rec("c"), rec("d")];
    expect(frontSettled(pool, new Set(["a"]), false)).toBe(true);
    expect(frontSettled(pool, new Set(["a", "b"]), false)).toBe(false);
    expect(frontSettled(pool, new Set(["a", "b"]), true)).toBe(true);
    expect(FRONT_SIZE).toBe(3);
  });
});

describe("the belt's order", () => {
  it("puts the fronts in the focused place and its two neighbours", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((id) => rec(id));
    expect(ids(withFront(items, ["e", "c", "f"]))).toEqual(["e", "c", "a", "b", "d", "f"]);
  });

  it("skips a front that left the window and leaves a short window whole", () => {
    expect(ids(withFront([rec("a"), rec("b")], ["x", "b"]))).toEqual(["b", "a"]);
    expect(ids(withFront([rec("a")], []))).toEqual(["a"]);
  });

  it("after the entry, keeps what is shown and slots new records where the window puts them", () => {
    const shown = ["e", "c", "a", "b", "d", "f"].map((id) => rec(id));
    // a page appended g, h after f; a live arrival z led the window; d was hidden
    const window = ["z", "a", "b", "c", "e", "f", "g", "h"].map((id) => rec(id));
    expect(ids(keepArrangement(shown, window))).toEqual(["z", "e", "c", "a", "b", "f", "g", "h"]);
  });

  it("never changes an arrangement when the window brings nothing new", () => {
    const shown = ["e", "c", "a"].map((id) => rec(id));
    expect(ids(keepArrangement(shown, ["a", "c", "e"].map((id) => rec(id))))).toEqual(["e", "c", "a"]);
  });
});
