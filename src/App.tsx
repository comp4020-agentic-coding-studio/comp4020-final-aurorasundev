import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import { PaperField, type PaperFieldHandle, type SheetRect } from "./components/PaperField.tsx";
import { ReadDialog } from "./components/ReadDialog.tsx";
import { SpaceFooter } from "./components/SpaceFooter.tsx";
import { WriteDialog } from "./components/WriteDialog.tsx";
import { ensureSession, listPapers } from "./lib/api.ts";

type Mode = { kind: "space" } | { kind: "writing" } | { kind: "reading"; id: string; revealed: boolean; rect: SheetRect | null };
type Space = { kind: "loading" } | { kind: "error" } | { kind: "ready"; ids: string[]; total: number };

const visibleLimit = (): number => (window.matchMedia("(max-width: 600px)").matches ? 6 : 12);

export function App() {
  const [space, setSpace] = useState<Space>({ kind: "loading" });
  const [mode, setMode] = useState<Mode>({ kind: "space" });
  const field = useRef<PaperFieldHandle>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setSpace({ kind: "loading" });
    try {
      await ensureSession();
      const { papers, total } = await listPapers();
      setSpace({ kind: "ready", ids: papers.slice(0, visibleLimit()).map((p) => p.id), total });
    } catch {
      setSpace({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPaper = useCallback((id: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
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

  const thrown = useCallback((id: string, total: number) => {
    setMode({ kind: "space" });
    setSpace((s) => {
      if (s.kind !== "ready") return { kind: "ready", ids: [id], total };
      const ids = [...s.ids.filter((x) => x !== id), id];
      if (ids.length > visibleLimit()) ids.shift();
      return { kind: "ready", ids, total };
    });
    field.current?.throwCreatedPaper(id);
  }, []);

  const busy = mode.kind !== "space";

  return (
    <div className="app">
      <Header />
      {space.kind === "ready" && (
        <PaperField ref={field} ids={space.ids} onOpen={openPaper} onOpenRect={moveSheet} inert={busy} />
      )}
      {space.kind === "loading" && <p className="space-status">Finding the space…</p>}
      {space.kind === "error" && (
        <div className="space-status" role="alert">
          <p>The space couldn't be reached.</p>
          <button type="button" className="button button-secondary" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {space.kind === "ready" && <SpaceFooter total={space.total} onWrite={startWriting} hidden={busy} />}
      {mode.kind === "writing" && <WriteDialog onCancel={cancelWriting} onThrown={thrown} />}
      {mode.kind === "reading" && <ReadDialog id={mode.id} revealed={mode.revealed} rect={mode.rect} onClose={closePaper} />}
    </div>
  );
}
