import { expect, test, type Page } from "@playwright/test";
import { ALEX, CASEY, DANA, JORDAN, RILEY, SAM, open, readProcess, report, serverToday, signIn } from "./helpers";

const CSRF = { "X-Requested-With": "process-manager" };

// Casey is Owner of the Cloud Platform team; Riley is Practice owner of Cyber security and Owner of the team Cyber Security.

/** A process of the Cloud Platform team whose review is long overdue. */
async function overdueProcess(page: Page, id: string, title: string) {
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const src = (await readProcess(page, "request-gcp-project"))!;
  const res = await page.request.put(`/api/processes/${id}?base=0`, {
    data: { ...src, id, title, owner: "cloud-platform-team", status: "active", review: { intervalMonths: 6, lastReviewedAt: "2025-01-01", reviewedBy: "Somebody long ago" } },
    headers: CSRF,
  });
  expect(res.ok(), `create ${id}`).toBeTruthy();
}

test("an owner sees what is theirs and what needs them, and handles it from one page", async ({ page, request }) => {
  await overdueProcess(page, "mine-demo", "Mine demo");
  await report(request, SAM, { targetId: "mine-demo", itemId: "raise-request", kind: "outdated", text: "The form has a new name since last week." });
  await signIn(page, CASEY);
  await open(page, "/");

  // the top bar says that something is waiting
  const entry = page.getByRole("link", { name: /My responsibilities, \d+ waiting/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("heading", { name: "My responsibilities" })).toBeVisible();
  await expect(page.locator(".mine-head")).toContainText("Cloud Platform team");

  // the review that is overdue: read it, or confirm it right here
  const reviews = page.getByRole("region", { name: /Reviews to do/ });
  const row = reviews.locator("li", { hasText: "Mine demo" });
  await expect(row).toContainText("Review overdue since 2025-07-01");
  await expect(row).toContainText("last reviewed 2025-01-01 by Somebody long ago");
  await row.getByRole("button", { name: "Still correct" }).click();
  await expect(page.locator(".toast", { hasText: "Recorded as reviewed today" })).toBeVisible();
  await expect(reviews.locator("li", { hasText: "Mine demo" })).toHaveCount(0);
  expect((await readProcess(page, "mine-demo"))!.review).toEqual({ intervalMonths: 6, lastReviewedAt: serverToday(), reviewedBy: "Casey Owner" });

  // the feedback that is waiting, with what it is about and who wrote it
  const waiting = page.getByRole("region", { name: /Feedback waiting for you/ });
  const item = waiting.locator("li", { hasText: "The form has a new name since last week." });
  await expect(item).toContainText("Mine demo");
  await expect(item).toContainText("Step 2: Raise the 'New GCP project' request");
  await expect(item).toContainText("Sam Consumer");
  await item.getByRole("button", { name: "Mark as fixed" }).click();
  await expect(waiting.locator("li", { hasText: "The form has a new name since last week." })).toHaveCount(0);

  // everything that is hers, with its version; nothing of other teams
  const all = page.getByRole("region", { name: /Everything that is yours/ });
  const mine = all.locator("tr", { hasText: "Mine demo" });
  await expect(mine).toContainText("Cloud Platform team");
  await expect(mine).toContainText("In use");
  await expect(mine).toContainText("Version 2"); // the review was a version of its own
  await expect(mine).toContainText(CASEY);
  await expect(all.locator("tr", { hasText: "Request a GCP project" })).toBeVisible();
  await expect(all.locator("tr", { hasText: "Onboard a site to Akamai" })).toHaveCount(0);
  await mine.getByRole("link", { name: "Mine demo" }).click();
  await expect(page.locator("h1")).toHaveText("Mine demo");
  // on the page itself she can confirm the review too, without being an editor
  await expect(page.getByRole("button", { name: "Mark as reviewed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
});

test("the review is refused when somebody changed it since the owner looked", async ({ page, playwright }) => {
  await overdueProcess(page, "mine-stale", "Mine stale");
  await signIn(page, CASEY);
  await open(page, "/mine");
  const row = page.getByRole("region", { name: /Reviews to do/ }).locator("li", { hasText: "Mine stale" });
  await expect(row).toBeVisible();

  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await other.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes, meta } = await (await other.get("/api/processes")).json();
  const doc = processes.find((p: { id: string }) => p.id === "mine-stale");
  expect((await other.put(`/api/processes/mine-stale?base=${meta["mine-stale"].version}`, { data: { ...doc, summary: "Changed in a way the owner has not read yet." }, headers: CSRF })).ok()).toBeTruthy();

  await row.getByRole("button", { name: "Still correct" }).click();
  await expect(page.locator(".toast", { hasText: "The review could not be recorded" })).toContainText("changed this process in the meantime");
  expect((await readProcess(page, "mine-stale"))!.review.lastReviewedAt).toBe("2025-01-01");
  await other.dispose();
});

test("a practice owner sees what belongs to the practice; somebody who owns nothing has no such page in the way", async ({ page }) => {
  await signIn(page, RILEY);
  await open(page, "/mine");
  const all = page.getByRole("region", { name: /Everything that is yours/ });
  await expect(all.locator("th").nth(1)).toHaveText("Yours through");
  // Secure logging is hers twice: it belongs to her practice, and her team maintains it
  await expect(all.locator("tr", { hasText: "Secure logging" })).toContainText("Cyber security");
  await expect(all.locator("tr", { hasText: "Secure logging" })).toContainText("Cyber Security");
  await expect(all.locator("tr", { hasText: "Code review" })).toHaveCount(0); // belongs to another practice

  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.getByRole("link", { name: /My responsibilities/ })).toHaveCount(0);
  await open(page, "/mine");
  await expect(page.locator(".lead")).toContainText("Nothing is assigned to you");
});

test("an admin adds and removes the members of a team on the team itself", async ({ page }) => {
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  const members = page.locator(".cat-members");
  await expect(members.locator("li", { hasText: CASEY })).toContainText("Owner");
  await expect(members.locator("li", { hasText: JORDAN })).toContainText("Owner");

  // one more member: a team can have as many as it needs
  await members.getByLabel("Email of the new member").fill("Sam@Example.com ");
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: SAM })).toContainText("Owner");
  await expect(members.locator("h3")).toContainText("3");
  await expect(members.getByLabel("Email of the new member")).toHaveValue("");

  // it takes effect at once: Sam now answers for what the team owns
  await signIn(page, SAM);
  await open(page, "/mine");
  await expect(page.locator(".mine-head")).toContainText("Cloud Platform team");
  await expect(page.getByRole("region", { name: /Everything that is yours/ }).locator("tr", { hasText: "Request a GCP project" })).toBeVisible();

  // and removing asks first, then takes it away again
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await page.locator(".cat-members").getByRole("button", { name: `Remove ${SAM} as Owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".cat-members li", { hasText: SAM })).toBeVisible();
  await page.locator(".cat-members").getByRole("button", { name: `Remove ${SAM} as Owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".cat-members li", { hasText: SAM })).toHaveCount(0);
  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.getByRole("link", { name: /My responsibilities/ })).toHaveCount(0);
});

test("a practice has members, each with the one role it gives; a new team needs saving first", async ({ page }) => {
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  // the team Cyber Security: Riley is its Owner
  await page.locator(".cat-item", { hasText: "Cyber Security" }).click();
  await expect(page.locator(".cat-members li", { hasText: RILEY })).toContainText("Owner");
  // the practice Cyber security: Riley is its Practice owner; every group has one member role, nothing to choose
  await page.getByRole("tab", { name: /Practices/ }).click();
  await page.locator(".cat-item", { hasText: "Cyber security" }).click();
  const members = page.locator(".cat-members");
  await expect(members.locator("li", { hasText: RILEY })).toContainText("Practice owner");
  await expect(members.getByLabel("As", { exact: true })).toHaveCount(0);
  await members.getByLabel("Email of the new member").fill("kim@example.com");
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: "kim@example.com" })).toContainText("Practice owner");
  // something that is not an address cannot be added
  await members.getByLabel("Email of the new member").fill("not an address");
  await expect(members.getByRole("button", { name: "Add member" })).toBeDisabled();
  await members.getByLabel("Email of the new member").fill("");
  await members.getByRole("button", { name: "Remove kim@example.com as Practice owner" }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: "kim@example.com" })).toHaveCount(0);

  // a team nobody belongs to
  await page.getByRole("tab", { name: /Teams/ }).click();
  await page.locator(".cat-item", { hasText: "Service Management" }).click();
  await expect(page.locator(".cat-members")).toContainText("Nobody yet");

  // a team that was added but not saved does not exist yet for anybody to belong to
  await page.getByRole("button", { name: "New team" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Data Platform team");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cat-members")).toContainText("Save the lists first");
  await expect(page.locator(".cat-members").getByLabel("Email of the new member")).toHaveCount(0);
  await page.getByRole("button", { name: "Discard" }).click();
});

test("who is a member is changed by admins only: somebody who only manages the lists sees them and is told who adds them", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  const members = page.locator(".cat-members");
  await expect(members).toContainText("An admin adds and removes them");
  await expect(members.locator("li", { hasText: CASEY })).toContainText("Owner");
  await expect(members.locator("li", { hasText: JORDAN })).toContainText("Owner");
  await expect(members.getByLabel("Email of the new member")).toHaveCount(0);
  await expect(members.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  // and the server agrees
  expect((await page.request.post("/api/admin/access", { data: { email: SAM, role: "owner", scope: "cloud-platform-team" }, headers: CSRF })).status()).toBe(403);
});
