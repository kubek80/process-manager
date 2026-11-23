import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, fields, open, openEditor, outline, publish, readerToday, readProcess, serverToday, signIn } from "./helpers";

// The reader's day. A moment (a save, a publication) falls on the day it is where the reader is,
// not in UTC: in Los Angeles in the evening UTC is already tomorrow, in Auckland just after
// midnight UTC is still yesterday. A day stored with a document (last review, last changed) is a
// calendar day and is shown as written everywhere. "Mark as reviewed" sends the reader's day,
// which the server takes while it is today somewhere on Earth (UTC-12 to UTC+14), else its own
// UTC day.
//
// The fixed clocks below are in the past, so that a day they stamp is one the server accepts as
// it is; the review tests run on the real clock, since the server judges "today" by its own.

const LA = "America/Los_Angeles"; // UTC-8 in November
const AUCKLAND = "Pacific/Auckland"; // UTC+13 in November (daylight saving)
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14, the first place on Earth where a day starts

// the processes made here are removed again: other tests count what there is
const MADE = new Set<string>();
test.afterEach(async ({ request }) => {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  for (const id of MADE) await request.delete(`/api/processes/${id}`, { headers: CSRF });
  MADE.clear();
});

/** A published copy of the GCP process, owned by the Cloud Platform team (Casey is its Owner). */
async function copy(request: APIRequestContext, id: string, title: string, review: Record<string, unknown> = { intervalMonths: 6, lastReviewedAt: "2025-01-01", reviewedBy: "Somebody" }) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const src = (await readProcess(request, "request-gcp-project"))!;
  MADE.add(id);
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, owner: "cloud-platform-team", status: "active", review }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
}

/**
 * Home's "Recently updated" with the times the server sends replaced: everything else long ago,
 * and the three named processes at the given moments (so that they are the newest three).
 */
async function withUpdates(page: Page, at: Record<string, string>) {
  await page.route(/\/api\/(processes|standards)$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const [id, m] of Object.entries<Record<string, unknown>>(body.meta ?? {})) m.updatedAt = at[id] ?? "2025-01-01T12:00:00Z";
    await route.fulfill({ response: res, json: body });
  });
}

const recentRow = (page: Page, title: string) => page.locator('section.home-shelf[data-shelf="recent"] li', { hasText: title }).locator("time");

/** Saves a change of the summary on the editing screen and returns the day the save was stamped with (`updatedAt`). */
async function saveAndStamp(page: Page, id: string) {
  await openEditor(page, "process", id);
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill(`Saved in another time zone (${Math.random().toString(36).slice(2, 8)}).`);
  await publish(page);
  return (await readProcess(page, id))!.updatedAt;
}

/** The review line in the head of a process page and in Admin › Health, as Dana (who looks after everything). */
async function reviewLines(page: Page, id: string, title: string) {
  await open(page, `/p/${id}/flow`);
  const head = page.locator("header.doc-head .card-mark[data-line=\"review\"]");
  await expect(head).toBeVisible();
  const headText = await head.textContent();
  const headBad = /\bbad\b/.test((await head.getAttribute("class")) ?? "");
  await open(page, "/admin/health");
  const row = page.locator(".admin-card", { hasText: "Reviews due" }).locator("li", { hasText: title }).locator(".tier-tag");
  await expect(row).toBeVisible();
  return { head: headText, headBad, health: await row.textContent(), healthClass: await row.getAttribute("class") };
}

/** A plain day stored with a document is shown as it is written, in every zone. */
async function plainDaysAsWritten(page: Page) {
  const gcp = (await readProcess(page, "request-gcp-project"))!;
  await open(page, "/p/request-gcp-project/flow");
  const foot = page.locator("header.doc-head .doc-foot");
  await expect(foot.locator(".doc-changed")).toHaveText(`Content changed ${gcp.updatedAt}`);
  if (gcp.review?.lastReviewedAt) await expect(foot.locator(".review-tag")).toHaveText(`Reviewed ${gcp.review.lastReviewedAt}`);
}

test.describe("in Los Angeles in the evening, when UTC is already the next day", () => {
  test.use({ timezoneId: LA });

  test("Home says today and yesterday by the reader's day", async ({ page }) => {
    // 19 November, 19:30 in Los Angeles; 20 November, 03:30 in UTC
    await page.clock.install({ time: new Date("2026-11-20T03:30:00Z") });
    await signIn(page, ALEX);
    await withUpdates(page, {
      "request-gcp-project": "2026-11-20T02:00:00Z", // 19 Nov 18:00 here: today (UTC says today too)
      "request-azure-landing-zone": "2026-11-19T20:00:00Z", // 19 Nov 12:00 here: today (UTC would say yesterday)
      "onboard-site-to-akamai": "2026-11-18T23:00:00Z", // 18 Nov 15:00 here: yesterday (UTC would say 2 days ago)
    });
    await open(page, "/");
    await expect(recentRow(page, "Request a GCP project")).toHaveText("today");
    await expect(recentRow(page, "Request an Azure landing zone")).toHaveText("today");
    await expect(recentRow(page, "Request an Azure landing zone")).toHaveAttribute("title", "2026-11-19");
    await expect(recentRow(page, "Onboard a site to Akamai")).toHaveText("yesterday");
    await expect(recentRow(page, "Onboard a site to Akamai")).toHaveAttribute("title", "2026-11-18");
  });

  test("a save on the editing screen is stamped with the reader's day", async ({ page, request }) => {
    await copy(request, "days-save-la", "Days save LA");
    await page.clock.install({ time: new Date("2026-11-20T05:00:00Z") }); // 19 Nov, 21:00 here
    await signIn(page, ALEX);
    expect(await saveAndStamp(page, "days-save-la")).toBe("2026-11-19");
  });

  test("on its due day a review is due, not overdue, though UTC is a day further", async ({ page, request }) => {
    // reviewed 2026-05-20, every six months: due 2026-11-20
    await copy(request, "days-due-la", "Days due LA", { intervalMonths: 6, lastReviewedAt: "2026-05-20", reviewedBy: "Somebody" });
    await page.clock.install({ time: new Date("2026-11-21T05:00:00Z") }); // 20 Nov, 21:00 here; 21 Nov in UTC
    await signIn(page, DANA);
    const lines = await reviewLines(page, "days-due-la", "Days due LA");
    expect(lines.head).toBe("Review due 2026-11-20");
    expect(lines.headBad).toBe(false);
    expect(lines.health).toBe("Review due 2026-11-20");
    expect(lines.healthClass).toContain("review-soon");
  });

  test("Mark as reviewed stores the reader's day; a day stored with a document is shown as written", async ({ page, request }) => {
    await copy(request, "days-review-la", "Days review LA");
    await signIn(page, CASEY);
    const day = readerToday(LA);
    await open(page, "/p/days-review-la/flow");
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.locator("header.doc-head .review-tag")).toHaveText(`Reviewed ${day}`);
    // the day the server dated it with is the one this reader sees, whatever UTC says
    expect([day, readerToday(LA)]).toContain((await readProcess(page, "days-review-la"))!.review.lastReviewedAt);
    await plainDaysAsWritten(page);
  });
});

test.describe("in Auckland just after midnight, when UTC is still the day before", () => {
  test.use({ timezoneId: AUCKLAND });

  test("Home says today and yesterday by the reader's day", async ({ page }) => {
    // 20 November, 00:30 in Auckland; 19 November, 11:30 in UTC
    await page.clock.install({ time: new Date("2026-11-19T11:30:00Z") });
    await signIn(page, ALEX);
    await withUpdates(page, {
      "request-gcp-project": "2026-11-19T11:15:00Z", // 20 Nov 00:15 here: today
      "request-azure-landing-zone": "2026-11-19T10:00:00Z", // 19 Nov 23:00 here: yesterday (UTC would say today)
      "onboard-site-to-akamai": "2026-11-18T10:00:00Z", // 18 Nov 23:00 here: 2 days ago (UTC would say yesterday)
    });
    await open(page, "/");
    await expect(recentRow(page, "Request a GCP project")).toHaveText("today");
    await expect(recentRow(page, "Request a GCP project")).toHaveAttribute("title", "2026-11-20");
    await expect(recentRow(page, "Request an Azure landing zone")).toHaveText("yesterday");
    await expect(recentRow(page, "Onboard a site to Akamai")).toHaveText("2 days ago");
  });

  test("a save on the editing screen is stamped with the reader's day", async ({ page, request }) => {
    await copy(request, "days-save-akl", "Days save Auckland");
    await page.clock.install({ time: new Date("2026-11-19T11:30:00Z") }); // 20 Nov, 00:30 here
    await signIn(page, ALEX);
    expect(await saveAndStamp(page, "days-save-akl")).toBe("2026-11-20");
  });

  test("a review is due on its due day and overdue from the next, by the reader's day", async ({ page, request }) => {
    await copy(request, "days-due-akl", "Days due Auckland", { intervalMonths: 6, lastReviewedAt: "2026-05-20", reviewedBy: "Somebody" });
    await signIn(page, DANA);
    // 20 Nov, 00:30 here: the due day (UTC is still the 19th)
    await page.clock.install({ time: new Date("2026-11-19T11:30:00Z") });
    let lines = await reviewLines(page, "days-due-akl", "Days due Auckland");
    expect(lines.head).toBe("Review due 2026-11-20");
    expect(lines.headBad).toBe(false);
    expect(lines.healthClass).toContain("review-soon");
    // 21 Nov, 00:30 here: overdue, though UTC is still on the due day
    await page.clock.setSystemTime(new Date("2026-11-20T11:30:00Z"));
    lines = await reviewLines(page, "days-due-akl", "Days due Auckland");
    expect(lines.head).toBe("Review overdue since 2026-11-20");
    expect(lines.headBad).toBe(true);
    expect(lines.health).toBe("Review overdue since 2026-11-20");
    expect(lines.healthClass).toContain("review-overdue");
  });

  test("Mark as reviewed stores the reader's day; a day stored with a document is shown as written", async ({ page, request }) => {
    await copy(request, "days-review-akl", "Days review Auckland");
    await signIn(page, CASEY);
    const day = readerToday(AUCKLAND);
    await open(page, "/p/days-review-akl/flow");
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.locator("header.doc-head .review-tag")).toHaveText(`Reviewed ${day}`);
    expect([day, readerToday(AUCKLAND)]).toContain((await readProcess(page, "days-review-akl"))!.review.lastReviewedAt);
    await plainDaysAsWritten(page);
  });
});

test.describe("at UTC+14, where a day starts first", () => {
  test.use({ timezoneId: KIRITIMATI });

  test("Mark as reviewed stores the day it is there (the next UTC day from 10:00 UTC)", async ({ page, request }) => {
    await copy(request, "days-review-kir", "Days review Kiritimati");
    await signIn(page, CASEY);
    const day = readerToday(KIRITIMATI);
    await open(page, "/p/days-review-kir/flow");
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.locator("header.doc-head .review-tag")).toHaveText(`Reviewed ${day}`);
    expect([day, readerToday(KIRITIMATI)]).toContain((await readProcess(page, "days-review-kir"))!.review.lastReviewedAt);
    await plainDaysAsWritten(page);
  });
});

test("a browser clock far off is today nowhere: the review gets the server's own day", async ({ page, request }) => {
  await copy(request, "days-review-off", "Days review clock off");
  const before = serverToday();
  await page.clock.install({ time: new Date("2031-03-01T12:00:00Z") });
  await signIn(page, CASEY);
  await open(page, "/p/days-review-off/flow");
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect.poll(async () => (await readProcess(page, "days-review-off"))!.review.lastReviewedAt).not.toBe("2025-01-01");
  expect([before, serverToday()]).toContain((await readProcess(page, "days-review-off"))!.review.lastReviewedAt);
});
