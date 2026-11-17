import { expect, test } from "@playwright/test";
import { ALEX, answer, clearFeedback, DANA, open, readStandard, report, SAM, save, signIn } from "./helpers";

test("the Admin panel is for admins and for people who manage the lists", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.locator(".nav").getByRole("link", { name: "Admin" })).toHaveCount(0);
  await open(page, "/admin/access");
  await expect(page.getByText("You do not have access to the Admin panel.")).toBeVisible();
  for (const path of ["/api/admin/access", "/api/admin/audit", "/api/admin/system"]) expect((await page.request.get(path)).status()).toBe(403);

  // Alex manages the lists but is no admin: no Access, Activity or System
  await signIn(page, ALEX);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Admin" }).click();
  await expect(page.locator(".admin-nav a")).toHaveText(["Lists", "Skills", "Health"]);
  await expect(page.locator(".admin-main > header h2")).toHaveText("Lists");
  await open(page, "/admin/access"); // asking for a section that is not yours shows one that is
  await expect(page.locator(".admin-main > header h2")).toHaveText("Lists");
  expect((await page.request.get("/api/admin/access")).status()).toBe(403);

  await signIn(page, DANA);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Admin" }).click();
  await expect(page.locator(".admin-nav a")).toHaveText(["Access", "Lists", "Skills", "Health", "Activity", "System"]);
});

test("an admin gives someone a role and it takes effect at once", async ({ page, browser }) => {
  // Sam, in another browser, is a consumer
  const samContext = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const sam = await samContext.newPage();
  await signIn(sam, SAM, { editor: true });
  await open(sam, "/s/code-review/doc");
  await expect(sam.locator(".req").first()).toBeVisible();
  await expect(sam.locator(".mode-switch")).toHaveCount(0);

  await signIn(page, DANA);
  await open(page, "/admin/access");
  const people = page.locator(".people li");
  await expect(people.filter({ hasText: "dana@example.com" })).toContainText("Cannot be removed here");
  await expect(people.filter({ hasText: "dana@example.com" }).getByRole("button")).toHaveCount(0);
  await expect(people.filter({ hasText: "riley@example.com" })).toContainText("Practice owner");
  await expect(people.filter({ hasText: "riley@example.com" })).toContainText("Cyber security");
  await expect(people.filter({ hasText: "jordan@example.com" })).toContainText("Platform owner");
  await expect(people.filter({ hasText: "jordan@example.com" })).toContainText("Google Cloud");

  const grant = page.locator(".grant");
  await expect(grant.getByRole("button", { name: "Give role" })).toBeDisabled();
  await grant.getByLabel("Email").fill("sam@example.com");
  // each role limited to a group asks for it from its own list; the others take no group at all
  await grant.getByLabel("Role").selectOption({ label: "Owner" });
  await expect(grant.getByRole("button", { name: "Give role" })).toBeDisabled(); // an owner needs a team
  await expect(grant.getByLabel("For the team").locator("option", { hasText: "Cloud Platform team" })).toHaveCount(1);
  await grant.getByLabel("Role").selectOption({ label: "Platform owner" });
  await expect(grant.getByLabel("For the team")).toHaveCount(0);
  await expect(grant.getByLabel("For the platform").locator("option", { hasText: "Google Cloud" })).toHaveCount(1);
  await expect(grant.getByLabel("For the platform").locator("option", { hasText: "Cloud Platform team" })).toHaveCount(0);
  await grant.getByLabel("Role").selectOption({ label: "Standards editor" });
  await expect(grant.getByLabel(/^For the/)).toHaveCount(0); // every standard: not limited to anything
  await grant.getByLabel("Role").selectOption({ label: "Practice owner" });
  await expect(grant.getByRole("button", { name: "Give role" })).toBeDisabled();
  await grant.getByLabel("For the practice").selectOption({ label: "Engineering" });
  await grant.getByRole("button", { name: "Give role" }).click();
  const row = people.filter({ hasText: "sam@example.com" });
  await expect(row.locator(".role-chip")).toContainText("Practice owner");
  await expect(row.locator(".role-chip")).toContainText("Engineering");

  // Sam reloads: the Editor switch is there and the standard of the practice can be edited, no other
  await sam.reload();
  await expect(sam.locator(".mode-switch")).toBeVisible();
  await expect(sam.locator('[aria-label^="Edit "]')).toHaveCount(4);
  await sam.locator('[aria-label="Edit REV-03"]').click();
  await sam.locator(".drawer").getByLabel("Short name").fill("Small, focused pull requests");
  await save(sam);
  expect((await readStandard(sam, "code-review"))!.requirements[2].title).toBe("Small, focused pull requests");
  await open(sam, "/s/secure-logging/doc");
  await expect(sam.locator(".req").first()).toBeVisible();
  await expect(sam.locator('[aria-label^="Edit "]')).toHaveCount(0);

  // taking the role away works the same way
  await row.getByRole("button", { name: /Remove Practice owner/ }).click();
  await answer(page, "Remove this role?", "Remove role");
  await expect(people.filter({ hasText: "sam@example.com" })).toHaveCount(0);
  await sam.reload();
  await expect(sam.locator(".mode-switch")).toHaveCount(0);
  await samContext.close();

  // all of it is in the activity log, newest first
  await page.locator(".admin-nav").getByRole("link", { name: "Activity" }).click();
  const log = page.locator(".activity li");
  await expect(log.nth(0)).toContainText("Dana Admin removed a role from sam@example.com");
  await expect(log.nth(1)).toContainText("Sam Consumer saved the standard code-review");
  await expect(log.nth(2)).toContainText("Dana Admin gave a role to sam@example.com");
  await expect(log.nth(2)).toContainText("Practice owner for the practice Engineering");
});

test("mistakes when giving a role are explained", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  const headers = { "X-Requested-With": "process-manager" };
  const res = await page.request.post("/api/admin/access", { data: { email: "x@example.com", role: "owner", scope: "no-such-team" }, headers });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("There is no team “no-such-team” in the lists.");
  for (const [role, scope, message] of [
    ["platform-owner", "no-such-platform", "There is no platform “no-such-platform” in the lists."],
    ["practice-owner", "google-cloud", "There is no practice “google-cloud” in the lists."], // a platform, not a practice: the lists are separate
    ["platform-owner", "", "needs the platform"],
  ]) {
    const refused = await page.request.post("/api/admin/access", { data: { email: "x@example.com", role, scope }, headers });
    expect(refused.status(), `${role} for “${scope}”`).toBe(400);
    expect((await refused.json()).error).toContain(message);
  }
  // a standards editor changes every standard: the role cannot be limited to a group any more
  const limited = await page.request.post("/api/admin/access", { data: { email: "x@example.com", role: "standards-editor", scope: "security" }, headers });
  expect(limited.status()).toBe(400);
  expect((await limited.json()).error).toContain("cannot be limited");
  // the admin named in the server settings cannot be removed through the API either: there is nothing stored to remove
  await page.request.delete("/api/admin/access", { data: { email: DANA, role: "admin", scope: "" }, headers });
  expect((await page.request.get("/api/admin/access")).ok()).toBeTruthy();
});

test("Health shows what needs attention; System shows how the installation is set up", async ({ page, request }) => {
  await clearFeedback(request, "process", "request-gcp-project");
  await report(request, SAM, { targetId: "request-gcp-project", text: "Something for the health page." });
  await page.clock.install({ time: new Date("2026-11-15T10:00:00Z") });
  await signIn(page, DANA);
  await open(page, "/admin/health");
  const cards = page.locator(".admin-card");
  await expect(cards.filter({ hasText: "Reviews due" }).locator("li", { hasText: "Onboard a site to Akamai" })).toContainText("Review overdue since 2026-09-02");
  await expect(cards.filter({ hasText: "Open feedback" }).locator("li", { hasText: "Request a GCP project" })).toContainText("1 open");
  await expect(page.locator(".stat", { hasText: "reviews due" })).toHaveClass(/bad/);
  await cards.filter({ hasText: "Reviews due" }).locator("li", { hasText: "Onboard a site to Akamai" }).getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Onboard a site to Akamai" })).toBeVisible();

  await open(page, "/admin/system");
  await expect(page.locator(".admin-card")).toContainText("Local development (user picker)");
  await expect(page.locator(".admin-card")).toContainText("Stored in the database");
  await expect(page.locator(".stat", { hasText: "standards" }).locator("strong")).not.toHaveText("0");
});
