import { aboutHref, useT } from "../lib/i18n.ts";
import { LangToggle } from "./LangToggle.tsx";
import { SiteMenu } from "./SiteMenu.tsx";

// The Gallery's places, in both its headers (browsing, and the opened
// record's copy): a row on a wide screen, behind one Menu on a phone.
export function GalleryLinks() {
  const t = useT();
  const links = (inMenu: boolean) => (
    <>
      <a className="header-link" href="/">
        {inMenu ? (
          t("Back to the space")
        ) : (
          <>
            <span className="wide-only">{t("Back to the space")}</span>
            <span className="narrow-only">{t("Space")}</span>
          </>
        )}
      </a>
      <a className="header-link header-about" href={aboutHref(t.lang)}>
        {t("About")}
      </a>
      <LangToggle />
    </>
  );
  return (
    <>
      <nav className="records-links" aria-label={t("Site")}>
        {links(false)}
      </nav>
      <div className="header-menu">
        <SiteMenu>{links(true)}</SiteMenu>
      </div>
    </>
  );
}
