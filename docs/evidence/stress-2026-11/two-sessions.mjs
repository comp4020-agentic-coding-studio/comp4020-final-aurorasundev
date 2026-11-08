// needs playwright-core and a Chromium; set PLAYWRIGHT_CORE and CHROME to their paths
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const exe = process.env.CHROME;
const base = process.argv[2] || "http://localhost:8080";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] });
try {
  const A = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const B = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })).newPage();
  await Promise.all([A.goto(base + "/"), B.goto(base + "/")]);
  await A.waitForTimeout(3000);
  const count = (p) => p.evaluate(() => Number(document.querySelector(".header-count, .count, [class*=count]")?.textContent?.replace(/\D/g, "") || NaN));
  console.log("start counts", await count(A), await count(B));
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const before = await count(B);
    const t0 = Date.now();
    const r = await A.evaluate(async () => { const res = await fetch("/api/papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "realtime probe", mode: "RELEASE", confirmed: true, submission_key: crypto.randomUUID() }) }); return [res.status, await res.json()]; });
    const tSaved = Date.now();
    await B.waitForFunction((b) => Number(document.querySelector(".header-count, .count, [class*=count]")?.textContent?.replace(/\D/g, "")) > b, before, { timeout: 5000, polling: 20 });
    console.log(`A save ${r[0]} -> B saw it ${Date.now() - tSaved} ms after reply (${Date.now() - t0} ms after click)`);
    ids.push(r[1].id ?? r[1].paper?.id);
  }
  // reverse direction: B saves, A sees
  const before = await count(A); const t1 = Date.now();
  await B.evaluate(async () => fetch("/api/papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "realtime probe B", mode: "KEEP", confirmed: true, submission_key: crypto.randomUUID() }) }));
  const t2 = Date.now();
  await A.waitForFunction((b) => Number(document.querySelector(".header-count, .count, [class*=count]")?.textContent?.replace(/\D/g, "")) > b, before, { timeout: 5000, polling: 20 });
  console.log(`B save -> A saw it ${Date.now() - t2} ms after reply`);
  console.log("end counts", await count(A), await count(B));
} finally { await browser.close(); }
