import { expect, test } from "@playwright/test";
import { ALEX, open, readCatalog, readProcess, signIn } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page, ALEX, { editor: true }); });

test("add a tool, fill in its details and save", async ({ page }) => {
  await open(page, "/catalog");
  await page.getByRole("tab", { name: /Tools/ }).click();
  await page.getByRole("button", { name: "New tool" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Jira Service Desk");
  await expect(page.locator(".cat-new")).toContainText("jira-service-desk");
  await page.keyboard.press("Enter");

  const detail = page.locator(".cat-detail");
  await expect(detail.getByRole("heading", { name: "Jira Service Desk" })).toBeVisible();
  await detail.getByLabel("Link").fill("https://jira.example.com");
  await expect(page.locator(".cat-item", { hasText: "Jira Service Desk" })).toContainText("new");
  await page.locator(".save-bar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".cat-saved")).toBeVisible();

  expect(readCatalog().tools).toContainEqual({ id: "jira-service-desk", name: "Jira Service Desk", url: "https://jira.example.com" });
});

test("an entry that is in use cannot be removed; an unused one can", async ({ page }) => {
  await open(page, "/catalog");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await expect(page.getByRole("button", { name: "Remove this team" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still used by");
  await expect(page.locator(".cat-usage")).toContainText("Request a GCP project");

  await page.locator(".cat-item", { hasText: "Network team" }).click();
  await expect(page.locator(".cat-usage")).toContainText("no process yet");
  await page.getByRole("button", { name: "Remove this team" }).click();
  await expect(page.locator(".cat-item", { hasText: "Network team" })).toHaveCount(0);
  await page.locator(".save-bar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".cat-saved")).toBeVisible();
  expect(readCatalog().teams.map((t: { id: string }) => t.id)).not.toContain("network-team");
});

test("discard restores the lists; renaming keeps the id", async ({ page }) => {
  await open(page, "/catalog");
  await page.getByRole("tab", { name: /Application tiers/ }).click();
  await page.locator(".cat-item", { hasText: "Tier 3" }).click();
  await page.locator(".cat-detail").getByLabel("Name").fill("Tier 3 (sandbox)");
  await expect(page.locator(".cat-detail code").first()).toHaveText("tier-3");
  await page.locator(".save-bar").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".cat-item", { hasText: "Tier 3 (sandbox)" })).toHaveCount(0);
  await expect(page.locator(".save-bar")).toHaveCount(0);
});

test("a missing tool can be added straight from a step", async ({ page }) => {
  page.on("dialog", (d) => d.accept("Confluence"));
  await open(page, "/p/raise-servicenow-request/flow");
  await page.locator(".block", { hasText: "Find the catalogue item" }).click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Edit step" }).click();
  await drawer.getByLabel("Tool").selectOption("__new");
  await expect(drawer.getByLabel("Tool")).toHaveValue("confluence");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();
  expect(readCatalog().tools).toContainEqual({ id: "confluence", name: "Confluence" });
  expect(readProcess("raise-servicenow-request").steps[0].tool).toBe("confluence");
});
