import { useCallback, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import { PaperField, type PaperFieldHandle, type SheetRect } from "./components/PaperField.tsx";
import { ReadDialog } from "./components/ReadDialog.tsx";
import { SpaceFooter } from "./components/SpaceFooter.tsx";
import { WriteDialog } from "./components/WriteDialog.tsx";
import type { Created } from "./lib/api.ts";
import { useLiveSpace } from "./lib/useLiveSpace.ts";

type Mode = { kind: "space" } | { kind: "writing" } | { kind: "reading"; id: string; revealed: boolean; rect: SheetRect | null };

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
    onGone: () => {},
    onChanged: (id, version) => {
      if (modeRef.current.kind === "reading" && modeRef.current.id === id) setReadingVersion((v) => Math.max(v, version));
    },
  });

  const openPaper = useCallback((id: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setReadingVersion(0);
    setMode({ kind: "reading", id, revealed: false, rect: null });
    field.current?.openPaper(id, (rect) =>
      setMode((m) => (m.kind === "reading" && m.id === id ? { ...m, revealed: true, rect } : m)),
    );
  }, []);

  const moveSheet = useCallback((rect: SheetRect) => {
    setMode((m) => (m.kind === "reading" && m.revealed ? { ...m, rect } : m));
  }, []);

  const closePaper = useCallback(() => {
    field.current?.closePaper();
    setMode({ kind: "space" });
    returnFocus.current?.focus();
  }, []);

  const startWriting = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMode({ kind: "writing" });
  }, []);

  const cancelWriting = useCallback(() => {
    setMode({ kind: "space" });
    returnFocus.current?.focus();
  }, []);

  // The server confirmed the save: only now does the paper crumple and fly.
  // Its own SSE echo (matched by submission key) only moved the count.
  const thrown = useCallback(
    (created: Created) => {
      setMode({ kind: "space" });
      dispatch({ type: "arrived", id: created.paper.id, revision: created.revision, total: created.total, limit, reading: null });
      field.current?.throwCreatedPaper(created.paper.id);
    },
    [dispatch, limit],
  );

  const busy = mode.kind !== "space";
  const ready = space.status === "ready";

  return (
    <div className={`app${mode.kind === "writing" ? " is-writing" : ""}`}>
      <Header />
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
      {mode.kind === "reading" && <ReadDialog id={mode.id} revealed={mode.revealed} rect={mode.rect} liveVersion={readingVersion} onClose={closePaper} />}
    </div>
  );
}
