import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";
import { ARTIFACT_TITLES, artifactAlt } from "../server/artifacts/provider.ts";
import { MATERIALS, METAPHORS, RELATIONS, type CreativeBriefV2 } from "../server/artifacts/types.ts";
import { ALT_ZH, SERVER_ZH, TITLE_ZH, ZH } from "../src/lib/i18n-dict.ts";
import { altText, titleText } from "../src/lib/i18n.ts";

// The Chinese interface is complete: every English string has a Chinese one,
// every record title the server can give has a translation, and the Chinese
// About page is served beside the English one.

const baseUrl = inject("baseUrl");
const cjk = /[㐀-鿿]/;

it("has a Chinese value for every English interface string and server refusal", () => {
  for (const [en, zh] of Object.entries(ZH)) {
    expect(zh.trim(), en).not.toBe("");
    expect(zh, en).not.toBe(en);
    // placeholders survive translation
    expect(zh.match(/\{\w+\}/g) ?? [], en).toEqual(en.match(/\{\w+\}/g) ?? []);
  }
  for (const [code, zh] of Object.entries(SERVER_ZH)) expect(zh, code).toMatch(cjk);
});

it("translates every record title in the server's fixed table, and only those", () => {
  const titles = Object.values(ARTIFACT_TITLES).flatMap((byRelation) => Object.values(byRelation));
  expect(titles).toHaveLength(30);
  for (const title of titles) {
    expect(TITLE_ZH[title], title).toMatch(cjk);
    expect(titleText("zh", title)).toBe(TITLE_ZH[title]);
    expect(titleText("en", title)).toBe(title);
  }
  expect(Object.keys(TITLE_ZH).sort()).toEqual([...titles].sort());
  // anything else (an older title, say) stays as stored
  expect(titleText("zh", "Knot in clay")).toBe("Knot in clay");
});

it("translates every alt text the server builds today, exactly from its phrases, and leaves others in English", () => {
  const seen = new Set<string>();
  for (const metaphor of METAPHORS)
    for (const material of MATERIALS)
      for (const relation of RELATIONS) {
        const alt = artifactAlt({ metaphor, material, relation } as CreativeBriefV2);
        const zh = altText("zh", alt);
        expect(zh, alt).toMatch(/^一件抽象作品：/);
        // each piece is its own exact phrase: the material and relation are found whole
        expect(zh.endsWith("。")).toBe(true);
        expect(Object.values(ALT_ZH.relation).some((r) => zh.endsWith(`；${r}。`)), alt).toBe(true);
        seen.add(zh);
      }
  // every combination reads differently: nothing collapsed into another
  expect(seen.size).toBe(METAPHORS.length * MATERIALS.length * RELATIONS.length);
  const old = "An abstract object: a small hollow vessel made of unglazed clay, slightly opening.";
  expect(altText("zh", old)).toBe(old);
});

const text = (html: string) => new JSDOM(html).window.document.body.textContent ?? "";
const headings = (md: string) => [...md.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1].trim());

it("serves the Chinese About page at /readme/zh/, linked both ways with /readme/", async () => {
  const res = await fetch(new URL("/readme/zh/", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<html lang="zh-CN">');
  const served = text(html);
  let from = 0;
  for (const heading of headings(readFileSync("README.zh.md", "utf8"))) {
    const at = served.indexOf(heading, from);
    expect(at, `/readme/zh/ is missing "${heading}" (or has it out of order)`).not.toBe(-1);
    from = at + heading.length;
  }
  const doc = new JSDOM(html).window.document;
  expect(doc.querySelector('a.other-lang[href="/readme/"]')?.textContent).toBe("English");

  const en = new JSDOM(await (await fetch(new URL("/readme/", baseUrl))).text()).window.document;
  expect(en.documentElement.lang).toBe("en-AU");
  expect(en.querySelector('a.other-lang[href="/readme/zh/"]')?.textContent).toBe("中文");
});
