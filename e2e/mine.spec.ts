import { expect, test, type Page } from "@playwright/test";
import { ALEX, CASEY, DANA, JORDAN, RILEY, SAM, open, readProcess, report, serverToday, signIn } from "./helpers";

const CSRF = { "X-Requested-With": "process-manager" };

// Casey is Owner of the Cloud Platform team; Riley is Practice owner of Cyber security and Owner of the team Cyber Security.

// the processes made here are removed again: other tests count what there is
test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  for (const id of ["mine-demo", "mine-stale"]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
  await request.dispose();
});

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
  await expect(row.getByRole("link", { name: "Open" })).toHaveAttribute("href", "#/p/mine-demo/flow");
  // the count of reviews in the colour of its worst case, with how many are overdue and how many due
  const stat = page.locator(".stat", { hasText: /reviews? due/ });
  await expect(stat).toHaveClass(/\bbad\b/);
  await expect(stat.locator(".stat-split")).toHaveText(/^(\d+ overdue · \d+ due|all overdue|it is overdue)$/);
  await row.getByRole("button", { name: "Still correct" }).click();
  await expect(page.getByText("“Mine demo” is recorded as reviewed today.")).toBeVisible();
  await expect(reviews.locator("li", { hasText: "Mine demo" })).toHaveCount(0);
  expect((await readProcess(page, "mine-demo"))!.review).toEqual({ intervalMonths: 6, lastReviewedAt: serverToday(), reviewedBy: "Casey Owner" });

  // the feedback that is waiting, with what it is about and who wrote it
  const waiting = page.getByRole("region", { name: /Feedback waiting for you/ });
  const item = waiting.locator("li", { hasText: "The form has a new name since last week." });
  await expect(item).toContainText("Mine demo");
  await expect(item).toContainText("Step 2: Raise the 'New GCP project' request");
  await expect(item).toContainText("Sam Consumer");
  // secondary buttons in the rows: one main button per page at most
  await expect(item.getByRole("button", { name: "Mark as fixed" })).not.toHaveClass(/\bprimary\b/);
  await item.getByRole("button", { name: "Mark as fixed" }).click();
  // every action confirms itself, and the new message replaces the one before
  await expect(page.locator(".toast", { hasText: /^Marked as fixed\. Sam Consumer is told\./ })).toBeVisible();
  await expect(page.locator(".toast", { hasText: "is recorded as reviewed today" })).toHaveCount(0);
  await expect(waiting.locator("li", { hasText: "The form has a new name since last week." })).toHaveCount(0);
  // Undo, from the message, opens it again
  await page.locator(".toast", { hasText: /^Marked as fixed\./ }).getByRole("button", { name: "Undo" }).click();
  await expect(waiting.locator("li", { hasText: "The form has a new name since last week." })).toBeVisible();
  await waiting.locator("li", { hasText: "The form has a new name since last week." }).getByRole("button", { name: "Mark as fixed" }).click();
  await expect(waiting.locator("li", { hasText: "The form has a new name since last week." })).toHaveCount(0);

  // everything that is hers, with its version; nothing of other teams
  const all = page.getByRole("region", { name: /Everything that is yours/ });
  const mine = all.locator("tr", { hasText: "Mine demo" });
  await expect(mine).toContainText("Cloud Platform team");
  await expect(mine).toContainText("In use");
  await expect(mine).toContainText("Version 2"); // the review was a version of its own
  await expect(mine).toContainText("Casey Owner"); // the name, not the address
  await expect(mine).not.toContainText(CASEY);
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

test("an admin adds and removes the Owners of a team on the team itself", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  const owners = page.locator('.cat-members[data-rank="owner"]');
  // owners by name (a mail link), since when and by whom, and a button to remove each (the role is the section's)
  await expect(owners.locator("h3")).toHaveText("Owners 2");
  await expect(owners.locator("li", { hasText: "Jordan Platform" }).locator("a.person-link")).toHaveAttribute("href", `mailto:${JORDAN}`);
  await expect(owners.locator("li", { hasText: "Jordan Platform" })).toContainText(/since \d{4}-\d\d-\d\d, added by/);
  await expect(owners.getByRole("button", { name: `Remove ${CASEY} as Owner` })).toBeVisible();
  await expect(owners.getByRole("button", { name: `Remove ${JORDAN} as Owner` })).toBeVisible();
  await expect(page.locator('.cat-members[data-rank="member"]')).toHaveCount(0); // a team has no members

  // one more Owner: a team can have as many as it needs
  await owners.getByLabel("Email of the new owner").fill("Sam@Example.com ");
  await owners.getByRole("button", { name: "Add owner" }).click();
  await expect(owners.getByRole("button", { name: `Remove ${SAM} as Owner` })).toBeVisible();
  await expect(page.locator(".toast", { hasText: "Sam Consumer is now an Owner of Cloud Platform team." })).toBeVisible();
  await expect(owners.locator("h3")).toHaveText("Owners 3");
  await expect(owners.getByLabel("Email of the new owner")).toHaveValue("");

  // it takes effect at once: Sam now answers for what the team owns
  await signIn(page, SAM);
  await open(page, "/mine");
  await expect(page.locator(".mine-head")).toContainText("Cloud Platform team");
  await expect(page.getByRole("region", { name: /Everything that is yours/ }).locator("tr", { hasText: "Request a GCP project" })).toBeVisible();

  // and removing asks first, then takes it away again
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  await owners.getByRole("button", { name: `Remove ${SAM} as Owner` }).click();
  const ask = page.getByRole("dialog", { name: "Remove this owner?" });
  await expect(ask).toContainText("Sam Consumer will no longer be an Owner of Cloud Platform team. What the team maintains will no longer be among their responsibilities.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(owners.locator("li", { hasText: "Sam Consumer" })).toBeVisible();
  await owners.getByRole("button", { name: `Remove ${SAM} as Owner` }).click();
  await ask.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(owners.locator("li", { hasText: "Sam Consumer" })).toHaveCount(0);
  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.getByRole("link", { name: /My responsibilities/ })).toHaveCount(0);
});

test("a practice has owners and members, each with the one role it gives; a new team needs saving first", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  // the team Cyber Security: Riley is its Owner
  await page.locator(".cat-item", { hasText: "Cyber Security" }).click();
  await expect(page.locator(".cat-members").getByRole("button", { name: `Remove ${RILEY} as Owner` })).toBeVisible();
  // the practice Cyber security: Riley is its Practice owner; each list gives one role, nothing to choose
  await page.getByRole("tab", { name: /Practices/ }).click();
  await page.locator(".cat-item", { hasText: "Cyber security" }).click();
  const owners = page.locator('.cat-members[data-rank="owner"]');
  const members = page.locator('.cat-members[data-rank="member"]');
  await expect(owners.getByRole("button", { name: `Remove ${RILEY} as Practice owner` })).toBeVisible();
  await expect(page.getByLabel("As", { exact: true })).toHaveCount(0);
  await expect(members).toContainText("Nobody yet. Add the people who write drafts for this practice.");
  await members.getByLabel("Email of the new member").fill("kim@example.com");
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.getByRole("button", { name: "Remove kim@example.com as Practice member" })).toBeVisible();
  await expect(members.locator(".member-note")).toHaveText("Nobody with this address has done anything in the portal yet. Check it is right.");
  // something that is not an address is not added, and says why
  await members.getByLabel("Email of the new member").fill("not an address");
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator(".member-problem")).toHaveText("Write one email address, like team@company.com.");
  await members.getByLabel("Email of the new member").fill("");
  await members.getByRole("button", { name: "Remove kim@example.com as Practice member" }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: "kim@example.com" })).toHaveCount(0);

  // a team nobody belongs to
  await page.getByRole("tab", { name: /Teams/ }).click();
  await page.locator(".cat-item", { hasText: "Service Management" }).click();
  await expect(owners).toContainText("Nobody yet");

  // a team that was added but not saved does not exist yet for anybody to belong to
  await page.getByRole("button", { name: "New team" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Data Platform team");
  await page.keyboard.press("Enter");
  await expect(owners).toContainText("Save the lists first");
  await expect(owners.getByLabel("Email of the new owner")).toHaveCount(0);
  await page.getByRole("button", { name: "Discard" }).click();
});

test("who is an Owner is changed by admins only: somebody who only manages the lists sees them, nothing to change", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await page.locator(".cat-item", { hasText: "Cloud Platform team" }).click();
  const owners = page.locator('.cat-members[data-rank="owner"]');
  await expect(owners).toContainText("Owners review what this team looks after and answer its feedback. An admin gives and takes this role.");
  await expect(owners.locator("li", { hasText: "Casey Owner" })).toBeVisible();
  await expect(owners.locator("li", { hasText: "Jordan Platform" })).toBeVisible();
  await expect(page.locator(".cat-members").getByRole("textbox")).toHaveCount(0);
  await expect(page.locator(".cat-members").getByRole("button", { name: /^Remove / })).toHaveCount(0);
  // and the server agrees
  expect((await page.request.post("/api/admin/access", { data: { email: SAM, role: "owner", scope: "cloud-platform-team" }, headers: CSRF })).status()).toBe(403);
  expect((await page.request.post("/api/groups/practices/security/members", { data: { email: SAM }, headers: CSRF })).status()).toBe(403);
});
