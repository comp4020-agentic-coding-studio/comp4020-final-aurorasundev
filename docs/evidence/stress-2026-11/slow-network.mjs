// needs playwright-core and a Chromium; set PLAYWRIGHT_CORE and CHROME to their paths
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const exe = process.env.CHROME;
const base = process.argv[2] || "http://localhost:8080";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 20000 }); // ~slow 3G
  const t0 = Date.now(); await page.goto(base + "/", { timeout: 120000 }); await page.locator(".write-open, button:has-text('Leave something here')").first().waitFor({ timeout: 120000 });
  console.log("slow 3G first load usable:", Date.now() - t0, "ms");
  const before = Number((await page.locator("[class*=count]").first().textContent()).replace(/\D/g, ""));
  await page.locator("button:has-text('Leave something here')").first().click();
  await page.locator("textarea").first().fill("slow network probe");
  await page.locator("input[type=radio]").nth(0).check({ force: true });
  await page.locator("input[type=checkbox]").first().check({ force: true });
  const submit = page.locator("button:has-text('Crumple')").first();
  await submit.click(); await submit.click({ force: true, timeout: 2000 }).catch(() => {}); // double click under slow net
  await page.waitForFunction((b) => Number(document.querySelector("[class*=count]")?.textContent?.replace(/\D/g, "")) > b, before, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const after = Number((await page.locator("[class*=count]").first().textContent()).replace(/\D/g, ""));
  console.log("count", before, "->", after, "(expect +1 despite double click)", "errors:", errs.length);
  // drop offline mid-session, come back: stream reconciles
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await fetch(base + "/api/session", { method: "POST" }).then((r) => r.headers.get("set-cookie").split(";")[0]).then((c) => fetch(base + "/api/papers", { method: "POST", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify({ content: "while offline", mode: "KEEP", confirmed: true, submission_key: crypto.randomUUID() }) }));
  await page.waitForTimeout(3000);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.waitForFunction((b) => Number(document.querySelector("[class*=count]")?.textContent?.replace(/\D/g, "")) > b, after, { timeout: 30000 });
  console.log("after offline->online, count caught up to", Number((await page.locator("[class*=count]").first().textContent()).replace(/\D/g, "")));
  await page.screenshot({ path: "slow-network.png" });
} finally { await browser.close(); }
