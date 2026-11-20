import { expect, test } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, RILEY, SAM, fields, meaningReady, open, signIn } from "./helpers";

// What a phone, a tablet and a small laptop show. A page that scrolls sideways hides controls
// off screen, so no page may be wider than the screen.
const PAGES = ["/", "/search?q=gcp", "/search?q=logging&type=standard&rigour=mandatory", "/processes", "/standards", "/p/request-gcp-project/flow", "/p/request-gcp-project/list", "/p/request-gcp-project/flow/raise-request",
  "/s/secure-logging/doc", "/s/secure-logging/doc/SEC-LOG-02", "/catalog", "/guide", "/mine", "/requests", "/requests?state=all"];
const ADMIN = ["/p/request-gcp-project/edit", "/p/request-gcp-project/edit/raise-request", "/s/secure-logging/edit", "/s/secure-logging/edit/SEC-LOG-02", "/admin/access", "/admin/lists", "/admin/skills", "/admin/health", "/admin/activity", "/admin/statistics", "/admin/system"];

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
        const nav = page.locator(".nav");
        const controls = [
          nav.getByRole("link", { name: "Home" }), nav.getByRole("link", { name: "Processes" }), nav.getByRole("link", { name: "Standards" }), nav.getByRole("link", { name: "Requests" }),
          nav.getByRole("link", { name: /My responsibilities/ }), nav.getByRole("link", { name: "Teams & tools" }), nav.getByRole("link", { name: "Guide" }),
          page.getByRole("button", { name: "Your account" }),
        ];
        if (who === DANA) controls.push(nav.getByRole("link", { name: "Admin" }));
        for (const control of controls) await expect(control, `${who} at ${width}px`).toBeInViewport({ ratio: 1 });
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
    await expect(page.locator(".nav a")).toHaveCount(8);
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
          // three columns side by side, none crushed
          const [o, m, f] = [(await outline.boundingBox())!, (await middle.boundingBox())!, (await side.boundingBox())!];
          expect(o.x + o.width, at).toBeLessThanOrEqual(m.x + 1);
          expect(m.x + m.width, at).toBeLessThanOrEqual(f.x + 1);
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
            // the fields stay a column of their own next to the map
            const [m, f] = [(await middle.boundingBox())!, (await side.boundingBox())!];
            expect(m.x + m.width, at).toBeLessThanOrEqual(f.x + 1);
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

      await open(page, "/admin/lists");
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
  const name = "Acme Ways of Working for Every Department"; // 40 characters
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
