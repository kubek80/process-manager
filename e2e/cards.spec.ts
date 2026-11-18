import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, clearFeedback, CSRF, open, pickFilter, report, SAM, signIn } from "./helpers";

// The Processes list, the Standards list and the search results share one layout: the filters
// on the left, the cards on the right. A card says one thing per line; it can be bookmarked and
// upvoted without opening it.

const GCP = "request-gcp-project";
const AKAMAI = "onboard-site-to-akamai"; // applies to Tier 0 and Tier 1 only
const REPO = "request-github-repository";

const card = (page: Page, id: string) => page.locator(`li.card[data-id="${id}"]`);

/** Takes away every bookmark and upvote of a person, so that the next test starts clean. */
async function unmarkAll(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  const { mine } = await (await request.get("/api/engagement")).json();
  for (const b of mine.bookmarks) await request.delete(`/api/bookmarks/${b.kind}/${b.id}`, { headers: CSRF });
  for (const u of mine.upvotes) await request.delete(`/api/upvotes/${u.kind}/${u.id}`, { headers: CSRF });
}

test.afterEach(async ({ request }) => {
  await unmarkAll(request, SAM);
  await unmarkAll(request, ALEX);
});

for (const [hash, panelId] of [["/processes", "process-filters"], ["/standards", "standard-filters"], ["/search", "search-filters"]] as const) {
  test(`${hash}: the filters are a panel on the left of the cards`, async ({ page }) => {
    await signIn(page, SAM);
    await open(page, hash);
    const panel = page.getByRole("complementary", { name: "Filters" });
    await expect(panel).toHaveAttribute("id", panelId);
    const results = page.getByRole("region", { name: "Results" });
    await expect(results.locator("li.card").first()).toBeVisible();
    const [p, r] = [(await panel.boundingBox())!, (await results.boundingBox())!];
    expect(p.x + p.width).toBeLessThanOrEqual(r.x + 1); // the panel ends where the results begin
    for (const name of ["Category", "Platform", "Practice", "Rigour", "Owner"]) await expect(panel.getByRole("button", { name: new RegExp(`^${name}: Any$`) })).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: /^Only my bookmarks, \d+ results?$/ })).toBeVisible();
    await expect(panel.locator("fieldset.profile-filter")).toBeVisible();
    await expect(page.locator(".filter-toggle")).toBeHidden(); // on a wide screen nothing to fold away
  });
}

test("a filter dropdown works with the keyboard: two values, a name that says them, Escape back", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  const button = page.getByRole("button", { name: "Category: Any" });
  await button.focus();
  await page.keyboard.press("ArrowDown"); // opens it and goes to the first option
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("group", { name: "Category", exact: true });
  const options = list.getByRole("checkbox");
  await expect(options.first()).toBeFocused();
  const first = (await list.locator(".filter-option-name").nth(0).textContent())!.trim();
  const second = (await list.locator(".filter-option-name").nth(1).textContent())!.trim();
  await page.keyboard.press("Space");
  await expect(options.nth(0)).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(options.nth(1)).toBeChecked();
  await page.keyboard.press("End");
  await expect(options.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(options.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  const chosenButton = page.getByRole("button", { name: `Category: ${first}, ${second}`, exact: true });
  await expect(chosenButton).toBeFocused();
  await expect(chosenButton).toHaveAttribute("aria-expanded", "false");

  // both are shown above the cards, each can be removed, and all at once
  const chosen = page.getByRole("group", { name: "Chosen filters" });
  await expect(chosen.getByRole("button", { name: `Remove filter Category: ${first}` })).toBeVisible();
  await expect(chosen.getByRole("button", { name: `Remove filter Category: ${second}` })).toBeVisible();
  for (const c of await page.locator("li.card .card-cat").allTextContents()) expect([first, second]).toContain(c.trim());
  await chosen.getByRole("button", { name: `Remove filter Category: ${first}` }).click();
  await expect(page.getByRole("button", { name: `Category: ${second}`, exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /^Only my bookmarks/ }).check();
  await expect(chosen.getByRole("button", { name: "Remove filter Bookmarks: only mine" })).toBeVisible();
  await chosen.getByRole("button", { name: "Clear all filters" }).click();
  await expect(chosen).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Category: Any" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Only my bookmarks/ })).not.toBeChecked();
  await expect(page.locator("p.list-count")).toHaveText("7 processes");
});

test("a card: owner, tiers top right, one fact per line, no step icons and no chips", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  const akamai = card(page, AKAMAI);
  await expect(akamai.locator(".card-kind")).toHaveText("Process");
  await expect(akamai.locator(".card-tiers")).toHaveText("Applies to: Tier 0, Tier 1");
  // the tiers sit in the top right corner
  const [c, t, title] = [(await akamai.boundingBox())!, (await akamai.locator(".card-tiers").boundingBox())!, (await akamai.locator(".card-title").boundingBox())!];
  expect(c.x + c.width - (t.x + t.width)).toBeLessThan(30);
  expect(t.y - c.y).toBeLessThan(30);
  expect(t.y).toBeLessThan(title.y);
  await expect(card(page, GCP).locator(".card-tiers")).toHaveText("Applies to: All tiers");

  // one "name: value" per line, the owner first
  const lines = akamai.locator("dl.card-lines > .card-line");
  await expect(lines.first()).toHaveAttribute("data-line", "owner");
  await expect(lines.first().locator("dt")).toHaveText("Owner:");
  await expect(lines.first().locator("dd")).not.toBeEmpty();
  expect(await lines.count()).toBeGreaterThanOrEqual(3);
  for (const line of await lines.all()) {
    await expect(line.locator("dt")).toHaveCount(1);
    await expect(line.locator("dd")).toHaveCount(1);
  }
  await expect(akamai.locator('[data-line="environments"] dd')).toHaveText("Staging, Production");
  // nothing of the old card: no row of step icons, no tags, no chips
  for (const old of [".card-strip", ".card-tags", ".tier-tag", ".type-icon", ".chip"]) await expect(page.locator(`li.card ${old}`), old).toHaveCount(0);
});

test("open feedback is a line of its own, only when there is some; Give feedback leads to the form", async ({ page, request }) => {
  await clearFeedback(request, "process", REPO);
  await clearFeedback(request, "process", GCP);
  try {
    await report(request, ALEX, { targetId: REPO, text: "The template repository was renamed." });
    await report(request, ALEX, { targetId: REPO, text: "The branch rules are different now." });
    await signIn(page, SAM);
    await open(page, "/processes");
    await expect(card(page, REPO).locator("p.card-feedback")).toHaveText("2 open feedback");
    await expect(card(page, GCP).locator("p.card-feedback")).toHaveCount(0);

    const give = card(page, GCP).getByRole("link", { name: "Give feedback on Request a GCP project" });
    await give.click();
    await expect(page).toHaveURL(/#\/p\/request-gcp-project\/feedback$/);
    await expect(page.getByRole("heading", { name: "Give feedback" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your feedback" })).toBeFocused();

    // the same on a standard's card
    await open(page, "/standards");
    await card(page, "secure-logging").getByRole("link", { name: "Give feedback on Secure logging" }).click();
    await expect(page).toHaveURL(/#\/s\/secure-logging\/feedback$/);
    await expect(page.getByRole("textbox", { name: "Your feedback" })).toBeFocused();
  } finally {
    await clearFeedback(request, "process", REPO);
  }
});

test("bookmark and upvote on a card work without opening it, and the bookmarks are a filter", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  const gcp = card(page, GCP);
  const upvote = gcp.getByRole("button", { name: /^Upvote Request a GCP project \(\d+\)$/ });
  const before = Number((await upvote.getAttribute("aria-label"))!.match(/\((\d+)\)/)![1]);
  await upvote.click();
  await expect(page).toHaveURL(/#\/processes$/); // the card did not open
  const taken = gcp.getByRole("button", { name: `Take back your upvote of Request a GCP project (${before + 1})` });
  await expect(taken).toHaveAttribute("aria-pressed", "true");
  await expect(taken.locator(".engage-count")).toHaveText(String(before + 1));

  await gcp.getByRole("button", { name: "Bookmark Request a GCP project" }).click();
  await expect(page).toHaveURL(/#\/processes$/);
  await expect(gcp.getByRole("button", { name: "Remove bookmark from Request a GCP project" })).toHaveAttribute("aria-pressed", "true");
  await card(page, AKAMAI).getByRole("button", { name: "Bookmark Onboard a site to Akamai" }).click();

  const only = page.getByRole("checkbox", { name: "Only my bookmarks, 2 results" });
  await only.check();
  await expect(page.locator("li.card")).toHaveCount(2);
  await expect(page.locator("p.list-count")).toHaveText("2 processes");
  // un-bookmarking in the filtered list takes the card away
  await card(page, AKAMAI).getByRole("button", { name: "Remove bookmark from Onboard a site to Akamai" }).click();
  await expect(page.locator("li.card")).toHaveCount(1);
  await expect(page.locator("li.card")).toHaveAttribute("data-id", GCP);

  // the server keeps them: a reload shows the same
  await page.reload();
  await expect(page.locator("li.card")).toHaveCount(1);
  await expect(card(page, GCP).getByRole("button", { name: `Take back your upvote of Request a GCP project (${before + 1})` })).toBeVisible();

  // the upvote is taken back
  await page.getByRole("checkbox", { name: /^Only my bookmarks/ }).uncheck();
  await card(page, GCP).getByRole("button", { name: /^Take back your upvote/ }).click();
  await expect(card(page, GCP).getByRole("button", { name: `Upvote Request a GCP project (${before})` })).toHaveAttribute("aria-pressed", "false");
});

test("Home shows your bookmarks until the last one is removed; bookmarks belong to one person", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/standards");
  await card(page, "secure-logging").getByRole("button", { name: "Bookmark Secure logging" }).click();
  await expect(card(page, "secure-logging").getByRole("button", { name: "Remove bookmark from Secure logging" })).toBeVisible();
  await open(page, "/processes");
  await card(page, GCP).getByRole("button", { name: "Bookmark Request a GCP project" }).click();
  await expect(card(page, GCP).getByRole("button", { name: "Remove bookmark from Request a GCP project" })).toBeVisible();

  await open(page, "/");
  const marks = page.locator("section.home-bookmarks");
  await expect(marks.getByRole("heading", { name: "Your bookmarks" })).toBeVisible();
  // newest first, a process and a standard
  await expect(marks.locator("li.card")).toHaveCount(2);
  await expect(marks.locator("li.card").nth(0)).toHaveAttribute("data-id", GCP);
  await expect(marks.locator("li.card").nth(1)).toHaveAttribute("data-id", "secure-logging");
  await expect(marks.locator("h3.card-title")).toHaveCount(2);
  await page.reload();
  await expect(marks.locator("li.card")).toHaveCount(2);

  // somebody else has none of them
  await signIn(page, ALEX);
  await open(page, "/");
  await expect(page.getByRole("heading", { name: "Find a process or a standard" })).toBeVisible();
  await expect(page.locator("section.home-bookmarks")).toHaveCount(0);
  await open(page, "/processes");
  await expect(card(page, GCP).getByRole("button", { name: "Bookmark Request a GCP project" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("checkbox", { name: "Only my bookmarks, 0 results" })).toBeVisible();

  // removing them on Home: the section goes with the last one
  await signIn(page, SAM);
  await open(page, "/");
  await marks.getByRole("button", { name: "Remove bookmark from Request a GCP project" }).click();
  await expect(marks.locator("li.card")).toHaveCount(1);
  await marks.getByRole("button", { name: "Remove bookmark from Secure logging" }).click();
  await expect(page.locator("section.home-bookmarks")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Find a process or a standard" })).toBeVisible();
  await expect(page.locator("section.home-bookmarks")).toHaveCount(0);
});

test("on a phone the filters fold away behind one button and the cards fit", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, SAM);
  await open(page, "/processes");
  const toggle = page.getByRole("button", { name: "Filters", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#process-filters")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#process-filters")).toBeVisible();
  await pickFilter(page, "Platform", "Google Cloud");
  await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.getByRole("button", { name: "Filters (1)" }).click(); // folds the panel away again
  await expect(page.locator("#process-filters")).toBeHidden();
  const gcp = card(page, GCP);
  await gcp.scrollIntoViewIfNeeded();
  const box = (await gcp.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await expect(gcp.locator(".card-tiers")).toBeInViewport({ ratio: 1 });
  await expect(gcp.getByRole("button", { name: /^Upvote / })).toBeInViewport({ ratio: 1 });
  await expect(gcp.getByRole("button", { name: /^Bookmark / })).toBeInViewport({ ratio: 1 });
});
