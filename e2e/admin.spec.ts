import { expect, test } from "@playwright/test";
import { ALEX, answer, clearFeedback, DANA, fields, open, outline, publish, readStandard, report, SAM, signIn } from "./helpers";

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
  await expect(page.locator(".admin-nav a")).toHaveText(["Teams", "Tools", "Skills", "Health"]);
  // the section's name is the heading of the page: the lists are two entries, Teams and Tools
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Teams");
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Teams");
  await expect(page.getByRole("complementary", { name: "Admin" }).locator(".admin-nav-title")).toHaveText("Admin");
  await open(page, "/admin/access"); // asking for a section that is not yours shows one that is
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Teams");
  expect((await page.request.get("/api/admin/access")).status()).toBe(403);

  await signIn(page, DANA);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Admin" }).click();
  await expect(page.locator(".admin-nav a")).toHaveText(["Access", "Teams", "Tools", "Skills", "Health", "Activity", "Statistics", "Theming", "System", "Code map"]);
  await page.locator(".admin-nav").getByRole("link", { name: "Theming" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Theming");
});

test("an admin gives someone a role and it takes effect at once", async ({ page, browser }) => {
  // Sam, in another browser, is a reader: no "Edit" anywhere
  const samContext = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const sam = await samContext.newPage();
  await signIn(sam, SAM);
  await open(sam, "/s/code-review/doc");
  await expect(sam.locator(".req").first()).toBeVisible();
  await expect(sam.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  await signIn(page, DANA);
  await open(page, "/admin/access");
  const people = page.locator(".users-list > li");
  await expect(people.filter({ hasText: "dana@example.com" })).toContainText("set where the portal is installed");
  await expect(people.filter({ hasText: "riley@example.com" })).toContainText("Practice owner for Cyber security");
  await expect(people.filter({ hasText: "jordan@example.com" })).toContainText("Platform owner for Google Cloud");

  await page.getByRole("button", { name: "Add person" }).click();
  const dialog = page.getByRole("dialog", { name: "Add person" });
  await dialog.getByLabel("Email").fill("sam@example.com");
  await dialog.getByRole("switch", { name: /^Practice owner/ }).check();
  await dialog.getByRole("combobox", { name: "Practice owner: practice 1" }).selectOption({ label: "Engineering" });
  await expect(dialog.locator(".roles-summary")).toHaveText("Gives: Practice owner for Engineering");
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog).toHaveCount(0);
  const row = people.filter({ hasText: "sam@example.com" });
  await expect(row).toContainText("Practice owner for Engineering");

  // Sam reloads: the standard of the practice can be edited, no other
  await sam.reload();
  await sam.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(sam).toHaveURL(/#\/s\/code-review\/edit/);
  await outline(sam, "REV-03");
  await fields(sam).getByLabel(/^Short name/).fill("Small, focused pull requests");
  await publish(sam);
  expect((await readStandard(sam, "code-review"))!.requirements[2].title).toBe("Small, focused pull requests");
  await open(sam, "/s/secure-logging/doc");
  await expect(sam.locator(".req").first()).toBeVisible();
  await expect(sam.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  // taking every role away works the same way
  await row.getByRole("button", { name: "Delete Sam Consumer" }).click();
  await answer(page, "Delete Sam Consumer?", "Delete");
  await expect(people.filter({ hasText: "sam@example.com" })).toHaveCount(0);
  await open(sam, "/s/code-review/doc");
  await sam.reload();
  await expect(sam.locator(".req").first()).toBeVisible();
  await expect(sam.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await samContext.close();

  // all of it is in the activity log, newest first, in plain words
  await page.locator(".admin-nav").getByRole("link", { name: "Activity" }).click();
  const log = page.locator(".activity li");
  await expect(log.nth(0)).toContainText("Dana Admin took every role from Sam Consumer");
  // documents by their title, the id as tooltip
  await expect(log.nth(1)).toContainText("Sam Consumer published the standard");
  await expect(log.nth(1).locator(".activity-doc")).toHaveText("“Code review”");
  await expect(log.nth(1).locator(".activity-doc")).toHaveAttribute("title", /code-review/);
  await expect(log.nth(2)).toContainText("Dana Admin changed the roles of Sam Consumer");
  // people by name, the address as tooltip
  await expect(log.nth(2).locator("b", { hasText: "Dana Admin" })).toHaveAttribute("title", "dana@example.com");
  await expect(log.nth(2)).toContainText("· added Practice owner for Engineering");
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
  await expect(page.locator(".admin-card")).toContainText("Kept by the portal. Every save is a version with a note");
  // the settings' names are only behind the disclosure for the people who run the portal
  const tech = page.locator("details.system-tech");
  await expect(tech.locator("summary")).toHaveText("For the people who run the portal");
  await expect(tech.getByText("PM_AUTH")).toBeHidden();
  await tech.locator("summary").click();
  await expect(tech.getByText("PM_AUTH")).toBeVisible();
  await expect(page.locator(".stat", { hasText: "standards" }).locator("strong")).not.toHaveText("0");
});
