const { chromium } = require('playwright');
const OUT = '/tmp/claude-0/-home-user-process-manager/6937071f-1168-55b9-a1f9-02a74234a2d3/scratchpad/lists/';
const BASE = 'http://127.0.0.1:8093';
(async () => {
  const browser = await chromium.launch();
  const run = async (name, { email = 'sam@example.com', editor = false, theme = 'light', width = 1440, path = '/#/processes', act } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.request.post(BASE + '/auth/dev/login', { data: { email }, headers: { 'X-Requested-With': 'process-manager' } });
    await page.addInitScript(([mode, theme]) => { localStorage.setItem('pm:mode', mode); localStorage.setItem('pm:theme', theme); }, [editor ? 'editor' : 'consumer', theme]);
    await page.goto(BASE + path);
    await page.waitForTimeout(900);
    if (act) await act(page);
    await page.screenshot({ path: OUT + name + '.png', fullPage: !!process.env.FULL });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(name, 'scrollWidth', sw, 'errors', errors.slice(0, 3));
    await ctx.close();
  };
  const which = process.argv.slice(2);
  const all = {
    'processes-1440': {},
    'processes-1440-dark': { theme: 'dark' },
    'standards-1440': { path: '/#/standards' },
    'search-1440': { path: '/#/search?q=request' },
    'processes-1024': { width: 1024 },
    'processes-768': { width: 768 },
    'processes-390': { width: 390 },
    'processes-360-open': { width: 360, act: async (p) => { await p.getByRole('button', { name: /^Filters/ }).click(); } },
    'processes-alex-editor': { email: 'alex@example.com', editor: true },
    'dropdown-open': { act: async (p) => { await p.getByRole('button', { name: /^Category:/ }).focus(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Space'); } },
    'home-1440': { path: '/#/' },
    'page2-360': { width: 360, act: async (p) => { await p.getByLabel('Items per page').selectOption('12'); await p.getByRole('button', { name: 'Next page' }).click(); await p.waitForTimeout(800); } },
    'page2-1024': { width: 1024, act: async (p) => { await p.getByLabel('Items per page').selectOption('12'); await p.getByRole('button', { name: 'Page 2' }).click(); await p.waitForTimeout(800); console.log(await p.locator('.list-count').innerText(), await p.evaluate(() => document.activeElement.className)); await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300); } },
    'home-bookmarks': { path: '/#/processes', act: async (p) => {
      for (const t of ['Onboard a site to Akamai', 'Book an architecture review']) { await p.getByRole('button', { name: 'Bookmark ' + t }).click(); await p.waitForTimeout(300); }
      await p.getByRole('button', { name: 'Upvote Onboard a site to Akamai (0)' }).click();
      await p.waitForTimeout(400);
      console.log('url after clicks', p.url());
      await p.goto('http://127.0.0.1:8093/#/'); await p.waitForTimeout(900); } },
    'bookmarked-filter': { path: '/#/processes', act: async (p) => { await p.getByRole('checkbox', { name: /Only my bookmarks/ }).check(); await p.waitForTimeout(300); } },
    'chosen-filters': { path: '/#/processes', act: async (p) => {
      await p.getByRole('button', { name: /^Category:/ }).click(); await p.getByRole('checkbox', { name: /^Cloud,/ }).check();
      await p.getByRole('checkbox', { name: /^Network,/ }).check();
      await p.getByLabel('Tier').selectOption({ label: 'Tier 0' });
      await p.keyboard.press('Escape'); } },
  };
  for (const [k, v] of Object.entries(all)) if (!which.length || which.includes(k)) await run(k, v);
  await browser.close();
})();
