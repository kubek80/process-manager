import { expect, test, type Locator, type Page } from "@playwright/test";
import { ALEX, CSRF, JORDAN, open, SAM, signIn, watchErrors } from "./helpers";

// Home is one search over processes and standards; the results page narrows it down with
// filters, and its address carries all of it. The sample has 7 processes and 3 standards.

const results = (page: Page) => page.locator(".search-page ol.cards > li.card");
const count = (page: Page) => page.locator("p.list-count");
const group = (page: Page, key: string) => page.locator(`.filter-dd[data-filter="${key}"]`);
/** Opens the dropdown of one filter (once) and gives it. */
async function openGroup(page: Page, key: string) {
  const g = group(page, key);
  const button = g.locator("button.filter-dd-button");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(g.locator(".filter-dd-list")).toBeVisible();
  return g;
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The number an option says it would give, read from what is shown next to it. */
const numberOf = async (option: Locator) => Number((await option.locator(".filter-option-count").innerText()).match(/\d+/)![0]);

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
  const gcp = page.locator('li.card[data-id="request-gcp-project"]');
  await expect(gcp.locator(".card-kind")).toHaveText("Process");
  await expect(gcp.locator("h2.card-title mark.search-mark")).toHaveText("GCP");
  await expect(gcp.locator('[data-line="rigour"] dd')).toHaveText("Mandatory");
  await expect(gcp.locator('[data-line="platform"] dd')).toHaveText("Google Cloud");
  await expect(gcp.locator('[data-line="owner"] dd')).toHaveText("Cloud Platform team");
  const iac = page.locator('li.card[data-kind="standard"][data-id="infrastructure-as-code"]');
  await expect(iac.locator(".card-kind")).toHaveText("Standard");
  await expect(iac.locator('[data-line="rigour"] dd')).toHaveText("4 must · 1 should"); // the level of a standard comes from its requirements
  await expect(iac.locator('[data-line="rules"] dd')).toHaveText("5 requirements");
  await expect(iac.locator('[data-line="practice"] dd')).toHaveText("Engineering");
  // the apigee process only mentions it inside: the place is named
  await expect(page.locator('li.card[data-id="onboard-api-to-apigee"] ul.card-hits')).toBeVisible();
});

test("each filter narrows the results, and the number next to an option is what it gives", async ({ page }) => {
  await open(page, "/search");
  await expect(count(page)).toHaveText("10 results");
  // the kind is chosen with the tabs above the results, each with what it gives; the address says it
  const tabs = page.getByRole("radiogroup", { name: "Show" });
  for (const [i, name] of ["All, 10 results", "Processes, 7 results", "Standards, 3 results"].entries()) await expect(tabs.getByRole("radio").nth(i)).toHaveAccessibleName(name);
  await expect(tabs.getByRole("radio", { name: /^All,/ })).toHaveAttribute("aria-checked", "true");
  await tabs.getByRole("radio", { name: /^Standards,/ }).click();
  await expect(results(page)).toHaveCount(3);
  await expect(page).toHaveURL(/[?&]type=standard(&|$)/);
  await expect(tabs.locator(".type-tab.on")).toHaveAttribute("data-type", "standard");
  await expect(count(page)).toHaveText("3 results");
  await tabs.getByRole("radio", { name: /^Standards,/ }).press("ArrowLeft"); // the arrow keys move the choice
  await expect(tabs.getByRole("radio", { name: /^Processes,/ })).toBeFocused();
  await expect(results(page)).toHaveCount(7);
  await expect(page).toHaveURL(/[?&]type=process(&|$)/);
  await tabs.getByRole("radio", { name: /^All,/ }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(count(page)).toHaveText("10 results");
  for (const key of ["rigour", "category", "practice", "platform", "owner"]) {
    await openGroup(page, key);
    const options = group(page, key).locator("label.filter-option:not(.off)");
    const n = await options.count();
    expect(n, `options of ${key}`).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const option = options.nth(i);
      const name = await option.locator(".filter-option-name").innerText();
      const expected = await numberOf(option);
      await option.getByRole("checkbox").check();
      await expect(results(page), `${key}: ${name}`).toHaveCount(expected);
      await expect(count(page)).toHaveText(`${expected} ${expected === 1 ? "result" : "results"} with 1 filter`);
      await expect(page.getByRole("button", { name: `Remove filter ${await group(page, key).locator(".filter-dd-name").innerText()}: ${name}` })).toBeVisible();
      await option.getByRole("checkbox").uncheck();
      await expect(count(page)).toHaveText("10 results");
    }
    await group(page, key).locator("button.filter-dd-button").click(); // closes it
  }
  // what gives nothing is shown greyed out and cannot be picked: nothing is optional in the sample
  await openGroup(page, "rigour");
  const optional = group(page, "rigour").locator("label.filter-option.off", { hasText: "Optional" });
  await expect(optional.getByRole("checkbox")).toBeDisabled();
});

test("two values of one filter mean either; two filters mean both", async ({ page }) => {
  await open(page, "/search");
  const platform = await openGroup(page, "platform");
  await platform.getByRole("checkbox", { name: "Google Cloud, 2 results" }).check();
  await expect(results(page)).toHaveCount(2);
  await platform.getByRole("checkbox", { name: /^Azure, / }).check();
  await expect(results(page)).toHaveCount(3); // Google Cloud or Azure
  await expect(page).toHaveURL(/platform=google-cloud,azure/);

  // the counts of the other filters, and of the tabs, follow what is chosen
  const tabs = page.getByRole("radiogroup", { name: "Show" });
  await expect(tabs.getByRole("radio", { name: "Standards, 1 result" })).toBeVisible();
  await tabs.getByRole("radio", { name: "Standards, 1 result" }).click();
  await expect(results(page)).toHaveCount(1); // a standard and on one of the two platforms
  await expect(results(page).first()).toHaveAttribute("data-id", "infrastructure-as-code");
  await expect(page).toHaveURL(/[?&]type=standard(&|$)/);
  await expect(count(page)).toHaveText("1 result with 2 filters");
  await expect(page.locator(".filter-toggle")).toBeHidden(); // on a wide screen the filters are always shown
  await expect(page.getByRole("button", { name: /^Platform: (Google Cloud, Azure|Azure, Google Cloud)$/ })).toBeVisible();

  // the address carries all of it: a reload, and the copied address in another tab, show the same
  await page.reload();
  await expect(results(page)).toHaveCount(1);
  await openGroup(page, "platform");
  await expect(platform.getByRole("checkbox", { name: /^Azure, / })).toBeChecked();
  const address = page.url();
  const other = await page.context().newPage();
  await other.goto(address);
  await expect(other.locator(".search-page ol.cards > li.card")).toHaveCount(1);
  await expect(other.locator("p.list-count")).toHaveText("1 result with 2 filters");
  await expect(other.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: /^Standards,/ })).toHaveAttribute("aria-checked", "true");
  await other.close();

  // a chosen filter is removed on its own, or all at once
  const chosen = page.locator(".filter-chosen");
  await expect(chosen.locator("button.filter-chip")).toHaveCount(2); // the kind is a tab, not a filter chip
  await tabs.getByRole("radio", { name: /^All,/ }).click();
  await expect(results(page)).toHaveCount(3);
  await expect(page).not.toHaveURL(/type=/);
  await chosen.getByRole("button", { name: "Clear all filters" }).click();
  await expect(results(page)).toHaveCount(10);
  await expect(page.locator(".filter-chosen")).toHaveCount(0);
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
  const gcp = page.locator('li.card[data-id="request-gcp-project"]');
  const step = gcp.locator("ul.card-hits a", { hasText: "Add your project to the project factory" });
  await expect(step.locator(".card-hit-where")).toHaveText("Step");
  await expect(step.locator("mark.search-mark").first()).toBeVisible();
  await step.click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow\/[\w-]+$/);
  await expect(page.locator(".drawer h3")).toHaveText("Add your project to the project factory");

  await open(page, "/search?q=personal%20data");
  const logging = page.locator('li.card[data-id="secure-logging"]');
  const requirement = logging.locator("ul.card-hits a", { hasText: "SEC-LOG-02" });
  // "Requirement · its name · SEC-LOG-02": the code comes after the name
  await expect(requirement.locator(".card-hit-where")).toHaveText("Requirement");
  await expect(requirement.locator(".card-hit-code")).toHaveText("SEC-LOG-02");
  expect(await requirement.evaluate((a) => [...a.querySelectorAll(".card-hit-where, .card-hit-label, .card-hit-code")].map((e) => e.className))).toEqual(["card-hit-where", "card-hit-label", "card-hit-code"]);
  await requirement.click();
  await expect(page).toHaveURL(/#\/s\/secure-logging\/doc\/SEC-LOG-02$/);
  await expect(page.locator("#req-SEC-LOG-02")).toHaveClass(/selected/);
  await expect(page.locator("#req-SEC-LOG-02")).toBeInViewport();
});

test("when nothing is found, the filters can be dropped from there", async ({ page }) => {
  await open(page, "/search?q=gcp&platform=azure");
  const empty = page.locator(".search-empty");
  await expect(empty.getByRole("heading", { name: "Nothing found" })).toBeVisible();
  await expect(empty).toContainText("Nothing matches “gcp” with these filters. Without them there are 3 results.");
  // one way out, the primary "Clear all filters"; the link beside the chips is not offered twice
  await expect(empty.getByRole("button", { name: /^Without / })).toHaveCount(0);
  await expect(empty.getByRole("button", { name: "Clear all filters" })).toHaveClass(/\bprimary\b/);
  await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(1);
  await empty.getByRole("button", { name: "Clear all filters" }).click();
  await expect(results(page)).toHaveCount(3);

  await open(page, "/search?q=gcp&platform=azure&type=standard");
  await page.locator(".search-empty").getByRole("button", { name: "Clear all filters" }).click();
  await expect(results(page)).toHaveCount(3);

  // without filters: what was tried, a hint on the words, and the libraries to browse; nothing to press that would only repeat it
  await open(page, "/search?q=zzqx");
  await expect(page.locator(".search-empty")).toContainText("Nothing matches “zzqx”, and nothing comes close by meaning either. Try another word.");
  await expect(page.locator(".search-try-other")).toHaveCount(0);
  await page.locator(".search-empty").getByRole("link", { name: "all processes" }).click();
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
});

test("a draft is found only by the people who may see it (its editors and its team), and is marked as one", async ({ page }) => {
  // a draft process of the Cloud Platform team on Azure, made by a process editor
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes } = await (await page.request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  const made = await page.request.put("/api/processes/search-draft-demo?base=0", {
    data: { ...src, id: "search-draft-demo", title: "Zebra draft demo", status: "draft", owner: "cloud-platform-team", platform: "azure", practice: undefined }, headers: CSRF,
  });
  expect(made.ok()).toBeTruthy();
  try {
    await signIn(page, SAM);
    await open(page, "/search?q=zebra");
    // words find nothing; the closest by meaning never include a draft (drafts are not searched by meaning)
    await expect(count(page).filter({ hasText: /^No exact match for “zebra”\. Closest by meaning:$/ }).or(page.locator(".search-empty h2")).first()).toBeVisible();
    await expect(page.locator('li.card[data-id="search-draft-demo"]')).toHaveCount(0);

    // Jordan is Owner of the team, so the draft reaches him: he looks after it, and finds it marked as a draft
    await signIn(page, JORDAN);
    expect((await (await page.request.get("/api/processes")).json()).processes.some((p: { id: string }) => p.id === "search-draft-demo")).toBe(true);
    await open(page, "/search?q=zebra");
    await expect(page.locator('li.card[data-id="search-draft-demo"] .card-mark.draft')).toHaveText("Draft");

    await signIn(page, ALEX);
    await open(page, "/search?q=zebra");
    const hit = page.locator('li.card[data-id="search-draft-demo"]');
    await expect(hit).toBeVisible();
    await expect(hit).toHaveClass(/\bdraft\b/);
    await expect(hit.locator(".card-mark.draft")).toHaveText("Draft");
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
    const toggle = page.locator("button.filter-toggle");
    await expect(toggle).toHaveText("Filters");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#search-filters")).toBeHidden();
    expect(await sideways(page), `results at ${width}px`).toBe(0);

    await toggle.click();
    await expect(page.locator("#search-filters")).toBeVisible();
    const option = (await openGroup(page, "platform")).locator("label.filter-option:not(.off)").first();
    const expected = await numberOf(option);
    await option.getByRole("checkbox").check();
    await expect(toggle).toHaveText("Filters (1)");
    await expect(results(page)).toHaveCount(expected);
    expect(await sideways(page), `results with the filters open at ${width}px`).toBe(0);
    for (const el of [page.locator(".filter-chosen button.filter-chip"), page.locator(".filter-clear")])
      await expect(el).toBeInViewport({ ratio: 1 });
    // the open panel pushes the results down; folding it away brings them back up
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#search-filters")).toBeHidden();
    await expect(results(page).first().locator("h2 a")).toBeInViewport({ ratio: 1 });
    // the kinds are tabs above the results, on a phone too
    await open(page, "/search?q=gcp");
    await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: /^Standards,/ }).click();
    await expect(results(page).first()).toHaveAttribute("data-kind", "standard");
    expect(await sideways(page), `the kind tabs at ${width}px`).toBe(0);

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
  // Tab goes through the page size and the filters to the first result
  const first = results(page).first().locator("h2.card-title a");
  const reached: string[] = [];
  for (let i = 0; i < 40 && !(await first.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
    reached.push(await page.evaluate(() => { const el = document.activeElement as HTMLElement; return el.getAttribute("aria-label") ?? el.textContent ?? ""; }));
  }
  await expect(first).toBeFocused();
  // the page size, then the filters of the panel, come before the first result
  const at = (name: string) => reached.findIndex((r) => r.startsWith(name));
  expect(at("Items per page"), reached.join(" | ")).toBeGreaterThanOrEqual(0);
  expect(at("Items per page")).toBeLessThan(at("Category:"));
  expect(at("Only my bookmarks")).toBeLessThan(at("Category:"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Onboard a site to Akamai" })).toBeVisible();
});
