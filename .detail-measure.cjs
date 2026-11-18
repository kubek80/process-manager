const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8094';
(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1366, 768]]) for (const who of ['sam@example.com', 'alex@example.com']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.request.post(BASE + '/auth/dev/login', { data: { email: who }, headers: { 'X-Requested-With': 'process-manager' } });
    await page.goto(BASE + '/#/p/request-gcp-project/flow');
    await page.waitForSelector('.flow-scroll');
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const top = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; };
      return { wrap: top('.flow-wrap'), lanes: top('.flow-canvas'), engage: top('.doc-engage'), engageH: Math.round(document.querySelector('.doc-engage')?.getBoundingClientRect().height ?? 0), before: top('.before-panel'), beforeH: Math.round(document.querySelector('.before-panel')?.getBoundingClientRect().height ?? 0) };
    });
    console.log(w + 'x' + h, who.split('@')[0], JSON.stringify(r), 'visible map px', h - r.lanes);
    if (process.argv[2]) await page.screenshot({ path: process.argv[2] + `/measure-${w}-${who.split('@')[0]}.png` });
    await ctx.close();
  }
  await browser.close();
})();
