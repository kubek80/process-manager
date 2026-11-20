import { expect, test, type APIRequestContext } from "@playwright/test";
import { ALEX, CASEY, CSRF, SAM, open, signIn } from "./helpers";

// The reader's page of a process and of a standard: the head (kind, owner in words, how binding
// as a neutral mark, the facts, the quiet line with dates), the tabs, and a first review that is
// counted from the first publication. Also the segmented controls of Requests and My
// responsibilities. What is made here is removed afterwards.

const FRESH = "pages-demo-fresh";

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  await request.delete(`/api/processes/${FRESH}`, { headers: CSRF });
});

/** The problem colours of the page (of errors), as the browser computes them. */
const problemColour = (page: import("@playwright/test").Page) => page.evaluate(() => ["--bad", "--bad-ink", "--bad-bg"].map((v) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${v}, rgb(1, 2, 3))`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  if (c === "rgb(1, 2, 3)") throw new Error(`${v} is not defined`);
  return c;
}));

test("the head of a process: kind, owner in words, how binding as a neutral mark, the facts and the dates", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  const head = page.locator("header.doc-head");
  await expect(head.locator(".kind-tag.process .card-kind")).toHaveText("Process");
  await expect(head.locator(".doc-owner")).toHaveText(/^Cloud · Owned by Cloud Platform team$/);
  await expect(head.getByRole("heading", { level: 1 })).toHaveText("Request a GCP project");
  // the same size of heading as the lists
  const listH1 = await (async () => { const p = await page.context().newPage(); await p.goto("/#/processes"); const s = await p.locator("h1").first().evaluate((e) => getComputedStyle(e).fontSize); await p.close(); return s; })();
  expect(await head.locator("h1").evaluate((e) => getComputedStyle(e).fontSize)).toBe(listH1);
  // how binding: a mark with bars and the word, in the ink of text, never the problem red
  const level = head.locator(".level-mark");
  await expect(level).toHaveText("Mandatory");
  await expect(level).toHaveAttribute("data-level", "mandatory");
  await expect(level.locator(".level-bars i.on")).toHaveCount(3);
  const bad = await problemColour(page);
  expect(bad).not.toContain(await level.evaluate((e) => getComputedStyle(e).color));
  expect(bad).not.toContain(await level.evaluate((e) => getComputedStyle(e).backgroundColor));
  await expect(head.locator(".tier-tag")).toHaveCount(0); // the old red chip
  // the facts to compare, then where it applies
  await expect(head.locator(".doc-facts").first()).toContainText("3-5 working days");
  await expect(head.locator(".doc-facts")).toContainText("Google Cloud");
  await expect(head.locator('.doc-facts .fact[title^="Platform: "]')).toHaveCount(1);
  // a quiet line with when it was updated and its version
  await expect(head.locator(".doc-foot")).toContainText(/Updated \d{4}-\d\d-\d\d/);
  await expect(head.locator(".doc-foot").getByRole("button", { name: /^Version \d+$/ })).toBeVisible();

  // the views are underline tabs
  const tabs = page.getByRole("tablist").first();
  await expect(tabs).toHaveClass(/\btabs\b/);
  const map = tabs.getByRole("tab", { name: "Map" });
  await expect(map).toHaveClass(/\btab\b/);
  await expect(map).toHaveAttribute("aria-selected", "true");
  await expect(map).toHaveClass(/\bon\b/);
  await tabs.getByRole("tab", { name: /^Checklist/ }).click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/list/);
  await expect(tabs.getByRole("tab", { name: /^Checklist/ })).toHaveAttribute("aria-selected", "true");
});

test("the head of a standard: issued by, its requirements counted by level, levels as neutral marks; the level filter is a segmented control", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/s/secure-logging/doc");
  const head = page.locator("header.doc-head");
  await expect(head.locator(".kind-tag.standard .card-kind")).toHaveText("Standard");
  await expect(head.locator(".doc-owner")).toContainText("Issued by Cyber Security");
  await expect(head.locator(".doc-facts").first()).toContainText("5 requirements");
  await expect(head.locator(".doc-facts").first()).toContainText("4 must");
  await expect(head.locator(".doc-facts").first()).toContainText("1 should");
  const bad = await problemColour(page);
  for (const mark of await page.locator(".req .req-level").all()) {
    expect(bad).not.toContain(await mark.evaluate((e) => getComputedStyle(e).color));
    expect(bad).not.toContain(await mark.evaluate((e) => getComputedStyle(e).backgroundColor));
  }
  // no coloured stripe on a requirement
  const req = page.locator(".req").first();
  const [l, r] = await req.evaluate((e) => [getComputedStyle(e).borderLeftWidth, getComputedStyle(e).borderRightWidth]);
  expect(l).toBe(r);
  const levels = page.getByRole("group", { name: "Show requirements of level" });
  await expect(levels).toHaveClass(/\bseg\b/);
  await expect(levels.getByRole("button", { name: /^All/ })).toContainText("5");
  await expect(levels.getByRole("button", { name: /^Must/ })).toContainText("4");
});

test("a first review is counted from the first publication: due later, not counted as needing a review", async ({ page, request }) => {
  // a process of the Cloud Platform team, with a review every six months, never reviewed, published today
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  const res = await request.put(`/api/processes/${FRESH}?base=0`, {
    data: { ...src, id: FRESH, title: "Pages demo fresh", owner: "cloud-platform-team", status: "active", review: { intervalMonths: 6 } }, headers: CSRF,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { meta } = await (await request.get("/api/processes")).json();
  expect(meta[FRESH].publishedAt).toBeTruthy();
  const due = new Date(meta[FRESH].publishedAt);
  due.setUTCMonth(due.getUTCMonth() + 6);

  await signIn(page, CASEY); // Owner of the team: looks after its reviews
  await open(page, `/p/${FRESH}/flow`);
  const head = page.locator("header.doc-head");
  await expect(head.locator(".doc-foot")).toContainText(`First review due ${due.toISOString().slice(0, 10)}`);
  await expect(head.locator('.card-mark[data-line="review"]')).toHaveCount(0); // nothing to do yet: no mark
  await expect(page.locator(".banner", { hasText: /review/i })).toHaveCount(0);
  // the lists do not count it as needing a review
  await open(page, "/processes");
  const card = page.locator(`li.card[data-id="${FRESH}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.card-mark[data-line="review"]')).toHaveCount(0);
  const only = page.getByRole("checkbox", { name: /^Only what needs a review/ });
  if (await only.count()) {
    await only.check();
    await expect(page.locator(`li.card[data-id="${FRESH}"]`)).toHaveCount(0);
  }
  // nor does My responsibilities: it is listed as hers, not as a review to do
  await open(page, "/mine");
  await expect(page.getByRole("region", { name: /Everything that is yours/ })).toContainText("Pages demo fresh");
  const reviews = page.getByRole("region", { name: /Reviews to do/ });
  if (await reviews.count()) await expect(reviews).not.toContainText("Pages demo fresh");
});

test("segmented controls: Requests' state and kind, My responsibilities' groups; the chosen one in the brand fill", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/requests");
  for (const name of ["State", "Kind"]) {
    const group = page.getByRole("group", { name });
    await expect(group).toHaveClass(/\bseg\b/);
    const on = group.locator('button.seg-item[aria-pressed="true"]');
    await expect(on).toHaveCount(1);
    await expect(on).toHaveClass(/\bon\b/);
    const fill = await page.evaluate(() => { const p = document.createElement("span"); p.style.background = "var(--accent-fill)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
    expect(await on.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(fill);
  }
  // Jordan looks after several groups: one segmented control to show one
  await signIn(page, "jordan@example.com");
  await open(page, "/mine");
  const groups = page.getByRole("group", { name: "Show what belongs to" });
  await expect(groups).toHaveClass(/\bseg\b/);
  await expect(groups.getByRole("button", { name: "All of mine" })).toHaveAttribute("aria-pressed", "true");
  const second = groups.locator("button.seg-item").nth(1);
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(groups.getByRole("button", { name: "All of mine" })).toHaveAttribute("aria-pressed", "false");
});

test("at 1366 x 768 the map of a process starts on the first screen", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  // its tool line and its first lane, without scrolling
  await expect(page.getByRole("button", { name: "Fit" })).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".lane-label").first()).toBeInViewport({ ratio: 1 });
  // "Before you start" stays open, compact: one line of links and one row of what is needed
  const before = page.getByRole("region", { name: "Before you start" });
  await expect(before.getByRole("button", { name: /Before you start/ })).toHaveAttribute("aria-expanded", "true");
  expect((await before.boundingBox())!.height).toBeLessThan(220);
});

test("a first review that is due soon reads “First review due …” on the card, as a warning", async ({ page, request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  const id = `${FRESH}-card`;
  const res = await request.put(`/api/processes/${id}?base=0`, {
    data: { ...src, id, title: "Pages demo first review", owner: "cloud-platform-team", status: "active", review: { intervalMonths: 1 } }, headers: CSRF,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  try {
    // twenty days later in this browser: the first review, a month after publication, is due within the month
    await page.clock.install({ time: new Date(Date.now() + 20 * 86_400_000) });
    await signIn(page, CASEY);
    await open(page, "/processes");
    const mark = page.locator(`li.card[data-id="${id}"] .card-mark[data-line="review"]`);
    await expect(mark).toContainText(/First review due \d{4}-\d\d-\d\d$/);
    await expect(mark).toHaveClass(/\bwarn\b/);
    // the page: the same mark, and the quiet line says it was not reviewed yet
    await page.locator(`li.card[data-id="${id}"] .card-link`).click();
    await expect(page.locator('header.doc-head .card-mark[data-line="review"]')).toContainText("First review due");
    await expect(page.locator("header.doc-head .doc-foot")).toContainText("Not reviewed yet");
    await expect(page.locator("header.doc-head")).not.toContainText("Never reviewed");
  } finally {
    await as(request, ALEX);
    await request.delete(`/api/processes/${id}`, { headers: CSRF });
  }
});
