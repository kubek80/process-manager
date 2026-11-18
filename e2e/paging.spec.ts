import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, open, SAM, signIn } from "./helpers";

// Pages of a list. The sample is small, so 18 more processes are made here (25 in all) and
// removed again afterwards: other tests count what there is.

const N = 18;
const IDS = Array.from({ length: N }, (_, i) => `paging-demo-${String(i + 1).padStart(2, "0")}`);
const TOTAL = 7 + N; // processes
const RESULTS = 10 + N; // processes and standards

async function asAlex(request: APIRequestContext) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await asAlex(request);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-github-repository");
  for (const [i, id] of IDS.entries()) {
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title: `Paging demo ${String(i + 1).padStart(2, "0")}`, status: "active" }, headers: CSRF });
    expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
  }
});

test.afterAll(async ({ request }) => {
  await asAlex(request);
  for (const id of IDS) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

const count = (page: Page) => page.locator("p.list-count");
const pager = (page: Page, name: string) => page.getByRole("navigation", { name, exact: true });

test("the Processes list in pages of 12: count, next, previous, the current page marked", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  // 24 a page unless chosen otherwise: two pages
  await expect(page.getByRole("combobox", { name: "Items per page" })).toHaveValue("24");
  await expect(count(page)).toHaveText(`Showing 1–24 of ${TOTAL} processes`);
  await page.getByRole("combobox", { name: "Items per page" }).selectOption("12");
  await expect(count(page)).toHaveText(`Showing 1–12 of ${TOTAL} processes`);
  await expect(page.locator("li.card")).toHaveCount(12);

  const top = pager(page, "Pages of processes");
  const bottom = pager(page, "Pages of processes, at the end");
  await expect(top).toBeVisible();
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await expect(bottom.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await expect(bottom.getByRole("button", { name: /^Page \d+$/ })).toHaveCount(3);

  await bottom.getByRole("button", { name: "Next page" }).click();
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);
  await expect(bottom.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await expect(top.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await expect(bottom.getByRole("button", { name: "Page 1" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Results" })).toBeFocused(); // reading goes on at the top of the results

  await top.getByRole("button", { name: "Page 3" }).click();
  await expect(count(page)).toHaveText(`Showing 25–${TOTAL} of ${TOTAL} processes`);
  await expect(page.locator("li.card")).toHaveCount(TOTAL - 24);
  await expect(bottom.getByRole("button", { name: "Next page" })).toBeDisabled();
  await bottom.getByRole("button", { name: "Previous page" }).click();
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);

  // a change of the search or of a filter starts again at page 1
  await page.getByRole("searchbox", { name: "Search processes" }).fill("paging demo");
  await expect(count(page)).toHaveText(`Showing 1–12 of ${N} processes`);
  await expect(bottom.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await bottom.getByRole("button", { name: "Next page" }).click();
  await expect(count(page)).toHaveText(`Showing 13–${N} of ${N} processes`);
  await page.getByRole("checkbox", { name: /^Only my bookmarks/ }).check();
  await expect(count(page)).toHaveText("No processes");
  await page.getByRole("checkbox", { name: /^Only my bookmarks/ }).uncheck();
  await expect(count(page)).toHaveText(`Showing 1–12 of ${N} processes`);

  // the page size is remembered in this browser, for every list
  await page.getByRole("button", { name: "Clear all filters" }).first().click();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Items per page" })).toHaveValue("12");
  await expect(count(page)).toHaveText(`Showing 1–12 of ${TOTAL} processes`);
  await open(page, "/search");
  await expect(page.getByRole("combobox", { name: "Items per page" })).toHaveValue("12");
  await expect(count(page)).toHaveText(`Showing 1–12 of ${RESULTS} results`);
  // all on one page: no pages to choose
  await page.getByRole("combobox", { name: "Items per page" }).selectOption("48");
  await expect(count(page)).toHaveText(`${RESULTS} results`);
  await expect(page.getByRole("navigation", { name: /^Pages of/ })).toHaveCount(0);
});

test("on the search page the page and its size are in the address, and Back goes to the page before", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search");
  await page.getByRole("combobox", { name: "Items per page" }).selectOption("12");
  await expect(page).toHaveURL(/#\/search\?size=12$/);
  await expect(count(page)).toHaveText(`Showing 1–12 of ${RESULTS} results`);
  const bottom = pager(page, "Pages of results, at the end");
  await bottom.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(page).toHaveURL(/[?&]size=12(&|$)/);
  await expect(count(page)).toHaveText(`Showing 13–24 of ${RESULTS} results`);
  await bottom.getByRole("button", { name: "Page 3" }).click();
  await expect(page).toHaveURL(/[?&]page=3(&|$)/);
  await expect(count(page)).toHaveText(`Showing 25–${RESULTS} of ${RESULTS} results`);

  await page.goBack();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(count(page)).toHaveText(`Showing 13–24 of ${RESULTS} results`);
  await expect(bottom.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).not.toHaveURL(/page=/);
  await expect(count(page)).toHaveText(`Showing 1–12 of ${RESULTS} results`);

  // the address opens the same page somewhere else, with its size, even where another size was chosen
  const other = await page.context().newPage();
  await other.addInitScript(() => { try { localStorage.setItem("pm:page-size", "48"); } catch { /* ignore */ } });
  await other.goto("/#/search?page=2&size=12");
  await expect(other.locator("p.list-count")).toHaveText(`Showing 13–24 of ${RESULTS} results`);
  await other.close();

  // a new filter starts again at page 1
  await bottom.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await page.getByRole("button", { name: /^Type:/ }).click();
  await page.getByRole("checkbox", { name: /^Processes, \d+ results$/ }).check();
  await expect(page).not.toHaveURL(/page=/);
  await expect(count(page)).toHaveText(`Showing 1–12 of ${TOTAL} results with 1 filter`);
});

test("on a phone the pages read “Page 2 of 3” and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, SAM);
  await page.addInitScript(() => { try { localStorage.setItem("pm:page-size", "12"); } catch { /* ignore */ } });
  await open(page, "/processes");
  const bottom = pager(page, "Pages of processes, at the end");
  await bottom.getByRole("button", { name: "Next page" }).click();
  // going to another page brings the start of the results into view
  await expect(page.locator("li.card").first()).toBeInViewport();
  await bottom.scrollIntoViewIfNeeded();
  await expect(bottom.locator(".pager-of")).toHaveText("Page 2 of 3");
  await expect(bottom.locator(".pager-of")).toBeVisible();
  await expect(bottom.getByRole("button", { name: "Previous page" })).toBeInViewport({ ratio: 1 });
  await expect(bottom.getByRole("button", { name: "Next page" })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("Back and reload return to the page the person left; a new browser starts on page 1", async ({ page, browser }) => {
  await signIn(page, SAM);
  await page.addInitScript(() => { try { localStorage.setItem("pm:page-size", "12"); } catch { /* ignore */ } });
  await open(page, "/processes");
  const bottom = pager(page, "Pages of processes, at the end");
  await bottom.getByRole("button", { name: "Page 2" }).click();
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);
  const first = page.locator("li.card").first();
  const title = (await first.locator(".card-title").textContent())!.trim();
  await first.locator(".card-link").click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.goBack();
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);
  await expect(bottom.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);
  // the Standards list keeps a page of its own
  await open(page, "/standards");
  await expect(page.locator("p.list-count")).toHaveText("3 standards");
  await open(page, "/processes");
  await expect(count(page)).toHaveText(`Showing 13–24 of ${TOTAL} processes`);

  // another browser (a new tab session) starts at the beginning
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const p2 = await other.newPage();
  await signIn(p2, SAM);
  await p2.addInitScript(() => { try { localStorage.setItem("pm:page-size", "12"); } catch { /* ignore */ } });
  await open(p2, "/processes");
  await expect(p2.locator("p.list-count")).toHaveText(`Showing 1–12 of ${TOTAL} processes`);
  await other.close();
});

test("on a phone the panel ends with a button that shows the results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search processes" }).fill("paging demo");
  const done = page.locator("#process-filters button.filter-done");
  await expect(done).toHaveText(`Show ${N} processes`);
  await done.click();
  await expect(page.locator("#process-filters")).toBeHidden();
  await expect(page.getByRole("button", { name: /^Filters \(1\)$/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("li.card").first()).toBeInViewport();
  // the same on the search page
  await open(page, "/search?q=paging%20demo");
  await page.locator("button.filter-toggle").click();
  await expect(page.locator("#search-filters button.filter-done")).toHaveText(`Show ${N} results`);
  await page.locator("#search-filters button.filter-done").click();
  await expect(page.locator("#search-filters")).toBeHidden();
});

test("search by meaning comes in pages as well, in the order the server gave", async ({ page }) => {
  await signIn(page, SAM);
  const asked: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/search") asked.push(r.url()); });
  // the 18 made here are copies of the repository process: all close to "repository"
  await open(page, "/search?q=repository&size=12&mode=meaning");
  await expect(page.locator("section.list-results")).not.toHaveAttribute("aria-busy", "true");
  await expect(count(page)).toHaveText(/^Showing 1–12 of \d+ results for “repository”$/);
  const total = Number((await count(page).innerText()).match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThanOrEqual(N + 1);
  const cards = page.locator(".search-page ol.cards > li.card");
  const ids = () => cards.evaluateAll((li) => li.map((l) => l.getAttribute("data-id")!));
  await expect(cards).toHaveCount(12);
  const first = await ids();
  const bottom = pager(page, "Pages of results, at the end");
  await bottom.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(page).toHaveURL(/[?&]mode=meaning$/);
  await expect(count(page)).toHaveText(`Showing 13–${Math.min(24, total)} of ${total} results for “repository”`);
  const second = await ids();
  expect(second.filter((id) => first.includes(id)), "no result on two pages").toEqual([]);
  expect(new Set([...first, ...second]).size).toBe(Math.min(24, total));
  expect([...first, ...second].filter((id) => IDS.includes(id)).length, "the copies made here are found").toBe(Math.min(N, 24 - 1));
  await page.goBack();
  await expect(count(page)).toHaveText(`Showing 1–12 of ${total} results for “repository”`);
  expect(await ids()).toEqual(first);
  // the pages are of one answer: the server was asked once
  expect(asked).toHaveLength(1);
});
