import { useCallback, useEffect, useRef, useState } from "react";
import { getPaper } from "../lib/api.ts";

type Props = {
  id: string;
  // false while the paper is still unfolding: the words wait for a flat sheet
  revealed: boolean;
  onClose: () => void;
};

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; content: string };

export function ReadDialog({ id, revealed, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const fetchPaper = useCallback(() => {
    let live = true;
    setLoad({ kind: "loading" });
    getPaper(id)
      .then((paper) => live && setLoad({ kind: "ready", content: paper.content }))
      .catch((err: Error) => live && setLoad({ kind: "error", message: err.message }));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(fetchPaper, [fetchPaper]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog read-dialog${revealed ? " is-revealed" : ""}`}
      aria-label="A paper someone left"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <article className="paper-sheet read-sheet">
        <button type="button" className="read-close" onClick={onClose} autoFocus>
          Close
        </button>
        <div className="read-body" tabIndex={0}>
          {load.kind === "loading" && <p className="read-status">Opening paper…</p>}
          {load.kind === "error" && (
            <div className="read-status" role="alert">
              <p>This paper couldn't be opened. {load.message}</p>
              <button type="button" className="button button-secondary" onClick={fetchPaper}>
                Try again
              </button>
            </div>
          )}
          {load.kind === "ready" && <p className="read-text">{load.content}</p>}
        </div>
        <p className="read-footer">Someone left this here.</p>
      </article>
    </dialog>
  );
}
