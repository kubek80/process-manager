const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8095", CSRF = { "X-Requested-With": "process-manager" };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 390, height: 900 } });
  await page.request.post(BASE + "/auth/dev/login", { data: { email: "dana@example.com" }, headers: CSRF });
  await page.addInitScript(() => localStorage.setItem("pm:mode", "editor"));
  await page.route("**/api/admin/statistics?*", async (r) => {
    const res = await r.fetch(); const j = await res.json();
    j.totals.views = 20; j.totals.deletedViews = 4; j.totals.deletedDownloads = 1;
    j.trend = j.trend.map((w, i, a) => ({ ...w, views: 3 + i * 2, days: i === 0 ? 2 : i === a.length - 1 ? 3 : 7 }));
    await r.fulfill({ response: res, json: j });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "/#/admin/statistics"); await page.locator(".stat-trend svg").waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  for (const t of [100, 300, 1000]) { await page.waitForTimeout(t); console.log(t, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
  console.log(await page.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > W + 0.5).slice(0, 8).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right) + " in " + e.parentElement.className); }));
  for (const h of ["/requests", "/admin/activity", "/admin/access"]) {
    await page.goto(BASE + "/#" + h); await page.locator("h1").first().waitFor(); await page.waitForTimeout(800);
    console.log(h, await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const out = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > W + 0.5).slice(0, 5).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right));
      return [document.documentElement.scrollWidth - W, out];
    }));
  }
  await b.close();
})();
