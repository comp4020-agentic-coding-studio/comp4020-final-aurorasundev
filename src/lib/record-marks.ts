// What this browser remembers about the records it has met, for the small
// paper tags (owner, 2026-10-27): someone who just released a note may want
// to find what it left. It lives only in this browser's storage and never
// reaches the server; losing it only brings a tag back. A tag is never a
// count, an order or a way back to a paper.
//
// - "Arrived recently": the server says the record arrived in the last day,
//   and this browser has not opened it.
// - "New to you": not opened here and not already in view the first time
//   this browser visited (so a first visit doesn't tag everything).
// - "Not heard yet": on the opened record, while it has sound this browser
//   has not played.

export type RecordMarks = { known: string[]; opened: string[]; heard: string[] };
export type RecordTag = "Arrived recently" | "New to you" | null;

export const MARKS_KEY = "throwaway.gallery.marks.v1";
// each list keeps the most recent ids only, so storage stays small
export const MARKS_CAP = 400;

const empty = (): RecordMarks => ({ known: [], opened: [], heard: [] });
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MARKS_CAP) : []);

// Null when nothing was stored: this is the browser's first visit.
export function parseMarks(raw: string | null): RecordMarks | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof RecordMarks, unknown>>;
    return { known: ids(v?.known), opened: ids(v?.opened), heard: ids(v?.heard) };
  } catch {
    return empty();
  }
}

const add = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id].slice(-MARKS_CAP));

export const markOpened = (m: RecordMarks, id: string): RecordMarks => ({ ...m, known: add(m.known, id), opened: add(m.opened, id) });
export const markHeard = (m: RecordMarks, id: string): RecordMarks => ({ ...m, heard: add(m.heard, id) });

// The first visit: what is already in view is known, except records that
// arrived recently, which keep their tag until opened.
export function firstVisit(items: { id: string; recent?: true }[]): RecordMarks {
  return { ...empty(), known: items.filter((a) => !a.recent).map((a) => a.id).slice(-MARKS_CAP) };
}

export function recordTag(a: { id: string; recent?: true }, m: RecordMarks): RecordTag {
  if (m.opened.includes(a.id)) return null;
  if (a.recent) return "Arrived recently";
  return m.known.includes(a.id) ? null : "New to you";
}

export const unheard = (id: string, hasSound: boolean, m: RecordMarks): boolean => hasSound && !m.heard.includes(id);
