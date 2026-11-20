import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, SAM, discardWorkingDraft, meaningReady, open, pickFilter, putWorkingDraft, readProcess, signIn } from "./helpers";

// Home's shelves and Browse, the search head (Words / Meaning / Both, "How this works"), the
// lists' address, Cards and Rows, what is found and what is not, and how the lists fit a laptop
// and a phone. The documents made here are removed afterwards: other tests count what there is.

const PREFIX = "finding-demo-";
const cards = (page: Page) => page.locator("ol.cards > li.card");

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
async function make(request: APIRequestContext, id: string, patch: Record<string, unknown>) {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-github-repository");
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, status: "active", ...patch }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
}
test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  for (const p of processes.filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/processes/${p.id}`, { headers: CSRF });
});

test("Home: Recently updated and Most viewed show published documents only, with counts and never people", async ({ page, request }) => {
  // a published one, a retired one and a draft, all new; each viewed by three people
  await make(request, `${PREFIX}published`, { title: "Finding demo published" });
  await make(request, `${PREFIX}retired`, { title: "Finding demo retired" });
  await make(request, `${PREFIX}draft`, { title: "Finding demo draft", status: "draft" });
  for (const who of [SAM, ALEX, CASEY]) {
    await as(request, who);
    for (const id of [`${PREFIX}published`, `${PREFIX}retired`]) expect((await request.post(`/api/views/process/${id}`, { headers: CSRF })).ok()).toBeTruthy();
  }
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const retired = processes.find((p: { id: string }) => p.id === `${PREFIX}retired`);
  expect((await request.put(`/api/processes/${PREFIX}retired?base=1`, { data: { ...retired, status: "deprecated" }, headers: CSRF })).ok()).toBeTruthy();

  // Alex may see the draft; Sam may not. Neither sees a draft or a retired one on the shelves
  for (const who of [ALEX, SAM]) {
    await signIn(page, who);
    await open(page, "/");
    const recent = page.locator('section.home-shelf[data-shelf="recent"]');
    const viewed = page.locator('section.home-shelf[data-shelf="viewed"]');
    await expect(recent.getByRole("heading", { name: "Recently updated" })).toBeVisible();
    await expect(viewed.getByRole("heading", { name: "Most viewed" })).toBeVisible();
    // the newest first, with when in words
    const first = recent.locator("a.home-rank-row").first();
    await expect(first).toContainText("Finding demo published");
    await expect(first.locator(".home-rank-figure")).toHaveText("today");
    await expect(first).toHaveAttribute("href", `#/p/${PREFIX}published/flow`);
    // the most viewed, with a number and a bar in the colour of its kind
    const row = viewed.locator("a.home-rank-row", { hasText: "Finding demo published" });
    await expect(row.locator(".home-rank-n")).toHaveText(/^\d+ views?$/);
    await expect(row.locator(".home-rank-bar.process")).toBeVisible();
    for (const shelf of [recent, viewed]) {
      await expect(shelf, who).not.toContainText("Finding demo retired");
      await expect(shelf, who).not.toContainText("Finding demo draft");
      // counts, never people
      await expect(shelf).not.toContainText(/@example\.com|Alex Editor|Sam Consumer|Casey Owner/);
    }
  }
});

test("Home: Browse shows six ways in per group, then “Show all N”", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  const browse = page.getByRole("complementary", { name: "Browse" });
  const groups = browse.locator("section.home-group");
  await expect(groups.first()).toBeVisible();
  let folded = 0;
  for (const group of await groups.all()) {
    const more = group.locator("button.home-links-more");
    if (!(await more.count())) { expect(await group.locator("a.chip").count()).toBeLessThanOrEqual(6); continue; }
    folded++;
    await expect(group.locator("a.chip")).toHaveCount(6);
    const n = Number((await more.innerText()).match(/^Show all (\d+)$/)![1]);
    expect(n).toBeGreaterThan(6);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(group.locator("a.chip")).toHaveCount(n);
    await expect(more).toHaveText("Show fewer");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await more.click();
    await expect(group.locator("a.chip")).toHaveCount(6);
  }
  // the sample's categories are more than six: at least one group is folded
  expect(folded).toBeGreaterThan(0);
});

test("the search head: Words, Meaning and Both beside the box, one line each in “How this works”", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/search?q=gcp");
  const box = page.locator(".search-head .search-box");
  const modes = page.getByRole("radiogroup", { name: "Search by" });
  await expect(modes).toHaveClass(/\bseg\b/);
  await expect(modes.getByRole("radio", { name: "Words" })).toHaveClass(/\bseg-item\b/);
  // at the right end of the line of the box
  const [b, m] = [(await box.boundingBox())!, (await modes.boundingBox())!];
  expect(m.x).toBeGreaterThanOrEqual(b.x + b.width - 1);
  expect(Math.abs((m.y + m.height / 2) - (b.y + b.height / 2))).toBeLessThan(12);
  // the explanation waits behind "How this works"
  const more = page.getByRole("button", { name: "How this works" });
  const help = page.locator("#search-mode-help");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(help).toBeHidden();
  await more.click();
  await expect(help).toBeVisible();
  await expect(help.locator("li")).toHaveCount(3);
  await more.click();
  await expect(help).toBeHidden();
  // each choice explains itself in its tooltip
  for (const name of ["Words", "Meaning", "Both"]) expect(await modes.getByRole("radio", { name }).getAttribute("title")).toBeTruthy();
  // on a phone the switch goes below the box
  await page.setViewportSize({ width: 390, height: 844 });
  const [b2, m2] = [(await box.boundingBox())!, (await modes.boundingBox())!];
  expect(m2.y).toBeGreaterThanOrEqual(b2.y + b2.height - 1);
  await expect(modes).toBeInViewport({ ratio: 1 });
});

test("one letter is marked only where it stands alone, never inside a word", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=a");
  await expect(cards(page).first()).toBeVisible();
  const marks = page.locator("mark.search-mark");
  expect(await marks.count()).toBeGreaterThan(0);
  const around = await marks.evaluateAll((els) => els.map((m) => ({
    text: m.textContent,
    before: (m.previousSibling?.textContent ?? "").slice(-1),
    after: (m.nextSibling?.textContent ?? "").slice(0, 1),
  })));
  for (const a of around) {
    expect(a.text!.toLowerCase()).toBe("a");
    expect(a.before, JSON.stringify(a)).not.toMatch(/[\p{L}\p{N}]/u);
    expect(a.after, JSON.stringify(a)).not.toMatch(/[\p{L}\p{N}]/u);
  }
});

test("words that find nothing: the closest by meaning; with filters, the filters are what to change", async ({ page, request }) => {
  await meaningReady(request);
  await signIn(page, SAM);
  await open(page, "/search?q=zebra");
  // one line above the results says it: no exact match, and what follows is the closest by meaning
  await expect(page.locator("p.list-count")).toHaveText("No exact match for “zebra”. Closest by meaning:");
  await expect(page.locator(".search-closest-line")).toHaveCount(0);
  await expect(cards(page).first()).toBeVisible();
  // nothing found: no filters, tabs, view switch, order or pages to offer
  await expect(page.getByRole("complementary", { name: "Filters" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Show" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Show as" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveCount(0);

  // with a filter chosen, nothing is guessed: it says that nothing matches with or without them
  await open(page, "/search?q=zebra&platform=azure");
  const empty = page.locator(".search-empty");
  await expect(empty.getByRole("heading", { name: "Nothing found" })).toBeVisible();
  await expect(empty).toContainText("Nothing matches “zebra”, with or without these filters.");
  await expect(page.locator("p.list-count")).not.toContainText("Closest by meaning");
  // no button per filter any more; the filters are not what hides it, so the empty state offers no Clear all filters
  await expect(empty.getByRole("button", { name: /^Without / })).toHaveCount(0);
  await expect(empty.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
  await expect(empty.getByRole("button", { name: "Search by meaning instead" })).toBeVisible();
  // the one "Clear all filters" is beside the chips
  await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(1);
  // the panel keeps only the chosen filter
  const panel = page.getByRole("complementary", { name: "Filters" });
  await expect(panel.getByRole("button", { name: /^Platform: Azure$/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Category:/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove filter Platform: Azure" })).toBeVisible();
  await page.getByRole("group", { name: "Chosen filters" }).getByRole("button", { name: "Clear all filters" }).click();
  await expect(page).toHaveURL(/#\/search\?q=zebra$/);
  await expect(page.locator("p.list-count")).toHaveText("No exact match for “zebra”. Closest by meaning:");
});

test("Cards or Rows: remembered per person; in Rows the titles line up", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/search");
  const view = page.getByRole("radiogroup", { name: "Show as" });
  await expect(view.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  await view.getByRole("radio", { name: "Rows" }).click();
  await expect(view.getByRole("radio", { name: "Rows" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("ol.cards.rows > li.card.row").first()).toBeVisible();
  // a fixed kind column: every title starts at the same place, a process's as a standard's
  const xs = await page.locator("ol.cards.rows > li.card.row .card-title").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(xs.length).toBeGreaterThan(5);
  expect(new Set(xs).size, `title positions ${xs.join(", ")}`).toBe(1);
  // the lists and a reload keep it
  await open(page, "/processes");
  await expect(page.locator("ol.cards.rows > li.card.row").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { name: "Rows" })).toHaveAttribute("aria-checked", "true");
  // somebody else in the same browser has their own
  await signIn(page, ALEX);
  await open(page, "/processes");
  await expect(page.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { name: "Cards" }).click();
});

test("the lists keep their search and filters in the address: a reload and a copied address show the same", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.getByRole("searchbox", { name: "Search processes" }).fill("request");
  await pickFilter(page, "Platform", "Google Cloud");
  await expect(page).toHaveURL(/#\/processes\?(.*&)?q=request(&|$)/);
  await expect(page).toHaveURL(/[?&]platform=google-cloud(&|$)/);
  const shown = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  expect(shown.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search processes" })).toHaveValue("request");
  await expect(page.getByRole("button", { name: "Platform: Google Cloud", exact: true })).toBeVisible();
  expect(await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")))).toEqual(shown);
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(other.locator("ol.cards > li.card")).toHaveCount(shown.length);
  await other.close();
  // the Standards list: its own address
  await open(page, "/standards?category=security");
  await expect(page.getByRole("button", { name: /^Category: / })).not.toHaveAccessibleName("Category: Any");
});

test("a due review is a warning, an overdue one a problem, for the people who look after it", async ({ page, request }) => {
  const soon = new Date(Date.now() - 170 * 86_400_000).toISOString().slice(0, 10); // six months ago, less 10 days: due within 30 days
  await make(request, `${PREFIX}due`, { title: "Finding demo due", owner: "cloud-platform-team", review: { intervalMonths: 6, lastReviewedAt: soon, reviewedBy: "Somebody" } });
  await make(request, `${PREFIX}overdue`, { title: "Finding demo overdue", owner: "cloud-platform-team", review: { intervalMonths: 6, lastReviewedAt: "2025-01-01", reviewedBy: "Somebody" } });
  await signIn(page, ALEX);
  await open(page, "/processes");
  const due = page.locator(`li.card[data-id="${PREFIX}due"] .card-mark[data-line="review"]`);
  await expect(due).toContainText(/^Review: Review due \d{4}-\d\d-\d\d$/);
  await expect(due).toHaveClass(/\bwarn\b/);
  await expect(due).not.toHaveClass(/\bbad\b/);
  const overdue = page.locator(`li.card[data-id="${PREFIX}overdue"] .card-mark[data-line="review"]`);
  await expect(overdue).toHaveClass(/\bbad\b/);
  // the colours differ: amber and red
  const [a, b] = [await due.evaluate((e) => getComputedStyle(e).color), await overdue.evaluate((e) => getComputedStyle(e).color)];
  expect(a).not.toBe(b);
  // a reader is not told
  await signIn(page, SAM);
  await open(page, "/processes");
  await expect(page.locator(`li.card[data-id="${PREFIX}due"]`)).toBeVisible();
  await expect(page.locator(`li.card[data-id="${PREFIX}due"] .card-mark[data-line="review"]`)).toHaveCount(0);
});

test("at 1440 x 900 the Processes list shows at least six whole cards", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/processes");
  await expect(cards(page).first()).toBeVisible();
  let whole = 0;
  for (const c of await cards(page).all()) {
    const box = (await c.boundingBox())!;
    if (box.y >= 0 && box.y + box.height <= 900 && box.x >= 0 && box.x + box.width <= 1440) whole++;
  }
  expect(whole).toBeGreaterThanOrEqual(6);
});

test("on a phone Sort and Per page are inside the Filters sheet", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/processes");
  await expect(cards(page).first()).toBeVisible();
  const sort = page.getByRole("combobox", { name: "Sort by" });
  await expect(sort).toBeHidden();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.locator("#process-filters");
  await expect(sheet).toBeVisible();
  const order = sheet.locator(".filter-order");
  await expect(order.getByRole("combobox", { name: "Sort by" })).toBeVisible();
  await expect(order.getByRole("combobox", { name: /per page/i })).toBeVisible();
  await order.getByRole("combobox", { name: "Sort by" }).selectOption({ index: 1 });
  await expect(page).toHaveURL(/[?&]sort=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await sheet.locator("button.filter-done").click();
  await expect(sheet).toBeHidden();
});

test("typed but not searched: a button offers the closest by meaning", async ({ page, request }) => {
  await meaningReady(request);
  await signIn(page, SAM);
  await open(page, "/search");
  await page.getByRole("searchbox", { name: "Search processes and standards" }).fill("zebra");
  await expect(page.locator("p.list-count")).toHaveText("No results for “zebra”");
  const other = page.locator(".search-try-other").getByRole("button", { name: "Show the closest by meaning" });
  await other.click();
  await expect(page.locator("p.list-count")).toHaveText("No exact match for “zebra”. Closest by meaning:");
  await expect(cards(page).first()).toBeVisible();
});

test("cards in a row line up their titles; long tier lists are short (“3 tiers”) with the whole list for screen readers", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/search");
  await expect(cards(page).first()).toBeVisible();
  const ys = await cards(page).evaluateAll((els) => els.slice(0, 3).map((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.querySelector(".card-title")!.getBoundingClientRect().top)]));
  expect(new Set(ys.map((y) => y[0])).size, "three cards in the first row").toBe(1);
  expect(new Set(ys.map((y) => y[1])).size, `titles at ${ys.map((y) => y[1]).join(", ")}`).toBe(1);
  const apigee = page.locator('li.card[data-id="onboard-api-to-apigee"] .card-tiers');
  await expect(apigee.locator("[aria-hidden]")).toHaveText("3 tiers");
  await expect(apigee.locator(".sr-only")).toHaveText("Applies to: Tier 0, Tier 1, Tier 2");
  await expect(apigee).toHaveAttribute("title", "Applies to Tier 0, Tier 1, Tier 2");
  await expect(page.locator('li.card[data-id="onboard-site-to-akamai"] .card-tiers')).toHaveText("Applies to: Tier 0, Tier 1"); // short enough to show whole
});

// ---------- the fourth round: marks at the foot of a card, one line for a sentence, a neutral highlight, phones

test("a card with a mark: no title in the row lower than the others; the marks sit above the card's foot", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // unpublished changes on the first process, so that its card carries a mark for Alex
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const gcp = (await readProcess(request, "request-gcp-project"))!;
  const put = await putWorkingDraft(request, "process", "request-gcp-project", { ...gcp, summary: `${gcp.summary} (a draft for the marks)` });
  expect(put.ok(), await put.text()).toBeTruthy();
  try {
    await signIn(page, ALEX);
    await open(page, "/processes?sort=title");
    const marked = page.locator('li.card[data-id="request-gcp-project"]');
    await expect(marked.locator(".card-marks")).toContainText("Unpublished changes");
    // in the markup and on the screen, the marks come after what was found and before the foot
    const order = await marked.evaluate((c) => [...c.querySelectorAll(".card-title, .card-found, .card-marks")].map((e) => e.className.split(" ")[0]));
    expect(order.indexOf("card-marks")).toBeGreaterThan(order.indexOf("card-title"));
    expect((await marked.locator(".card-marks").boundingBox())!.y).toBeGreaterThan((await marked.locator(".card-title").boundingBox())!.y);
    // every row of cards: the titles at the same height
    const rows = await cards(page).evaluateAll((els) => {
      const by = new Map<number, number[]>();
      for (const e of els) { const top = Math.round(e.getBoundingClientRect().top); by.set(top, [...(by.get(top) ?? []), Math.round(e.querySelector(".card-title")!.getBoundingClientRect().top)]); }
      return [...by.values()];
    });
    expect(rows.some((r) => r.length > 1), "cards side by side").toBe(true);
    for (const titles of rows) expect(new Set(titles).size, `titles of a row at ${titles.join(", ")}`).toBe(1);
  } finally {
    await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
    await discardWorkingDraft(request, "process", "request-gcp-project");
  }
});

test("a sentence typed as a search: one line says there is no exact match and that the closest by meaning follow", async ({ page, request }) => {
  await meaningReady(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, SAM);
  const q = "how do I get a new project in google cloud for my team";
  await open(page, `/search?q=${encodeURIComponent(q)}`);
  const line = page.locator("p.list-count");
  await expect(line).toHaveText(`No exact match for “${q}”. Closest by meaning:`);
  await expect(cards(page).first()).toBeVisible();
  // one line, not a count and a second sentence under it
  const lines = await line.evaluate((e) => Math.round(e.getBoundingClientRect().height / (parseFloat(getComputedStyle(e).lineHeight) || 20)));
  expect(lines).toBe(1);
  await expect(page.locator(".search-closest-line")).toHaveCount(0);
});

test("the search highlight is a neutral mark that keeps the text's colour, also under a brand colour of the admin's", async ({ page, request }) => {
  const look = async (look: Record<string, string>) => {
    await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
    const { revision } = await (await request.get("/api/admin/theme")).json();
    const res = await request.put(`/api/admin/theme?rev=${revision}`, { data: look, headers: CSRF });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  await look({ brand: "#c2185b" });
  try {
    await signIn(page, SAM);
    await open(page, "/search?q=logging");
    const mark = page.locator("mark.search-mark").first();
    await expect(mark).toBeVisible();
    const colours = await mark.evaluate((m) => {
      const probe = (v: string) => { const x = document.createElement("span"); x.style.backgroundColor = v; x.style.color = v; document.body.appendChild(x); const c = getComputedStyle(x); const r = [c.backgroundColor, c.color]; x.remove(); return r; };
      return { bg: getComputedStyle(m).backgroundColor, color: getComputedStyle(m).color, parent: getComputedStyle(m.parentElement!).color, mark: probe("var(--search-mark)")[0], accent: probe("var(--accent)")[1], fill: probe("var(--accent-fill)")[0] };
    });
    expect(colours.bg, "the neutral mark colour").toBe(colours.mark);
    expect(colours.bg).not.toBe(colours.fill);
    expect(colours.bg).not.toBe(colours.accent);
    expect(colours.color, "the text keeps its colour").toBe(colours.parent);
  } finally {
    await look({});
  }
});

test("on a phone the search fields have short examples as placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  for (const [path, label, text] of [
    ["/", "Search processes and standards", "e.g. GCP project or logging"],
    ["/search", "Search processes and standards", "e.g. GCP project or logging"],
    ["/processes", "Search processes", "e.g. GCP, repository, Akamai"],
    ["/standards", "Search standards", "e.g. logging, SEC-LOG-01"],
  ] as const) {
    await open(page, path);
    const box = page.getByRole("searchbox", { name: label, exact: true });
    await expect(box, path).toHaveAttribute("placeholder", text);
    // the whole placeholder fits in the field
    expect(await box.evaluate((e: HTMLInputElement) => e.scrollWidth <= e.clientWidth + 1), `${path}: the placeholder fits`).toBe(true);
  }
  // wider, the longer ones
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "/processes");
  await expect(page.getByRole("searchbox", { name: "Search processes", exact: true })).toHaveAttribute("placeholder", "Search processes: GCP, repository, Akamai…");
});
