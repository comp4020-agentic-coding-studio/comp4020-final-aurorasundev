import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import { PaperField, type PaperFieldHandle, type SheetRect } from "./components/PaperField.tsx";
import { ReadDialog, type Ended } from "./components/ReadDialog.tsx";
import { ReturnKeyDialog } from "./components/ReturnKeyDialog.tsx";
import { SpaceFooter } from "./components/SpaceFooter.tsx";
import { WriteDialog } from "./components/WriteDialog.tsx";
import type { Burned, Created } from "./lib/api.ts";
import { useLiveSpace } from "./lib/useLiveSpace.ts";

type Mode =
  | { kind: "space" }
  | { kind: "writing" }
  | { kind: "key"; variant: "issue" | "restore" }
  | { kind: "reading"; id: string; revealed: boolean; rect: SheetRect | null; ended: Ended | null };

// The references show generously spaced papers rather than the demo's crowded
// 40-paper stage; the window stays small enough to keep that negative space.
const visibleLimit = (): number => (window.matchMedia("(max-width: 600px)").matches ? 5 : 8);

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: "space" });
  // newest version announced live for the paper being read
  const [readingVersion, setReadingVersion] = useState(0);
  const field = useRef<PaperFieldHandle>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pendingOps = useMemo(() => new Set<string>(), []);
  const limit = useMemo(visibleLimit, []);

  const { space, dispatch, retry } = useLiveSpace({
    limit,
    reading: () => (modeRef.current.kind === "reading" ? modeRef.current.id : null),
    pendingOps,
    onGone: (id, why) => {
      setMode((m) => (m.kind === "reading" && m.id === id && !m.ended ? { ...m, ended: why } : m));
    },
    onChanged: (id, version) => {
      if (modeRef.current.kind === "reading" && modeRef.current.id === id) setReadingVersion((v) => Math.max(v, version));
    },
  });

  const openPaper = useCallback((id: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setReadingVersion(0);
    setMode({ kind: "reading", id, revealed: false, rect: null, ended: null });
    field.current?.openPaper(id, (rect) =>
      setMode((m) => (m.kind === "reading" && m.id === id ? { ...m, revealed: true, rect } : m)),
    );
  }, []);

  const moveSheet = useCallback((rect: SheetRect) => {
    setMode((m) => (m.kind === "reading" && m.revealed ? { ...m, rect } : m));
  }, []);

  // Closing an ended paper is the last of it: it fades instead of crumpling
  // back, and leaves this page's window.
  const closePaper = useCallback(() => {
    const m = modeRef.current;
    if (m.kind === "reading" && m.ended) {
      field.current?.burnOpenPaper();
      dispatch({ type: "removed", id: m.id, revision: -1, total: 0, reading: null });
    } else field.current?.closePaper();
    setMode({ kind: "space" });
  }, [dispatch]);

  // This page let it go: the server has committed, so it plays its own
  // ending; other pages learn of it from the stream.
  const burned = useCallback(
    (result: Burned) => {
      const m = modeRef.current;
      if (m.kind !== "reading") return;
      field.current?.burnOpenPaper();
      dispatch({ type: "removed", id: m.id, revision: result.revision, total: result.total, reading: null });
      setMode({ kind: "space" });
      document.querySelector<HTMLElement>(".space-write")?.focus();
    },
    [dispatch],
  );

  const ended = useCallback((why: Ended) => {
    setMode((m) => (m.kind === "reading" && !m.ended ? { ...m, ended: why } : m));
  }, []);

  const startWriting = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMode({ kind: "writing" });
  }, []);

  const cancelWriting = useCallback(() => {
    setMode({ kind: "space" });
  }, []);

  // The server confirmed the save: only now does the paper crumple and fly.
  // Its own SSE echo (matched by submission key) only moved the count.
  // After a Keep, the return key is offered once the throw has landed.
  const thrown = useCallback(
    (created: Created) => {
      setMode({ kind: "space" });
      dispatch({ type: "arrived", id: created.paper.id, revision: created.revision, total: created.total, limit, reading: null });
      field.current?.throwCreatedPaper(created.paper.id);
      if (created.offer_return_key) {
        setTimeout(() => {
          if (modeRef.current.kind === "space") setMode({ kind: "key", variant: "issue" });
        }, 1800);
      }
    },
    [dispatch, limit],
  );

  const openReturnKey = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMode({ kind: "key", variant: "restore" });
  }, []);

  const closeKey = useCallback(() => {
    setMode({ kind: "space" });
  }, []);

  const busy = mode.kind !== "space";

  // Focus goes back to whatever opened the dialog once it can take it: the
  // field is inert until the space re-renders, and a paper's button stays
  // hidden while it crumples back into place (two seconds or more on a slow
  // device). Gives up after six seconds, or once the visitor moves focus.
  useEffect(() => {
    if (busy) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (!target) return;
    const until = performance.now() + 6000;
    let frame = 0;
    const tryFocus = () => {
      if (!target.isConnected || performance.now() > until) return;
      const idle = document.activeElement === document.body || document.activeElement === null;
      if (!idle) return;
      target.focus();
      if (document.activeElement !== target) frame = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  const ready = space.status === "ready";

  return (
    <div className={`app${mode.kind === "writing" ? " is-writing" : ""}`}>
      <Header onReturnKey={openReturnKey} />
      {ready && <PaperField ref={field} ids={space.ids} onOpen={openPaper} onOpenRect={moveSheet} inert={busy} />}
      {space.status === "loading" && <p className="space-status">Finding the space…</p>}
      {space.status === "error" && (
        <div className="space-status" role="alert">
          <p>The space couldn't be reached.</p>
          <button type="button" className="button button-secondary" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {ready && (
        <SpaceFooter total={space.total} onWrite={startWriting} busy={busy} reconnecting={space.connection === "reconnecting"} />
      )}
      {mode.kind === "writing" && (
        <WriteDialog
          onCancel={cancelWriting}
          onThrown={thrown}
          pendingOps={pendingOps}
          offline={space.connection === "reconnecting"}
        />
      )}
      {mode.kind === "key" && <ReturnKeyDialog variant={mode.variant} onClose={closeKey} onRestored={retry} />}
      {mode.kind === "reading" && (
        <ReadDialog
          id={mode.id}
          revealed={mode.revealed}
          rect={mode.rect}
          liveVersion={readingVersion}
          ended={mode.ended}
          pendingOps={pendingOps}
          onBurned={burned}
          onEnded={ended}
          onClose={closePaper}
        />
      )}
    </div>
  );
}
