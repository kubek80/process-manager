import { expect, test } from "@playwright/test";
import { ALEX, SAM, signIn } from "./helpers";

test("the app is closed until you sign in", async ({ page, request }) => {
  for (const path of ["/api/processes", "/api/standards", "/api/catalog", "/api/feedback", "/api/skills", "/api/admin/access"]) expect((await request.get(path)).status()).toBe(401);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Process Manager" })).toBeVisible();
  await expect(page.getByText("Local development.")).toBeVisible();
  await expect(page.locator(".login-users button")).toHaveCount(6);
  await expect(page.locator(".login-users")).toContainText("Jordan Platform");
  await expect(page.locator(".topbar")).toHaveCount(0);
});

test("a reader signs in, sees no editing, and can switch user to an editor who does", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Sam Consumer/ }).click();
  // signed in, the app starts at Home: one search over processes and standards
  await expect(page.getByRole("heading", { name: "Find a process or a standard" })).toBeVisible();
  await page.locator(".nav").getByRole("link", { name: "Processes" }).click();
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create from text with AI/ })).toHaveCount(0);
  await expect(page.locator(".nav").getByRole("link", { name: "Admin" })).toHaveCount(0);

  await page.getByRole("button", { name: "Your account" }).click();
  await expect(page.locator(".user-pop")).toContainText("sam@example.com");
  await expect(page.locator(".user-pop")).toContainText("Consumer");
  await page.getByRole("button", { name: "Switch user" }).click();
  await expect(page.locator(".login-users")).toBeVisible();

  // an editor gets the editing controls by their rights alone: there is no mode to switch on
  await page.getByRole("button", { name: /Alex Editor/ }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  await page.locator(".nav").getByRole("link", { name: "Processes" }).click();
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Consumer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create from text with AI/ })).toBeVisible();
});

test("the session survives a reload and ends on sign-out", async ({ page }) => {
  await signIn(page, SAM);
  await page.goto("/#/processes");
  await expect(page.locator(".card").first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".card").first()).toBeVisible();
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("button", { name: "Switch user" }).click();
  await expect(page.locator(".login-users")).toBeVisible();
  expect((await page.request.get("/api/processes")).status()).toBe(401);
});

test("the server refuses changes from someone without the right, whatever the browser shows", async ({ page }) => {
  await signIn(page, SAM);
  const headers = { "X-Requested-With": "process-manager" };
  expect((await page.request.put("/api/catalog", { data: { teams: [] }, headers })).status()).toBe(403);
  expect((await page.request.delete("/api/processes/request-gcp-project", { headers })).status()).toBe(403);
  expect((await page.request.delete("/api/standards/secure-logging", { headers })).status()).toBe(403);
  expect((await page.request.post("/api/admin/access", { data: { email: SAM, role: "admin", scope: "" }, headers })).status()).toBe(403);
  // and nobody gets anywhere without the anti-forgery header
  await signIn(page, ALEX);
  expect((await page.request.delete("/api/processes/request-gcp-project")).status()).toBe(403);
  expect((await page.request.get("/api/processes")).ok()).toBeTruthy();
});
