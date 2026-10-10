import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { createPaperScene } from "../scene/vendor/paper-scene.js";

export type SheetRect = { left: number; top: number; width: number; height: number };
export type ExploreEdge = "left" | "right" | "back" | "front";

export type PaperFieldHandle = {
  openPaper: (id: string, onUnfolded: (rect: SheetRect | null) => void) => void;
  closePaper: () => void;
  burnOpenPaper: () => void;
  removeOpenPaper: () => void;
  setEntryEdge: (edge: ExploreEdge) => void;
  throwCreatedPaper: (id: string) => void;
  // the furnace ritual (plan §5); false from prepare means no scene to hold it
  prefetchFire: () => void;
  prepareRitual: (id: string) => boolean;
  placeRitual: () => void;
  returnRitual: () => void;
  igniteRitual: (burn: Burn) => void;
  burnRitualRemotely: (burn: Burn) => void;
  clearRitual: () => void;
  cancelRitual: () => void;
  endRitual: () => void;
  burnRemote: (id: string, burn: Burn) => boolean;
};

export type Burn = { seed: number; durationMs: number };
export type RitualEvent = { type: "ready" | "dropped" | "burning" | "ashes" | "fallback" };
export type RitualLayout = { paperBottom: number; furnaceTop: number; furnaceBottom: number };

type Props = {
  ids: string[];
  onOpen: (id: string) => void;
  onOpenRect: (rect: SheetRect) => void;
  // a deliberate drag across empty floor, toward where new papers come from
  onExplore: (edge: ExploreEdge) => void;
  onRitual: (event: RitualEvent) => void;
  onRitualLayout: (layout: RitualLayout) => void;
  // the scene could not be drawn (or recovered): the app offers HTML instead
  onAvailable: (available: boolean) => void;
  inert: boolean;
};

type Scene = ReturnType<typeof createPaperScene>;
type Status = "loading" | "ready" | "failed";

const compact = (): boolean => window.matchMedia("(max-width: 600px)").matches;

export const PaperField = forwardRef<PaperFieldHandle, Props>(function PaperField(
  { ids, onOpen, onOpenRect, onExplore, onRitual, onRitualLayout, onAvailable, inert },
  ref,
) {
  const stage = useRef<HTMLDivElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const queuedThrows = useRef<string[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ ids, onOpen, onOpenRect, onExplore, onRitual, onRitualLayout, onAvailable });
  latest.current = { ids, onOpen, onOpenRect, onExplore, onRitual, onRitualLayout, onAvailable };

  useEffect(() => {
    setStatus("loading");
    let disposed = false;
    let created: Scene | null = null;
    let observer: ResizeObserver | null = null;
    // The space and its live count can render before downloading Three.js.
    void import("../scene/vendor/paper-scene.js").then(({ createPaperScene }) => {
      if (disposed) return;
      created = createPaperScene(stage.current!, buttons.current!, {
        vatBase: "/vat/",
        compact: compact(),
        onPaperOpen: (id: string) => latest.current.onOpen(id),
        onExplore: (edge: ExploreEdge) => latest.current.onExplore(edge),
        onRitual: (event: RitualEvent) => latest.current.onRitual(event),
        onRitualLayout: (layout: RitualLayout) => latest.current.onRitualLayout(layout),
        onReady: () => { if (!disposed) setStatus("ready"); },
        onError: (err: Error) => {
          if (disposed) return;
          console.error("paper scene failed", err.message);
          setStatus("failed");
        },
      });
      scene.current = created;
      created.setPapers(latest.current.ids);
      for (const id of queuedThrows.current.splice(0)) created.throwCreatedPaper(id);
      observer = new ResizeObserver(() => {
        const rect = created?.resize();
        if (rect) latest.current.onOpenRect(rect);
      });
      observer.observe(stage.current!);
    }).catch((err: unknown) => {
      if (disposed) return;
      console.error("paper scene failed", err instanceof Error ? err.message : err);
      setStatus("failed");
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      created?.dispose();
      if (scene.current === created) scene.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    scene.current?.setPapers(ids);
  }, [ids]);

  const failed = status === "failed";
  useEffect(() => {
    latest.current.onAvailable(!failed);
  }, [failed]);

  useImperativeHandle(
    ref,
    () => ({
      openPaper: (id, onUnfolded) => {
        if (failed || !scene.current) onUnfolded(null);
        else scene.current.openPaper(id, onUnfolded);
      },
      closePaper: () => scene.current?.closePaper(),
      burnOpenPaper: () => scene.current?.burnOpenPaper(),
      removeOpenPaper: () => scene.current?.removeOpenPaper(),
      setEntryEdge: (edge) => scene.current?.setEntryEdge(edge),
      throwCreatedPaper: (id) => {
        if (scene.current) scene.current.throwCreatedPaper(id);
        else if (!failed) queuedThrows.current.push(id);
      },
      prefetchFire: () => scene.current?.prefetchFire(),
      prepareRitual: (id) => (!failed && scene.current ? scene.current.prepareRitual(id) : false),
      placeRitual: () => scene.current?.placeRitual(),
      returnRitual: () => scene.current?.returnRitual(),
      igniteRitual: (burn) => scene.current?.igniteRitual(burn),
      burnRitualRemotely: (burn) => scene.current?.burnRitualRemotely(burn),
      clearRitual: () => scene.current?.clearRitual(),
      cancelRitual: () => scene.current?.cancelRitual(),
      endRitual: () => scene.current?.endRitual(),
      burnRemote: (id, burn) => (!failed && scene.current ? scene.current.burnRemote(id, burn) : false),
    }),
    [failed],
  );

  return (
    <div className="paper-field" inert={inert}>
      <div ref={stage} className="paper-stage" hidden={failed} aria-hidden="true" />
      <div ref={buttons} className="paper-buttons" hidden={failed} />
      {status === "loading" && <p className="scene-note">Gathering papers…</p>}
      {failed && (
        <div className="scene-fallback">
          <p className="scene-note" role="status">
            The papers can't be drawn on this device, but you can still open them.{" "}
            <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>
              Try drawing again
            </button>
          </p>
          <div className="paper-stubs">
            {ids.map((id) => (
              <button key={id} type="button" className="paper-stub" aria-label="Open paper" onClick={() => onOpen(id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
