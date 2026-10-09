import { useEffect, useRef, useState } from "react";
import type { RitualLayout } from "./PaperField.tsx";

// The furnace ritual's words and controls (B01–B03, B05). The paper and the
// furnace are in the scene; everything readable or pressable is here, in
// HTML. Without WebGL the same controls drive a small drawn paper and ash.
export type RitualStage = "preparing" | "ready" | "committing" | "checking" | "burning" | "ashes";
// whose ending this is: this visitor's own, someone else's who let it go
// first, or a removal for safety (no fire at all)
export type RitualOutcome = "own" | "other" | "removed";

type Props = {
  stage: RitualStage;
  outcome: RitualOutcome;
  error: string | null;
  canPlace: boolean;
  fallback: boolean;
  layout: RitualLayout | null;
  onCancel: () => void;
  onPlace: () => void;
  onBack: () => void;
};

const PRECOMMIT: RitualStage[] = ["preparing", "ready"];

function words(stage: RitualStage, outcome: RitualOutcome, fallback: boolean): { lead: string; note: string | null } {
  if (outcome === "removed") return { lead: "This paper is no longer available.", note: null };
  if (outcome === "other") {
    return stage === "ashes"
      ? { lead: "It is gone.", note: "Someone else let it go first." }
      : { lead: "Someone else let it go first.", note: null };
  }
  switch (stage) {
    case "preparing":
    case "ready":
      return fallback
        ? { lead: "Place the paper in the furnace.", note: "It is gone only when you place it inside." }
        : { lead: "Drag the paper into the furnace.", note: "It is gone only when you place it inside." };
    case "committing":
    case "burning":
      return { lead: "Letting go…", note: null };
    case "checking":
      return { lead: "Checking whether it was released…", note: "Leaving now can't undo it if it already was." };
    case "ashes":
      return { lead: "It is gone.", note: null };
  }
}

export function RitualOverlay({ stage, outcome, error, canPlace, fallback, layout, onCancel, onPlace, onBack }: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  const [ashReady, setAshReady] = useState(false);
  const precommit = PRECOMMIT.includes(stage) && outcome === "own";
  const { lead, note } = words(stage, outcome, fallback);
  const ended = stage === "ashes" || outcome !== "own";

  // focus comes into the ritual, onto its (visually hidden) title
  useEffect(() => {
    title.current?.focus();
  }, []);

  useEffect(() => {
    setAshReady(false);
    if (stage !== "ashes") return;
    const timer = setTimeout(() => setAshReady(true), 3000);
    return () => clearTimeout(timer);
  }, [stage]);

  // between the hovering paper and the furnace's rim, wherever the scene put
  // them; centred lower down when there is no scene to measure
  // (kept clear of the rim: the two lines take about 90px)
  const between = layout && precommit ? (layout.paperBottom + layout.furnaceTop) / 2 : null;
  // above the rim and the paper burning in it (B02/B03)
  const above = layout && !precommit ? `max(var(--ritual-end-min), calc(${layout.furnaceTop}px - var(--ritual-end-offset)))` : null;
  const style = between !== null ? { top: between } : above !== null ? { top: above, transform: "translate(-50%, -100%)" } : undefined;

  return (
    <section className={`ritual is-${stage}${fallback ? " is-fallback" : ""}`} aria-labelledby="ritual-title">
      <h2 id="ritual-title" className="visually-hidden" tabIndex={-1} ref={title}>
        Letting go of this paper
      </h2>
      {fallback && (
        <div className={`ritual-drawn is-${outcome === "removed" ? "removed" : stage}`} aria-hidden="true">
          <span className="ritual-drawn-paper" />
          <span className="ritual-drawn-furnace" />
        </div>
      )}
      <div className="ritual-words" style={style}>
        <p className="ritual-lead">{lead}</p>
        {note && <p className="ritual-note">{note}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {/* what changed, said once; not the animation */}
      <p className="visually-hidden" role="status">
        {stage === "ready" && outcome === "own" ? "The paper is ready to place in the furnace." : stage === "preparing" ? "" : lead}
      </p>
      <div className="ritual-actions">
        {precommit && (
          <>
            <button type="button" className="button button-secondary ritual-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="text-button ritual-place" onClick={onPlace} disabled={!canPlace}>
              Place in furnace
            </button>
          </>
        )}
        {(ended || stage === "checking") && (
          <button type="button" className="button button-secondary ritual-back" onClick={onBack} disabled={stage === "ashes" && !ashReady}>
            Back to the space
          </button>
        )}
      </div>
    </section>
  );
}
