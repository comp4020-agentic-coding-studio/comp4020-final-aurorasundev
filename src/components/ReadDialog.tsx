import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, burnPaper, getPaper, witnessPaper, type Burned, type OpenedPaper, type PaperState } from "../lib/api.ts";
import type { PaperStatus } from "../lib/space.ts";
import type { SheetRect } from "./PaperField.tsx";

export type Ended = Exclude<PaperStatus, "active">;

type Props = {
  id: string;
  // false while the paper is still unfolding: the words wait for a flat sheet
  revealed: boolean;
  // where the unfolded 3D sheet sits on screen; null means no scene to sit on
  rect: SheetRect | null;
  // the newest version the live stream has announced for this paper
  liveVersion: number;
  // set when the paper left the shared space while open here
  ended: Ended | null;
  pendingOps: Set<string>;
  onBurned: (result: Burned) => void;
  onEnded: (why: Ended) => void;
  onClose: () => void;
};

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; paper: OpenedPaper };

// The reading sheet sits over the unfolded 3D sheet, a little wider for the
// text. On a phone that sheet projects too short to read more than a few
// lines (M03), so it grows to a readable height around the same centre,
// staying clear of the header above and the count below.
const SHEET_MIN = 620;
const CLEAR_TOP = 108;
const CLEAR_BOTTOM = 80;

function sheetBox(rect: SheetRect): { left: number; top: number; width: number; height: number } {
  const width = Math.min(rect.width * 1.2, window.innerWidth - 24);
  const height = Math.max(rect.height, Math.min(SHEET_MIN, window.innerHeight - CLEAR_TOP - CLEAR_BOTTOM));
  const centred = rect.top + rect.height / 2 - height / 2;
  const top = height === rect.height ? rect.top : Math.max(CLEAR_TOP, Math.min(centred, window.innerHeight - CLEAR_BOTTOM - height));
  return { left: rect.left - (width - rect.width) / 2, top, width, height };
}

export const witnessLine = (n: number): string | null =>
  n === 0 ? null : `${n.toLocaleString("en-AU")} ${n === 1 ? "person has" : "people have"} witnessed this.`;

export function ReadDialog({ id, revealed, rect, liveVersion, ended, pendingOps, onBurned, onEnded, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [view, setView] = useState<"read" | "confirm">("read");
  const [ready, setReady] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const burnKey = useRef<string | null>(null);
  // Once the paper has left the space, no late answer may bring it back.
  const endedRef = useRef(ended);
  endedRef.current = ended;

  // Never let an older answer overwrite a newer one, whichever arrives last.
  const merge = useCallback((state: PaperState, content?: { content: string; read_receipt: string | null }) => {
    if (endedRef.current) return;
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
        if (!live || endedRef.current) return;
        if (err instanceof ApiError && err.status === 404) setLoad((c) => (c.kind === "ready" ? c : { kind: "missing" }));
        else setLoad((c) => (c.kind === "ready" ? c : { kind: "error", message: err.message }));
      });
    return () => {
      live = false;
    };
  }, [id, merge]);

  useEffect(fetchPaper, [fetchPaper]);

  // Someone else witnessed it: refresh this reading's state (count, rights).
  const heldVersion = load.kind === "ready" ? load.paper.version : null;
  useEffect(() => {
    if (heldVersion !== null && liveVersion > heldVersion && !ended) return fetchPaper();
  }, [liveVersion, heldVersion, ended, fetchPaper]);

  // A quarantined paper's words go at once; a destroyed one stays readable
  // here until closed, if they had already arrived.
  useEffect(() => {
    if (ended === "quarantined") setLoad({ kind: "missing" });
    else if (ended) setLoad((c) => (c.kind === "ready" ? c : { kind: "missing" }));
    if (ended) setView("read");
  }, [ended]);

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
      if (err instanceof ApiError && err.code === "paper_gone") onEnded("destroyed");
      else setActionError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    } finally {
      setActing(false);
    }
  }

  function startConfirm() {
    burnKey.current = crypto.randomUUID();
    setReady(false);
    setActionError(null);
    setView("confirm");
  }

  async function letGo() {
    if (load.kind !== "ready" || !load.paper.read_receipt || !burnKey.current || acting) return;
    const key = burnKey.current;
    setActing(true);
    setActionError(null);
    pendingOps.add(key);
    try {
      onBurned(await burnPaper(id, load.paper.read_receipt, key));
    } catch (err) {
      // someone else let it go first: this reader is now just holding it
      if (err instanceof ApiError && err.code === "paper_gone") onEnded("destroyed");
      else setActionError(err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");
    } finally {
      pendingOps.delete(key);
      setActing(false);
    }
  }

  const box = rect ? sheetBox(rect) : null;
  const paper = load.kind === "ready" ? load.paper : null;
  const count = paper ? witnessLine(paper.witness_count) : null;
  const finalReading = !!ended && ended !== "quarantined" && !!paper;
  const goneText = ended === "quarantined" ? "This paper is no longer available." : "This paper is no longer here.";
  // Keep: only its author sees the action at all. Release: everyone sees it,
  // usable once they have witnessed the paper.
  const showBurn = paper && (paper.mode === "release" || paper.viewer.is_author);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog read-dialog${revealed ? " is-revealed" : ""}${rect ? " over-scene" : ""}${finalReading ? " is-final" : ""}`}
      style={box ? { ...box, margin: 0 } : undefined}
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
          {load.kind === "missing" && <p className="read-status">{goneText}</p>}
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

        {finalReading && (
          <div className="read-foot read-final" role="status">
            <p className="read-final-title">This was let go while you were holding it.</p>
            <p className="read-final-note">You may finish reading. Once you close it, it is gone.</p>
          </div>
        )}

        {paper && !ended && view === "read" && (
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
              {showBurn && (
                <button type="button" className="button button-secondary" onClick={startConfirm} disabled={!paper.viewer.can_burn}>
                  Let it disappear
                </button>
              )}
            </div>
            <div className="read-meta">
              <p className="read-origin">{paper.viewer.is_author ? "You left this here." : "Someone left this here."}</p>
            </div>
          </div>
        )}

        {paper && !ended && view === "confirm" && (
          <div className="read-foot read-confirm">
            {paper.viewer.is_author && <p className="read-origin">You left this here.</p>}
            <h3 className="read-confirm-title">Ready to let this go?</h3>
            <p className="read-confirm-note">Once it disappears, it cannot be opened again.</p>
            <label className="choice choice-check">
              <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} disabled={acting} />
              <span>I'm ready to let this go.</span>
            </label>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="read-actions">
              <button type="button" className="button button-secondary" onClick={() => setView("read")} disabled={acting}>
                Cancel
              </button>
              <button type="button" className="button button-primary" onClick={letGo} disabled={!ready || acting}>
                Let it disappear
              </button>
            </div>
            {count && (
              <div className="read-meta">
                <p className="read-origin">{count}</p>
              </div>
            )}
          </div>
        )}
      </article>
    </dialog>
  );
}
