import { expect, test } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, RILEY, SAM, fields, meaningReady, open, outlineNav, signIn } from "./helpers";

// What a phone, a tablet and a small laptop show. A page that scrolls sideways hides controls
// off screen, so no page may be wider than the screen.
const PAGES = ["/", "/search?q=gcp", "/search?q=logging&type=standard&rigour=mandatory", "/processes", "/standards", "/p/request-gcp-project/flow", "/p/request-gcp-project/list", "/p/request-gcp-project/flow/raise-request",
  "/s/secure-logging/doc", "/s/secure-logging/doc/SEC-LOG-02", "/teams", "/tools", "/pillar/core-network", "/guide", "/mine", "/requests", "/requests?state=all"];
const ADMIN = ["/p/request-gcp-project/edit", "/p/request-gcp-project/edit/raise-request", "/s/secure-logging/edit", "/s/secure-logging/edit/SEC-LOG-02", "/admin/access", "/admin/teams", "/admin/tools", "/admin/skills", "/admin/health", "/admin/activity", "/admin/statistics", "/admin/system", "/admin/code", "/admin/code/tables", "/admin/code/vectors/file/server/internal/retrieval/retrieval.go"];

// the server listens before its index is complete: wait until search by meaning answers
test.beforeAll(async ({ request }) => { await meaningReady(request); });

const box = (page: import("@playwright/test").Page) => page.getByRole("searchbox", { name: "Search processes and standards" });
const sideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, width] of [["a small phone", 360], ["a phone", 390], ["a tablet", 768], ["a small laptop", 1024]] as const) {
  test(`no page scrolls sideways on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, SAM);
    for (const hash of PAGES) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as a reader at ${width}px`).toBe(0);
    }
    // owners of a practice and of a platform: one more entry in the top bar, and a page with tables of its own
    for (const who of [RILEY, JORDAN]) {
      await signIn(page, who);
      for (const hash of ["/", "/search?q=gcp", "/mine", "/s/secure-logging/doc", "/p/request-gcp-project/flow"]) {
        await open(page, hash);
        await expect(page.locator("h1").first()).toBeVisible();
        expect(await sideways(page), `${hash} as ${who} at ${width}px`).toBe(0);
      }
    }
    await signIn(page, DANA);
    for (const hash of [...PAGES, ...ADMIN]) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as an editor at ${width}px`).toBe(0);
    }
  });
}

for (const width of [390, 360]) {
  test(`on a phone ${width} wide the top bar keeps every control within reach`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // the longest top bar there can be: an admin who also answers for a team has eight links
    await signIn(page, DANA);
    const role = { email: DANA, role: "owner", scope: "dns-team" };
    expect((await page.request.post("/api/admin/access", { data: role, headers: CSRF })).ok()).toBeTruthy();
    try {
      for (const who of [DANA, JORDAN]) {
        await signIn(page, who);
        await open(page, "/");
        await expect(page.locator("h1").first()).toBeVisible();
        // the places are behind "Menu": a sheet of labelled places, the current one marked
        await expect(page.locator("nav.nav")).toBeHidden();
        const menu = page.locator("button.menu-btn");
        await expect(menu, `${who} at ${width}px`).toBeInViewport({ ratio: 1 });
        await expect(menu).toHaveAccessibleName(/^Menu(, \d+ waiting)?$/);
        await expect(menu).toHaveAttribute("aria-expanded", "false");
        await expect(menu).toHaveAttribute("aria-controls", "main-menu");
        await expect(page.getByRole("button", { name: "Your account" }), `${who} at ${width}px`).toBeInViewport({ ratio: 1 });
        await menu.click();
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        const sheet = page.getByRole("navigation", { name: "Main" });
        await expect(sheet).toBeVisible();
        const places = ["Home", "Patterns", "Standards", "Services", "Requests", /^My responsibilities/, "Teams", "Tools", "Guide", ...(who === DANA ? ["Admin"] : [])];
        for (const place of places) {
          const link = sheet.getByRole("link", { name: place });
          await expect(link, `${who} at ${width}px: ${place}`).toBeInViewport({ ratio: 1 });
          expect((await link.boundingBox())!.height, `${place} is a touch target`).toBeGreaterThanOrEqual(44);
        }
        await expect(sheet.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
        await expect(sheet.locator("a.on")).toHaveCount(1);
        expect(await sideways(page), `the menu for ${who} at ${width}px`).toBe(0);
        // Escape closes it and gives the focus back to the button
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
        await expect(menu).toBeFocused();
        // choosing a place goes there and closes it; the button shows where one is
        await menu.click();
        await sheet.getByRole("link", { name: "Standards" }).click();
        await expect(page).toHaveURL(/#\/standards$/);
        await expect(sheet).toBeHidden();
        await expect(menu.locator(".menu-here")).toHaveText("Standards");
        await menu.click();
        await expect(sheet.getByRole("link", { name: "Standards" })).toHaveAttribute("aria-current", "page");
        // a press outside closes it
        await page.mouse.click(5, 800);
        await expect(sheet).toBeHidden();
        expect(await sideways(page), `top bar for ${who} at ${width}px`).toBe(0);
      }
    } finally {
      await signIn(page, DANA);
      await page.request.delete("/api/admin/access", { data: role, headers: CSRF });
    }
  });
}

test("the longest top bar fits every width without scrolling sideways", async ({ page }) => {
  await signIn(page, DANA);
  const role = { email: DANA, role: "owner", scope: "dns-team" };
  expect((await page.request.post("/api/admin/access", { data: role, headers: CSRF })).ok()).toBeTruthy();
  try {
    await open(page, "/");
    await expect(page.locator(".nav a")).toHaveCount(10);
    for (const width of [1440, 1366, 1280, 1200, 1100, 1024, 1000, 900, 800, 700, 600, 520, 480, 440, 414, 400, 375, 360]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await sideways(page), `top bar at ${width}px`).toBe(0);
    }
  } finally {
    await page.request.delete("/api/admin/access", { data: role, headers: CSRF });
  }
});

test("a step opens as a panel that works with the keyboard alone", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  const first = page.locator(".block-main").first();
  await first.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Decide the project details" });
  await expect(panel).toBeVisible();
  // focus has moved into the panel, Escape closes it and focus goes back to where it was
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(first).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`requests, statistics and the share dialog fit a phone in the ${theme} theme`, async ({ page }) => {
    await signIn(page, DANA);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    for (const width of [360, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const hash of ["/requests", "/requests?state=all", "/admin/statistics"]) {
        await open(page, hash);
        await expect(page.locator("h1").first()).toBeVisible();
        if (hash === "/admin/statistics") await expect(page.locator(".stat-totals")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await sideways(page), `${hash} at ${width}px, ${theme}`).toBe(0);
      }
      await open(page, "/requests");
      await page.getByRole("button", { name: "Ask for a process or standard" }).first().click();
      const ask = page.getByRole("dialog", { name: "Ask for a process or standard" });
      await expect(ask.getByRole("button", { name: "Send request" })).toBeVisible();
      expect(await sideways(page), `the request form at ${width}px, ${theme}`).toBe(0);
      await page.keyboard.press("Escape");

      await open(page, "/p/request-gcp-project/flow");
      await page.getByRole("button", { name: "Share" }).click();
      const share = page.getByRole("dialog", { name: /^Share “/ });
      await expect(share.getByRole("textbox", { name: "Link" })).toBeInViewport({ ratio: 1 });
      for (const option of ["Copy link", "Copy link and title"]) await expect(share.getByRole("button", { name: option, exact: option === "Copy link" ? true : undefined })).toBeInViewport({ ratio: 1 });
      await expect(share.getByRole("link", { name: /Email/ })).toBeInViewport({ ratio: 1 });
      expect(await sideways(page), `the share dialog at ${width}px, ${theme}`).toBe(0);
      // the numbers and the buttons near the top of the page fit as well
      await page.keyboard.press("Escape");
      const engage = page.getByRole("group", { name: "Use and feedback" });
      for (const b of await engage.getByRole("button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.x + box.width, `${await b.getAttribute("aria-label") ?? await b.innerText()} at ${width}px`).toBeLessThanOrEqual(width);
      }
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`the search page with Words, Meaning and Both fits every width in the ${theme} theme`, async ({ page }) => {
    await signIn(page, CASEY);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    for (const width of [360, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const hash of ["/search?q=gcp", "/search?q=cloud&mode=meaning", "/search?q=cloud&mode=both"]) {
        await open(page, hash);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator(".search-page ol.cards > li.card").first()).toBeVisible();
        const modes = page.getByRole("radiogroup", { name: "Search by" });
        for (const name of ["Words", "Meaning", "Both"]) await expect(modes.getByRole("radio", { name, exact: true }), `${name} at ${width}px`).toBeInViewport({ ratio: 1 });
        // the help is hidden until "How this works" is pressed; opened, every line fits
        const more = page.getByRole("button", { name: "How this works" });
        if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
        await expect(page.locator("#search-mode-help")).toBeVisible();
        for (const line of await page.locator("#search-mode-help li").all()) {
          const rect = (await line.boundingBox())!;
          expect(rect.x + rect.width, `${await line.innerText()} at ${width}px`).toBeLessThanOrEqual(width);
        }
        expect(await sideways(page), `${hash} at ${width}px, ${theme}`).toBe(0);
      }
      // the notices of the second status line fit as well: an earlier search, and a problem
      await box(page).fill("a much longer question about cloud projects and their budgets");
      await expect(page.locator("p.search-earlier")).toBeVisible();
      expect(await sideways(page), `the earlier-search notice at ${width}px, ${theme}`).toBe(0);
      await page.route(/\/api\/search\?/, (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"x"}' }));
      await box(page).press("Enter");
      await expect(page.locator(".search-problem")).toBeVisible();
      await expect(page.locator(".search-problem button")).toBeInViewport({ ratio: 1 });
      expect(await sideways(page), `a problem at ${width}px, ${theme}`).toBe(0);
      await page.unroute(/\/api\/search\?/);
    }
  });
}

// ---------- the editing screen

const SCREENS = [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [360, 740]] as const;

for (const theme of ["light", "dark"] as const) {
  test(`the editing screen of a process and of a standard fits every screen in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, DANA);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    for (const [width, height] of SCREENS) {
      await page.setViewportSize({ width, height });
      for (const [hash, item] of [["/p/request-gcp-project/edit", /^3 /], ["/s/secure-logging/edit", /^SEC-LOG-02 /]] as const) {
        await open(page, hash);
        const at = `${hash} at ${width}x${height}, ${theme}`;
        const bar = page.locator(".edit-bar");
        await expect(bar).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator(".topbar"), at).toHaveCount(0); // a screen of its own: the editing bar takes the place of the top bar
        // every control of the editing bar is within reach
        const phone = width <= 760;
        // on a phone Undo and Redo are in More, to keep the bar to two rows
        for (const control of [bar.getByRole("button", { name: /^Back to reading/ }), ...(phone ? [] : [bar.getByRole("button", { name: "Undo" }), bar.getByRole("button", { name: "Redo" })]),
          bar.locator(".eb-status"), bar.getByRole("button", { name: /^More/ }), bar.getByRole("button", { name: "Save draft" }), bar.getByRole("button", { name: "Publish…" }), bar.locator(".eb-state")]) {
          await expect(control, at).toBeInViewport({ ratio: 1 });
        }
        if (phone) {
          await expect(bar.getByRole("button", { name: "Undo" }), at).toHaveCount(0);
          // two rows: the state and the actions below Back and the title
          const [back, save] = [(await bar.getByRole("button", { name: /^Back to reading/ }).boundingBox())!, (await bar.getByRole("button", { name: "Save draft" }).boundingBox())!];
          expect(save.y, at).toBeGreaterThan(back.y + back.height - 2);
          // touch targets of at least 44 px
          for (const b of [bar.getByRole("button", { name: "Save draft" }), bar.getByRole("button", { name: "Publish…" }), bar.getByRole("button", { name: /^More/ })])
            expect((await b.boundingBox())!.height, at).toBeGreaterThanOrEqual(44);
        }
        expect(await sideways(page), at).toBe(0);
        const outline = page.locator(".edit-outline");
        const middle = page.locator(".edit-middle");
        const side = page.locator(".edit-fields");
        if (width >= 1280) {
          // three columns side by side, none crushed: outline, fields, what readers will see
          const [o, m, f] = [(await outline.boundingBox())!, (await middle.boundingBox())!, (await side.boundingBox())!];
          expect(o.x + o.width, at).toBeLessThanOrEqual(f.x + 1);
          expect(f.x + f.width, at).toBeLessThanOrEqual(m.x + 1);
          expect(m.width, at).toBeGreaterThan(500);
          expect(o.width, at).toBeGreaterThan(200);
          expect(f.width, at).toBeGreaterThan(300);
          await expect(page.locator(".panel-strip"), at).toBeHidden();
        } else {
          // the outline slides over the page when asked for, and goes away again
          await expect(page.getByRole("navigation", { name: /^Outline of the/ }), at).toBeHidden();
          await page.locator(".panel-strip").getByRole("button", { name: "Outline" }).click();
          await expect(page.getByRole("navigation", { name: /^Outline of the/ }), at).toBeInViewport();
          expect(await sideways(page), `${at}, outline open`).toBe(0);
          await page.getByRole("button", { name: "Close the outline" }).click();
          await expect(page.getByRole("navigation", { name: /^Outline of the/ }), at).toBeHidden();
          if (width > 760) {
            // the fields stay a column of their own, before the map
            const [m, f] = [(await middle.boundingBox())!, (await side.boundingBox())!];
            expect(f.x + f.width, at).toBeLessThanOrEqual(m.x + 1);
            await expect(side, at).toBeInViewport();
          }
        }
        // selecting something shows its fields; on a phone they slide over and can be closed
        await page.locator(".panel-strip").getByRole("button", { name: "Outline" }).or(page.getByRole("navigation", { name: /^Outline of the/ }).getByRole("button", { name: "About" })).first().click();
        await page.getByRole("navigation", { name: /^Outline of the/ }).getByRole("button", { name: item }).click();
        await expect(fields(page).locator(".fields-head h2"), at).toBeInViewport();
        expect(await sideways(page), `${at}, fields open`).toBe(0);
        if (width <= 760) {
          await page.getByRole("button", { name: hash.startsWith("/p/") ? "Back to the map" : "Back to the requirements" }).click();
          await expect(fields(page).locator(".fields-head h2"), at).toBeHidden();
        }
        // the More menu fits too
        await bar.getByRole("button", { name: /^More/ }).click();
        for (const it of await page.getByRole("menu", { name: "More" }).getByRole("menuitem").all()) await expect(it, at).toBeInViewport({ ratio: 1 });
        await page.keyboard.press("Escape");
        expect(await sideways(page), `${at}, menu`).toBe(0);
      }
    }
  });
}

test("the editing screen reads outline, fields, what readers will see: on the screen, for Tab and for “Skip to the page”", async ({ page }) => {
  await signIn(page, DANA);
  /** Which column the keyboard is in. */
  const column = () => page.evaluate(() => {
    const a = document.activeElement;
    return a?.closest(".edit-outline") ? "outline" : a?.closest(".edit-fields") ? "fields" : a?.closest(".edit-middle") ? "preview" : "elsewhere";
  });
  const outline = page.locator(".edit-outline"), side = page.locator(".edit-fields"), middle = page.locator(".edit-middle");
  for (const [hash, item] of [["/p/request-gcp-project/edit", /^3 /], ["/s/secure-logging/edit", /^SEC-LOG-02 /]] as const) {
    // a laptop: three columns that meet, the fields between where one chooses and what it changes
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("about:blank"); // a fresh load: the keyboard starts at the top
    await open(page, hash);
    await outlineNav(page).getByRole("button", { name: item }).click();
    await expect(side.locator(".fields-head h2")).toBeVisible();
    const [o, f, m] = [(await outline.boundingBox())!, (await side.boundingBox())!, (await middle.boundingBox())!];
    expect(Math.abs(o.x + o.width - f.x), `${hash}: the outline's right edge meets the fields`).toBeLessThanOrEqual(1);
    expect(Math.abs(f.x + f.width - m.x), `${hash}: the fields' right edge meets what readers will see`).toBeLessThanOrEqual(1);
    expect(m.x + m.width, `${hash}: what readers will see goes to the right edge`).toBeGreaterThanOrEqual(1439);
    // the selected item's fields carry its accent on the edge towards the preview
    await expect(side).toHaveClass(/\bon-item\b/);
    // Tab from the selected item: the outline, then every field, then what readers will see, never back
    await outlineNav(page).getByRole("button", { name: item }).focus();
    const met: string[] = [await column()];
    for (let i = 0; i < 120 && met[met.length - 1] !== "preview"; i++) {
      await page.keyboard.press("Tab");
      const c = await column();
      if (c !== met[met.length - 1]) met.push(c);
    }
    expect(met, `${hash}: the order for the keyboard`).toEqual(["outline", "fields", "preview"]);
    // the page's order is the screen's: outline, fields, what readers will see
    expect(await page.locator(".edit-body > :is(.edit-outline, .edit-fields, .edit-middle)").evaluateAll((els) => els.map((e) => e.className.split(" ")[0]))).toEqual(["edit-outline", "edit-fields", "edit-middle"]);
    // "Skip to the page" still leads to what readers will see
    await page.goto("about:blank");
    await open(page, hash);
    await expect(page.locator(".edit-bar")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the page" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(middle).toBeFocused();

    // a laptop (1100-1279): the outline is always the narrow rail in a column of its own; nothing covers the fields
    const sections = hash.startsWith("/p/") ? ["About", "Before you start", "Who takes part", "Steps", "Links and resources", "Standards it helps to meet"] : ["About", "Scope and exceptions", "Requirements", "Background"];
    for (const width of [1279, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const at = `${hash} at ${width}`;
      await expect(page.locator(".panel-strip"), at).toBeHidden();
      await expect(outlineNav(page), at).toBeVisible();
      const [o2, f2, m2] = [(await outline.boundingBox())!, (await side.boundingBox())!, (await middle.boundingBox())!];
      expect(o2.width, `${at}: the rail`).toBeLessThan(80);
      expect(Math.abs(o2.x + o2.width - f2.x), `${at}: the fields right after the rail`).toBeLessThanOrEqual(1);
      expect(Math.abs(f2.x + f2.width - m2.x), `${at}: then what readers will see`).toBeLessThanOrEqual(1);
      expect(m2.width, `${at}: the preview keeps its room`).toBeGreaterThan(640);
      // every part of the outline can be chosen from the rail, by its icon, which has its name
      for (const name of sections) {
        await outlineNav(page).getByRole("button", { name: new RegExp(`^${name}(,|$)`) }).click();
        await expect(side.locator(".fields-section-title"), `${at}: ${name}`).toHaveText(name);
      }
      // its button opens the whole outline over the fields; choosing closes it again
      await outline.getByRole("button", { name: "Show the outline with names" }).click();
      await expect(outlineNav(page).locator(".outline-label").first(), at).toBeVisible();
      expect((await outline.boundingBox())!.width, `${at}: open`).toBeGreaterThan(250);
      await outlineNav(page).getByRole("button", { name: item }).click();
      await expect.poll(async () => (await outline.boundingBox())!.width, `${at}: closed by choosing`).toBeLessThan(80);
      await expect(side.locator(".fields-head h2")).toBeInViewport();
      expect(await sideways(page), at).toBe(0);
    }

    // below 1100 (the outline slides over from the left): the fields first, what readers will see after them
    for (const width of [1099, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const [f2, m2] = [(await side.boundingBox())!, (await middle.boundingBox())!];
      expect(f2.x, `${hash} at ${width}: the fields at the left`).toBeLessThanOrEqual(1);
      expect(Math.abs(f2.x + f2.width - m2.x), `${hash} at ${width}: then what readers will see`).toBeLessThanOrEqual(1);
      await page.locator(".panel-strip").getByRole("button", { name: "Outline" }).click();
      const o2 = (await outlineNav(page).boundingBox())!;
      expect(o2.x, `${hash} at ${width}: the outline slides over the fields`).toBeLessThan(f2.x + f2.width);
      // choosing closes it: the fields of what was chosen are where it was
      await outlineNav(page).getByRole("button", { name: item }).click();
      await expect(outlineNav(page)).toBeHidden();
      await expect(side.locator(".fields-head h2")).toBeInViewport();
    }

    // a phone: one column, what readers will see; the fields slide over it and keep the keyboard to themselves
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(side.locator(".fields-head h2")).toBeInViewport(); // still open from the choice above
    await expect(middle).toBeHidden();
    await page.getByRole("button", { name: hash.startsWith("/p/") ? "Back to the map" : "Back to the requirements" }).click();
    await expect(side).toBeHidden();
    const m3 = (await middle.boundingBox())!;
    expect(m3.x).toBe(0);
    expect(m3.width).toBe(390);
  }
});

test("the outline lies on the quieter page ground and the fields on the white sheet, in both themes; the selected row is white", async ({ page }) => {
  await signIn(page, DANA);
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("about:blank");
    await open(page, "/p/request-gcp-project/edit/approve-budget");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const bg = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
    const [outlineBg, fieldsBg, pageBg] = [await bg(".edit-outline"), await bg(".edit-fields"), await bg(".edit-screen")];
    expect(outlineBg, `${theme}: the outline differs from the fields`).not.toBe(fieldsBg);
    expect(outlineBg, `${theme}: the outline is the page's ground`).toBe(pageBg);
    expect(await bg('.edit-outline .outline-item[aria-current="true"]'), `${theme}: the selected row is a piece of the sheet`).toBe(fieldsBg);
    // the selected row reaches the outline's edge, towards the fields
    const [row, o] = [(await page.locator('.edit-outline .outline-item[aria-current="true"]').boundingBox())!, (await page.locator(".edit-outline").boundingBox())!];
    expect(o.x + o.width - (row.x + row.width)).toBeLessThanOrEqual(2);
  }
});

test("on a phone the editing screen's messages and the checker's list keep their place", async ({ page }) => {
  await signIn(page, DANA);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/p/request-gcp-project/edit");
  await expect(page.locator(".edit-bar")).toBeVisible();
  // the variables that place them over the fields are set, but a phone does not use them
  const toasts = await page.locator(".toasts").evaluate((e) => { const s = getComputedStyle(e); return [s.top, s.left]; });
  expect(toasts[0]).toBe("128px");
  expect(toasts[1]).toBe("16px");
});

test("the editing bar reads “Back” and “More” on a tablet, and keeps their full names for screen readers", async ({ page }) => {
  await signIn(page, DANA);
  for (const [width, words] of [[1440, ["Back to reading", "More"]], [900, ["Back", "More"]], [700, ["", ""]]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "/p/request-gcp-project/edit");
    const back = page.locator(".edit-bar").getByRole("button", { name: "Back to reading", exact: true });
    const more = page.locator(".edit-bar").getByRole("button", { name: "More", exact: true });
    await expect(back).toBeInViewport({ ratio: 1 });
    await expect(more).toBeInViewport({ ratio: 1 });
    expect((await back.innerText()).trim(), `Back at ${width}px`).toBe(words[0]);
    expect((await more.innerText()).trim(), `More at ${width}px`).toBe(words[1]);
    // its menu opens on the screen, wherever the button ended up on the bar
    await more.click();
    for (const it of await page.getByRole("menu", { name: "More" }).getByRole("menuitem").all()) await expect(it, `menu at ${width}px`).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`Home, Access with its roles dialog, and the icon field fit every width in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const at = `${width}px, ${theme}`;
      await signIn(page, ALEX); // somebody with bookmarks-free Home, the lists and something to create
      await open(page, "/");
      await expect(page.locator(".home-browse")).toBeVisible();
      expect(await sideways(page), `Home at ${at}`).toBe(0);

      await signIn(page, DANA);
      await open(page, "/admin/access");
      await expect(page.locator(".users-list > li").first()).toBeVisible();
      expect(await sideways(page), `Access at ${at}`).toBe(0);
      await page.getByRole("button", { name: "Edit Jordan Platform" }).click();
      const dialog = page.getByRole("dialog", { name: "Roles of Jordan Platform" });
      await dialog.getByRole("button", { name: "Another platform" }).click();
      await expect(dialog.getByRole("combobox", { name: "Platform owner: platform 2" })).toBeVisible();
      // the dialog is taller than a laptop screen: it scrolls, and its buttons can be reached
      for (const b of [dialog.getByRole("button", { name: "Save" }), dialog.getByRole("button", { name: "Cancel" })]) { await b.scrollIntoViewIfNeeded(); await expect(b, at).toBeInViewport({ ratio: 0.9 }); }
      expect(await sideways(page), `the roles dialog at ${at}`).toBe(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await open(page, "/admin/tools");
      await page.getByRole("tab", { name: /Tools/ }).click();
      await page.locator(".cat-item", { hasText: "GitHub" }).first().click();
      const field = page.locator(".icon-field");
      await field.scrollIntoViewIfNeeded();
      await expect(field.getByRole("button", { name: "Choose image…" }), at).toBeInViewport({ ratio: 1 });
      expect(await sideways(page), `the icon field at ${at}`).toBe(0);
    }
  });
}

// ---------- every width, light and dark: nothing sideways, nothing on top of something else

const WIDTHS = [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [360, 740]] as const;

/**
 * Pairs of visible controls (buttons, links, fields) inside `scope` whose boxes overlap by more
 * than 2 px, leaving out one inside the other. Empty when nothing is drawn over anything else.
 */
async function overlapping(page: import("@playwright/test").Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel)) {
      const els = [...root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=tab], [role=radio], h1, h2")].filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && !e.closest("[inert], .theme-preview, [hidden], .sr-only, .search-sr");
      });
      const name = (e: HTMLElement) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""}“${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}”`;
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const [a, b] = [els[i], els[j]];
        if (a.contains(b) || b.contains(a)) continue;
        const [r, q] = [a.getBoundingClientRect(), b.getBoundingClientRect()];
        const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (w > 2 && h > 2) out.push(`${name(a)} × ${name(b)}`);
      }
    }
    return out;
  }, scope);
}

for (const theme of ["light", "dark"] as const) {
  test(`the redesigned screens fit every width without overlaps in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, DANA);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    for (const [width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      const at = (what: string) => `${what} at ${width}x${height}, ${theme}`;
      // Home, the search in cards and in rows, a process page, a standard page, Theming
      for (const [hash, ready] of [
        ["/", ".home-page h1"], ["/search?q=gcp", "ol.cards > li.card"], ["/p/request-gcp-project/flow", "header.doc-head h1"],
        ["/s/secure-logging/doc", "header.doc-head h1"], ["/admin/theming", ".theme-section"],
      ] as const) {
        await open(page, hash);
        await expect(page.locator(ready).first(), at(hash)).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await sideways(page), at(hash)).toBe(0);
        expect(await overlapping(page, ".topbar:not(.theme-preview *)"), at(`${hash}, the top bar`)).toEqual([]);
        for (const part of ["header.doc-head", ".search-head", ".results-bar", ".home-search", ".theme-settings"])
          expect(await overlapping(page, part), at(`${hash}, ${part}`)).toEqual([]);
      }
      // the results as rows
      await open(page, "/search?q=gcp");
      const view = page.getByRole("radiogroup", { name: "Show as" });
      await view.getByRole("radio", { name: "Rows" }).click();
      await expect(page.locator("ol.cards.rows > li.card.row").first()).toBeVisible();
      expect(await sideways(page), at("rows")).toBe(0);
      expect(await overlapping(page, "ol.cards.rows > li.card.row"), at("rows")).toEqual([]);
      await view.getByRole("radio", { name: "Cards" }).click();
      expect(await overlapping(page, "ol.cards > li.card"), at("cards")).toEqual([]);

      // the editing screen, with the outline open and as a rail where there is one
      await open(page, "/p/request-gcp-project/edit/details-ok");
      await expect(page.locator(".edit-bar")).toBeVisible();
      for (const rail of [false, true]) {
        const toggle = page.locator("button.outline-toggle");
        if (width >= 1280 && (await toggle.isVisible())) {
          if (((await toggle.getAttribute("aria-expanded")) === "false") !== rail) await toggle.click();
        } else if (rail) continue;
        const where = at(`the editing screen${rail ? ", outline narrowed" : ""}`);
        expect(await sideways(page), where).toBe(0);
        expect(await overlapping(page, ".edit-bar"), `${where}, the bar`).toEqual([]);
        expect(await overlapping(page, ".edit-fields"), `${where}, the fields`).toEqual([]);
        expect(await page.locator(".edit-middle").evaluate((e) => e.scrollWidth - e.clientWidth), `${where}: the middle does not scroll sideways`).toBeLessThanOrEqual(1);
      }
      // the standard's editing screen
      await open(page, "/s/secure-logging/edit/SEC-LOG-02");
      await expect(page.locator(".edit-bar")).toBeVisible();
      expect(await sideways(page), at("the standard's editing screen")).toBe(0);
      expect(await page.locator(".edit-middle").evaluate((e) => e.scrollWidth - e.clientWidth), at("the standard's middle")).toBeLessThanOrEqual(1);
      expect(await overlapping(page, ".edit-bar"), at("the standard's bar")).toEqual([]);
    }
    // the outline back as it was for the next tests
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "/p/request-gcp-project/edit");
    const toggle = page.locator("button.outline-toggle");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  });
}

test("a long portal name never pushes the top bar over its edge", async ({ page, request }) => {
  const name = "Acme Ways of Working for All Departments"; // 40 characters, the most there may be
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const { revision } = await (await request.get("/api/admin/theme")).json();
  expect((await request.put(`/api/admin/theme?rev=${revision}`, { data: { name }, headers: CSRF })).ok()).toBeTruthy();
  try {
    await signIn(page, DANA); // an admin: the most links in the top bar
    for (const width of [1440, 1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/processes");
      await expect(page.locator(".card").first()).toBeVisible();
      const at = `${width}px`;
      expect(await sideways(page), at).toBe(0);
      const bar = page.locator(".topbar");
      const brand = bar.locator(".brand");
      await expect(brand, at).toHaveAccessibleName(name);
      // everything in the bar stays inside the screen and nothing is drawn over anything else
      for (const el of await bar.locator("a[href], button").filter({ visible: true }).all()) {
        const b = (await el.boundingBox())!;
        expect(b.x, at).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, at).toBeLessThanOrEqual(width + 0.5);
      }
      expect(await overlapping(page, ".topbar"), at).toEqual([]);
      const shown = bar.locator(".brand-name");
      if (width >= 1200) {
        await expect(shown, at).toBeVisible();
        await expect(brand, at).toHaveAttribute("title", name); // cut with "…", the whole name as tooltip
      } else await expect(shown, at).toBeHidden();
    }
  } finally {
    const { revision: now } = await (await request.get("/api/admin/theme")).json();
    await request.put(`/api/admin/theme?rev=${now}`, { data: {}, headers: CSRF });
  }
});

// ---------- the fourth round: the Guide's contents on a phone, the Checklist's column, the taller editing map

for (const theme of ["light", "dark"] as const) {
  test(`the Guide on a phone, the Checklist beside its column and the editing map on a phone fit, in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, DANA);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);

    // the Guide at 390: the contents bar sticks under the top bar, nothing sideways or on top of anything
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/guide");
    const contents = page.locator(".guide-contents-bar");
    await expect(contents).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await sideways(page), `the Guide at 390, ${theme}`).toBe(0);
    expect(await overlapping(page, ".guide-contents-bar"), "the contents bar").toEqual([]);
    await page.mouse.wheel(0, 4000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect(contents.locator("button.guide-contents-btn")).toBeInViewport({ ratio: 1 });
    const bar = (await contents.boundingBox())!;
    const top = (await page.locator(".topbar").boundingBox())!;
    expect(bar.y, "under the top bar").toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(await overlapping(page, ".guide-section"), "the sections").toEqual([]);
    await contents.locator("button.guide-contents-btn").click();
    const sheet = page.getByRole("dialog", { name: "Contents" });
    await expect(sheet).toBeVisible();
    expect(await sideways(page), "the contents open").toBe(0);
    for (const b of (await sheet.locator(".guide-toc-group button").all()).slice(0, 4)) expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(36);
    await page.keyboard.press("Escape");

    // the Checklist at 1440 and at 1100: the steps and, beside them, the column with the progress
    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/p/request-gcp-project/list");
      const steps = page.locator(".list-view > ol.steps");
      const side = page.locator(".list-view > .list-bar");
      await expect(steps).toBeVisible();
      const [s, b] = [(await steps.boundingBox())!, (await side.boundingBox())!];
      expect(b.x, `the column beside the steps at ${width}`).toBeGreaterThanOrEqual(s.x + s.width - 1);
      expect(s.width, `the steps at ${width}`).toBeLessThanOrEqual(1000);
      expect(s.width, `the steps keep room at ${width}`).toBeGreaterThan(500);
      expect(await sideways(page), `the Checklist at ${width}, ${theme}`).toBe(0);
      expect(await overlapping(page, ".list-view"), `the Checklist at ${width}`).toEqual([]);
    }
    // narrower: the progress above the steps again
    await page.setViewportSize({ width: 1000, height: 900 });
    await open(page, "/p/request-gcp-project/list");
    const [s, b] = [(await page.locator(".list-view > ol.steps").boundingBox())!, (await page.locator(".list-view > .list-bar").boundingBox())!];
    expect(b.y + b.height, "above the steps at 1000").toBeLessThanOrEqual(s.y + 1);

    // the editing screen at 390: the map takes the rest of the height
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/p/request-gcp-project/edit");
    await expect(page.locator(".edit-bar")).toBeVisible();
    const map = page.locator(".edit-preview .flow-scroll");
    await expect(map).toBeVisible();
    const m = (await map.boundingBox())!;
    expect(m.height, "the map's height on a phone").toBeGreaterThan(380);
    expect(m.y + m.height, "the map ends within the window").toBeLessThanOrEqual(844 + 1);
    expect(await sideways(page), `the editing screen at 390, ${theme}`).toBe(0);
    expect(await overlapping(page, ".edit-preview .flow-head"), "the map's tools").toEqual([]);
    // the legend is behind its button
    await expect(page.locator(".edit-preview .legend-box").getByRole("button", { name: "Legend" })).toBeVisible();
  });
}
