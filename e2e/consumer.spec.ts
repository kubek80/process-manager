import { expect, test } from "@playwright/test";
import { open, SAM, signIn, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page, SAM); });

test("find a process by searching and by tier and language", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  const cards = page.locator(".card");
  await expect(cards.filter({ hasText: "Request a GCP project" })).toBeVisible();

  await page.getByPlaceholder(/Search/).fill("akamai");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Onboard a site to Akamai");
  await expect(cards.first()).toContainText("Tier 0, Tier 1");
  await page.getByPlaceholder(/Search/).fill("");

  // Akamai onboarding only applies to tiers 0 and 1
  const mine = page.locator(".profile-filter");
  await mine.getByLabel("Tier").selectOption({ label: "Tier 3" });
  await expect(cards.filter({ hasText: "Onboard a site to Akamai" })).toHaveCount(0);
  await expect(cards.filter({ hasText: "Request a GCP project" })).toBeVisible();
  await mine.getByLabel("Tier").selectOption({ label: "any tier" });

  // ...and only to staging and production
  await mine.getByLabel("Environment").selectOption({ label: "Development" });
  await expect(cards.filter({ hasText: "Onboard a site to Akamai" })).toHaveCount(0);
  await mine.getByLabel("Environment").selectOption({ label: "Production" });
  await expect(cards.filter({ hasText: "Onboard a site to Akamai" })).toContainText("Staging, Production");
  await mine.getByLabel("Environment").selectOption({ label: "any environment" });

  // publishing a library is for Go and JavaScript only
  await mine.getByLabel("Language").selectOption({ label: "Python" });
  await expect(cards.filter({ hasText: "Publish an internal library" })).toHaveCount(0);
  await mine.getByLabel("Language").selectOption({ label: "Go" });
  await expect(cards.filter({ hasText: "Publish an internal library" })).toBeVisible();

  await page.locator(".filters .chip", { hasText: "Source control" }).click();
  await expect(cards.filter({ hasText: "Request a GCP project" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the map shows who does what, with my lane first", async ({ page }) => {
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.getByRole("heading", { name: "Request a GCP project" })).toBeVisible();
  const lanes = page.locator(".lane-head strong");
  await expect(lanes).toHaveText(["You", "Budget owner", "Cloud Platform team", "Project factory"]);
  await expect(page.locator(".block")).toHaveCount(10);
  await expect(page.locator(".edge-label")).toHaveText(["Yes", "No"]);
  // a consumer gets no editing controls
  await expect(page.locator(".edge-add")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "JSON" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);

  await page.locator(".block", { hasText: "Add your project to the project factory" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer).toContainText("Copy projects/_template.yaml to projects/<project-name>.yaml.");
  await expect(drawer.getByRole("link", { name: /Open gcp-project-factory/ })).toHaveAttribute("href", /gcp-project-factory/);
  await expect(drawer).toContainText("Skill: add a GCP project");
  await expect(drawer.getByRole("button", { name: "Edit step" })).toHaveCount(0);
});

test("follow the checklist: prerequisites, exact actions, ticks that are remembered", async ({ page }) => {
  await open(page, "/p/request-gcp-project/list");
  await expect(page.getByText("0 of 5 of your steps done")).toBeVisible();
  await expect(page.locator(".prereq")).toHaveCount(4);
  await expect(page.locator(".prereqs .resources li.skill")).toContainText("Skill: add a GCP project");
  await expect(page.locator(".link-list.row").getByRole("link", { name: "Infrastructure as code" })).toBeVisible();

  const first = page.locator(".step").first();
  await expect(first).toContainText("Choose the environment: dev, test or prod.");
  await first.getByRole("button", { name: "Mark as done" }).click();
  await page.locator(".prereq").first().getByRole("button", { name: "I have this" }).click();
  await expect(page.getByText("1 of 5 of your steps done")).toBeVisible();
  await expect(page.getByText("1/4 ready")).toBeVisible();

  // someone else's step is shown, but collapsed and not tickable
  const approval = page.locator("#step-approve-budget");
  await expect(approval).toContainText("Not you");
  await expect(approval.getByRole("button", { name: "Mark as done" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("1 of 5 of your steps done")).toBeVisible();
  await expect(page.getByText("1/4 ready")).toBeVisible();

  await page.getByText("Only my steps").click();
  await expect(page.locator(".step")).toHaveCount(5);
  await page.getByRole("button", { name: "Reset ticks" }).click();
  await expect(page.getByText("0 of 5 of your steps done")).toBeVisible();
});

test("a sub-process can be expanded in place and opened", async ({ page }) => {
  await open(page, "/p/request-gcp-project/list");
  const step = page.locator("#step-raise-request");
  await step.getByRole("button", { name: "7 steps" }).click();
  await expect(step.locator(".subproc-steps li")).toHaveCount(7);
  await step.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Raise a ServiceNow request" })).toBeVisible();
});

test("a prerequisite links to the process that provides it", async ({ page }) => {
  await open(page, "/p/onboard-api-to-apigee/flow");
  await page.getByRole("button", { name: /Don’t have it\? Request a GCP project/ }).click();
  await expect(page.getByRole("heading", { name: "Request a GCP project" })).toBeVisible();
});

test("teams and tools are a read-only directory", async ({ page }) => {
  await open(page, "/catalog");
  await expect(page.getByRole("heading", { name: /Teams, tools/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(5); // teams and units, tools, tiers, environments, languages
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await expect(page.locator(".cat-detail")).toContainText("Slack #cloud-platform");
  await expect(page.locator(".cat-detail .eyebrow")).toHaveText("Platform owner");
  await expect(page.locator(".cat-usage")).toContainText("Request a GCP project");
  await expect(page.locator(".cat-usage")).toContainText("Infrastructure as code"); // the standard this unit issues
  await expect(page.locator(".cat-detail input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New team/ })).toHaveCount(0);
  await page.getByRole("tab", { name: /Tools/ }).click();
  await page.locator(".cat-item", { hasText: "ServiceNow" }).click();
  await expect(page.getByRole("link", { name: "Open ServiceNow" })).toBeVisible();
});

test("the guide explains the app with flow charts that fit the page", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/guide");
  await expect(page.getByRole("heading", { name: "How Process Manager works" })).toBeVisible();
  await expect(page.locator(".guide-fig .block").first()).toBeVisible();
  // every flow chart fits its column: nothing to scroll sideways
  const overflow = await page.locator(".guide-fig .flow-scroll").evaluateAll((els) => els.map((e) => e.scrollWidth - e.clientWidth));
  expect(overflow.length).toBeGreaterThanOrEqual(7);
  expect(overflow.every((px) => px === 0)).toBe(true);

  // the guide covers using, editing, AI assistants, administration and running it
  const toc = page.locator(".guide-toc");
  await expect(toc.locator(".eyebrow")).toHaveText(["Using it", "Editing", "For AI assistants", "Administration", "Running it"]);
  for (const id of ["what", "modes", "read", "follow", "blocks", "standards", "feedback", "edit", "editstandard", "ai", "lifecycle", "skills", "agents", "roadmap", "admin", "catalog", "architecture", "local", "tests", "deploy", "files", "docs"])
    await expect(page.locator(`#guide-${id} h2`)).toBeVisible();
  await expect(page.locator("#guide-modes .guide-table.roles tbody tr")).toHaveCount(5);
  await expect(page.locator("#guide-architecture .arch-box")).toHaveCount(8);
  await expect(page.locator("#guide-local")).toContainText("npm run dev");
  await expect(page.locator("#guide-local")).toContainText("Dana Admin");
  await expect(page.locator("#guide-deploy")).toContainText("PM_ADMINS");
  await expect(page.locator("#guide-skills")).toContainText(".claude/agents/");

  await toc.getByRole("button", { name: "How it is built" }).click();
  await expect(page.locator("#guide-architecture")).toBeInViewport();
  await expect(toc.getByRole("button", { name: "How it is built" })).toHaveClass(/on/);
  expect(errors).toEqual([]);
});
