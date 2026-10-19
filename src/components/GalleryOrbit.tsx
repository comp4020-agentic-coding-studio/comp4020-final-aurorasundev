import type { gsap } from "gsap";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PublicArtifact } from "../lib/gallery-api.ts";
import { createGalleryOrbit, type GalleryOrbit as Scene, type OrbitFrame } from "../scene/gallery-orbit.ts";

// The HTML host for the record exhibition: mounts the isolated scene, feeds
// it the live collection by id and passes its settled focus back up. The
// canvas is decorative; every record is reachable by the page's own controls.

export type OrbitHandle = { step: (dir: 1 | -1) => void; focus: (id: string) => void };
type Props = {
  items: PublicArtifact[];
  open: boolean;
  frames: () => OrbitFrame | null;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  onLost: () => void;
  // the scene's open/close timelines report their ends; the HTML takes over
  // (or hands back) from these, never from a timer
  onArrive: () => void;
  onHandBack: () => void;
  // the opened record's HTML reveal, nested into the scene's open timeline
  reveal: () => gsap.core.Timeline | null;
};

export const GalleryOrbit = forwardRef<OrbitHandle, Props>(function GalleryOrbit({ items, open, frames, onFocus, onOpen, onLost, onArrive, onHandBack, reveal }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const handlers = useRef({ onFocus, onOpen, onLost, onArrive, onHandBack, reveal });
  handlers.current = { onFocus, onOpen, onLost, onArrive, onHandBack, reveal };

  useEffect(() => {
    const f = frames();
    if (!host.current || !f) return;
    let made: Scene | null = null;
    try {
      made = createGalleryOrbit(host.current, f, {
        onFocus: (id) => handlers.current.onFocus(id),
        onOpen: (id) => handlers.current.onOpen(id),
        onLost: () => handlers.current.onLost(),
        onArrive: () => handlers.current.onArrive(),
        onHandBack: () => handlers.current.onHandBack(),
        reveal: () => handlers.current.reveal(),
      });
    } catch {
      handlers.current.onLost();
      return;
    }
    scene.current = made;
    return () => {
      made.dispose();
      scene.current = null;
    };
    // the scene lives for the page; its inputs arrive through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scene.current?.setItems(items.map((a) => ({ id: a.id, image_url: a.image_url })));
  }, [items]);

  useEffect(() => {
    scene.current?.setOpen(open);
  }, [open]);

  useImperativeHandle(ref, () => ({
    step: (dir) => scene.current?.step(dir),
    focus: (id) => scene.current?.focus(id),
  }));

  return <div ref={host} className="gl-stage" />;
});
