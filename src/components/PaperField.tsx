import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPaperScene } from "../scene/vendor/paper-scene.js";

export type SheetRect = { left: number; top: number; width: number; height: number };

export type PaperFieldHandle = {
  openPaper: (id: string, onUnfolded: (rect: SheetRect | null) => void) => void;
  closePaper: () => void;
  throwCreatedPaper: (id: string) => void;
};

type Props = {
  ids: string[];
  onOpen: (id: string) => void;
  onOpenRect: (rect: SheetRect) => void;
  inert: boolean;
};

type Scene = ReturnType<typeof createPaperScene>;
type Status = "loading" | "ready" | "failed";

const compact = (): boolean => window.matchMedia("(max-width: 600px)").matches;

export const PaperField = forwardRef<PaperFieldHandle, Props>(function PaperField(
  { ids, onOpen, onOpenRect, inert },
  ref,
) {
  const stage = useRef<HTMLDivElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ ids, onOpen, onOpenRect });
  latest.current = { ids, onOpen, onOpenRect };

  useEffect(() => {
    setStatus("loading");
    let created: Scene;
    try {
      created = createPaperScene(stage.current!, buttons.current!, {
        vatBase: "/vat/",
        compact: compact(),
        onPaperOpen: (id: string) => latest.current.onOpen(id),
        onReady: () => setStatus("ready"),
        onError: (err: Error) => {
          console.error("paper scene failed", err.message);
          setStatus("failed");
        },
      });
    } catch (err) {
      console.error("paper scene failed", err instanceof Error ? err.message : err);
      setStatus("failed");
      return;
    }
    scene.current = created;
    created.setPapers(latest.current.ids);

    const observer = new ResizeObserver(() => {
      const rect = created.resize();
      if (rect) latest.current.onOpenRect(rect);
    });
    observer.observe(stage.current!);
    return () => {
      observer.disconnect();
      created.dispose();
      scene.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    scene.current?.setPapers(ids);
  }, [ids]);

  const failed = status === "failed";

  useImperativeHandle(
    ref,
    () => ({
      openPaper: (id, onUnfolded) => {
        if (failed || !scene.current) onUnfolded(null);
        else scene.current.openPaper(id, onUnfolded);
      },
      closePaper: () => scene.current?.closePaper(),
      throwCreatedPaper: (id) => scene.current?.throwCreatedPaper(id),
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
