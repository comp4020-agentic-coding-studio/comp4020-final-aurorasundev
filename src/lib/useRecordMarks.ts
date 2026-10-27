import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicArtifact } from "./gallery-api.ts";
import { firstVisit, markHeard, markOpened, MARKS_KEY, parseMarks, recordTag, unheard, type RecordMarks, type RecordTag } from "./record-marks.ts";

// The paper tags' memory, bridged to React (see record-marks.ts). Storage can
// be missing or throw (a private window, blocked site data); then the tags
// simply follow this page's own visit.

function read(): RecordMarks | null {
  try {
    return parseMarks(window.localStorage.getItem(MARKS_KEY));
  } catch {
    return null;
  }
}

function write(m: RecordMarks): void {
  try {
    window.localStorage.setItem(MARKS_KEY, JSON.stringify(m));
  } catch {
    // the tags still work for this visit
  }
}

export function useRecordMarks(items: PublicArtifact[], loaded: boolean) {
  const [marks, setMarks] = useState<RecordMarks | null>(read);
  const latest = useRef(marks);
  latest.current = marks;

  // the first visit settles once the first records are in
  useEffect(() => {
    if (marks || !loaded) return;
    const first = firstVisit(items);
    write(first);
    setMarks(first);
  }, [marks, loaded, items]);

  const update = useCallback((change: (m: RecordMarks) => RecordMarks) => {
    const now = latest.current;
    if (!now) return;
    const next = change(now);
    if (next === now) return;
    latest.current = next;
    write(next);
    setMarks(next);
  }, []);

  const opened = useCallback((id: string) => update((m) => (m.opened.includes(id) ? m : markOpened(m, id))), [update]);
  const heard = useCallback((id: string) => update((m) => (m.heard.includes(id) ? m : markHeard(m, id))), [update]);
  const tagFor = useCallback((a: PublicArtifact | null): RecordTag => (a && marks ? recordTag(a, marks) : null), [marks]);
  const notHeard = useCallback((a: PublicArtifact | null, hasSound: boolean) => !!a && !!marks && unheard(a.id, hasSound, marks), [marks]);

  return { tagFor, notHeard, opened, heard };
}
