import { expect, test, type Locator, type Page } from "@playwright/test";
import { ALEX, CSRF, open, SAM, signIn, watchErrors } from "./helpers";

// Home is one search over processes and standards; the results page narrows it down with
// filters, and its address carries all of it. The sample has 7 processes and 3 standards.

const results = (page: Page) => page.locator("ol.search-list > li.search-result");
const count = (page: Page) => page.locator("p.search-count");
const group = (page: Page, key: string) => page.locator(`fieldset.search-facet[data-filter="${key}"]`);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The number an option says it would give, read from what is shown next to it. */
const numberOf = async (option: Locator) => Number((await option.locator(".search-option-count").innerText()).match(/\d+/)![0]);

test.beforeEach(async ({ page }) => { await signIn(page, SAM); });

test("Home searches processes and standards and offers ways in", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  const home = page.locator(".home-page");
  await expect(home.getByRole("heading", { level: 1 })).toHaveText("Find a process or a standard");
  await expect(home.locator(".search-box.big").getByRole("searchbox", { name: "Search processes and standards" })).toBeVisible();
  await expect(page.locator(".nav").getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  // all processes, all standards, with how many there are
  const all = home.locator(".home-entry");
  await expect(all).toHaveCount(2);
  await expect(all.filter({ hasText: "All processes" }).locator(".home-entry-count")).toHaveText("7 processes");
  await expect(all.filter({ hasText: "All standards" }).locator(".home-entry-count")).toHaveText("3 standards");
  // by platform, practice and category: each way in says how much it leads to, and leads there
  for (const way of ["platform", "practice", "category"]) await expect(home.locator(`section.home-group[data-browse="${way}"] a.chip`).first()).toBeVisible();
  const gcp = home.locator('section.home-group[data-browse="platform"]').getByRole("link", { name: "Google Cloud, 2 results" });
  await gcp.click();
  await expect(page).toHaveURL(/#\/search\?platform=google-cloud$/);
  await expect(results(page)).toHaveCount(2);
  await page.goBack();
  await all.filter({ hasText: "All standards" }).click();
  await expect(page.getByRole("heading", { name: "What must I meet?" })).toBeVisible();
  await page.goBack();

  // searching goes to the results; Back comes home again
  await home.getByRole("searchbox").fill("gcp");
  await home.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/search\?q=gcp$/);
  await expect(count(page)).toHaveText("3 results for “gcp”");
  await expect(page.getByRole("searchbox", { name: "Search processes and standards" })).toHaveValue("gcp");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Find a process or a standard" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("results mix processes and standards, with what they belong to and where the words were found", async ({ page }) => {
  await open(page, "/search?q=gcp");
  await expect(results(page)).toHaveCount(3);
  // the best match first: the word is in its title
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  const gcp = page.locator('li.search-result[data-id="request-gcp-project"]');
  await expect(gcp.locator(".search-kind")).toHaveText("Process");
  await expect(gcp.locator("h2.search-result-title mark.search-mark")).toHaveText("GCP");
  await expect(gcp.locator(".search-tags")).toContainText("Mandatory");
  await expect(gcp.locator(".search-tags")).toContainText("Google Cloud");
  await expect(gcp.locator(".search-tags")).toContainText("Cloud Platform team");
  const iac = page.locator('li.search-result[data-kind="standard"][data-id="infrastructure-as-code"]');
  await expect(iac.locator(".search-kind")).toHaveText("Standard");
  await expect(iac.locator(".search-tags")).toContainText("4 mandatory, 1 recommended"); // the rigour of a standard comes from its requirements
  await expect(iac.locator(".search-tags")).toContainText("Engineering");
  // the apigee process only mentions it inside: the place is named
  await expect(page.locator('li.search-result[data-id="onboard-api-to-apigee"] ul.search-hits')).toBeVisible();
});

test("each filter narrows the results, and the number next to an option is what it gives", async ({ page }) => {
  await open(page, "/search");
  await expect(count(page)).toHaveText("10 results");
  for (const key of ["type", "rigour", "category", "practice", "platform"]) {
    const options = group(page, key).locator("label.search-option:not(.off)");
    const n = await options.count();
    expect(n, `options of ${key}`).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const option = options.nth(i);
      const name = await option.locator(".search-option-name").innerText();
      const expected = await numberOf(option);
      await option.getByRole("checkbox").check();
      await expect(results(page), `${key}: ${name}`).toHaveCount(expected);
      await expect(count(page)).toHaveText(`${expected} ${expected === 1 ? "result" : "results"} with 1 filter`);
      await expect(page.getByRole("button", { name: `Remove filter ${await group(page, key).locator("legend").innerText()}: ${name}` })).toBeVisible();
      await option.getByRole("checkbox").uncheck();
      await expect(count(page)).toHaveText("10 results");
    }
  }
  // what gives nothing is shown greyed out and cannot be picked: nothing is optional in the sample
  const optional = group(page, "rigour").locator("label.search-option.off", { hasText: "Optional" });
  await expect(optional.getByRole("checkbox")).toBeDisabled();
});

test("two values of one filter mean either; two filters mean both", async ({ page }) => {
  await open(page, "/search");
  const platform = group(page, "platform");
  await platform.getByRole("checkbox", { name: "Google Cloud, 2 results" }).check();
  await expect(results(page)).toHaveCount(2);
  await platform.getByRole("checkbox", { name: /^Azure, / }).check();
  await expect(results(page)).toHaveCount(3); // Google Cloud or Azure
  await expect(page).toHaveURL(/platform=google-cloud,azure/);

  // the counts of the other filters follow what is chosen
  await expect(group(page, "type").getByRole("checkbox", { name: "Standards, 1 result" })).toBeVisible();
  await group(page, "type").getByRole("checkbox", { name: "Standards, 1 result" }).check();
  await expect(results(page)).toHaveCount(1); // a standard and on one of the two platforms
  await expect(results(page).first()).toHaveAttribute("data-id", "infrastructure-as-code");
  await expect(count(page)).toHaveText("1 result with 3 filters");
  await expect(page.locator(".search-filter-toggle")).toBeHidden(); // on a wide screen the filters are always shown

  // the address carries all of it: a reload, and the copied address in another tab, show the same
  await page.reload();
  await expect(results(page)).toHaveCount(1);
  await expect(platform.getByRole("checkbox", { name: /^Azure, / })).toBeChecked();
  const address = page.url();
  const other = await page.context().newPage();
  await other.goto(address);
  await expect(other.locator("ol.search-list > li.search-result")).toHaveCount(1);
  await expect(other.locator("p.search-count")).toHaveText("1 result with 3 filters");
  await other.close();

  // a chosen filter is removed on its own, or all at once
  const chosen = page.locator(".search-chosen");
  await expect(chosen.locator("button.chip.on")).toHaveCount(3);
  await chosen.getByRole("button", { name: "Remove filter Type: Standards" }).click();
  await expect(results(page)).toHaveCount(3);
  await expect(page).not.toHaveURL(/type=/);
  await chosen.getByRole("button", { name: "Clear all filters" }).click();
  await expect(results(page)).toHaveCount(10);
  await expect(page.locator(".search-chosen")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/search$/);
});

test("typing searches at once and keeps Back for the page before", async ({ page }) => {
  await open(page, "/standards");
  await open(page, "/search");
  const box = page.getByRole("searchbox", { name: "Search processes and standards" });
  await box.fill("logging");
  await expect(page).toHaveURL(/#\/search\?q=logging$/);
  await expect(results(page).first()).toHaveAttribute("data-id", "secure-logging");
  await box.fill("logging ret");
  await expect(page).toHaveURL(/q=logging(%20|\+)ret/);
  await page.goBack(); // what was typed is no step of its own
  await expect(page.getByRole("heading", { name: "What must I meet?" })).toBeVisible();
});

test("a place found inside a document opens straight at that step or requirement", async ({ page }) => {
  await open(page, "/search?q=project%20factory");
  const gcp = page.locator('li.search-result[data-id="request-gcp-project"]');
  const step = gcp.locator("ul.search-hits a", { hasText: "Add your project to the project factory" });
  await expect(step.locator(".search-hit-where")).toHaveText("Step");
  await expect(step.locator("mark.search-mark").first()).toBeVisible();
  await step.click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow\/[\w-]+$/);
  await expect(page.locator(".drawer h3")).toHaveText("Add your project to the project factory");

  await open(page, "/search?q=personal%20data");
  const logging = page.locator('li.search-result[data-id="secure-logging"]');
  const requirement = logging.locator("ul.search-hits a", { hasText: "SEC-LOG-02" });
  await expect(requirement.locator(".search-hit-where")).toHaveText("Requirement SEC-LOG-02");
  await requirement.click();
  await expect(page).toHaveURL(/#\/s\/secure-logging\/doc\/SEC-LOG-02$/);
  await expect(page.locator("#req-SEC-LOG-02")).toHaveClass(/selected/);
  await expect(page.locator("#req-SEC-LOG-02")).toBeInViewport();
});

test("when nothing is found, the filters can be dropped from there", async ({ page }) => {
  await open(page, "/search?q=gcp&platform=azure");
  const empty = page.locator(".search-empty");
  await expect(empty.getByRole("heading", { name: "Nothing found" })).toBeVisible();
  await expect(empty).toContainText("Without the filters there are 3 results.");
  await empty.getByRole("button", { name: "Without Platform: Azure" }).click();
  await expect(results(page)).toHaveCount(3);

  await open(page, "/search?q=gcp&platform=azure&type=standard");
  await page.locator(".search-empty").getByRole("button", { name: "Clear all filters" }).click();
  await expect(results(page)).toHaveCount(3);

  // without filters: a hint on the words, and the libraries to browse
  await open(page, "/search?q=zzqx");
  await expect(page.locator(".search-empty")).toContainText("Check the spelling");
  await page.locator(".search-empty").getByRole("link", { name: "all processes" }).click();
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
});

test("a draft is found only by the people who may see it, and is marked as one", async ({ page }) => {
  // a draft process, made by a process editor
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes } = await (await page.request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  const made = await page.request.put("/api/processes/search-draft-demo?base=0", {
    data: { ...src, id: "search-draft-demo", title: "Zebra draft demo", status: "draft" }, headers: CSRF,
  });
  expect(made.ok()).toBeTruthy();
  try {
    await signIn(page, SAM);
    await open(page, "/search?q=zebra");
    await expect(page.locator(".search-empty h2")).toHaveText("Nothing found");

    await signIn(page, ALEX, { editor: true });
    await open(page, "/search?q=zebra");
    const hit = page.locator('li.search-result[data-id="search-draft-demo"]');
    await expect(hit).toBeVisible();
    await expect(hit.locator(".search-tags .tier-tag", { hasText: "Draft" })).toBeVisible();
    // in Consumer mode the same person sees what readers see
    await page.locator(".mode-switch").getByRole("button", { name: "Consumer" }).click();
    await expect(page.locator(".search-empty h2")).toHaveText("Nothing found");
  } finally {
    await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
    expect((await page.request.delete("/api/processes/search-draft-demo", { headers: CSRF })).ok()).toBeTruthy();
  }
});

for (const width of [390, 360]) {
  test(`on a phone ${width} wide the filters are behind one button and nothing scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, "/");
    await expect(page.locator(".home-page h1")).toBeVisible();
    expect(await sideways(page), `Home at ${width}px`).toBe(0);

    await open(page, "/search?q=gcp");
    await expect(results(page)).toHaveCount(3);
    const toggle = page.locator("button.search-filter-toggle");
    await expect(toggle).toHaveText("Filters");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#search-filters")).toBeHidden();
    expect(await sideways(page), `results at ${width}px`).toBe(0);

    await toggle.click();
    await expect(page.locator("#search-filters")).toBeVisible();
    await group(page, "type").getByRole("checkbox", { name: /^Standards, / }).check();
    await expect(toggle).toHaveText("Filters (1)");
    await expect(results(page)).toHaveCount(1);
    expect(await sideways(page), `results with the filters open at ${width}px`).toBe(0);
    for (const el of [page.locator(".search-chosen button.chip.on"), page.locator(".search-clear"), results(page).first().locator("h2 a")])
      await expect(el).toBeInViewport({ ratio: 1 });

    await open(page, "/search?q=gcp&platform=azure&type=standard");
    await expect(page.locator(".search-empty h2")).toBeVisible();
    expect(await sideways(page), `nothing found at ${width}px`).toBe(0);
  });
}

test("search works with the keyboard alone", async ({ page }) => {
  await open(page, "/");
  const box = page.getByRole("searchbox", { name: "Search processes and standards" });
  await expect(box).toBeFocused(); // ready for typing on a computer
  await page.keyboard.type("akamai");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/search\?q=akamai$/);
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  // Tab goes through the filters to the first result
  const first = results(page).first().locator("h2.search-result-title a");
  for (let i = 0; i < 40 && !(await first.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Onboard a site to Akamai" })).toBeVisible();
});
