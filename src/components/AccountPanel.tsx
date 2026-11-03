import { useEffect, useRef, useState } from "react";
import { ApiError, ownPapers, ownRecords, signOut, type OwnPaper } from "../lib/api.ts";
import { getGalleryConfig, type PublicArtifact } from "../lib/gallery-api.ts";
import { useGalleryAudio } from "../lib/useGalleryAudio.ts";
import { RecordPlayer } from "./RecordPlayer.tsx";

// Your papers, and what they became (ADR 009). A state of the space, seen
// only by the signed-in person: the papers they left that are still here,
// each opening into the ordinary reading sheet (so a Keep can be let go from
// there), and the Gallery records their Release papers became, with the
// Gallery's one player. No counts, no order beyond newest first, nothing
// anyone else can see.

type Props = {
  username: string;
  onOpenPaper: (id: string) => void;
  onSignedOut: () => void;
  onClose: () => void;
};

type Load<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: T[] };

// The two ways a paper was left mean different things to its author: a
// kept paper is still theirs to let go; a released one is in readers' hands.
const GROUPS = [
  { mode: "keep", title: "Kept by you", note: "Only you can let these go." },
  { mode: "release", title: "Released", note: "Handed to whoever reads them. When one burns, it leaves a record below." },
] as const;

const failed = (err: unknown): string => (err instanceof ApiError ? err.message : "That didn't reach the space. Try again.");

export function AccountPanel({ username, onOpenPaper, onSignedOut, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [papers, setPapers] = useState<Load<OwnPaper>>({ kind: "loading" });
  const [records, setRecords] = useState<Load<PublicArtifact>>({ kind: "loading" });
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [listening, setListening] = useState<PublicArtifact | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sound = useGalleryAudio(listening, musicEnabled, true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let live = true;
    setPapers({ kind: "loading" });
    setRecords({ kind: "loading" });
    ownPapers()
      .then(({ papers }) => live && setPapers({ kind: "ready", items: papers }))
      .catch((err) => live && setPapers({ kind: "error", message: failed(err) }));
    ownRecords()
      .then(({ records }) => live && setRecords({ kind: "ready", items: records }))
      .catch((err) => live && setRecords({ kind: "error", message: failed(err) }));
    getGalleryConfig()
      .then((config) => live && setMusicEnabled(config.music_enabled === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [attempt]);

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    setError(null);
    sound.stop();
    try {
      await signOut();
      onSignedOut();
    } catch (err) {
      setError(failed(err));
      setLeaving(false);
    }
  }

  const ownItems = papers.kind === "ready" ? papers.items : null;

  const retry = (
    <button type="button" className="button button-secondary" onClick={() => setAttempt((n) => n + 1)}>
      Try again
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      className="dialog account-dialog mine-dialog"
      aria-labelledby="mine-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!leaving) onClose();
      }}
    >
      <div className="paper-sheet account-sheet mine-sheet">
        <button type="button" className="sheet-close" onClick={onClose} disabled={leaving}>
          Close
        </button>
        <h2 id="mine-title" className="account-title">
          Your papers
        </h2>
        <p className="account-principle">Signed in as {username}. Only you can see this page.</p>

        {papers.kind === "loading" && (
          <section className="mine-section" aria-label="Your papers in the space">
            <p className="read-status">Finding your papers…</p>
          </section>
        )}
        {papers.kind === "error" && (
          <section className="mine-section" aria-label="Your papers in the space">
            <div className="read-status" role="alert">
              <p>{papers.message}</p>
              {retry}
            </div>
          </section>
        )}
        {ownItems?.length === 0 && (
          <section className="mine-section" aria-label="Your papers in the space">
            <p className="account-note">Nothing you left is in the space right now.</p>
          </section>
        )}
        {ownItems &&
          GROUPS.map((group) => {
            const items = ownItems.filter((paper) => paper.mode === group.mode);
            if (items.length === 0) return null;
            return (
              <section key={group.mode} className="mine-section" aria-labelledby={`mine-${group.mode}`}>
                <h3 id={`mine-${group.mode}`} className="mine-heading">
                  {group.title}
                </h3>
                <p className="account-note mine-group-note">{group.note}</p>
                <ul className="mine-papers">
                  {items.map((paper) => (
                    <li key={paper.id}>
                      <button type="button" className="mine-paper" onClick={() => onOpenPaper(paper.id)} disabled={leaving}>
                        {paper.excerpt || (paper.has_drawing ? "A drawing" : "")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

        <section className="mine-section" aria-labelledby="mine-records">
          <h3 id="mine-records" className="mine-heading">
            What they became
          </h3>
          {records.kind === "loading" && <p className="read-status">Finding your records…</p>}
          {records.kind === "error" && (
            <div className="read-status" role="alert">
              <p>{records.message}</p>
              {retry}
            </div>
          )}
          {records.kind === "ready" && records.items.length === 0 && (
            <p className="account-note">When a paper you released burns, the record it leaves will appear here.</p>
          )}
          {records.kind === "ready" && records.items.length > 0 && (
            <ul className="mine-records">
              {records.items.map((record) => (
                <li key={record.id} className={listening?.id === record.id ? "is-listening" : undefined}>
                  <button
                    type="button"
                    className="mine-record"
                    aria-pressed={listening?.id === record.id}
                    onClick={() => setListening((current) => (current?.id === record.id ? null : record))}
                    disabled={leaving}
                  >
                    <img src={record.image_url} alt={record.alt} width={120} height={120} loading="lazy" />
                    <span className="mine-record-title">{record.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {listening && <RecordPlayer key={listening.id} sound={sound} />}
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="mine-actions">
          <button type="button" className="text-button" onClick={leave} disabled={leaving}>
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
