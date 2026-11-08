import { readFileSync } from "node:fs";
import { Marked } from "marked";

// GitHub-style heading ids, so in-page links in README.md work here as well.
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const markdown = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

// The About page in each interface language: README.md in English at
// /readme/, its translation README.zh.md at /readme/zh/. Each links to the other.
const PAGES = {
  en: {
    lang: "en-AU",
    title: "About Throwaway",
    back: "Back to the space",
    backGallery: "Back to the Gallery",
    toGallery: "Go to the Gallery",
    menu: "Menu",
    close: "Close",
    other: { href: "/readme/zh/", lang: "zh-CN", label: "中文" },
  },
  zh: {
    lang: "zh-CN",
    title: "关于 Throwaway",
    back: "回到空间",
    backGallery: "回到展馆",
    toGallery: "去展馆看看",
    menu: "菜单",
    close: "关闭",
    other: { href: "/readme/", lang: "en", label: "English" },
  },
} as const;

// Where the visitor came from, as the link they followed said (the Gallery's
// About link adds ?from=gallery). It only chooses which fixed page is sent:
// arriving from the Gallery, the way back to it comes first; from anywhere
// else the space comes first and the Gallery is offered as a place to go.
// Nothing is stored or logged.
export type ReadmeFrom = "space" | "gallery";

// A line break inside a Chinese paragraph would render as a stray space
// between two characters; Chinese runs straight on, into and out of a link
// (a line ending in a link's ")" or starting with "[" for a Chinese label).
const CJK = "\u3000-\u303f\u3400-\u9fff\uff00-\uffef";
const joinCjkLines = (md: string): string =>
  md.replace(new RegExp(`(?<=[${CJK})])\\n[ \\t]*(?=[${CJK}]|\\[[${CJK}])`, "g"), "");

// Rendered server-side so the page carries the full README with no script:
// spec/invariants.test.ts reads the headings straight from this HTML.
export function renderReadmePage(readmePath: string, language: keyof typeof PAGES = "en", from: ReadmeFrom = "space"): string {
  const page = PAGES[language];
  const otherHref = from === "gallery" ? `${page.other.href}?from=gallery` : page.other.href;
  const places =
    from === "gallery"
      ? [
          { href: "/gallery/", label: page.backGallery },
          { href: "/", label: page.back },
        ]
      : [
          { href: "/", label: page.back },
          { href: "/gallery/", label: page.toGallery },
        ];
  const placeLinks = (cls: string): string => places.map((p) => `<a class="${cls}" href="${p.href}">${p.label}</a>`).join("\n        ");
  const source = readFileSync(readmePath, "utf8");
  const body = markdown.parse(language === "zh" ? joinCjkLines(source) : source, { async: false });
  return `<!doctype html>
<html lang="${page.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${page.title}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
      :root {
        --bg: #c6cdcc;
        --ink: #292927;
        --muted: #5c5a55;
        --serif: Georgia, "Times New Roman", "Songti SC", serif;
        --sans: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--ink); }
      body { font-family: var(--sans); font-size: 18px; line-height: 1.6; }
      header {
        display: flex; justify-content: space-between; align-items: baseline;
        padding: 40px 48px 0;
      }
      .wordmark { font-family: var(--serif); font-size: 32px; color: var(--ink); text-decoration: none; }
      .back, .other-lang { color: var(--ink); text-decoration: none; font-size: 17px; }
      .back:hover, .back:focus-visible, .other-lang:hover, .other-lang:focus-visible { text-decoration: underline; }
      nav { display: flex; gap: 28px; align-items: baseline; }
      main { max-width: 860px; margin: 0 auto; padding: 56px 24px 96px; }
      main h1 { font-family: var(--serif); font-weight: 400; font-size: 64px; line-height: 1.1; margin: 0 0 8px; }
      /* D06: the opening line reads as a lead, section headings in the serif */
      main h1 + p { font-size: 23px; line-height: 1.45; margin: 0 0 8px; }
      main h2 { font-family: var(--serif); font-size: 34px; font-weight: 400; line-height: 1.2; margin: 48px 0 12px; }
      main h3 { font-size: 20px; font-weight: 600; margin: 32px 0 8px; }
      main p, main li { color: var(--ink); }
      main a { color: var(--ink); text-underline-offset: 3px; }
      main a:focus-visible, .back:focus-visible, .other-lang:focus-visible, .wordmark:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
      main img { max-width: 100%; height: auto; }
      main code { font-size: 0.9em; }
      main blockquote { margin: 0; padding-left: 16px; border-left: 3px solid var(--muted); color: var(--muted); }
      /* the phone's Menu, as in the space and the Gallery (SiteMenu.tsx and
         app.css): the places stack down a pale sheet over a dimmed page */
      .menu-open { display: none; position: relative; padding: 0; border: 0; background: none; color: var(--ink); font: inherit; font-size: 18px; cursor: pointer; }
      .menu-open::after { content: ""; position: absolute; inset: 50% -8px auto; height: 44px; transform: translateY(-50%); }
      .menu-open:focus-visible, .menu-close:focus-visible, .menu-links a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
      .menu { inset: 0 0 auto auto; width: min(320px, calc(100vw - 40px)); margin: 16px 20px 0 auto; padding: 0; border: 0; border-radius: 6px; background: #f3f0e8; color: var(--ink); box-shadow: 0 18px 40px rgb(40 36 30 / 0.22); }
      .menu::backdrop { background: rgb(28 28 26 / 0.42); }
      .menu[open] { animation: menu-in 180ms ease-out; }
      .menu[open]::backdrop { animation: menu-dim 180ms ease-out; }
      @keyframes menu-in { from { opacity: 0; transform: translateY(-8px); } }
      @keyframes menu-dim { from { background: rgb(28 28 26 / 0); } }
      @media (prefers-reduced-motion: reduce) { .menu[open], .menu[open]::backdrop { animation: none; } }
      .menu-sheet { display: flex; flex-direction: column; align-items: flex-end; padding: 14px 20px 22px; }
      .menu-close { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 16px; cursor: pointer; }
      .menu-links { display: flex; flex-direction: column; align-self: stretch; margin-top: 6px; border-top: 1px solid #cfcbc2; }
      .menu-links a { display: flex; justify-content: flex-end; align-items: center; min-height: 52px; border-bottom: 1px solid #cfcbc2; color: var(--ink); font-size: 20px; text-decoration: none; }
      .menu-links a:last-child { border-bottom: 0; }
      /* below 860 px, as the space and the Gallery fold theirs */
      @media (max-width: 860px) {
        header { align-items: center; }
        header nav { display: none; }
        .menu-open { display: block; }
      }
      @media (max-width: 600px) {
        body { font-size: 17px; }
        header { padding: 28px 22px 0; }
        .wordmark { font-size: 26px; }
        main { padding: 40px 22px 72px; }
        main h1 { font-size: 46px; }
        main h1 + p { font-size: 20px; }
        main h2 { font-size: 26px; }
      }
    </style>
  </head>
  <body>
    <header>
      <a class="wordmark" href="/">Throwaway</a>
      <nav>
        <a class="other-lang" href="${otherHref}" lang="${page.other.lang}" hreflang="${page.other.lang}">${page.other.label}</a>
        ${placeLinks("back")}
      </nav>
      <button type="button" class="menu-open" aria-haspopup="dialog" aria-expanded="false">${page.menu}</button>
      <dialog class="menu" aria-label="${page.menu}">
        <div class="menu-sheet">
          <button type="button" class="menu-close">${page.close}</button>
          <div class="menu-links">
            ${placeLinks("place")}
            <a href="${otherHref}" lang="${page.other.lang}" hreflang="${page.other.lang}">${page.other.label}</a>
          </div>
        </div>
      </dialog>
    </header>
    <script>
      (() => {
        const open = document.querySelector(".menu-open");
        const menu = document.querySelector(".menu");
        open.addEventListener("click", () => {
          menu.showModal();
          open.setAttribute("aria-expanded", "true");
        });
        menu.querySelector(".menu-close").addEventListener("click", () => menu.close());
        // a press on the dimmed page, outside the sheet, closes it
        menu.addEventListener("click", (e) => { if (e.target === menu) menu.close(); });
        menu.addEventListener("close", () => open.setAttribute("aria-expanded", "false"));
      })();
    </script>
    <main>
${body}
    </main>
  </body>
</html>
`;
}
