import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// The About page is served as plain HTML, outside React, so it carries its own
// copy of the phone's Menu (owner, 2026-11-08): the same places as its header
// row, in a modal sheet that the page's own script opens and closes.

const baseUrl = inject("baseUrl");

// Arrived at from the Gallery (its About link says ?from=gallery), the way
// back to the Gallery comes first and the language switch keeps that; from
// the space or directly, the space comes first and the Gallery is offered
// as a place to go (owner, 2026-11-09).
for (const [path, places, hrefs] of [
  ["/readme/", ["Back to the space", "Go to the Gallery", "中文"], ["/", "/gallery/", "/readme/zh/"]],
  ["/readme/zh/", ["回到空间", "去展馆看看", "English"], ["/", "/gallery/", "/readme/"]],
  ["/readme/?from=gallery", ["Back to the Gallery", "Back to the space", "中文"], ["/gallery/", "/", "/readme/zh/?from=gallery"]],
  ["/readme/zh/?from=gallery", ["回到展馆", "回到空间", "English"], ["/gallery/", "/", "/readme/?from=gallery"]],
  ["/readme/?from=elsewhere", ["Back to the space", "Go to the Gallery", "中文"], ["/", "/gallery/", "/readme/zh/"]],
] as const) {
  it(`${path} folds its header places into a Menu that opens over a dimmed page`, async () => {
    const dom = new JSDOM(await (await fetch(new URL(path, baseUrl))).text(), { runScripts: "dangerously" });
    const doc = dom.window.document;
    const proto = dom.window.HTMLDialogElement.prototype;
    proto.showModal = function () {
      this.setAttribute("open", "");
    };
    proto.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new dom.window.Event("close"));
    };

    const links = [...doc.querySelectorAll(".menu-links a")];
    expect(links.map((a) => a.textContent)).toEqual(places);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(hrefs);
    // the header row on a wide screen offers the same places
    const row = [...doc.querySelectorAll("header nav a")];
    expect(new Set(row.map((a) => a.getAttribute("href")))).toEqual(new Set(hrefs));

    const opener = doc.querySelector<HTMLButtonElement>(".menu-open")!;
    const menu = doc.querySelector<HTMLDialogElement>("dialog.menu")!;
    opener.click();
    expect(menu.hasAttribute("open")).toBe(true);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    doc.querySelector<HTMLElement>(".menu-sheet")!.click();
    expect(menu.hasAttribute("open")).toBe(true);
    menu.click();
    expect(menu.hasAttribute("open")).toBe(false);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    opener.click();
    doc.querySelector<HTMLButtonElement>(".menu-close")!.click();
    expect(menu.hasAttribute("open")).toBe(false);
    dom.window.close();
  });
}
