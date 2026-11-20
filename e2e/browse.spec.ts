import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, SAM, open, openApplication, pickFilter, publishChange, putWorkingDraft, signIn } from "./helpers";

// Home, the two lists and the search results: how processes and standards look different, where
// the browse column is, the filters for "my application", a filter with nothing to choose, the
// line with the count, the order, the page size and the pager, and the order by date.
//
// Six processes are made here, one after another (so "newest" has a known order), and removed
// afterwards: other tests count what there is.

const N = 6;
const IDS = Array.from({ length: N }, (_, i) => `browse-demo-${i + 1}`);
const TITLE = (i: number) => `Browse demo ${i + 1}`;

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-github-repository");
  // no rigour on any of them: the rigour filter has nothing to offer for these
  const { rigour: _r, ...rest } = src;
  for (const [i, id] of IDS.entries()) {
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...rest, id, title: TITLE(i), summary: `The browse demo number ${i + 1}.`, status: "active" }, headers: CSRF });
    expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100)); // one second apart: their dates differ
  }
  // the oldest one is changed last: it is the most recently updated
  const first = (await (await request.get("/api/processes")).json()).processes.find((p: { id: string }) => p.id === IDS[0]);
  await publishChange(request, "process", IDS[0], { ...first, summary: "The browse demo number 1, changed last." });
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  for (const id of [...IDS, "browse-draft-demo"]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

const cards = (page: Page) => page.locator("ol.cards > li.card");
const demoOrder = async (page: Page) => (await page.locator("ol.cards > li.card[data-id^='browse-demo-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-id"))));

test("processes and standards look different: on Home, on the cards of the lists and of the search", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/");
  const entries = page.locator("a.home-entry");
  await expect(entries.and(page.locator(".process")).locator(".home-entry-kind")).toHaveText("Processes");
  await expect(entries.and(page.locator(".standard")).locator(".home-entry-kind")).toHaveText("Standards");
  // a marker of its own, not only a colour: a different icon
  await expect(page.locator(".home-entry-icon.process svg")).toHaveClass(/lucide-workflow/);
  await expect(page.locator(".home-entry-icon.standard svg")).toHaveClass(/lucide-shield-check/);

  await open(page, "/search?type=process");
  const p = cards(page).and(page.locator('[data-kind="process"]')).first();
  await expect(p).toBeVisible();
  const pRadius = await p.locator(".kind-tag").evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
  await expect(p.locator(".kind-tag.process .card-kind")).toHaveText("Process");
  await expect(p.locator(".kind-tag svg")).toHaveClass(/lucide-workflow/);
  await open(page, "/search?type=standard");
  const s = cards(page).and(page.locator('[data-kind="standard"]')).first();
  await expect(s).toBeVisible();
  await expect(s.locator(".kind-tag.standard .card-kind")).toHaveText("Standard");
  await expect(s.locator(".kind-tag svg")).toHaveClass(/lucide-shield-check/);
  // and their shapes differ (round and square marks), whatever the colours
  expect(await s.locator(".kind-tag").evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).not.toBe(pRadius);
  // on the search, where kinds are mixed, every card says its kind
  await open(page, "/search");
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).locator(".kind-tag").count()).toBe(await cards(page).count());
  // a list of one kind has no use for the tag
  for (const hash of ["/processes", "/standards"]) {
    await open(page, hash);
    await expect(cards(page).first()).toBeVisible();
    await expect(cards(page).locator(".kind-tag")).toHaveCount(0);
  }
});

test("Home: the Browse column is to the right of the main column on a big screen, below it on a smaller one", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  const main = page.locator(".home-main");
  const browse = page.getByRole("complementary", { name: "Browse" });
  await expect(browse.getByRole("heading", { level: 2, name: "Browse" })).toBeVisible();
  for (const group of ["category", "platform", "practice"]) await expect(browse.locator(`section.home-group[data-browse="${group}"] h3`)).toBeVisible();
  let [m, b] = [(await main.boundingBox())!, (await browse.boundingBox())!];
  expect(b.x).toBeGreaterThanOrEqual(m.x + m.width - 1);
  expect(Math.abs(b.y - m.y)).toBeLessThan(60);
  // it stands apart: a surface of its own, not the page's background
  const bg = await browse.evaluate((e) => getComputedStyle(e).backgroundColor);
  const pageBg = await page.locator("body").evaluate((e) => getComputedStyle(e).backgroundColor);
  const border = await browse.evaluate((e) => getComputedStyle(e).borderTopWidth);
  expect(bg !== pageBg || border !== "0px").toBe(true);

  await page.setViewportSize({ width: 900, height: 900 });
  [m, b] = [(await main.boundingBox())!, (await browse.boundingBox())!];
  expect(b.y).toBeGreaterThanOrEqual(m.y + m.height - 1);
  // a link of the column leads to the search with that choice
  await browse.locator('section.home-group[data-browse="category"] a.chip').first().click();
  await expect(page).toHaveURL(/#\/search\?category=/);
});

test("Tier, environment and language are single-choice dropdowns with counts, remembered on the standard's page", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/standards");
  const panel = page.getByRole("complementary", { name: "Filters" });
  // folded under "My application" until it is opened or something in it is chosen
  const app = panel.locator("button.filter-app-toggle");
  await expect(app).toHaveAccessibleName(/^My application/);
  await expect(app).toContainText("Not chosen");
  const tier = panel.getByRole("button", { name: /^Tier: / });
  await expect(tier).toHaveCount(0);
  await app.click();
  await expect(app).toHaveAttribute("aria-expanded", "true");
  await tier.click();
  const group = panel.getByRole("radiogroup", { name: "Tier" });
  await expect(group.getByRole("radio").first()).toHaveAccessibleName(/^Any tier, \d+ results?$/);
  await expect(group.getByRole("radio").first()).toBeChecked();
  await expect(group.locator(".filter-dd-hint")).toBeVisible();
  await tier.click();
  await pickFilter(page, "Tier", "Tier 3");
  await expect(panel.getByRole("button", { name: "Tier: Tier 3", exact: true })).toBeVisible();
  // one choice: another one replaces it
  await pickFilter(page, "Tier", "Tier 2");
  await expect(panel.getByRole("button", { name: "Tier: Tier 2", exact: true })).toBeVisible();
  await pickFilter(page, "Tier", "Tier 3");
  await expect(panel.locator("p.filter-profile-note")).toContainText("here and on every process and standard");
  // folded, it says what is chosen; another visit opens it by itself, because something is chosen
  await app.click();
  await expect(app).toHaveAttribute("aria-expanded", "false");
  await expect(app).toContainText("Tier 3");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(panel.locator("button.filter-app-toggle")).toHaveAttribute("aria-expanded", "true");

  // the standard's page knows it
  await open(page, "/s/secure-logging/doc");
  await expect(page.locator("#req-SEC-LOG-03")).toContainText("Does not apply to your application");
  await open(page, "/standards");
  await pickFilter(page, "Tier", "Any tier");
  await open(page, "/s/secure-logging/doc");
  await expect(page.locator("#req-SEC-LOG-03")).not.toContainText("Does not apply to your application");
});

test("an application option with no results is offered, can be chosen, and gives the empty state", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=akamai");
  await expect(cards(page).first()).toBeVisible(); // only the Akamai process, for tiers 0 and 1
  const panel = page.getByRole("complementary", { name: "Filters" });
  await openApplication(page);
  await panel.getByRole("button", { name: /^Tier: / }).click();
  const tier3 = panel.getByRole("radiogroup", { name: "Tier" }).getByRole("radio", { name: "Tier 3, 0 results" });
  await expect(tier3).toBeEnabled();
  await expect(panel.locator('.filter-dd[data-filter="tier"] .filter-none')).toHaveCount(0);
  await tier3.check();
  await expect(panel.getByRole("button", { name: "Tier: Tier 3", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator("p.list-count")).toContainText("No results");
  await pickFilter(page, "Tier", /^Any tier, \d+ results?$/);
  await expect(cards(page).first()).toBeVisible();
});

test("a filter with nothing to choose says why instead of offering dead options", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("searchbox", { name: "Search processes" }).fill("Browse demo");
  await expect(cards(page)).toHaveCount(N);
  const panel = page.getByRole("complementary", { name: "Filters" });
  const rigour = panel.getByRole("button", { name: "Rigour: Nothing to choose", exact: true });
  await expect(rigour).toBeVisible();
  await expect(panel.locator('.filter-dd[data-filter="rigour"]')).toHaveClass(/\bnothing\b/);
  await rigour.click();
  await expect(panel.locator('.filter-dd[data-filter="rigour"] .filter-none')).toHaveText(/says how binding it is\.$/);
  await expect(panel.locator('.filter-dd[data-filter="rigour"]').getByRole("checkbox")).toHaveCount(0);
});

test("count, Sort by, Items per page and the pager on one line; a second size control at the end", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, SAM);
  await open(page, "/processes");
  await expect(page.locator("p.list-count")).toContainText(`${7 + N}`);
  // the search box is the full width of the list, above the filters and the results
  for (const [hash, label] of [["/processes", "Search processes"], ["/standards", "Search standards"]] as const) {
    await open(page, hash);
    const box = page.locator("form.search-box.live");
    await expect(box.getByRole("searchbox", { name: label })).toBeVisible();
    const [f, panel, results] = [(await box.boundingBox())!, (await page.getByRole("complementary", { name: "Filters" }).boundingBox())!, (await page.getByRole("region", { name: "Results" }).boundingBox())!];
    expect(f.y + f.height).toBeLessThanOrEqual(Math.min(panel.y, results.y) + 1);
    expect(f.width).toBeGreaterThanOrEqual(results.x + results.width - panel.x - 2);
  }
  await open(page, "/processes");
  const bar = page.locator(".results-bar");
  await bar.getByRole("combobox", { name: "Items per page", exact: true }).selectOption("12"); // 24 at first on a wide screen
  const parts = [bar.locator("p.list-count"), bar.getByRole("combobox", { name: "Sort by" }), bar.getByRole("combobox", { name: "Items per page", exact: true }), bar.getByRole("navigation", { name: "Pages of processes", exact: true })];
  const middles = [];
  for (const part of parts) { await expect(part, String(part)).toBeVisible(); const b = (await part.boundingBox())!; middles.push(b.y + b.height / 2); }
  for (const y of middles) expect(Math.abs(y - middles[0])).toBeLessThan(14);

  // the size can be changed at the end of the list too, and both follow
  const foot = page.locator(".results-foot");
  const atEnd = foot.getByRole("combobox", { name: "Items per page, at the end" });
  await expect(atEnd).toHaveValue("12");
  await atEnd.selectOption("24");
  await expect(cards(page)).toHaveCount(7 + N);
  await expect(bar.getByRole("combobox", { name: "Items per page", exact: true })).toHaveValue("24");
  await expect(foot).toHaveCount(1); // still more than 12 results: the control stays where the person used it
});

test("sorting by Newest and Recently updated on the lists, remembered per person", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("searchbox", { name: "Search processes" }).fill("Browse demo");
  await expect(cards(page)).toHaveCount(N);
  const sort = page.getByRole("combobox", { name: "Sort by" });
  await expect(sort.locator("option")).toHaveText(["Best match", "Newest", "Recently updated"]);
  await sort.selectOption({ label: "Newest" });
  expect(await demoOrder(page)).toEqual([...IDS].reverse());
  await sort.selectOption({ label: "Recently updated" });
  expect(await demoOrder(page)).toEqual([IDS[0], ...IDS.slice(1).reverse()]);

  // remembered for this person: after a reload, and on the way back from a process
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("updated");
  await page.getByRole("searchbox", { name: "Search processes" }).fill("");
  await expect(page.getByRole("combobox", { name: "Sort by" }).locator("option").first()).toHaveText("Name");
  expect((await demoOrder(page)).slice(0, 1)).toEqual([IDS[0]]);
  // somebody else in this browser has their own order
  await signIn(page, ALEX);
  await open(page, "/processes");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("");
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("");
});

test("sorting on the search page is in the address and kept on reload", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=browse%20demo");
  await expect(page.locator("ol.cards > li.card[data-id^='browse-demo-']")).toHaveCount(N);
  const sort = page.getByRole("combobox", { name: "Sort by" });
  await expect(sort).toHaveValue("");
  await sort.selectOption({ label: "Newest" });
  await expect(page).toHaveURL(/[?&]sort=newest(&|$)/);
  expect(await demoOrder(page)).toEqual([...IDS].reverse());
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("newest");
  expect(await demoOrder(page)).toEqual([...IDS].reverse());
  await page.getByRole("combobox", { name: "Sort by" }).selectOption({ label: "Recently updated" });
  await expect(page).toHaveURL(/[?&]sort=updated(&|$)/);
  expect((await demoOrder(page))[0]).toBe(IDS[0]);
  await page.getByRole("combobox", { name: "Sort by" }).selectOption({ label: "Best match" });
  await expect(page).not.toHaveURL(/sort=/);
});

test("the marks “Draft” and “Unpublished changes” are shown only to the people who may see them", async ({ page, request }) => {
  // a never-published draft of the Cloud Platform team, and unpublished changes to one of the demos
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === IDS[1]);
  expect((await request.put("/api/processes/browse-draft-demo?base=0", { data: { ...src, id: "browse-draft-demo", title: "Browse demo draft", status: "draft", owner: "cloud-platform-team" }, headers: CSRF })).ok()).toBeTruthy();
  expect((await putWorkingDraft(request, "process", IDS[2], { ...processes.find((p: { id: string }) => p.id === IDS[2]), summary: "Changed in a draft." })).ok()).toBeTruthy();
  try {
    const marks = async (email: string) => {
      await signIn(page, email);
      await open(page, "/processes");
      await page.getByRole("searchbox", { name: "Search processes" }).fill("Browse demo");
      await expect(cards(page).first()).toBeVisible();
      return {
        draft: await page.locator('li.card[data-id="browse-draft-demo"] .card-mark.draft').count(),
        draftCard: await page.locator('li.card[data-id="browse-draft-demo"]').count(),
        changes: await page.locator(`li.card[data-id="${IDS[2]}"] .card-mark.changes`).count(),
      };
    };
    expect(await marks(ALEX)).toEqual({ draft: 1, draftCard: 1, changes: 1 }); // he may change both
    // the mark says who saved the changes, by name
    await expect(page.locator(`li.card[data-id="${IDS[2]}"] .card-mark.changes`)).toHaveAttribute("title", "Saved by Alex Editor, not yet published");
    expect(await marks(CASEY)).toEqual({ draft: 1, draftCard: 1, changes: 0 }); // looks after the team's draft; changes are the editors'
    expect(await marks(SAM)).toEqual({ draft: 0, draftCard: 0, changes: 0 }); // a reader: neither exists
  } finally {
    await as(request, ALEX);
    const w = await (await request.get(`/api/processes/${IDS[2]}/draft`)).json().catch(() => null);
    if (w?.revision) await request.delete(`/api/processes/${IDS[2]}/draft?rev=${w.revision}`, { headers: CSRF });
    await request.delete("/api/processes/browse-draft-demo", { headers: CSRF });
  }
});
