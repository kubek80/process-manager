import { expect, test } from "@playwright/test";
import { ALEX, open, readCatalog, readProcess, save, signIn } from "./helpers";

// Alex manages the lists: for him the Admin panel has the Lists section only.

test.beforeEach(async ({ page }) => { await signIn(page, ALEX, { editor: true }); });

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
  await open(page, "/p/raise-servicenow-request/flow");
  await page.locator(".block", { hasText: "Find the catalogue item" }).click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Edit step" }).click();
  const tool = drawer.getByRole("combobox", { name: "Tool" });
  await tool.selectOption("__new");
  // the name is typed in a field in the panel; Enter (or "Add tool") saves it to the list of tools
  await drawer.getByLabel("Name of the new tool").fill("Confluence");
  await drawer.getByLabel("Name of the new tool").press("Enter");
  await expect(tool).toHaveValue("confluence");
  await expect(drawer.getByLabel("Name of the new tool")).toHaveCount(0);
  await save(page);
  expect((await readCatalog(page)).tools).toContainEqual({ id: "confluence", name: "Confluence" });
  expect((await readProcess(page, "raise-servicenow-request"))!.steps[0].tool).toBe("confluence");
});

test("a team becomes a unit that can issue standards; a new environment can be chosen in a process", async ({ page }) => {
  await open(page, "/admin/lists");
  await expect(page.locator(".admin-nav a")).toHaveText(["Lists", "Skills", "Health"]); // no Access, Activity or System for a lists manager
  await page.locator(".cat-item", { hasText: "DNS team" }).click();
  await expect(page.locator(".cat-detail .eyebrow")).toHaveText("Team");
  await page.locator(".cat-detail").getByRole("button", { name: "Platform owner" }).click();
  await expect(page.locator(".cat-detail .eyebrow")).toHaveText("Platform owner");

  await page.getByRole("tab", { name: /Environments/ }).click();
  await page.getByRole("button", { name: "New environment" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Pre-production");
  await page.keyboard.press("Enter");
  await save(page);
  const catalog = await readCatalog(page);
  expect(catalog.teams.find((t: { id: string }) => t.id === "dns-team").kind).toBe("platform");
  expect(catalog.environments.at(-1)).toEqual({ id: "pre-production", name: "Pre-production" });

  await signIn(page, ALEX, { editor: true });
  await open(page, "/p/raise-servicenow-request/flow");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.locator(".modal").getByRole("button", { name: "Pre-production" })).toBeVisible();
});
