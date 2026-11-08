import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n.ts";

// On a phone the header's places don't fit beside the wordmark, so they fold
// into one "Menu" control (owner, 2026-11-08). It opens a native modal
// dialog: the links stack down a pale sheet, the page behind dims, and
// Escape, the backdrop or Close shuts it. Desktop never shows it; the
// header's own row of links stays as it was. Closed, nothing but the button
// is in the page, so the links are never there twice.

type Props = {
  // the same links the header shows on desktop, in order
  children: ReactNode;
  // while a paper is let go, nothing in the header moves
  disabled?: boolean;
};

export function SiteMenu({ children, disabled = false }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  // a ritual starting while it is open closes it
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // focus goes back to Menu once the sheet has gone (a link that leaves the
  // page, or an account sheet opening, takes it elsewhere first)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) opener.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="site-menu-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {t("Menu")}
      </button>
      {open && <MenuSheet onClose={close}>{children}</MenuSheet>}
    </>
  );
}

function MenuSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="site-menu"
      aria-label={t("Site")}
      // Escape closes only the menu: inside an opened record, React would
      // otherwise carry this cancel up to the record's dialog and close it
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      // a press on the backdrop (outside the sheet) closes it
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="site-menu-sheet">
        <button type="button" className="site-menu-close" onClick={onClose}>
          {t("Close")}
        </button>
        {/* a choice made inside closes the menu: a link leaves the page, the
            account and language controls act in place */}
        <nav className="site-menu-links" onClick={(e) => (e.target as HTMLElement).closest("a, button") && onClose()}>
          {children}
        </nav>
      </div>
    </dialog>
  );
}
