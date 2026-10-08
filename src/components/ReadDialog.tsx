import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getPaper, witnessPaper, type OpenedPaper, type PaperState } from "../lib/api.ts";
import type { SheetRect } from "./PaperField.tsx";

type Props = {
  id: string;
  // false while the paper is still unfolding: the words wait for a flat sheet
  revealed: boolean;
  // where the unfolded 3D sheet sits on screen; null means no scene to sit on
  rect: SheetRect | null;
  // the newest version the live stream has announced for this paper
  liveVersion: number;
  onClose: () => void;
};

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; paper: OpenedPaper };

export const witnessLine = (n: number): string | null =>
  n === 0 ? null : `${n.toLocaleString("en-AU")} ${n === 1 ? "person has" : "people have"} witnessed this.`;

export function ReadDialog({ id, revealed, rect, liveVersion, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Never let an older answer overwrite a newer one, whichever arrives last.
  const merge = useCallback((state: PaperState, content?: { content: string; read_receipt: string | null }) => {
    setLoad((current) => {
      if (current.kind !== "ready") return content ? { kind: "ready", paper: { ...state, ...content } } : current;
      if (state.version < current.paper.version) return current;
      return { kind: "ready", paper: { ...current.paper, ...state, ...(content ?? {}) } };
    });
  }, []);

  const fetchPaper = useCallback(() => {
    let live = true;
    getPaper(id)
      .then((paper) => live && merge(paper, { content: paper.content, read_receipt: paper.read_receipt }))
      .catch((err: Error) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "missing" });
        else setLoad((current) => (current.kind === "ready" ? current : { kind: "error", message: err.message }));
      });
    return () => {
      live = false;
    };
  }, [id, merge]);

  useEffect(fetchPaper, [fetchPaper]);

  // Someone else witnessed it: refresh this reading's state (count, rights).
  const heldVersion = load.kind === "ready" ? load.paper.version : null;
  useEffect(() => {
    if (heldVersion !== null && liveVersion > heldVersion) return fetchPaper();
  }, [liveVersion, heldVersion, fetchPaper]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function sawIt() {
    if (load.kind !== "ready" || !load.paper.read_receipt || acting) return;
    setActing(true);
    setActionError(null);
    try {
      merge(await witnessPaper(id, load.paper.read_receipt));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    } finally {
      setActing(false);
    }
  }

  const sheetWidth = rect ? Math.min(rect.width * 1.2, window.innerWidth - 24) : 0;
  const paper = load.kind === "ready" ? load.paper : null;
  const count = paper ? witnessLine(paper.witness_count) : null;

  return (
    <dialog
      ref={dialogRef}
      className={`dialog read-dialog${revealed ? " is-revealed" : ""}${rect ? " over-scene" : ""}`}
      style={rect ? { left: rect.left - (sheetWidth - rect.width) / 2, top: rect.top, width: sheetWidth, height: rect.height, margin: 0 } : undefined}
      aria-label="A paper someone left"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <article className="paper-sheet read-sheet">
        <button type="button" className="sheet-close" onClick={onClose} autoFocus>
          Close
        </button>
        <div className="read-body" tabIndex={0}>
          {load.kind === "loading" && <p className="read-status">Opening paper…</p>}
          {load.kind === "missing" && <p className="read-status">This paper is no longer here.</p>}
          {load.kind === "error" && (
            <div className="read-status" role="alert">
              <p>This paper couldn't be opened. {load.message}</p>
              <button type="button" className="button button-secondary" onClick={fetchPaper}>
                Try again
              </button>
            </div>
          )}
          {paper && <p className="read-text">{paper.content}</p>}
        </div>
        {paper && (
          <div className="read-foot">
            {count && <p className="read-count">{count}</p>}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="read-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={sawIt}
                disabled={paper.viewer.has_witnessed || acting || !paper.read_receipt}
              >
                {paper.viewer.has_witnessed ? "Witnessed" : "I saw it"}
              </button>
            </div>
            <div className="read-meta">
              <p className="read-origin">{paper.viewer.is_author ? "You left this here." : "Someone left this here."}</p>
            </div>
          </div>
        )}
      </article>
    </dialog>
  );
}
