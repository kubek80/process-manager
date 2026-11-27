import { expect, test } from "@playwright/test";
import { ALEX, CSRF, fields, open, openEditor, outline, publish, readCatalog, readProcess, readWorkingDraft, save, saveDraft, signIn, unfold } from "./helpers";

// Alex manages the lists: for him the Admin panel has Teams, Tools, Services, Skills and Health only.

test.beforeEach(async ({ page }) => { await signIn(page, ALEX); });

test("add a tool, fill in its details and save", async ({ page }) => {
  await open(page, "/admin/tools");
  await page.getByRole("tab", { name: /Tools/ }).click();
  await page.getByRole("button", { name: "New tool" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Jira Service Desk");
  await expect(page.locator(".cat-new")).toContainText("jira-service-desk");
  await page.keyboard.press("Enter");

  const detail = page.locator(".cat-detail");
  await expect(detail.getByRole("heading", { name: "Jira Service Desk" })).toBeVisible();
  await detail.getByLabel("Link").fill("https://jira.example.com");
  await expect(page.locator(".cat-item", { hasText: "Jira Service Desk" })).toContainText("new");
  await save(page);

  expect((await readCatalog(page)).tools).toContainEqual({ id: "jira-service-desk", name: "Jira Service Desk", url: "https://jira.example.com" });
});

test("an entry that is in use cannot be removed; an unused one can", async ({ page }) => {
  const before = await readCatalog(page);
  await open(page, "/admin/teams");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await expect(page.getByRole("button", { name: "Remove this team" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still used by");
  await expect(page.locator(".cat-usage")).toContainText("Request a GCP project");

  // a team that performs a service is in use too, until the service goes (or gets another team)
  await page.locator(".cat-item", { hasText: "Network team" }).click();
  await expect(page.locator(".cat-usage")).toContainText("nothing yet");
  await expect(page.getByRole("button", { name: "Remove this team" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still performs 1 service (under Services). Give it another team first, then it can be removed.");
  await page.locator(".admin-nav").getByRole("link", { name: "Services" }).click();
  await page.locator(".cat-item", { hasText: "Firewall rule change" }).click();
  await page.getByRole("button", { name: "Remove this service" }).click();
  await page.locator(".admin-nav").getByRole("link", { name: "Teams" }).click();
  await page.locator(".cat-item", { hasText: "Network team" }).click();
  await page.getByRole("button", { name: "Remove this team" }).click();
  await expect(page.locator(".cat-item", { hasText: "Network team" })).toHaveCount(0);
  await save(page);
  const saved = await readCatalog(page);
  expect(saved.teams.map((t: { id: string }) => t.id)).not.toContain("network-team");
  expect(saved.services.map((s: { id: string }) => s.id)).not.toContain("firewall-rule-change");
  // both back as they were: other tests read the sample's services
  const now = await page.request.get("/api/catalog");
  const back = await page.request.put(`/api/catalog?base=${now.headers()["x-document-version"]}`, { data: { ...saved, teams: before.teams, services: before.services }, headers: CSRF });
  expect(back.ok(), await back.text()).toBeTruthy();
});

test("discard restores the lists; renaming keeps the id", async ({ page }) => {
  await open(page, "/admin/tools");
  await page.getByRole("tab", { name: /Application tiers/ }).click();
  await page.locator(".cat-item", { hasText: "Tier 3" }).click();
  await page.locator(".cat-detail").getByLabel("Name").fill("Tier 3 (sandbox)");
  await expect(page.locator(".cat-detail code").first()).toHaveText("tier-3");
  await page.locator(".save-bar").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".cat-item", { hasText: "Tier 3 (sandbox)" })).toHaveCount(0);
  await expect(page.locator(".saved")).toBeVisible(); // nothing left to save
  await expect(page.getByRole("button", { name: "Undo" })).toBeFocused(); // Discard can be undone, and says so by putting the focus there
});

test("a missing tool can be added straight from a step", async ({ page }) => {
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, /^1 Find the catalogue item/);
  const drawer = fields(page);
  const tool = drawer.getByRole("combobox", { name: "Tool" });
  await tool.selectOption("__new");
  // the name is typed in a field in the panel; Enter (or "Add tool") saves it to the list of tools
  await drawer.getByLabel("Name of the new tool").fill("Confluence");
  await drawer.getByLabel("Name of the new tool").press("Enter");
  await expect(tool).toHaveValue("confluence");
  await expect(drawer.getByLabel("Name of the new tool")).toHaveCount(0);
  // the tool is in the lists at once; the step only once the change is published
  expect((await readCatalog(page)).tools).toContainEqual({ id: "confluence", name: "Confluence" });
  await saveDraft(page);
  expect((await readWorkingDraft(page, "process", "raise-servicenow-request"))!.doc.steps[0].tool).toBe("confluence");
  await publish(page);
  expect((await readProcess(page, "raise-servicenow-request"))!.steps[0].tool).toBe("confluence");
});

test("a new environment can be chosen in a process; the lists of groups are separate", async ({ page }) => {
  await open(page, "/admin/teams");
  await expect(page.locator(".admin-nav a")).toHaveText(["Teams", "Tools", "Services", "Skills", "Health"]); // no Access, Activity or System for a lists manager
  // teams, practices and platforms are three lists: a team is just a group of people, of no kind
  // Admin › Teams: its tabs in two sets, the teams with their groups, then practices and platforms
  await expect(page.getByRole("group", { name: "Lists of teams" }).getByRole("tablist")).toHaveCount(2);
  for (const n of ["Teams and how they are grouped", "Practices and platforms"]) await expect(page.getByRole("tablist", { name: n, exact: true })).toBeVisible();
  const tabs = page.getByRole("group", { name: "Lists of teams" }).getByRole("tab");
  const names = ["Teams", "Pillars", "Tribes", "Domains", "Practices", "Platforms"];
  await expect(tabs).toHaveText(names.map((n) => new RegExp(`^${n}\\s*\\d+$`)));
  // each tab counts its entries; the one chosen is marked, and says what the list is for under the tabs
  const lists = await readCatalog(page);
  await expect(tabs.first().locator(".tab-count")).toHaveText(String(lists.teams.length));
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toHaveClass(/\bon\b/);
  await expect(page.locator("p.cat-blurb")).toHaveText((await tabs.first().getAttribute("title"))!);
  await page.locator(".cat-item", { hasText: "DNS team" }).click();
  await expect(page.locator(".cat-detail .eyebrow")).toHaveText("team");
  await expect(page.locator(".cat-detail").getByRole("button", { name: "Platform owner" })).toHaveCount(0);
  // the team Cyber Security and the practice Cyber security share an id, each in its own list
  await page.locator(".cat-item", { hasText: "Cyber Security" }).click();
  await expect(page.locator(".cat-detail code").first()).toHaveText("security");
  await page.getByRole("tab", { name: /Practices/ }).click();
  await page.locator(".cat-item", { hasText: "Cyber security" }).click();
  await expect(page.locator(".cat-detail .eyebrow")).toHaveText("practice");
  await expect(page.locator(".cat-detail code").first()).toHaveText("security");
  await expect(page.locator(".cat-usage")).toContainText("Secure logging");

  await page.locator(".admin-nav").getByRole("link", { name: "Tools" }).click();
  await page.getByRole("tab", { name: /Environments/ }).click();
  await page.getByRole("button", { name: "New environment" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Pre-production");
  await page.keyboard.press("Enter");
  await save(page);
  const catalog = await readCatalog(page);
  expect(catalog.teams.every((t: Record<string, unknown>) => !("kind" in t))).toBe(true);
  expect(catalog.environments.at(-1)).toEqual({ id: "pre-production", name: "Pre-production" });

  await signIn(page, ALEX);
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, "About");
  await unfold(page, "Where it applies");
  await expect(fields(page).getByRole("button", { name: "Pre-production" })).toBeVisible();
});

test("the lists' tabs are one set for the keyboard: one Tab stop, the arrows through the place's tabs, Home and End", async ({ page }) => {
  for (const hash of ["/admin/teams", "/teams"]) {
    await open(page, hash);
    const lists = page.getByRole("group", { name: "Lists of teams" });
    const tabs = lists.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    // one Tab stop: only the chosen tab can be reached with Tab
    expect(await tabs.evaluateAll((ts) => ts.map((t) => t.getAttribute("tabindex")))).toEqual(["0", ...Array(5).fill("-1")]);
    await tabs.first().focus();
    await expect(tabs.first()).toHaveAccessibleName(/^Teams/);
    // the arrows choose the next one, across the two sets, and keep the keyboard on it
    for (const name of ["Pillars", "Tribes", "Domains", "Practices", "Platforms"]) {
      await page.keyboard.press("ArrowRight");
      const tab = lists.getByRole("tab", { name: new RegExp(`^${name}`) });
      await expect(tab).toBeFocused();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(tab).toHaveAttribute("tabindex", "0");
    }
    await expect(page.getByRole("tablist", { name: "Practices and platforms", exact: true }).getByRole("tab", { name: /^Platforms/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(lists.getByRole("tab", { name: /^Teams/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(lists.getByRole("tab", { name: /^Platforms/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(lists.getByRole("tab", { name: /^Teams/ })).toBeFocused();
    await page.keyboard.press("End");
    await expect(lists.getByRole("tab", { name: /^Platforms/ })).toBeFocused();
    await page.keyboard.press("Home");
    // Tab leaves the tabs at once
    await page.keyboard.press("Tab");
    await expect(tabs.first()).not.toBeFocused();
    expect(await page.evaluate(() => !!document.activeElement?.closest(".cat-kinds-groups"))).toBe(false);
  }
  // for readers the address follows the chosen list
  await page.getByRole("group", { name: "Lists of teams" }).getByRole("tab", { name: /^Teams/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/teams\/pillars$/);
});
