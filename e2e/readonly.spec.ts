import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { READONLY } from "../playwright.config";
import { ALEX, open, readCatalog, readProcess, SAM, signIn } from "./helpers";

/** The deployment where processes come from the repository and the app must not write them. */
test.use({ baseURL: READONLY });
const PORT = 8091;

test("an editor prepares a change and downloads the file; nothing is written on the server", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await open(page, "/");
  await expect(page.getByText("Processes are managed in the repository here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create from text with AI" })).toHaveCount(0);

  await open(page, "/p/request-gcp-project/flow");
  await page.locator(".block").first().click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Edit step" }).click();
  await drawer.getByLabel("What happens", { exact: true }).fill("Decide the details of the project");
  await expect(page.locator(".banner", { hasText: "Processes are read-only here." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download file" }).click()]);
  expect(download.suggestedFilename()).toBe("request-gcp-project.json");
  const file = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(file.steps[0].title).toBe("Decide the details of the project");
  expect(file.id).toBe("request-gcp-project");
  expect(readProcess("request-gcp-project", PORT).steps[0].title).toBe("Decide the project details");

  // the rule is enforced by the server, not by hidden buttons
  const res = await page.request.put("/api/processes/request-gcp-project", { data: file, headers: { "X-Requested-With": "process-manager" } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toContain("read-only");

  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.locator(".modal").getByRole("button", { name: "Delete process" })).toHaveCount(0);
});

test("the lists are downloaded too", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await open(page, "/catalog");
  await page.locator(".cat-item", { hasText: "Security" }).click();
  await page.locator(".cat-detail").getByLabel("How to reach them").fill("Slack #security");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download catalog.json" }).click()]);
  const file = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(file.teams.find((t: { id: string }) => t.id === "security").contact).toBe("Slack #security");
  expect(readCatalog(PORT).teams.find((t: { id: string }) => t.id === "security").contact).toBeUndefined();
});

test("feedback still works where content is read-only", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/feedback");
  await page.getByPlaceholder(/What happened/).fill("The budget form has a new field.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.locator(".fb-item", { hasText: "The budget form has a new field." })).toBeVisible();
  await page.reload();
  await expect(page.locator(".fb-item", { hasText: "The budget form has a new field." })).toBeVisible();
});
