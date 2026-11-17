const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.request.post('http://127.0.0.1:8093/auth/dev/login', { data: { email: 'sam@example.com' }, headers: { 'X-Requested-With': 'process-manager' } });
  await p.goto('http://127.0.0.1:8093/#/processes'); await p.waitForTimeout(800);
  const active = () => p.evaluate(() => { const a = document.activeElement; return `${a.tagName} ${a.getAttribute('aria-label') ?? a.textContent.slice(0, 30)} expanded=${a.getAttribute('aria-expanded')}`; });
  await p.getByRole('button', { name: /^Category:/ }).focus();
  await p.keyboard.press('ArrowDown'); console.log('after ArrowDown:', await active());
  await p.keyboard.press('ArrowDown'); console.log('after ArrowDown:', await active());
  await p.keyboard.press('Space'); await p.waitForTimeout(100); console.log('after Space:', await active(), await p.locator('.list-count').innerText());
  await p.keyboard.press('Escape'); console.log('after Escape:', await active());
  await p.keyboard.press('Enter'); console.log('Enter on button:', await active());
  await p.keyboard.press('Tab'); console.log('Tab:', await active());
  await p.keyboard.press('Escape');
  // tab order in the first card
  await p.getByRole('button', { name: 'Clear all filters' }).click();
  await p.locator('li.card').first().locator('.card-link').focus();
  for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); console.log('card tab', i, await active()); }
  // clicking the card body opens it
  await p.locator('li.card', { hasText: 'Onboard a site to Akamai' }).click();
  await p.waitForTimeout(400); console.log('after card click', p.url());
  await p.goto('http://127.0.0.1:8093/#/search?q=gcp'); await p.waitForTimeout(800);
  console.log('search count:', await p.locator('.list-count').innerText());
  await p.getByRole('button', { name: /^Type:/ }).click(); await p.getByRole('checkbox', { name: /^Standards,/ }).check(); await p.waitForTimeout(200);
  console.log('url', p.url(), await p.locator('.list-count').innerText());
  console.log('errors', errs);
  await b.close();
})();
