import { expect, test } from "@playwright/test";
import { ALEX, fields, open, openEditor, outline, publish, readCatalog, readProcess, readWorkingDraft, save, saveDraft, signIn } from "./helpers";

// Alex manages the lists: for him the Admin panel has the Lists section only.

test.beforeEach(async ({ page }) => { await signIn(page, ALEX); });

test("add a tool, fill in its details and save", async ({ page }) => {
  await open(page, "/admin/lists");
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
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await expect(page.getByRole("button", { name: "Remove this team" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still used by");
  await expect(page.locator(".cat-usage")).toContainText("Request a GCP project");

  await page.locator(".cat-item", { hasText: "Network team" }).click();
  await expect(page.locator(".cat-usage")).toContainText("nothing yet");
  await page.getByRole("button", { name: "Remove this team" }).click();
  await expect(page.locator(".cat-item", { hasText: "Network team" })).toHaveCount(0);
  await save(page);
  expect((await readCatalog(page)).teams.map((t: { id: string }) => t.id)).not.toContain("network-team");
});

test("discard restores the lists; renaming keeps the id", async ({ page }) => {
  await open(page, "/admin/lists");
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
  await open(page, "/admin/lists");
  await expect(page.locator(".admin-nav a")).toHaveText(["Lists", "Skills", "Health"]); // no Access, Activity or System for a lists manager
  // teams, practices and platforms are three lists: a team is just a group of people, of no kind
  await expect(page.locator(".cat-tabs [role=tab] strong")).toHaveText(["Teams", "Practices", "Platforms", "Categories", "Tools", "Application tiers", "Environments", "Languages"]);
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
  await expect(fields(page).getByRole("button", { name: "Pre-production" })).toBeVisible();
});
