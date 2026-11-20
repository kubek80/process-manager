import { expect, test, type APIRequestContext } from "@playwright/test";
import { ALEX, CASEY, CSRF, SAM, open, readProcess, signIn } from "./helpers";

// The reader's page of a process and of a standard: the head (kind, owner in words, how binding
// as a neutral mark, the facts, the quiet line with dates), the tabs, and a first review that is
// counted from the first publication. Also the segmented controls of Requests and My
// responsibilities. What is made here is removed afterwards.

const FRESH = "pages-demo-fresh";
const OLD = "pages-demo-retired";

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  await request.delete(`/api/processes/${FRESH}`, { headers: CSRF });
  await request.delete(`/api/processes/${OLD}`, { headers: CSRF });
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
  // a quiet line with when its content last changed and its version
  await expect(head.locator(".doc-foot .doc-changed")).toHaveText(/^Content changed \d{4}-\d\d-\d\d$/);
  await expect(head.locator(".doc-foot .doc-changed")).toHaveAttribute("title", /Versions/);
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

test("segmented controls: Requests' state and kind, My responsibilities' groups; the chosen one raised and outlined, in brand-coloured text, not filled", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/requests");
  for (const name of ["State", "Kind"]) {
    const group = page.getByRole("group", { name });
    await expect(group).toHaveClass(/\bseg\b/);
    const on = group.locator('button.seg-item[aria-pressed="true"]');
    await expect(on).toHaveCount(1);
    await expect(on).toHaveClass(/\bon\b/);
    const token = (css: string, prop: "backgroundColor" | "color") => page.evaluate(([v, p]) => { const x = document.createElement("span"); x.style.background = v; x.style.color = v; document.body.appendChild(x); const c = getComputedStyle(x)[p as "color"]; x.remove(); return c; }, [css, prop]);
    const look = await on.evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, color: c.color, shadow: c.boxShadow }; });
    // a raised neutral surface, never the brand fill; the text in the brand colour; an outline (inset ring)
    expect(look.bg).not.toBe(await token("var(--accent-fill)", "backgroundColor"));
    expect(look.bg).toBe(await token("var(--seg-on)", "backgroundColor"));
    expect(look.color).toBe(await token("var(--accent)", "color"));
    expect(look.shadow).toContain("inset");
    // the others are not raised
    const off = group.locator('button.seg-item[aria-pressed="false"]').first();
    expect(await off.evaluate((e) => getComputedStyle(e).boxShadow)).toBe("none");
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

// ---------- the fourth round: one page frame, a quieter head

test("a standard's page has the frame of a process page: the h1 at the same place at 1366 and at 1440", async ({ page }) => {
  await signIn(page, SAM);
  for (const width of [1366, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/p/request-gcp-project/flow");
    const p = (await page.locator("header.doc-head h1").boundingBox())!;
    await open(page, "/s/secure-logging/doc");
    const s = (await page.locator("header.doc-head h1").boundingBox())!;
    expect(Math.abs(p.x - s.x), `the h1 of both pages at the same x at ${width} (${p.x} and ${s.x})`).toBeLessThanOrEqual(1);
    // the body as wide as the process page's
    const pw = await (async () => { await open(page, "/p/request-gcp-project/flow"); const w = (await page.locator(".process-page").boundingBox())!.width; await open(page, "/s/secure-logging/doc"); return w; })();
    expect(Math.abs((await page.locator(".page").first().boundingBox())!.width - pw), `the standard page as wide as the process page at ${width}`).toBeLessThanOrEqual(1);
  }
  // the requirement's code after its name, small and grey, in no box
  const req = page.locator("#req-SEC-LOG-01");
  const order = await req.locator(".req-head").evaluate((h) => [...h.querySelectorAll(".req-title, .req-id")].map((e) => e.className));
  expect(order).toEqual(["req-title", "req-id"]);
  const code = req.locator(".req-head .req-id");
  const look = await code.evaluate((e) => { const c = getComputedStyle(e); return { border: c.borderTopWidth, bg: c.backgroundColor, size: parseFloat(c.fontSize) }; });
  expect(look.border).toBe("0px");
  expect(look.bg).toBe("rgba(0, 0, 0, 0)");
  expect(look.size).toBeLessThan(parseFloat(await req.locator(".req-title").evaluate((e) => getComputedStyle(e).fontSize)));
});

test("the head: Edit is the one primary button, Mark as reviewed quiet unless due, Give feedback a plain button", async ({ page, request }) => {
  await as(request, ALEX);
  const src = (await readProcess(request, "publish-internal-library"))!;
  await request.delete(`/api/processes/${OLD}`, { headers: CSRF });
  const data = { ...src, id: OLD, title: "Pages demo retired", status: "active", review: { intervalMonths: 6, lastReviewedAt: "2025-01-01", reviewedBy: "Somebody" } };
  const made = await request.put(`/api/processes/${OLD}?base=0`, { data, headers: CSRF });
  expect(made.ok(), await made.text()).toBeTruthy();
  await signIn(page, ALEX);
  await open(page, "/p/publish-internal-library/flow");
  const head = page.locator("header.doc-head");
  await expect(head.locator(".btn.primary")).toHaveCount(1);
  await expect(head.locator(".btn.primary")).toHaveText("Edit");
  await expect(head.locator("a.btn.primary")).toHaveAttribute("href", "#/p/publish-internal-library/edit");
  const reviewed = head.getByRole("button", { name: "Mark as reviewed" });
  await expect(reviewed).toHaveClass(/\bquiet\b/);
  await expect(reviewed).not.toHaveClass(/\breview-due\b/);
  // from 1000 px wide the reader's buttons sit on the tab row
  await expect(head.getByRole("button", { name: "Give feedback" })).toHaveCount(0);
  const feedback = page.locator(".tabs-row .engage-actions").getByRole("button", { name: "Give feedback" });
  await expect(feedback).not.toHaveClass(/\baccent-soft\b/);
  await expect(feedback).not.toHaveClass(/\bprimary\b/);
  // not styled as "on": the background of an ordinary button, not the brand's
  const plain = await head.locator(".btn.quiet").first().evaluate((e) => getComputedStyle(e).color);
  expect(await feedback.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(await head.locator(".btn.primary").evaluate((e) => getComputedStyle(e).backgroundColor));
  expect(plain).toBeTruthy();

  // overdue: the warning style on Mark as reviewed, the banner under the title and summary, before the facts
  await page.reload();
  await open(page, `/p/${OLD}/flow`);
  await expect(head.getByRole("button", { name: "Mark as reviewed" })).toHaveClass(/\breview-due\b/);
  const notices = head.locator(".doc-notices");
  await expect(notices.locator(".banner")).toHaveCount(1);
  await expect(notices.locator(".banner")).toContainText("Review overdue");
  // retired: its banner in the same place
  const retired = await request.put(`/api/processes/${OLD}?base=1`, { data: { ...data, status: "deprecated" }, headers: CSRF });
  expect(retired.ok(), await retired.text()).toBeTruthy();
  await page.reload();
  await expect(notices.locator(".banner").first()).toContainText("This process is retired.");
  const order = await head.evaluate((h) => [...h.querySelectorAll("h1, .lead, .doc-notices, .doc-facts")].map((e) => e.tagName === "H1" ? "h1" : e.className.split(" ")[0]));
  expect(order).toEqual(["h1", "lead", "doc-notices", "doc-facts"]);
  const [notice, facts] = [(await notices.boundingBox())!, (await head.locator(".doc-facts").boundingBox())!];
  expect(notice.y + notice.height).toBeLessThanOrEqual(facts.y + 1);
});

test("the Checklist at 1440: the steps up to 1000 px wide with the progress and its switches as a column beside them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/list");
  const steps = page.locator(".list-view > ol.steps");
  const bar = page.locator(".list-view > .list-bar");
  await expect(bar).toContainText("of your steps done");
  await expect(bar.getByText("Only my steps")).toBeVisible();
  const [s, b] = [(await steps.boundingBox())!, (await bar.boundingBox())!];
  expect(s.width).toBeLessThanOrEqual(1000);
  expect(b.x, "the column is beside the steps").toBeGreaterThanOrEqual(s.x + s.width);
  expect(Math.abs(b.y - s.y), "at the top of the steps").toBeLessThan(20);
  // it stays in view while the steps scroll
  await page.mouse.wheel(0, 900);
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThan(200);
  await expect(bar).toBeInViewport();
  // a tick: "Reset ticks" in the same column
  await page.getByRole("button", { name: /^Mark as done: / }).first().click();
  await expect(bar.getByRole("button", { name: "Reset ticks" })).toBeVisible();
  await bar.getByRole("button", { name: "Reset ticks" }).click();
  await expect(bar.getByRole("button", { name: "Reset ticks" })).toHaveCount(0);
});

test("the reader's map: arrow keys go from step to step; the step opened stays in view when its panel opens", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  const blocks = page.locator(".block-main");
  await expect(blocks).toHaveCount(10);
  // "Before you start" folded, so that the map is on the first screen
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  if (await hide.isVisible()) await hide.click();
  expect(await blocks.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length), "one Tab stop for the blocks").toBe(1);
  const name = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  await blocks.first().focus();
  await expect.poll(name).toMatch(/^1\. Decide the project details, .+, by You$/);
  await page.keyboard.press("ArrowRight");
  await expect.poll(name).toMatch(/^2\. /);
  await page.keyboard.press("End");
  await expect.poll(name).toMatch(/^10\. /);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(name).toMatch(/^9\. /);
  const nine = (await name()).replace(/^9\. /, "").split(",")[0];
  await page.keyboard.press("Enter");
  await expect(page.locator(".drawer h3")).toHaveText(nine);
  // the panel took room from the map: the step is brought back into view
  const selected = page.locator(".block.selected");
  const inMap = async () => {
    const [b, v] = [(await selected.boundingBox())!, (await page.locator(".flow-scroll").boundingBox())!];
    return b.x >= v.x - 1 && b.x + b.width <= v.x + v.width + 1 && b.y >= v.y - 1 && b.y + b.height <= v.y + v.height + 1;
  };
  await expect.poll(inMap, { message: "the selected step is inside the visible part of the map" }).toBe(true);
});

// ---------- the fifth round: print, the tab row, arriving on a phone

test("a process prints as a document: no bar or controls, “Before you start” in full, every step, and a last line that says which version", async ({ page }) => {
  await signIn(page, SAM);
  const gcp = (await readProcess(page, "request-gcp-project"))!;
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".process-page")).toHaveClass(/\bprinting\b/);
  // nothing to press on paper: no top bar, skip link, tabs, buttons or switches
  // (a tool's link in a step stays, with its address after it)
  for (const sel of [".topbar", ".skip-link", ".tabs-row", ".engage-actions", "button.btn", "a.btn:not(.link-btn)"]) {
    for (const el of await page.locator(sel).all()) await expect(el, sel).toBeHidden();
  }
  // the head, "Before you start" open with its whole texts, then every step as the checklist
  await expect(page.locator("header.doc-head h1")).toHaveText("Request a GCP project");
  await expect(page.locator("#before-body")).toBeVisible();
  await expect(page.locator(".prereq")).toHaveCount(gcp.prerequisites.length);
  await expect(page.locator(".block")).toHaveCount(0); // not the map
  await expect(page.locator(".list-view .step")).toHaveCount(gcp.steps.length);
  await expect(page.locator(".list-view .step .step-title")).toHaveText(gcp.steps.map((s: { title: string }) => s.title));
  // every step open with what to do, also somebody else's
  await expect(page.locator(".list-view .step .step-body")).toHaveCount(gcp.steps.length);
  for (const body of await page.locator(".list-view .step .step-body").all()) await expect(body).toBeVisible();
  // the last line: which process, which version, when its content changed, when and from where it was printed
  await expect(page.locator(".print-foot")).toHaveText(/^Request a GCP project · Version \d+ · content changed \d{4}-\d\d-\d\d · printed \d{4}-\d\d-\d\d \d\d:\d\d from http:\/\/127\.0\.0\.1:8090\/#\/p\/request-gcp-project/);
  // always light, whatever the theme
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  // back on the screen: the map again, no last line
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".process-page")).not.toHaveClass(/\bprinting\b/);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.locator(".print-foot")).toHaveCount(0);
});

test("a standard prints every requirement, whatever level is chosen on the screen", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/s/secure-logging/doc");
  await expect(page.locator(".req").first()).toBeVisible();
  const all = await page.locator(".req").count();
  expect(all).toBeGreaterThan(1);
  // only the "Should" ones on the screen
  await page.locator(".req-bar").getByRole("button", { name: /^Should/ }).click();
  await expect.poll(() => page.locator(".req").count()).toBeLessThan(all);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".standard-page")).toHaveClass(/\bprinting\b/);
  await expect(page.locator(".req")).toHaveCount(all);
  await expect(page.locator(".req-bar")).toBeHidden();
  await expect(page.locator(".standard-intro")).toBeVisible();
  await expect(page.locator(".print-foot")).toHaveText(/^Secure logging · Version \d+ · content changed \d{4}-\d\d-\d\d · printed /);
  await page.emulateMedia({ media: "screen" });
  await expect.poll(() => page.locator(".req").count()).toBeLessThan(all);
});

test("from 1000 px wide the reader's buttons sit on the tab row, icons only below 1200; narrower they are in the head", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/p/request-gcp-project/flow");
  const onTabs = page.locator(".tabs-row .engage-actions");
  // the buttons are a named group there too, as in the head
  await expect(page.getByRole("group", { name: "What you can do with this process" })).toBeVisible();
  await expect(onTabs.getByRole("button", { name: "Give feedback" })).toBeVisible();
  await expect(onTabs.getByRole("button", { name: /^Upvote / })).toBeVisible();
  await expect(onTabs.getByRole("button", { name: /^Bookmark / })).toBeVisible();
  await expect(onTabs.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(onTabs.getByRole("button", { name: "Share" })).toContainText("Share");
  // the numbers stay in the head, the buttons are not there twice
  const head = page.getByRole("group", { name: "Use and feedback" });
  await expect(head.locator(".engage-stats")).toBeVisible();
  await expect(head.getByRole("button")).toHaveCount(0);
  // the same row as the tabs
  const tab = (await page.getByRole("tab", { name: "Map" }).boundingBox())!;
  const share = (await onTabs.getByRole("button", { name: "Share" }).boundingBox())!;
  expect(Math.abs((share.y + share.height / 2) - (tab.y + tab.height / 2)), "on the tab row").toBeLessThan(tab.height);
  // a standard as well
  await open(page, "/s/secure-logging/doc");
  await expect(page.locator(".tabs-row .engage-actions").getByRole("button", { name: "Give feedback" })).toBeVisible();

  // below 1200: the icons alone, the names still read out
  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page, "/p/request-gcp-project/flow");
  const label = onTabs.getByRole("button", { name: "Share" }).locator(".engage-label");
  await expect.poll(async () => (await label.boundingBox())?.width ?? 0, "the word is only read out").toBeLessThanOrEqual(1);

  // below 1000: in the head's group "Use and feedback"
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".tabs-row .engage-actions")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Use and feedback" }).getByRole("button", { name: "Give feedback" })).toBeVisible();
});

test("on a phone a process opens on its Checklist, without a new entry in the history; the Map stays one tap away", async ({ page }) => {
  await signIn(page, SAM);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/processes");
  await expect(page.locator("ol.cards > li").first()).toBeVisible();
  await open(page, "/p/request-gcp-project/flow");
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/list$/);
  await expect(page.getByRole("tab", { name: /^Checklist/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".list-view .step").first()).toBeVisible();
  // the address was replaced: Back goes to where the person came from
  await page.goBack();
  await expect(page).toHaveURL(/#\/processes$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/list$/);
  // the Map, chosen, stays the Map
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow$/);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow$/);
  // a link to a step on the map opens the map at that step
  await open(page, "/p/request-gcp-project/flow/approve-budget");
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow\/approve-budget$/);
  // on a wider screen the map is where the address says
  await page.setViewportSize({ width: 1200, height: 900 });
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow$/);
});
