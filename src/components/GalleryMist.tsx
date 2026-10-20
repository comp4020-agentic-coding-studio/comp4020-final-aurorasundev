import { useEffect, useRef, type RefObject } from "react";
import { createMist, MIST_BEHIND, MIST_ENTRY, MIST_STILL, type Mist } from "../scene/mist.ts";

// The HTML host for the entry mist: mounts the isolated shader module once
// and publishes it through `mist` for whoever drives its level (the entry's
// transition). The canvas is a decorative veil over the title (it takes no
// pointer); a failure or a lost context leaves the stage plate and the plain
// title.

type Props = {
  mist: RefObject<Mist | null>;
  // live: drifting and parted by the pointer; still: one frame (reduced motion)
  still: boolean;
  // behind the exhibition from the start (no entry on this visit)
  behind: boolean;
  onLost: () => void;
};

export function GalleryMist({ mist, still, behind, onLost }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const lost = useRef(onLost);
  lost.current = onLost;

  useEffect(() => {
    if (!host.current) return;
    let made: Mist;
    try {
      made = createMist(host.current, { still, onLost: () => lost.current() });
    } catch {
      lost.current();
      return;
    }
    made.level.value = still ? MIST_STILL : behind ? MIST_BEHIND : MIST_ENTRY;
    made.setBackground(behind);
    made.touch();
    mist.current = made;
    return () => {
      made.dispose();
      mist.current = null;
    };
    // the mist lives for the page; its level moves through the published handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="gallery-mist" aria-hidden="true" />;
}
