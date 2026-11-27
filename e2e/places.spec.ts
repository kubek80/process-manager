import { expect, test, type Page } from "@playwright/test";
import { ALEX, SAM, navigate, open, readCatalog, save, signIn } from "./helpers";

// The lists are two places, in the top bar and in Admin: Teams (who: teams, pillars, tribes,
// domains, practices, platforms) and Tools (tools, categories, architecture patterns, and where
// rules apply: tiers, paths, environments, languages). In Admin they are one page with one draft
// of the one document of the lists. The older one place, "Teams & tools" (#/catalog…), and
// #/admin/lists… lead to the same list and entry in their new place.

const TEAM_TABS = [/^Teams/, /^Pillars/, /^Tribes/, /^Domains/, /^Practices/, /^Platforms/];
const TOOL_TABS = [/^Tools/, /^Categories/, /^Architecture patterns/, /^Application tiers/, /^Paths/, /^Environments/, /^Languages/];
const tabs = (page: Page) => page.locator(".cat-kinds-groups").getByRole("tab");
const detail = (page: Page) => page.locator(".cat-detail");
const sideMenu = (page: Page) => page.locator(".admin-nav");

test("Teams and Tools are two places of the top bar, each with its own heading, lead and tabs", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/");
  const bar = page.locator("nav.nav");
  await expect(bar.getByRole("link")).toHaveText(["Home", "Processes", "Standards", "Requests", "Teams", "Tools", "Guide"]);
  await navigate(page, "Teams");
  await expect(page).toHaveURL(/#\/teams$/);
  await expect(page).toHaveTitle(/^Teams · /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Teams");
  const lead = page.locator(".catalog-page .head-text .lead");
  await expect(lead).toHaveText("Who owns what, how teams are grouped in pillars, tribes and domains, who belongs to each team, platform and practice, and how to reach them.");
  await expect(tabs(page)).toHaveText(TEAM_TABS);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  // two sets that stand a little apart, each named for screen readers, on one row
  await expect(page.getByRole("tablist", { name: "Teams and how they are grouped" }).getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tablist", { name: "Practices and platforms" }).getByRole("tab")).toHaveCount(2);
  const tops = await tabs(page).evaluateAll((ts) => ts.map((t) => Math.round(t.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(bar.getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
  // neither place speaks of the other's lists
  await expect(lead).not.toContainText(/tool|categor|pattern|tier|path|environment|language/i);

  await navigate(page, "Tools");
  await expect(page).toHaveURL(/#\/tools$/);
  await expect(page).toHaveTitle(/^Tools · /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tools");
  await expect(lead).toHaveText("The systems steps are done in, the categories and architecture patterns things are filed under, and where rules apply: application tiers, paths, environments and languages.");
  await expect(lead).not.toContainText(/team|pillar|tribe|domain|practice|platform/i);
  await expect(tabs(page)).toHaveText(TOOL_TABS);
  await expect(page.getByRole("tablist", { name: "Tools and how things are filed" }).getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tablist", { name: "Where rules apply" }).getByRole("tab")).toHaveCount(4);
  await expect(bar.getByRole("link", { name: "Tools", exact: true })).toHaveAttribute("aria-current", "page");
  // the list and the entry in the address
  await tabs(page).filter({ hasText: /^Paths/ }).click();
  await expect(page).toHaveURL(/#\/tools\/paths$/);
  await page.locator(".cat-item", { hasText: "Brownfield" }).click();
  await expect(page).toHaveURL(/#\/tools\/paths\/brownfield$/);
  await page.reload();
  await expect(detail(page).getByRole("heading", { name: "Brownfield" })).toBeVisible();
  // a team's, pillar's, practice's page is in Teams
  await open(page, "/practice/security");
  await expect(bar.getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".group-page > a.back")).toHaveText("Teams");
  await expect(page.locator(".group-page > a.back")).toHaveAttribute("href", "#/teams/practices/security");
  await open(page, "/pillar/core-network");
  await expect(bar.getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".group-page > a.back")).toHaveAttribute("href", "#/teams/pillars/core-network");
});

test("the older addresses lead to the same list and entry in its new place", async ({ page }) => {
  await signIn(page, ALEX);
  for (const [old, now, heading] of [
    ["/catalog", /#\/teams$/, "Teams"],
    ["/catalog/teams", /#\/teams$/, "Teams"],
    ["/catalog/platforms/google-cloud", /#\/teams\/platforms\/google-cloud$/, "Google Cloud"],
    ["/catalog/tools", /#\/tools$/, "Tools"],
    ["/catalog/languages/go", /#\/tools\/languages\/go$/, "Go"],
    ["/catalog/patterns/event-driven", /#\/tools\/patterns\/event-driven$/, "Event-driven"],
  ] as const) {
    await open(page, old);
    await expect(page, old).toHaveURL(now);
    if (heading !== "Teams" && heading !== "Tools") await expect(detail(page).getByRole("heading", { level: 2 })).toHaveText(heading);
    else await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
  for (const [old, now, entry] of [
    ["/admin/lists", /#\/admin\/teams$/, "Teams"],
    ["/admin/lists/tribes/cloud-tribe", /#\/admin\/teams\/tribes\/cloud-tribe$/, "Cloud"],
    ["/admin/lists/patterns/event-driven", /#\/admin\/tools\/patterns\/event-driven$/, "Event-driven"],
  ] as const) {
    await open(page, old);
    await expect(page, old).toHaveURL(now);
    if (entry === "Teams") await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Teams");
    else await expect(detail(page).locator('[data-field="name"]')).toHaveValue(entry);
  }
});

test("Admin › Teams and Admin › Tools are one page with one draft: changes under one are still there under the other, saved as one version", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, ALEX);
  const before = await page.request.get("/api/catalog");
  const version = Number(before.headers()["x-document-version"]);
  await open(page, "/admin/teams");
  await expect(sideMenu(page).getByRole("link")).toHaveText(["Teams", "Tools", "Skills", "Health"]); // a lists manager
  await expect(sideMenu(page).getByRole("link", { name: "Teams" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Teams");
  await expect(tabs(page)).toHaveText(TEAM_TABS);
  await page.locator(".cat-item", { hasText: "DNS team" }).click();
  await detail(page).getByLabel("What they do").fill("Runs the company's names, changed in a test.");
  const unsaved = page.locator(".cat-save-text");
  await expect(unsaved).toHaveText("Unsaved changes to the lists");
  // the other entry: nothing asked, the same unsaved state, its own tabs
  await sideMenu(page).getByRole("link", { name: "Tools" }).click();
  await expect(page).toHaveURL(/#\/admin\/tools$/);
  await expect(page.getByRole("dialog", { name: "Leave without saving?" })).toHaveCount(0);
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Tools");
  await expect(tabs(page)).toHaveText(TOOL_TABS);
  await expect(unsaved).toHaveText("Unsaved changes to the lists");
  await page.locator(".cat-item", { hasText: "Terraform" }).click();
  await detail(page).getByLabel("What it is used for").fill("Infrastructure as code, changed in a test.");
  // back to Teams, by the side menu and by Back: the first change is still there, on its entry
  await sideMenu(page).getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/#\/admin\/teams$/);
  await expect(detail(page).getByLabel("What they do")).toHaveValue("Runs the company's names, changed in a test.");
  await page.goBack();
  await expect(page).toHaveURL(/#\/admin\/tools$/);
  await expect(detail(page).getByLabel("What it is used for")).toHaveValue("Infrastructure as code, changed in a test.");
  // leaving both still asks
  await navigate(page, "Guide");
  const ask = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Stay" }).click();
  // one save: both changes, one version
  await save(page);
  const after = await page.request.get("/api/catalog");
  expect(Number(after.headers()["x-document-version"])).toBe(version + 1);
  const lists = await readCatalog(page);
  expect(lists.teams.find((t: { id: string }) => t.id === "dns-team").description).toBe("Runs the company's names, changed in a test.");
  expect(lists.tools.find((t: { id: string }) => t.id === "terraform").description).toBe("Infrastructure as code, changed in a test.");
  // put back
  await page.locator(".cat-item", { hasText: "Terraform" }).click();
  await detail(page).getByLabel("What it is used for").fill("");
  await sideMenu(page).getByRole("link", { name: "Teams" }).click();
  await page.locator(".cat-item", { hasText: "DNS team" }).click();
  await detail(page).getByLabel("What they do").fill("");
  await save(page);
});

test("what is to fix in the lists is listed under both entries, and going to a problem moves to its part", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/teams/teams/dns-team");
  await detail(page).locator('[data-field="name"]').fill("");
  await page.locator(".admin-nav").getByRole("link", { name: "Tools" }).click();
  const issues = page.locator("section.cat-issues").getByRole("list", { name: "What is to fix in the lists" });
  await expect(issues).toContainText("Give the team with the id “dns-team” a name.");
  await issues.getByRole("button", { name: /a name\.$/ }).click();
  await expect(page).toHaveURL(/#\/admin\/teams$/);
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Teams");
  await expect(sideMenu(page).getByRole("link", { name: "Teams" })).toHaveAttribute("aria-current", "page");
  await expect(detail(page).locator('[data-field="name"]')).toBeFocused();
  // and the other way round
  await detail(page).locator('[data-field="name"]').fill("DNS team");
  await sideMenu(page).getByRole("link", { name: "Tools" }).click();
  await page.locator(".cat-item", { hasText: "Terraform" }).click();
  await detail(page).locator('[data-field="name"]').fill("");
  await sideMenu(page).getByRole("link", { name: "Teams" }).click();
  await expect(issues).toContainText("Give the tool with the id “terraform” a name.");
  await issues.getByRole("button", { name: /a name\.$/ }).click();
  await expect(page).toHaveURL(/#\/admin\/tools$/);
  await expect(detail(page).locator('[data-field="name"]')).toBeFocused();
  await page.getByRole("button", { name: "Discard" }).click();
});

test("the keyboard goes through the tabs of the place one is in", async ({ page }) => {
  await signIn(page, ALEX);
  for (const [hash, first, last] of [["/tools", "Tools", "Languages"], ["/admin/tools", "Tools", "Languages"], ["/teams", "Teams", "Platforms"]] as const) {
    await open(page, hash);
    await tabs(page).first().focus();
    await expect(tabs(page).first()).toHaveAccessibleName(new RegExp(`^${first}`));
    await page.keyboard.press("End");
    await expect(tabs(page).last()).toBeFocused();
    await expect(tabs(page).last()).toHaveAccessibleName(new RegExp(`^${last}`));
    await page.keyboard.press("ArrowRight");
    await expect(tabs(page).first()).toBeFocused();
    await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  }
});

test("on a phone the Menu offers Teams and Tools, and each place fits without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  for (const [hash, place] of [["/teams", "Teams"], ["/tools", "Tools"]] as const) {
    await open(page, hash);
    await expect(page.locator("button.menu-btn")).toContainText(place);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
  await page.locator("button.menu-btn").click();
  const sheet = page.getByRole("navigation", { name: "Main" });
  await expect(sheet.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Tools", exact: true })).toHaveAttribute("aria-current", "page");
  await sheet.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(page).toHaveURL(/#\/teams$/);
});
