import type { KeyboardEvent, MouseEvent, Ref } from "react";

// The Gallery's corner wordmark (owner, 2026-10-20). On the entry it reads
// "Throwaway", as everywhere else on the site; the entry title flies into its
// place and replaces it, so through the exhibition and an opened record it
// reads "The Throwaway Gallery". It never leads to the room: it returns to the
// Gallery's own entry ("Back to the space" is the way to "/"). Without
// JavaScript the href lands on the Gallery's entry anyway.
//
// Both texts sit in one grid cell; the entry transition (entry-motion.ts)
// fades the old one out under the arriving title. Its accessible name is the
// Gallery's name in every state.

export const GALLERY_NAME = "The Throwaway Gallery";

type Props = {
  // returns false when there is nothing to do in place (the plain page): the
  // link then simply loads the Gallery
  onHome: () => boolean;
  // the two texts, for the entry transition
  nameRef?: Ref<HTMLSpanElement>;
  oldRef?: Ref<HTMLSpanElement>;
  // the opened record's header copy: only the Gallery's name, never the old text
  settled?: boolean;
};

export function GalleryWordmark({ onHome, nameRef, oldRef, settled = false }: Props) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // a new tab or window keeps the browser's own behaviour
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (onHome()) e.preventDefault();
  };
  // a link answers Enter by itself (a click); Space, as on a button, too
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key !== " ") return;
    e.preventDefault();
    if (!onHome()) e.currentTarget.click();
  };
  return (
    <a className={`wordmark gallery-wordmark${settled ? " is-settled" : ""}`} href="/gallery/" aria-label={GALLERY_NAME} onClick={onClick} onKeyDown={onKeyDown}>
      {!settled && (
        <span ref={oldRef} className="wm-old" aria-hidden="true">
          Throwaway
        </span>
      )}
      <span ref={nameRef} className="wm-name" aria-hidden="true">
        {GALLERY_NAME}
      </span>
    </a>
  );
}
