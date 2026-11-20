import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CASEY, CSRF, DANA, JORDAN, SAM, clearFeedback, navigate, open, report, signIn } from "./helpers";

// The frame of the portal and Admin after the fourth round: the Guide's contents on a phone, a
// long portal name, the Menu's count, the roles in the account menu, the Statistics table, the
// save bar of Admin › Lists, what is said when the portal cannot be reached, and one form for
// dates. What a test changes (the look, feedback) is put back afterwards, also when it fails.

/** Sets the look of the portal through the API, as an admin. */
async function setLook(request: APIRequestContext, look: Record<string, string>) {
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const { revision } = await (await request.get("/api/admin/theme")).json();
  const res = await request.put(`/api/admin/theme?rev=${revision}`, { data: look, headers: CSRF });
  expect(res.ok(), await res.text()).toBeTruthy();
}

const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const DATE_TIME = /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/;

test("the Guide on a phone: a Contents button that opens the list, jumps, marks where you are; Back to top", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  await open(page, "/guide");
  const button = page.locator(".guide-contents-bar button.guide-contents-btn");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-haspopup", "dialog");
  await expect(button).toHaveAccessibleName(/^Contents/);
  // the side contents are not there at this width
  await expect(page.locator("nav.guide-toc:not(.guide-toc-sheet)")).toBeHidden();
  await button.click();
  const sheet = page.getByRole("dialog", { name: "Contents" });
  const list = sheet.locator("nav.guide-toc.guide-toc-sheet");
  await expect(list).toBeVisible();
  await expect(list.locator('[aria-current="location"]')).toHaveCount(1);
  // jump to a section further down
  const target = list.locator(".guide-toc-group button").nth(5);
  const title = (await target.innerText()).trim();
  await target.click();
  await expect(sheet).toHaveCount(0);
  const heading = page.locator(".guide-section h2", { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  await expect(heading).toBeInViewport();
  // the bar stays at the top and says where you are; the list marks it
  await expect(button).toBeInViewport();
  await expect(button.locator(".guide-contents-here")).toHaveText(title);
  await button.click();
  await expect(list.locator('[aria-current="location"]')).toHaveText(title);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // "Back to top" at the end of the section
  const back = heading.locator("xpath=..").getByRole("button", { name: "Back to top" });
  await back.scrollIntoViewIfNeeded();
  await back.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("a portal name of 39 characters: whole in the top bar at 1440, on two lines on the sign-in page", async ({ page, request, browser }) => {
  const name = "Acme Group Ways of Working and Standard";
  expect(name).toHaveLength(39);
  await setLook(request, { name });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, DANA);
    await open(page, "/");
    const brand = page.locator(".topbar .brand-name");
    await expect(brand).toHaveText(name);
    expect(await brand.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "not cut").toBe(true);
    // the places still all in the bar
    await expect(page.locator("nav.nav").getByRole("link", { name: "Admin", exact: true })).toBeInViewport();

    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const login = await anon.newPage();
      await login.goto("/");
      const h1 = login.getByRole("heading", { name });
      await expect(h1).toHaveClass(/\blong\b/);
      const lines = await h1.evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
      expect(lines).toBe(2);
      expect(await h1.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    } finally {
      await anon.close();
    }
  } finally {
    await setLook(request, {});
  }
});

test("below 1120 px the Menu button says how much waits right after the word Menu", async ({ page, request }) => {
  await report(request, SAM, { targetId: "request-gcp-project", text: "Frame demo: something waits for the Cloud Platform team." });
  try {
    await page.setViewportSize({ width: 1000, height: 800 });
    await signIn(page, CASEY);
    await open(page, "/processes");
    const menu = page.locator("button.menu-btn");
    await expect(menu).toHaveAccessibleName(/^Menu, \d+ waiting$/);
    const parts = await menu.evaluate((b) => [...b.children].filter((c) => c.tagName !== "svg").map((c) => c.className));
    expect(parts).toEqual(["menu-word", "nav-count", "menu-here"]);
    const n = Number((await menu.getAttribute("aria-label"))!.match(/\d+/)![0]);
    await expect(menu.locator("b.nav-count")).toHaveText(String(n));
    await expect(menu.locator(".menu-here")).toHaveText("Processes");
  } finally {
    await clearFeedback(request, "process", "request-gcp-project");
  }
});

test("the account menu lists the roles in the words of Admin › Access; somebody without a role is a Reader", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, "/");
  await page.getByRole("button", { name: "Your account" }).click();
  const roles = page.locator(".user-pop").getByRole("list", { name: "Your roles" });
  await expect(roles.getByRole("listitem")).toHaveText(["Platform owner for Google Cloud", "Practice owner for Engineering", "Owner for Cloud Platform team"]);
  await expect(page.locator(".user-pop .user-role")).toHaveCount(0);
  await signIn(page, DANA);
  await open(page, "/");
  await page.getByRole("button", { name: "Your account" }).click();
  await expect(page.locator(".user-pop").getByRole("list", { name: "Your roles" }).getByRole("listitem")).toHaveText(["Admin"]);
});

test("Statistics: the table per process and standard needs no sideways scroll at 1440 and 1366", async ({ page }) => {
  await signIn(page, DANA);
  for (const width of [1440, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/admin/statistics");
    const wrap = page.getByRole("region", { name: "Statistics per process and standard" });
    await expect(wrap.locator("tbody tr").first()).toBeVisible();
    await expect(wrap.locator("thead th")).toHaveText([/^Name/, "Belongs to", /^Views/, /^People/, /^Skill downloads/, /^Upvotes/, /^Feedback open/, /^Feedback handled/]);
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth), `no sideways scroll at ${width}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // an entry without an owning team says so
    const rows = wrap.locator("tbody tr");
    for (const row of (await rows.all()).slice(0, 5)) await expect(row.locator(".stat-belongs")).toHaveText(/\S/);
  }
});

test("Admin › Lists shows the id of an entry and keeps its save bar in view; Teams & tools shows no ids", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  await page.locator(".cat-list").getByRole("button", { name: /Cloud Platform team/ }).first().click();
  await expect(page.locator(".cat-detail p.cat-id")).toHaveText("Id cloud-platform-team");
  await expect(page.locator(".tabs .tab svg")).toHaveCount(0); // no tab icons
  // a change further down the form: the save bar is in view, under the top bar
  const field = page.locator(".cat-detail").getByLabel("What they do");
  await field.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 600);
  const before = await field.inputValue();
  await field.fill(`${before} (not saved)`);
  const bar = page.locator(".cat-toolbar.with-save.dirty");
  await expect(bar).toBeInViewport();
  await expect(bar).toContainText("Unsaved changes");
  await expect(bar.getByRole("button", { name: "Save changes" })).toBeInViewport();
  const top = (await bar.boundingBox())!.y;
  expect(top, "just under the top bar").toBeLessThan(80);
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".cat-toolbar.dirty")).toHaveCount(0);

  // Teams & tools, for everybody: no ids, no tab icons
  await navigate(page, "Teams & tools");
  await page.locator(".cat-list").getByRole("button", { name: /Cloud Platform team/ }).first().click();
  await expect(page.locator(".cat-detail h2")).toHaveText("Cloud Platform team");
  await expect(page.locator(".cat-id")).toHaveCount(0);
  await expect(page.locator(".catalog-page")).not.toContainText("cloud-platform-team");
  await expect(page.locator(".tabs .tab svg")).toHaveCount(0);
});

/** Every text on the page that tells the person something went wrong. */
const said = (page: Page) => page.locator("[role=alert], .toast, .load-error, .crash").allInnerTexts();

test("when the portal cannot be reached: a plain sentence that says what to do and whether anything was saved", async ({ page }) => {
  await signIn(page, DANA);
  // loading: the activity cannot be fetched
  await open(page, "/");
  await page.route("**/api/admin/audit*", (route) => route.abort("internetdisconnected"));
  await open(page, "/admin/activity");
  await expect(page.getByText("The activity could not be loaded.")).toBeVisible();
  await expect(page.getByText("Could not reach the portal. Check your connection and try again.")).toBeVisible();
  for (const t of await said(page)) expect(t.toLowerCase()).not.toContain("server");
  await page.unroute("**/api/admin/audit*");

  // a change: nothing was saved, and it says so
  await open(page, "/admin/lists");
  await page.locator(".cat-list").getByRole("button", { name: /DNS team/ }).first().click();
  await page.locator(".cat-detail").getByLabel("What they do").fill("Changed while the portal is out of reach.");
  await page.route("**/api/catalog?*", (route) => (route.request().method() === "PUT" ? route.abort("internetdisconnected") : route.continue()));
  await page.getByRole("button", { name: "Save changes" }).click();
  const toast = page.locator(".toast", { hasText: "Could not reach the portal. Nothing was saved. Check your connection and try again." });
  await expect(toast).toBeVisible();
  for (const t of await said(page)) expect(t.toLowerCase()).not.toContain("server");
  await page.unroute("**/api/catalog?*");
  await page.getByRole("button", { name: "Discard" }).click();

  // a part of the app that cannot be fetched: its own page, with Reload, the way back and the details folded
  await page.route("**/assets/GuidePage-*.js", (route) => route.abort("internetdisconnected"));
  await navigate(page, "Guide");
  const crash = page.locator(".crash");
  await expect(crash.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
  await expect(crash).toContainText("Could not reach the portal. Check your connection, then reload the page. Nothing you saved is lost.");
  await expect(crash.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(crash.getByRole("button", { name: "Back to the start" })).toBeVisible();
  const details = crash.locator("details.crash-detail");
  await expect(details.locator("summary")).toHaveText("Details");
  await expect(details.locator("p")).toBeHidden();
  await details.locator("summary").click();
  await expect(details.locator("p")).toContainText("For support:");
  expect((await crash.locator("h1, .lead").allInnerTexts()).join(" ").toLowerCase()).not.toContain("server");
});

test("a process or standard that is gone: said in plain words, with no id; the same on its editing screen", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/p/no-such-process-here/flow");
  await expect(page.getByRole("heading", { name: "Process not found" })).toBeVisible();
  await expect(page.getByText("This process does not exist (any more). It may have been renamed or deleted.")).toBeVisible();
  await expect(page.locator(".page")).not.toContainText("no-such-process-here");
  await page.getByRole("link", { name: "Back to all processes" }).click();
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  await open(page, "/s/no-such-standard-here/doc");
  await expect(page.getByText("This standard does not exist (any more). It may have been renamed or deleted.")).toBeVisible();
  await expect(page.locator(".page")).not.toContainText("no-such-standard-here");
  await open(page, "/p/no-such-process-here/edit");
  await expect(page.getByText("This process does not exist (any more). It may have been renamed or deleted.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("no-such-process-here");
});

test("dates in one form: Theming's last change and the Activity log as 2026-11-20 07:30", async ({ page, request }) => {
  await setLook(request, { name: "Frame demo dates" });
  try {
    await signIn(page, DANA);
    await open(page, "/admin/theming");
    const last = page.getByText(/^Last changed by /);
    await expect(last).toBeVisible();
    await expect(last).toHaveText(new RegExp(`^Last changed by Dana Admin on ${DATE_TIME.source}\\.$`));
    await open(page, "/admin/activity");
    const times = page.locator(".activity li time");
    await expect(times.first()).toBeVisible();
    for (const t of (await times.allInnerTexts()).slice(0, 10)) expect(t).toMatch(new RegExp(`^${DATE_TIME.source}$`));
    // the skills list: a date alone
    await open(page, "/admin/skills");
    const em = page.locator(".cat-item-text em", { hasText: /^from the / }).first();
    await expect(em).toHaveText(new RegExp(`^from the \\w+ · ${DATE.source}$`));
  } finally {
    await setLook(request, {});
  }
});

// ---------- the fifth round: the skip link, the main region, Admin › Lists' removal

test("“Skip to the page” is the first Tab stop on every signed-in page and moves the keyboard into the page", async ({ page }) => {
  await signIn(page, DANA);
  // (Home puts the cursor in its search box at once; the link is first in its order all the same)
  await open(page, "/");
  await expect(page.getByRole("searchbox").first()).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.textContent)).toBe("Skip to the page");
  for (const path of ["/processes", "/p/request-gcp-project/flow", "/s/secure-logging/doc", "/requests", "/admin/access"]) {
    await page.goto("about:blank"); // a fresh load: the keyboard starts at the top of the page
    await open(page, path);
    await expect(page.locator("#main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    // the page is the main region
    await expect(page.locator("main#main.main-region"), path).toHaveCount(1);
    await expect(page.locator(".admin-main").locator("xpath=self::main")).toHaveCount(0);
    const skip = page.getByRole("link", { name: "Skip to the page" });
    await expect(skip).not.toBeInViewport(); // out of sight until it has the focus
    await page.keyboard.press("Tab");
    await expect(skip, path).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main"), path).toBeFocused();
    // the next Tab goes into the page, not to the top bar
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => (document.activeElement?.closest("#main") ? "in" : document.activeElement?.outerHTML.slice(0, 120))), `${path}: the next stop is in the page`).toBe("in");
  }
  // the editing screen: the link goes to its own main region, the middle
  await page.goto("about:blank");
  await open(page, "/p/request-gcp-project/edit");
  await expect(page.locator(".edit-bar")).toBeVisible();
  await expect(page.locator("div#main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the page" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main.edit-middle")).toBeFocused();
});

test("Admin › Lists: removing an entry says so with Undo, which puts it back where it was; New is a secondary button", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  await page.locator(".cat-kinds").getByRole("tab", { name: /^Categories/ }).click();
  const create = page.getByRole("button", { name: "New category" });
  await expect(create).not.toHaveClass(/\bprimary\b/);
  await create.click();
  await page.locator(".cat-new").getByLabel("Name").fill("Undo demo category");
  await page.keyboard.press("Enter");
  const entry = page.locator(".cat-item", { hasText: "Undo demo category" });
  await expect(entry).toBeVisible();
  await page.getByRole("button", { name: "Remove this category" }).click();
  await expect(entry).toHaveCount(0);
  const toast = page.locator(".toast", { hasText: "Undo demo category removed" });
  await expect(toast).toContainText("It is gone for everyone once the lists are saved.");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(entry).toBeVisible();
  await expect(entry).toHaveClass(/\bon\b/);
  await expect(page.locator(".cat-detail h2")).toHaveText("Undo demo category");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(entry).toHaveCount(0);
});
