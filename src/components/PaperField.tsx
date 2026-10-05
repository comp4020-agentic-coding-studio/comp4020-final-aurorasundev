import { forwardRef, useImperativeHandle } from "react";

export type PaperFieldHandle = {
  openPaper: (id: string, onUnfolded: () => void) => void;
  closePaper: () => void;
  throwCreatedPaper: (id: string) => void;
};

type Props = {
  ids: string[];
  onOpen: (id: string) => void;
  inert: boolean;
};

// Stand-in field until the paper scene lands: one plain button per paper.
export const PaperField = forwardRef<PaperFieldHandle, Props>(function PaperField({ ids, onOpen, inert }, ref) {
  useImperativeHandle(ref, () => ({
    openPaper: (_id, onUnfolded) => onUnfolded(),
    closePaper: () => {},
    throwCreatedPaper: () => {},
  }));

  return (
    <div className="paper-field" inert={inert}>
      {ids.map((id) => (
        <button key={id} type="button" className="paper-stub" aria-label="Open paper" onClick={() => onOpen(id)} />
      ))}
    </div>
  );
});
