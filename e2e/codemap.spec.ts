import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AREAS, CATEGORIES } from "../src/codemap/index.ts";
import { ALEX, CSRF, DANA, JORDAN, SAM, clearFeedback, open, putDoc, readProcess, report, signIn } from "./helpers";

// Admin › Code map (`#/admin/code`): the portal's own source sorted into categories, for whoever
// reviews its code; the files themselves come one at a time from `GET /api/admin/source`, for
// admins only. The writers of the categories change their sentences while the portal grows, so
// these tests read the categories' structure from `src/codemap` and never assert on a sentence
// of their content: only on the page's own words, on counts and on the names of the categories.

const byId = (id: string) => CATEGORIES.find((c) => c.id === id)!;
const VECTORS = byId("vectors"), TABLES = byId("tables");
const LONG = "server/internal/retrieval/retrieval.go"; // a long file of From tables to vectors

const source = (path: string) => `/api/admin/source?path=${encodeURIComponent(path)}`;
const fileHash = (category: string, path: string, at?: string) => `/admin/code/${category}/file/${path}${at ? `?at=${at}` : ""}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const h1 = (page: Page) => page.locator(".cm-main h1");
const cats = (page: Page) => page.getByRole("navigation", { name: "Code map categories" });
const searchField = (page: Page) => page.getByRole("searchbox", { name: "Find a file, a table or a word" });
const code = (page: Page) => page.locator(".cm-code");
const readbarN = (page: Page) => page.locator(".cm-readbar-n");

/** Where an element's top is in the window: a place that was jumped to sits near the top. */
const topOf = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().top);
async function landedNearTop(l: Locator) {
  await expect(l).toBeInViewport();
  // the jump corrects itself once what is above has settled: wait for that
  await expect.poll(() => topOf(l), { timeout: 5000 }).toBeLessThan(260);
  expect(await topOf(l)).toBeGreaterThan(-4);
}

// ---------- who gets it

test("Code map is for admins only: in the Admin menu, on the page and from the server", async ({ page, request }) => {
  // not signed in
  expect((await request.get(source("package.json"))).status()).toBe(401);

  // a reader and an owner of a platform, a practice and a team have no Admin at all
  for (const who of [SAM, JORDAN]) {
    await signIn(page, who);
    await open(page, "/");
    await expect(page.locator("nav.nav").getByRole("link", { name: "Admin" })).toHaveCount(0);
    await open(page, "/admin/code");
    await expect(page.getByText("You do not have access to the Admin panel.")).toBeVisible();
    await expect(page.locator(".cm-admin, .cm-page")).toHaveCount(0);
    for (const path of [source("package.json"), source("no/such/file.ts"), "/api/admin/source"]) expect((await page.request.get(path)).status(), `${who} ${path}`).toBe(403);
  }

  // a process editor who manages the lists: Admin without Code map; the address shows a section of his
  await signIn(page, ALEX);
  await open(page, "/");
  await page.locator("nav.nav").getByRole("link", { name: "Admin" }).click();
  await expect(page.locator(".admin-nav a")).toHaveText(["Lists", "Skills", "Health"]);
  await open(page, "/admin/code");
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Lists");
  await expect(page.locator(".cm-page")).toHaveCount(0);
  expect((await page.request.get(source("package.json"))).status()).toBe(403);

  // an admin: the last section of the menu, and the file's text as it is in the checkout
  await signIn(page, DANA);
  await open(page, "/");
  await page.locator("nav.nav").getByRole("link", { name: "Admin" }).click();
  await expect(page.locator(".admin-nav a").last()).toHaveText("Code map");
  await expect(page.locator(".admin-nav a").last()).toHaveAttribute("title", "How the portal is built, for whoever reviews its code");
  await page.locator(".admin-nav").getByRole("link", { name: "Code map" }).click();
  await expect(page).toHaveURL(/#\/admin\/code$/);
  await expect(page.locator(".page.admin.cm-admin")).toHaveCount(1);
  await expect(h1(page)).toHaveText("Code map");
  await expect(page).toHaveTitle(/^Code map · Admin/);
  await expect(page.locator(".admin-nav a.on")).toHaveText("Code map");
  const res = await page.request.get(source("package.json"));
  expect(res.status()).toBe(200);
  const body = await res.json();
  const text = readFileSync("package.json", "utf8");
  expect(body).toEqual({ path: "package.json", text, bytes: Buffer.byteLength(text) });
});

test("the source answers one identical 404 for everything it will not show, and is never cached", async ({ page }) => {
  await signIn(page, DANA);
  const unknown = await page.request.get(source("src/no-such-file.ts"));
  expect(unknown.status()).toBe(404);
  const refusal = await unknown.body();
  expect(JSON.parse(refusal.toString())).toEqual({ error: "That file cannot be shown." });
  const refused: [string, string][] = [
    ["a file named like a secret", source(".env.example")],
    ["a way out of the checkout", source("../etc/passwd")],
    ["an installed package", source("node_modules/x.js")],
    ["a hidden file", source(".gitignore")],
    ["a folder", source("server")],
    ["a folder with a slash", source("src/")],
    ["an encoded ..", "/api/admin/source?path=%2e%2e%2fetc%2fpasswd"],
    ["an encoded .. inside", "/api/admin/source?path=src%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"],
    ["an encoded .. encoded twice", "/api/admin/source?path=%252e%252e%252fetc%252fpasswd"],
    ["an absolute path", source("/etc/passwd")],
    ["two paths", `${source("package.json")}&path=README.md`],
    ["no path", "/api/admin/source"],
    ["the git folder", source(".git/config")],
    ["the build output", source("dist/index.html")],
  ];
  for (const [what, url] of refused) {
    const res = await page.request.get(url);
    expect(res.status(), what).toBe(404);
    expect((await res.body()).equals(refusal), `${what}: ${await res.text()}`).toBeTruthy();
    expect(res.headers()["content-type"], what).toBe(unknown.headers()["content-type"]);
  }
  // a real tracked file: its text, never kept by a cache
  const ok = await page.request.get(source("server/internal/httpapi/source.go"));
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toBe("no-store");
  expect((await ok.json()).text).toContain("package httpapi");
  // the portal says it can show its source here (the browser tests' server runs beside it)
  expect((await (await page.request.get("/api/admin/system")).json()).source).toBe(true);
});

// ---------- the overview

test("the overview: the first hour, the four areas with every category as a card, the list beside it", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code");
  await expect(h1(page)).toHaveText("Code map");
  await expect(page.locator(".cm-overview .lead")).toContainText("How the portal is built, for whoever reviews its code");
  await expect(page.locator(".cm-nosource")).toHaveCount(0); // the source can be shown here
  await expect(searchField(page)).toBeVisible();

  // the first hour: six links in order, each to its category
  const first = page.locator("section.cm-first");
  await expect(first.getByRole("heading", { level: 2 })).toHaveText("The first hour");
  const route = ["tables", "saving", "vectors", "search", "rights", "api"];
  const links = first.locator("ol > li > a");
  await expect(links).toHaveText(route.map((id) => byId(id).title));
  for (let i = 0; i < route.length; i++) await expect(links.nth(i)).toHaveAttribute("href", `#/admin/code/${route[i]}`);
  await links.nth(2).click();
  await expect(page).toHaveURL(/#\/admin\/code\/vectors$/);
  await expect(h1(page)).toHaveText(VECTORS.title);
  await page.goBack();
  await expect(h1(page)).toHaveText("Code map");

  // the areas, each with its categories as cards: their names, a line and their counts
  const areas = page.locator("section.cm-area");
  await expect(areas.locator("h2")).toHaveText(["Data", "Server", "App", "Around the code"]);
  await expect(page.locator("a.cm-card")).toHaveCount(20);
  expect(CATEGORIES).toHaveLength(20);
  for (const [i, area] of AREAS.entries()) {
    const mine = CATEGORIES.filter((c) => c.area === area.id);
    const cards = areas.nth(i).locator("a.cm-card");
    await expect(cards.locator("h3")).toHaveText(mine.map((c) => c.title));
    for (const [k, c] of mine.entries()) {
      await expect(cards.nth(k)).toHaveAttribute("href", `#/admin/code/${c.id}`);
      await expect(cards.nth(k).locator(".cm-count")).toHaveText(new RegExp(`^${c.files.length} files?( · ${c.charts.length} charts?)?( · \\d+ tables?)?$`));
      await expect(cards.nth(k).locator("p")).not.toHaveText(/^\s*$/);
    }
  }

  // the list of categories beside the page, in the same order, under the names of the areas
  const nav = cats(page);
  await expect(nav).toBeVisible();
  await expect(nav.locator(".cm-cats-all")).toHaveText("Overview");
  await expect(nav.locator(".cm-cats-title")).toHaveText(AREAS.map((a) => a.title));
  await expect(nav.locator("ul a")).toHaveText(CATEGORIES.map((c) => c.title));
  await expect(nav.locator("a[aria-current=page]")).toHaveCount(0);
  await nav.getByRole("link", { name: TABLES.title, exact: true }).click();
  await expect(h1(page)).toHaveText(TABLES.title);
  await expect(nav.locator("a.on[aria-current=page]")).toHaveText(TABLES.title);
});

// ---------- the search

test("the search finds a word in files, requirements and tables, grouped by category, kept in the address; its hits land", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code");
  await searchField(page).fill("feedback");
  await expect(page).toHaveURL(/#\/admin\/code\?q=feedback$/);
  const results = page.locator("section.cm-results");
  await expect(results.locator("h2")).toHaveText(/^\d+ places in \d+ categories$/);
  await expect(page.locator("section.cm-first")).toHaveCount(0); // the hits replace the cards
  const groups = results.locator(".cm-group");
  expect(await groups.count()).toBeGreaterThan(1);
  const names = CATEGORIES.map((c) => c.title);
  for (const name of await groups.locator("h3 a").allTextContents()) expect(names).toContain(name);
  // every kind of hit says what it is (for a screen reader), with the word marked
  const kinds = await results.locator("ul.cm-hits a .cm-sr").allTextContents();
  for (const kind of ["File: ", "Requirement: ", "Table: "]) expect(kinds).toContain(kind);
  expect(await results.locator("mark.search-mark").count()).toBeGreaterThan(5);
  await expect(results.locator("mark.search-mark").first()).toHaveText(/feedback/i);
  // a group with more than eight shows the rest on request
  const big = groups.filter({ has: page.getByRole("button", { name: /^Show all \d+ in / }) }).first();
  if (await big.count()) {
    const n = Number((await big.getByRole("button").textContent())!.match(/\d+/)![0]);
    await big.getByRole("button").click();
    await expect(big.locator("ul.cm-hits > li")).toHaveCount(n);
  }

  // a table: lands on the table's heading, even with the charts above it
  const tables = groups.filter({ has: page.getByRole("link", { name: TABLES.title, exact: true }) });
  const tableHit = tables.locator("ul.cm-hits a", { has: page.locator(".cm-sr", { hasText: "Table:" }) }).first();
  const at = (await tableHit.getAttribute("href"))!.match(/\?at=table-(.+)$/)![1];
  await tableHit.click();
  await expect(page).toHaveURL(new RegExp(`#/admin/code/tables\\?at=table-${at}$`));
  await expect(h1(page)).toHaveText(TABLES.title);
  const block = page.locator(`article.cm-table#code-table-${slug(decodeURIComponent(at))}`);
  await landedNearTop(block.locator("h3"));
  await expect(block).toBeFocused();
  // the browser's Back restores the search
  await page.goBack();
  await expect(searchField(page)).toHaveValue("feedback");
  await expect(results.locator("h2")).toHaveText(/^\d+ places in \d+ categories$/);

  // a requirement of a file: the file opens with that comment in view, marked a moment
  const reqHit = results.locator("ul.cm-hits a[href*='/file/'][href*='?at=req-']").first();
  const href = (await reqHit.getAttribute("href"))!;
  await reqHit.click();
  await expect(page).toHaveURL(href);
  await expect(page.locator(".cm-line").first()).toBeVisible();
  const flash = page.locator(".cm-flash");
  await expect(flash).toHaveCount(1);
  await expect(flash).toBeInViewport();
  await expect(flash).toBeFocused();
  // "Overview and search" in the list of categories returns to the search
  const back = cats(page).locator(".cm-cats-all");
  await expect(back).toHaveText("Overview and search");
  await back.click();
  await expect(page).toHaveURL(/#\/admin\/code\?q=feedback$/);
  await expect(searchField(page)).toHaveValue("feedback");
  await expect(results.locator(".cm-group").first()).toBeVisible();

  // nothing
  await searchField(page).fill("zzqx nowhere");
  await expect(results.locator("h2")).toHaveText("Nothing found");
  await expect(results).toContainText("Try fewer or shorter words.");
  await expect(results.locator(".cm-group")).toHaveCount(0);
  // emptied: the cards again, and the address without the search
  await searchField(page).fill("");
  await expect(page).toHaveURL(/#\/admin\/code$/);
  await expect(page.locator("a.cm-card")).toHaveCount(20);
  await expect(cats(page).locator(".cm-cats-all")).toHaveText("Overview");
});

test("a category's summary and a chart's title are found too", async ({ page }) => {
  await signIn(page, DANA);
  const chart = VECTORS.charts[0].process.title;
  await open(page, `/admin/code?q=${encodeURIComponent(chart)}`);
  await expect(searchField(page)).toHaveValue(chart);
  const hit = page.locator("ul.cm-hits a", { has: page.locator(".cm-sr", { hasText: "Chart:" }) }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\?at=chart-code-/);
  await expect(page.locator("figure.cm-chart.cm-flash, figure.cm-chart:focus")).toHaveCount(1);
  await expect(page.locator("figure.cm-chart:focus")).toBeInViewport();
});

// ---------- a category

test("a category: its parts in order with chips, readable charts that enlarge, examples, files and the files' switch", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code/vectors");
  await expect(h1(page)).toHaveText(VECTORS.title);
  await expect(h1(page)).toBeFocused();
  await expect(page).toHaveTitle(/Code map · Admin/);
  await expect(page.locator("p.cm-crumbs")).toHaveText(/^Code map›Data$/);
  await expect(page.locator(".cm-category header .cm-count")).toHaveText(new RegExp(`^${VECTORS.files.length} files · ${VECTORS.charts.length} charts?$`));

  // the parts, in order, and the chips that jump to them
  const parts = [["code-must", "What it must do", VECTORS.requirements.length], ["code-charts", "How it works", VECTORS.charts.length],
    ["code-tables", "Tables", VECTORS.tables?.length ?? 0], ["code-examples", "Examples", VECTORS.examples?.length ?? 0], ["code-files", "Files", VECTORS.files.length]]
    .filter(([, , n]) => (n as number) > 0) as [string, string, number][];
  expect(await page.locator("section.cm-part").evaluateAll((s) => s.map((e) => e.id))).toEqual(parts.map(([id]) => id));
  const chips = page.getByRole("navigation", { name: "On this page" }).getByRole("button");
  await expect(chips).toHaveText(parts.map(([, label, n]) => `${label}${n}`));
  for (const [id, label] of [...parts].reverse()) {
    await chips.filter({ hasText: label }).click();
    await expect(page.locator(`#${id}`)).toBeFocused();
    await expect(page.locator(`#${id} h2`)).toBeInViewport();
  }
  await expect(page.locator("#code-must li[id^=code-must-]")).toHaveCount(VECTORS.requirements.length);
  await expect(page.locator("#code-must .cm-comment[role=note]")).toHaveCount(VECTORS.requirements.length);

  // the charts: every step drawn, never shrunk below readable; Enlarge opens it with the zoom
  const charts = page.locator("figure.cm-chart");
  await expect(charts).toHaveCount(VECTORS.charts.length);
  const chart = charts.first();
  const first = VECTORS.charts[0].process;
  await expect(chart).toHaveId(`code-chart-${slug(first.id)}`);
  await expect(chart.locator("h3")).toHaveText(first.title);
  await expect(chart.locator(".block")).toHaveCount(first.steps.length);
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".block").first()).toBeVisible();
  const scale = await chart.locator(".flow-canvas").evaluate((e) => Number(getComputedStyle(e).zoom));
  expect(scale).toBeGreaterThanOrEqual(0.9);
  const titleHeight = (await chart.locator(".block-title").first().boundingBox())!.height;
  expect(titleHeight, "a step's name is drawn at a readable size").toBeGreaterThanOrEqual(11);
  await expect(chart.locator("figcaption")).not.toHaveText(/^\s*$/);
  const enlarge = chart.getByRole("button", { name: `Enlarge the chart “${first.title}”` });
  await enlarge.click();
  const dialog = page.getByRole("dialog", { name: first.title });
  await expect(dialog).toHaveClass(/cm-enlarge/);
  await expect(dialog.getByRole("group", { name: "Zoom" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(dialog.locator(".block")).toHaveCount(first.steps.length);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(enlarge).toBeFocused();

  // a worked example: its stages, each with its data
  const example = page.locator("article.cm-example").first();
  await expect(example).toHaveId("code-example-0");
  const stages = VECTORS.examples![0].stages;
  await expect(example.locator("ol.cm-stages > li")).toHaveCount(stages.length);
  await expect(example.locator("pre.cm-shape")).toHaveCount(stages.length);
  await expect(example.locator(".cm-stage-n")).toHaveText(stages.map((_, i) => String(i + 1)));

  // the files: every one with Open, the one to read first marked, its tests and other categories
  const files = page.locator("ul.cm-files > li.cm-file");
  await expect(files).toHaveCount(VECTORS.files.length);
  await expect(files.locator("h3 a.cm-path")).toHaveText(VECTORS.files.map((f) => f.path));
  await expect(files.locator("a.cm-open")).toHaveCount(VECTORS.files.length);
  await expect(page.locator(".cm-start")).toHaveCount(1);
  await expect(page.locator(`#code-file-${slug(VECTORS.start!)} .cm-start`)).toHaveText("Read first");
  await expect(page.getByRole("link", { name: `Open ${VECTORS.start}` })).toBeVisible();
  const tested = VECTORS.files.filter((f) => f.tests?.length);
  await expect(page.locator("li.cm-file .cm-tests")).toHaveCount(tested.length);
  await expect(page.locator("li.cm-file .cm-tests a.cm-path")).toHaveCount(tested.reduce((n, f) => n + f.tests!.length, 0)); // every test path opens
  const elsewhere = VECTORS.files.filter((f) => CATEGORIES.some((c) => c.id !== "vectors" && c.files.some((g) => g.path === f.path)));
  await expect(page.locator("li.cm-file .cm-also")).toHaveCount(elsewhere.length);
  expect(elsewhere.length).toBeGreaterThan(0);
  // a comment's anchor opens the file at it
  const anchored = page.locator("li.cm-file .cm-comment .cm-at a").first();
  await expect(anchored).toHaveAttribute("href", /\/file\/.+\?at=req-\d+$/);

  // the index of the files jumps to a file's row and keeps the place in the address
  const last = VECTORS.files[VECTORS.files.length - 1].path;
  const index = page.getByRole("list", { name: "Files of this part" });
  await expect(index.getByRole("button")).toHaveCount(VECTORS.files.length);
  await index.getByRole("button", { name: new RegExp(`^${last.replace(/[.]/g, "\\.")}`) }).click();
  await expect(page).toHaveURL(new RegExp(`\\?at=file-${encodeURIComponent(last).replace(/[.]/g, "\\.")}$`));
  await expect(page.locator(`#code-file-${slug(last)}`)).toBeFocused();
  await landedNearTop(page.locator(`#code-file-${slug(last)}`));

  // With comments / Paths only, remembered for this viewer
  const seg = page.getByRole("group", { name: "Show the files" });
  try {
    await seg.getByRole("button", { name: "Paths only" }).click();
    await expect(page.locator("ul.cm-files")).toHaveClass(/compact/);
    await expect(page.locator("a.cm-open")).toHaveCount(0);
    await expect(index).toHaveCount(0);
    await page.reload();
    await expect(page.locator("ul.cm-files")).toHaveClass(/compact/);
    await expect(seg.getByRole("button", { name: "Paths only" })).toHaveAttribute("aria-pressed", "true");
    await seg.getByRole("button", { name: "With comments" }).click();
    await expect(page.locator("ul.cm-files")).not.toHaveClass(/compact/);
    await expect(page.locator("a.cm-open")).toHaveCount(VECTORS.files.length);
  } finally {
    await page.evaluate(() => { try { localStorage.removeItem("pm.codemap.files"); } catch { /* ignore */ } });
  }
});

test("the tables: the index jumps to a table; a table's block with its columns and the files that create and write it", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code/tables");
  await expect(h1(page)).toHaveText(TABLES.title);
  const tables = TABLES.tables!;
  expect(tables.length).toBeGreaterThan(3);
  await expect(page.locator("article.cm-table")).toHaveCount(tables.length);
  const index = page.getByRole("list", { name: "Tables of this part" });
  await expect(index.getByRole("button")).toHaveCount(tables.length);
  await expect(index.locator(".cm-path")).toHaveText(tables.map((t) => t.name));

  // a table far down the page
  const t = tables[tables.length - 2];
  await index.getByRole("button").nth(tables.length - 2).click();
  await expect(page).toHaveURL(new RegExp(`#/admin/code/tables\\?at=table-${t.name}$`));
  const block = page.locator(`#code-table-${slug(t.name)}`);
  await expect(block).toBeFocused();
  await landedNearTop(block.locator("h3"));
  await expect(block.locator("h3")).toHaveText(t.name);
  await expect(block.locator("table.cm-cols thead th")).toHaveText(["Column", "Type", "Note"]);
  await expect(block.locator("table.cm-cols tbody tr")).toHaveCount(t.columns.length);
  await expect(block.locator("table.cm-cols tbody tr td:first-child")).toHaveText(t.columns.map((c) => c.name));
  const facts = block.locator("dl.cm-facts");
  await expect(facts.locator("dt")).toHaveText(t.readBy?.length ? ["Created in", "Written by", "Read by"] : ["Created in", "Written by"]);
  await expect(facts.locator("div", { hasText: "Written by" }).locator("dd a.cm-path")).toHaveText(t.writtenBy);
  // a table's block is no Tab stop of its own; only a box that scrolls is
  expect(await page.locator("article.cm-table[tabindex='0']").count()).toBe(0);

  // "Created in" opens the file; Back returns to the table
  const created = facts.locator("div", { hasText: "Created in" }).locator("dd a");
  await expect(created).toHaveText(t.createdIn);
  await created.click();
  await expect(h1(page)).toHaveText(t.createdIn);
  await expect(page.locator(".cm-line").first()).toBeVisible();
  await page.goBack();
  await expect(h1(page)).toHaveText(TABLES.title);
  await expect(page).toHaveURL(new RegExp(`\\?at=table-${t.name}$`));
  await expect(block.locator("h3")).toBeInViewport();
  // "Written by" too
  await facts.locator("div", { hasText: "Written by" }).locator("dd a").first().click();
  await expect(h1(page)).toHaveText(t.writtenBy[0]);
});

// ---------- a file

test("a file: its text with line numbers, the comments above the lines they name, from comment to comment, wrap, copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, DANA);
  await open(page, "/admin/code/vectors");
  await page.getByRole("link", { name: `Open ${VECTORS.start}` }).click();
  const path = VECTORS.start!;
  const file = VECTORS.files.find((f) => f.path === path)!;
  await expect(page).toHaveURL(new RegExp(`#/admin/code/vectors/file/${path}$`));
  await expect(h1(page)).toHaveText(path);
  await expect(h1(page)).toBeFocused();
  await expect(page).toHaveTitle(new RegExp(`^${path.split("/").pop()!.replace(".", "\\.")} · Code map · Admin`));
  await expect(page.locator("p.cm-crumbs a")).toHaveText(["Code map", VECTORS.title]);

  // the source, line by line, as it is in the checkout
  const lines = readFileSync(path, "utf8").replace(/\n$/, "").split("\n");
  await expect(code(page)).toHaveAttribute("aria-label", `Source of ${path}`);
  await expect(code(page).locator(".cm-line")).toHaveCount(lines.length);
  await expect(code(page).locator(".cm-ln").first()).toHaveText("1");
  await expect(code(page).locator(".cm-ln").last()).toHaveText(String(lines.length));
  expect(await code(page).locator(".cm-line.quiet").count(), "the source's own comment lines are dimmed").toBeGreaterThan(0);

  // what the file must do: every sentence; a placed one names its line, and its comment sits above it
  const reqs = page.locator("li[id^=cm-req-]");
  await expect(reqs).toHaveCount(file.requirements.length);
  let placed = 0;
  for (const [i, r] of file.requirements.entries()) {
    const link = page.locator(`#cm-req-${i} .cm-line-link`);
    if (!r.at || !(await link.count())) continue;
    const n = Number((await link.textContent())!.match(/^line (\d+)$/)![1]);
    const comment = page.locator(`#cm-c-${n}`);
    await expect(comment).toHaveAttribute("role", "note");
    await expect(comment).toHaveAttribute("aria-label", `Requirement at line ${n}`);
    // the next line of code is line n, and it holds the text the requirement points at
    const next = comment.locator("xpath=following-sibling::div[contains(@class,'cm-line')][1]");
    await expect(next.locator(".cm-ln")).toHaveText(String(n));
    expect(await next.locator(".cm-text").textContent()).toContain(r.at);
    expect(lines[n - 1]).toContain(r.at);
    placed++;
  }
  expect(placed, "at least one comment is placed in the code").toBeGreaterThan(0);
  const commented = await code(page).locator(".cm-inline").count();

  // "line N" jumps there and keeps it in the address
  const i = file.requirements.findIndex((r, k) => r.at && k > 0) >= 0 ? file.requirements.findIndex((r, k) => r.at && k > 0) : file.requirements.findIndex((r) => r.at);
  const target = page.locator(`#cm-req-${i} .cm-line-link`);
  const n = Number((await target.textContent())!.match(/\d+/)![0]);
  await target.click();
  await expect(page).toHaveURL(new RegExp(`\\?at=req-${i}$`));
  await expect(page.locator(`#cm-c-${n}`)).toBeFocused();
  await expect(page.locator(`#cm-c-${n}`)).toBeInViewport();

  // from comment to comment, with the bar in view
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const bar = page.getByRole("toolbar", { name: "Reading this file" });
  await expect(readbarN(page)).toHaveText(commented === 1 ? "1 comment in this file" : `${commented} comments in this file`);
  await bar.getByRole("button", { name: "Next comment" }).click();
  await expect(readbarN(page)).toHaveText(`Comment 1 of ${commented}`);
  if (commented > 1) {
    await bar.getByRole("button", { name: "Next comment" }).click();
    await expect(readbarN(page)).toHaveText(`Comment 2 of ${commented}`);
    await expect(bar).toBeInViewport();
    await bar.getByRole("button", { name: "Previous comment" }).click();
    await expect(readbarN(page)).toHaveText(`Comment 1 of ${commented}`);
  }

  // Wrap lines: changes the box, and is remembered for this viewer
  const wrap = bar.getByRole("checkbox", { name: "Wrap lines" });
  try {
    await expect(wrap).not.toBeChecked();
    await expect(code(page)).not.toHaveClass(/\bwrap\b/);
    await wrap.check();
    await expect(code(page)).toHaveClass(/\bwrap\b/);
    await page.reload();
    await expect(page.locator(".cm-line").first()).toBeVisible();
    await expect(code(page)).toHaveClass(/\bwrap\b/);
    await expect(page.getByRole("checkbox", { name: "Wrap lines" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Wrap lines" }).uncheck();
    await expect(code(page)).not.toHaveClass(/\bwrap\b/);
  } finally {
    await page.evaluate(() => { try { localStorage.removeItem("pm.codemap.wrap"); } catch { /* ignore */ } });
  }

  // Copy path
  await page.getByRole("button", { name: "Copy path" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
});

test("a file: Previous and Next walk the category in order and end; Also in; Back returns to the file's row", async ({ page }) => {
  await signIn(page, DANA);
  const files = VECTORS.files.map((f) => f.path);
  await open(page, fileHash("vectors", files[0]));
  await expect(h1(page)).toHaveText(files[0]);
  await expect(page.getByRole("link", { name: /^Previous file: / })).toHaveCount(0);
  for (let k = 0; k < files.length; k++) {
    await expect(h1(page)).toHaveText(files[k]);
    await expect(page.locator(".cm-file-bar .cm-pos")).toHaveText(`File ${k + 1} of ${files.length}`);
    if (k > 0) await expect(page.locator(".cm-file-bar").getByRole("link", { name: `Previous file: ${files[k - 1]}` })).toBeVisible();
    if (k === files.length - 1) break;
    await page.locator(".cm-file-bar").getByRole("link", { name: `Next file: ${files[k + 1]}` }).click();
  }
  // the last one has no next file, neither in the bar nor at the foot
  await expect(page.getByRole("link", { name: /^Next file: / })).toHaveCount(0);
  await page.locator(".cm-file-bar").getByRole("link", { name: `Previous file: ${files[files.length - 2]}` }).click();
  await expect(h1(page)).toHaveText(files[files.length - 2]);
  // the foot under the code walks too
  await expect(page.locator(".cm-file-foot .cm-pos")).toHaveText(`File ${files.length - 1} of ${files.length}`);
  await page.locator(".cm-file-foot").getByRole("link", { name: /^Next file: / }).click();
  await expect(h1(page)).toHaveText(files[files.length - 1]);

  // Also in: the same file in another category
  const shared = VECTORS.files.find((f) => CATEGORIES.some((c) => c.id !== "vectors" && c.files.some((g) => g.path === f.path)))!;
  const other = CATEGORIES.find((c) => c.id !== "vectors" && c.files.some((g) => g.path === shared.path))!;
  await open(page, fileHash("vectors", shared.path));
  await expect(h1(page)).toHaveText(shared.path);
  const also = page.locator(".cm-file-page > .cm-also");
  await expect(also).toContainText("Also in:");
  await also.getByRole("link", { name: other.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/admin/code/${other.id}/file/${shared.path}$`));
  await expect(h1(page)).toHaveText(shared.path);
  await expect(page.locator("p.cm-crumbs a").last()).toHaveText(other.title);
  await expect(cats(page).locator("a[aria-current=page]")).toHaveText(other.title);

  // from a row far down the category to its file, and the browser's Back returns to the row
  const last = files[files.length - 1];
  await open(page, "/admin/code/vectors");
  await expect(h1(page)).toHaveText(VECTORS.title);
  await page.getByRole("link", { name: `Open ${last}` }).click();
  await expect(h1(page)).toHaveText(last);
  await page.goBack();
  await expect(h1(page)).toHaveText(VECTORS.title);
  await expect(page).toHaveURL(new RegExp(`\\?at=file-`));
  await landedNearTop(page.locator(`#code-file-${slug(last)}`));
  // "Back to …" does the same
  await page.getByRole("link", { name: `Open ${last}` }).click();
  await expect(h1(page)).toHaveText(last);
  await page.getByRole("link", { name: `Back to ${VECTORS.title}` }).click();
  await landedNearTop(page.locator(`#code-file-${slug(last)}`));
});

// ---------- when a file cannot be shown

test("what a file's page says when the file cannot be shown, and Try again", async ({ page }) => {
  await signIn(page, DANA);
  const file = VECTORS.files.find((f) => f.path === LONG)!;
  const not = "This file cannot be shown here: it is not tracked by git yet, or it is not a text file the portal may show. Its path and what it must do are above.";
  const off = "The file itself is shown only where the portal runs beside its source code (npm run dev). Its path and what it must do are above.";

  // the portal shows source, but not this file
  await page.route("**/api/admin/source?**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "That file cannot be shown." }) }));
  await open(page, fileHash("vectors", LONG));
  await expect(page.locator(".cm-file-page .cm-nosource")).toHaveText(not);
  await expect(page.locator("li[id^=cm-req-]")).toHaveCount(file.requirements.length);
  await expect(page.locator(".cm-code")).toHaveCount(0);
  await page.unroute("**/api/admin/source?**");

  // this installation shows no source at all: said on the overview and on a file
  await page.route("**/api/admin/system", async (r) => {
    const res = await r.fetch();
    await r.fulfill({ response: res, json: { ...(await res.json()), source: false } });
  });
  await open(page, "/admin/code");
  await expect(page.locator(".cm-overview .cm-nosource[role=status]")).toHaveText("Here the files themselves cannot be opened: the portal does not run beside its source code (npm run dev does). Their paths, what they must do, the charts and the tables are all here.");
  await open(page, fileHash("vectors", LONG));
  await expect(page.locator(".cm-file-page .cm-nosource")).toHaveText(off);
  await expect(page.locator("li[id^=cm-req-]")).toHaveCount(file.requirements.length);
  await page.unroute("**/api/admin/system");

  // another failure: said with Try again, which works once the server answers
  await page.route("**/api/admin/source?**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong." }) }));
  await open(page, fileHash("vectors", LONG));
  await expect(page.getByText("The file could not be loaded.")).toBeVisible();
  await page.unroute("**/api/admin/source?**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".cm-line").first()).toBeVisible();
  await expect(page.getByText("The file could not be loaded.")).toHaveCount(0);
});

// ---------- not found

test("an unknown category, a file not in its category, and a test file opened from Tested by", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code/no-such-part");
  await expect(h1(page)).toHaveText("Not in the code map");
  await expect(page.locator(".cm-not-found .lead")).toContainText("no-such-part");
  await page.locator("a.cm-back").click();
  await expect(h1(page)).toHaveText("Code map");

  // a file of another category: says where it is
  const foreign = CATEGORIES.find((c) => c.id === "frame")!.files[0].path;
  expect(VECTORS.files.some((f) => f.path === foreign)).toBe(false);
  await open(page, fileHash("vectors", foreign));
  await expect(h1(page)).toHaveText(`Not in ${VECTORS.title}`);
  await expect(page.locator(".cm-not-found .lead")).toContainText(foreign);
  await expect(page.locator(".cm-not-found .lead").getByRole("link", { name: byId("frame").title })).toHaveAttribute("href", `#/admin/code/frame/file/${foreign}`);
  // the way back is a button of its own size, not a bar across the page
  const back = page.locator("a.cm-back");
  await expect(back).toHaveText(`Back to ${VECTORS.title}`);
  expect((await back.boundingBox())!.width).toBeLessThan((await page.locator(".cm-not-found").boundingBox())!.width / 2);
  await back.click();
  await expect(h1(page)).toHaveText(VECTORS.title);
  // a file that is nowhere
  await open(page, fileHash("vectors", "src/no/such/file.ts"));
  await expect(h1(page)).toHaveText(`Not in ${VECTORS.title}`);

  // a test file opens from "Tested by", in the category of the file that names it
  const tested = VECTORS.files.find((f) => f.tests?.length)!;
  await open(page, "/admin/code/vectors");
  const link = page.locator(`#code-file-${slug(tested.path)} .cm-tests a`).first();
  await expect(link).toHaveText(tested.tests![0]);
  await link.click();
  await expect(h1(page)).toHaveText(tested.tests![0]);
  await expect(page.locator(".cm-line").first()).toBeVisible();
  await expect(page.locator(".cm-file-page .lead")).toContainText(tested.path);
  await expect(page.getByRole("heading", { name: "What this file must do" })).toHaveCount(0);
  await expect(page.locator(".cm-file-bar .cm-pos")).toHaveCount(0);
  // Back to the category returns to the row of the file it tests
  await page.getByRole("link", { name: `Back to ${VECTORS.title}` }).click();
  await landedNearTop(page.locator(`#code-file-${slug(tested.path)}`));
});

// ---------- layout, themes, keyboard

test("no page of the code map scrolls sideways at 390, 1366 and 1440; a long file scrolls inside its own box", async ({ page }) => {
  await signIn(page, DANA);
  for (const width of [390, 1366, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const hash of ["/admin/code", "/admin/code?q=feedback", "/admin/code/tables", "/admin/code/reading", fileHash("vectors", LONG)]) {
      await open(page, hash);
      await expect(h1(page)).toBeVisible();
      if (hash.includes("/file/")) await expect(page.locator(".cm-line").first()).toBeVisible();
      if (hash.endsWith("tables")) await expect(page.locator("figure.cm-chart .block").first()).toBeVisible();
      expect(await sideways(page), `${hash} at ${width}px`).toBe(0);
    }
    // the long lines of the code scroll inside the box at a phone's width
    if (width === 390) expect(await code(page).evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    // the category list: beside the page from 1120 px, a menu above it below
    await open(page, "/admin/code/tables");
    if (width < 1120) {
      await expect(page.locator("aside.cm-side")).toHaveCount(0);
      const menu = page.locator("details.cm-menu");
      await expect(menu.locator("summary")).toHaveText(`Categories· ${TABLES.title}`);
      await expect(cats(page)).toBeHidden();
      await menu.locator("summary").click();
      await expect(cats(page)).toBeVisible();
      await cats(page).getByRole("link", { name: VECTORS.title, exact: true }).click();
      await expect(h1(page)).toHaveText(VECTORS.title);
      await expect(page.locator("details.cm-menu")).not.toHaveAttribute("open", "");
    } else {
      await expect(page.locator("details.cm-menu")).toHaveCount(0);
      await expect(page.locator("aside.cm-side")).toBeVisible();
      await expect(cats(page)).toBeVisible();
    }
  }
});

test("the code map in the light and the dark theme", async ({ page }) => {
  await signIn(page, DANA);
  const colours: Record<string, string[]> = {};
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    await open(page, fileHash("vectors", VECTORS.start!));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".cm-inline").first()).toBeVisible();
    colours[theme] = await page.evaluate(() => [".cm-code", ".cm-inline", ".cm-main h1"].map((s) => {
      const st = getComputedStyle(document.querySelector(s)!);
      return `${st.backgroundColor} ${st.color}`;
    }));
    expect(await sideways(page)).toBe(0);
  }
  for (let i = 0; i < colours.light.length; i++) expect(colours.dark[i], `${i}`).not.toBe(colours.light[i]);
});

test("the keyboard: the search field comes early; the focus is on the heading of an opened category and file", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/code");
  await expect(h1(page)).toHaveText("Code map");
  await page.waitForLoadState("networkidle");
  let stops = 0;
  for (; stops < 40; stops++) {
    await page.keyboard.press("Tab");
    if (await searchField(page).evaluate((e) => e === document.activeElement)) break;
  }
  expect(stops, "Tab presses before the search field").toBeLessThan(25);
  // the first hour comes right after it
  await page.keyboard.press("Tab");
  await expect(page.locator("section.cm-first a").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(h1(page)).toHaveText(TABLES.title);
  await expect(h1(page)).toBeFocused();
  await page.getByRole("link", { name: `Open ${TABLES.start}` }).click();
  await expect(h1(page)).toHaveText(TABLES.start!);
  await expect(h1(page)).toBeFocused();
});

// ---------- the two leaks closed with this page

test("a process taken back to draft leaves no trace of its skill or its feedback for a reader", async ({ page, request }) => {
  const ID = "request-azure-landing-zone", SKILL = `process-${ID}`;
  const as = async (who: string) => expect((await request.post("/auth/dev/login", { data: { email: who }, headers: CSRF })).ok()).toBeTruthy();
  const skills = async () => ((await (await request.get("/api/skills")).json()).skills as { id: string }[]).map((s) => s.id);
  await as(SAM);
  const before = { processes: ((await (await request.get("/api/processes")).json()).processes as unknown[]).length, skills: (await skills()).length };
  expect(await skills()).toContain(SKILL);
  const { id: feedback } = await report(request, SAM, { targetId: ID, text: "The questionnaire link is broken." });

  await as(ALEX);
  const doc = (await readProcess(request, ID))!;
  expect(doc.status).toBe("active");
  try {
    expect((await putDoc(request, "process", ID, { ...doc, status: "draft" })).ok()).toBeTruthy();

    await as(SAM);
    // the list leaves it out (the skills follow a save in the background)
    await expect.poll(skills).not.toContain(SKILL);
    // the skill, its version and its download answer as for one that never existed
    for (const tail of ["", "/versions/1", "/download"]) {
      const res = await request.get(`/api/skills/${SKILL}${tail}`), none = await request.get(`/api/skills/process-never-there${tail}`);
      expect(res.status(), tail).toBe(404);
      expect((await res.body()).equals(await none.body()), `${tail}: ${await res.text()}`).toBeTruthy();
    }
    // his own feedback on it: gone for him
    for (const [method, data] of [["PATCH", { resolved: true }], ["DELETE", undefined]] as const) {
      const res = await request.fetch(`/api/feedback/${feedback}`, { method, data, headers: CSRF });
      const none = await request.fetch("/api/feedback/00000000-0000-0000-0000-000000000000", { method, data, headers: CSRF });
      expect(res.status(), method).toBe(404);
      expect(await res.json()).toEqual({ error: "That feedback no longer exists." });
      expect((await res.body()).equals(await none.body()), method).toBeTruthy();
    }
    // what he sees: no such process, so no skill panel to open
    await signIn(page, SAM);
    await open(page, `/p/${ID}/flow`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Process not found");
    await open(page, "/search?q=azure%20landing%20zone");
    await expect(page.locator(`li.card[data-id="${ID}"]`)).toHaveCount(0);
  } finally {
    await as(ALEX);
    const now = (await readProcess(request, ID))!;
    if (now.status !== "active") expect((await putDoc(request, "process", ID, { ...now, status: "active" })).ok()).toBeTruthy();
    await clearFeedback(request, "process", ID);
  }
  // as before for everybody else
  await as(SAM);
  await expect.poll(skills).toContain(SKILL);
  expect((await skills()).length).toBe(before.skills);
  expect(((await (await request.get("/api/processes")).json()).processes as unknown[]).length).toBe(before.processes);
  expect((await request.get(`/api/skills/${SKILL}`)).status()).toBe(200);
});
