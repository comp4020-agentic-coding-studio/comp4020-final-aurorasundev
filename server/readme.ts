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

// Rendered server-side so the page carries the full README with no script:
// spec/invariants.test.ts reads the headings straight from this HTML.
export function renderReadmePage(readmePath: string): string {
  const body = markdown.parse(readFileSync(readmePath, "utf8"), { async: false });
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>About Throwaway</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
      :root {
        --bg: #e7e4de;
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
      .back { color: var(--ink); text-decoration: none; font-size: 17px; }
      .back:hover, .back:focus-visible { text-decoration: underline; }
      main { max-width: 860px; margin: 0 auto; padding: 56px 24px 96px; }
      main h1 { font-family: var(--serif); font-weight: 400; font-size: 64px; line-height: 1.1; margin: 0 0 8px; }
      /* D06: the opening line reads as a lead, section headings in the serif */
      main h1 + p { font-size: 23px; line-height: 1.45; margin: 0 0 8px; }
      main h2 { font-family: var(--serif); font-size: 34px; font-weight: 400; line-height: 1.2; margin: 48px 0 12px; }
      main h3 { font-size: 20px; font-weight: 600; margin: 32px 0 8px; }
      main p, main li { color: var(--ink); }
      main a { color: var(--ink); text-underline-offset: 3px; }
      main a:focus-visible, .back:focus-visible, .wordmark:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
      main img { max-width: 100%; height: auto; }
      main code { font-size: 0.9em; }
      main blockquote { margin: 0; padding-left: 16px; border-left: 3px solid var(--muted); color: var(--muted); }
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
      <a class="back" href="/">Back to the space</a>
    </header>
    <main>
${body}
    </main>
  </body>
</html>
`;
}
