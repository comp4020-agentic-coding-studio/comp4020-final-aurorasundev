import { describe, expect, it } from "vitest";
import { firstVisit, markHeard, markOpened, MARKS_CAP, parseMarks, recordTag, unheard } from "../src/lib/record-marks.ts";

// The paper tags' memory: one browser's own list of records met, never sent.

const a = (id: string, recent = false) => (recent ? { id, recent: true as const } : { id });

describe("paper tags", () => {
  it("a first visit knows what's in view, except what arrived recently", () => {
    const m = firstVisit([a("x"), a("y", true)]);
    expect(recordTag(a("x"), m)).toBeNull();
    expect(recordTag(a("y", true), m)).toBe("Arrived recently");
    // a record that arrives later is new to this browser
    expect(recordTag(a("z"), m)).toBe("New to you");
  });

  it("opening a record clears its tag; recent wins over new", () => {
    let m = firstVisit([]);
    expect(recordTag(a("z", true), m)).toBe("Arrived recently");
    m = markOpened(m, "z");
    expect(recordTag(a("z", true), m)).toBeNull();
    expect(recordTag(a("z"), m)).toBeNull();
  });

  it("not heard yet only while there is sound this browser hasn't played", () => {
    let m = firstVisit([]);
    expect(unheard("r", true, m)).toBe(true);
    expect(unheard("r", false, m)).toBe(false);
    m = markHeard(m, "r");
    expect(unheard("r", true, m)).toBe(false);
  });

  it("reads storage strictly and stays small", () => {
    expect(parseMarks(null)).toBeNull();
    expect(parseMarks("not json")).toEqual({ known: [], opened: [], heard: [] });
    expect(parseMarks('{"known":["a",3,null],"opened":"x"}')).toEqual({ known: ["a"], opened: [], heard: [] });
    let m = firstVisit([]);
    for (let i = 0; i < MARKS_CAP + 10; i++) m = markOpened(m, `id${i}`);
    expect(m.opened).toHaveLength(MARKS_CAP);
    expect(m.opened.at(-1)).toBe(`id${MARKS_CAP + 9}`);
  });
});
