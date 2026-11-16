import { expect, test, type Page } from "@playwright/test";
import { ALEX, CASEY, RILEY, SAM, open, readProcess, report, serverToday, signIn } from "./helpers";

const CSRF = { "X-Requested-With": "process-manager" };

// Casey is Owner for the Cloud Platform team; Riley owns and edits the standards of Cyber Security.

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

test("a unit sees its standards; somebody who owns nothing has no such page in the way", async ({ page }) => {
  await signIn(page, RILEY);
  await open(page, "/mine");
  const all = page.getByRole("region", { name: /Everything that is yours/ });
  await expect(all.locator("tr", { hasText: "Secure logging" })).toContainText("Cyber Security");
  await expect(all.locator("tr", { hasText: "Code review" })).toHaveCount(0); // another unit's standard

  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.getByRole("link", { name: /My responsibilities/ })).toHaveCount(0);
  await open(page, "/mine");
  await expect(page.locator(".lead")).toContainText("Nothing is assigned to you");
});
