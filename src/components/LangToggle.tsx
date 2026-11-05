import { useLangToggle } from "../lib/i18n.ts";

// "中 / EN" in the header: one press switches the interface to the other
// language. The current one is marked; the name says where the press goes.
export function LangToggle() {
  const { lang, toggle } = useLangToggle();
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={toggle}
      aria-label={lang === "zh" ? "Switch to English" : "切换到中文"}
      lang={lang === "zh" ? "en" : "zh-CN"}
    >
      <span lang="zh-CN" className={lang === "zh" ? "is-current" : undefined} aria-hidden="true">
        中
      </span>
      <span className="lang-sep" aria-hidden="true">
        /
      </span>
      <span lang="en" className={lang === "en" ? "is-current" : undefined} aria-hidden="true">
        EN
      </span>
    </button>
  );
}
