const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  await p.request.post('http://127.0.0.1:8093/auth/dev/login', { data: { email: 'sam@example.com' }, headers: { 'X-Requested-With': 'process-manager' } });
  await p.goto('http://127.0.0.1:8093/#/processes'); await p.waitForTimeout(800);
  console.log(await p.evaluate(() => {
    const out = [];
    for (const sel of ['.list-results', '.upvote-btn', '.upvote-btn svg', '.engage-count']) {
      const el = document.querySelector(sel); if (!el) { out.push(sel + ' none'); continue; }
      const cs = getComputedStyle(el);
      out.push(sel + ' ' + [cs.display, cs.border, cs.background.slice(0,40), cs.padding, cs.width, cs.height, cs.flexDirection].join(' | '));
    }
    return out.join('\n');
  }));
  const r = await p.request.get('http://127.0.0.1:8093/api/engagement'); console.log('engagement', r.status());
  await b.close();
})();
