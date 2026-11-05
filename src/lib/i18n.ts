import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError } from "./api.ts";
import { ALT_ZH, SERVER_ZH, TITLE_ZH, ZH, type Key } from "./i18n-dict.ts";

// The interface language: English (the default) or simplified Chinese. One
// choice for the whole site, kept in this browser only (never sent), read by
// both pages so it carries between the space and the Gallery. Interface text
// only: what people write is never translated. Record titles and alt text
// come from the server's fixed tables, so they switch too (i18n-dict.ts).

export type Lang = "en" | "zh";
export type { Key };

export const LANG_KEY = "throwaway.lang";

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "zh" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function fromUrl(): Lang | null {
  try {
    const v = new URLSearchParams(window.location.search).get("lang");
    return v === "zh" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

let current: Lang | null = null;
const listeners = new Set<() => void>();

function apply(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-AU";
}

export function getLang(): Lang {
  if (current === null) {
    current = typeof window === "undefined" ? "en" : (fromUrl() ?? stored() ?? "en");
    apply(current);
  }
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // blocked storage: the choice holds for this page only
  }
  apply(lang);
  for (const fn of listeners) fn();
}

// forgets the in-memory choice, so the next read comes from storage again
// (tests remount the app as if on a new page)
export function resetLangForTests() {
  current = null;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLang(): Lang {
  const lang = useSyncExternalStore(subscribe, getLang, () => "en" as Lang);
  useEffect(() => apply(lang), [lang]);
  return lang;
}

// A message held in state: an English interface string, or a server
// refusal kept with its stable code, translated when it is shown so a
// change of language changes it too.
export type Msg = string | { code: string; message: string };

export const errorMsg = (err: unknown, fallback: Key): Msg =>
  err instanceof ApiError ? { code: err.code, message: err.message } : fallback;

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// A server refusal in Chinese: by its code (and, where one code carries
// several texts, its English), else the code's general meaning; an unknown
// code keeps the server's English.
export function serverText(lang: Lang, code: string, message: string): string {
  if (lang === "en") return message;
  return SERVER_ZH[`${code}|${message}`] ?? SERVER_ZH[code] ?? (ZH as Record<string, string>)[message] ?? message;
}

export function titleText(lang: Lang, title: string): string {
  return lang === "zh" ? (TITLE_ZH[title] ?? title) : title;
}

// The phrases themselves hold commas, so the pieces are found by matching
// whole known phrases from each end, never by splitting.
const ALT_HEAD = "An abstract artwork: ";
export function altText(lang: Lang, alt: string): string {
  if (lang === "en" || !alt.startsWith(ALT_HEAD) || !alt.endsWith(".")) return alt;
  const body = alt.slice(ALT_HEAD.length, -1);
  for (const [relation, rel] of Object.entries(ALT_ZH.relation)) {
    if (!body.endsWith(", " + relation)) continue;
    const thing = body.slice(0, -(relation.length + 2));
    for (const [metaphor, zm] of Object.entries(ALT_ZH.metaphor)) {
      if (!thing.startsWith(metaphor + " ")) continue;
      const material = (ALT_ZH.material as Record<string, string>)[thing.slice(metaphor.length + 1)];
      if (material) return `一件抽象作品：${zm}，${material}；${rel}。`;
    }
  }
  return alt;
}

export type T = ((key: Key, vars?: Record<string, string | number>) => string) & {
  lang: Lang;
  msg: (m: Msg) => string;
  title: (title: string) => string;
  alt: (alt: string) => string;
  // numbers as the language writes them
  num: (n: number) => string;
};

export function translator(lang: Lang): T {
  const t = ((key: Key, vars?: Record<string, string | number>) => fill(lang === "zh" ? ZH[key] : key, vars)) as T;
  t.lang = lang;
  t.msg = (m) =>
    typeof m === "string" ? (lang === "zh" ? ((ZH as Record<string, string>)[m] ?? m) : m) : serverText(lang, m.code, m.message);
  t.title = (title) => titleText(lang, title);
  t.alt = (alt) => altText(lang, alt);
  t.num = (n) => n.toLocaleString(lang === "zh" ? "zh-CN" : "en-AU");
  return t;
}

export function useT(): T {
  const lang = useLang();
  return useMemo(() => translator(lang), [lang]);
}

// The header toggle: one press to the other language. Its name says where it
// goes, in that language; the visible label marks each language's own text.
export function useLangToggle() {
  const lang = useLang();
  const toggle = useCallback(() => setLang(lang === "zh" ? "en" : "zh"), [lang]);
  return { lang, toggle };
}

// The About page in the chosen language
export const aboutHref = (lang: Lang): string => (lang === "zh" ? "/readme/zh/" : "/readme/");
