import fs from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, open, report, RILEY, SAM, serverToday, signIn } from "./helpers";

// Admin > Statistics: how much each process and standard is used. The numbers are made in the
// test, on a process of its own, by every built-in person.

// new ids for every start of the file: a skill download counts once per person, skill and day,
// so a process deleted and made again under the same id the same day would count no downloads
const run = Date.now().toString(36);
const ID = `statistics-demo-${run}`;
const TITLE = "Statistics demo";
const EVERYONE = [SAM, ALEX, CASEY, RILEY, JORDAN, DANA];
const FORMULA = `statistics-formula-demo-${run}`; // a draft whose title starts like a spreadsheet formula
const RETIRED = `statistics-retired-demo-${run}`;
const GONE = `statistics-gone-demo-${run}`; // viewed, then deleted

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project"); // on Google Cloud
  await request.delete(`/api/processes/${ID}`, { headers: CSRF });
  expect((await request.put(`/api/processes/${ID}?base=0`, { data: { ...src, id: ID, title: TITLE, status: "active" }, headers: CSRF })).ok()).toBeTruthy();
  // six people view it (twice each: still one view a day each), one upvotes, three people download
  // its skill (Sam twice: still one download a day), one piece of feedback
  for (const who of EVERYONE) {
    await as(request, who);
    for (let i = 0; i < 2; i++) expect((await request.post(`/api/views/process/${ID}`, { headers: CSRF })).status()).toBe(200);
  }
  for (const who of [SAM, SAM, CASEY, RILEY]) {
    await as(request, who);
    expect((await request.get(`/api/skills/process-${ID}/download`)).ok()).toBeTruthy();
  }
  await as(request, SAM);
  expect((await request.put(`/api/upvotes/process/${ID}`, { headers: CSRF })).ok()).toBeTruthy();
  await report(request, SAM, { targetId: ID, text: "The statistics demo has a problem." });

  await as(request, ALEX);
  const docs: [string, string, string][] = [[FORMULA, " =1+1 Formula demo", "draft"], [RETIRED, "Retired statistics demo", "deprecated"], [GONE, "Gone statistics demo", "active"]];
  for (const [id, title, status] of docs) {
    await request.delete(`/api/processes/${id}`, { headers: CSRF });
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, status }, headers: CSRF });
    expect(res.ok(), `${id}: ${await res.text()}`).toBeTruthy();
  }
  expect((await request.post(`/api/views/process/${GONE}`, { headers: CSRF })).status()).toBe(200);
  expect((await request.delete(`/api/processes/${GONE}`, { headers: CSRF })).ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  for (const id of [ID, FORMULA, RETIRED]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

const cells = async (row: Locator) => (await row.locator("td").allTextContents()).map((t) => t.trim());
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));
/** The columns of the table, after Name (with the kind as a small mark before it) and Belongs to (owning team, platform · practice). */
const COL = { views: 2, people: 3, downloads: 4, upvotes: 5, open: 6, handled: 7 };

async function statistics(page: Page) {
  await signIn(page, DANA);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Admin" }).click();
  await page.locator(".admin-nav").getByRole("link", { name: "Statistics" }).click();
  await expect(page).toHaveURL(/#\/admin\/statistics$/);
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Statistics");
}

test("only an admin sees the statistics; the server refuses everybody else", async ({ page }) => {
  for (const who of [SAM, ALEX, JORDAN]) {
    await signIn(page, who);
    for (const path of ["/api/admin/statistics?period=30", "/api/admin/statistics.csv?period=30"]) expect((await page.request.get(path)).status(), `${who} ${path}`).toBe(403);
  }
  // Alex manages the lists: he has an Admin panel, without Statistics
  await signIn(page, ALEX);
  await open(page, "/admin/statistics");
  await expect(page.locator(".admin-nav")).not.toContainText("Statistics");
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Lists");
  await expect(page.locator(".stat-table")).toHaveCount(0);
});

test("the numbers of a process over the last 7 days, sorted and grouped", async ({ page }) => {
  await statistics(page);
  await expect(page.getByText("A view counts once per person per day, however often they open it;")).toBeVisible();
  const periods = page.getByRole("group", { name: "Period" });
  await expect(periods.getByRole("button")).toHaveText(["7 days", "30 days", "90 days", "A year", "All time"]);
  await periods.getByRole("button", { name: "7 days" }).click();
  await expect(periods.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  // seven days, today included, as the server counts them (also when the test runs over midnight)
  const { to } = await (await page.request.get("/api/admin/statistics?period=7")).json();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  await expect(page.locator(".stat-range")).toHaveText(`From ${from} to ${to}`);

  const table = page.getByRole("region", { name: "Statistics per process and standard" });
  const row = table.locator("tbody tr", { has: page.getByRole("link", { name: TITLE, exact: true }) });
  await expect(row).toHaveCount(1);
  const c = await cells(row);
  // the headers: no Kind, Owner, Platform or Practice columns any more
  await expect(table.locator("thead th")).toHaveText([/^Name/, "Belongs to", /^Views/, /^People/, /^Skill downloads/, /^Upvotes/, /^Feedback open/, /^Feedback handled/]);
  // the kind is a small mark before the name (said to screen readers), names not ids under Belongs to
  await expect(row.locator(".stat-kind.process")).toBeVisible();
  await expect(row.locator(".stat-kind")).toHaveAttribute("title", "Process");
  expect(c[0]).toBe(`Process: ${TITLE}`);
  await expect(row.locator(".stat-belongs .stat-owner")).toHaveText("Cloud Platform team");
  await expect(row.locator(".stat-belongs .stat-scope")).toHaveText(/^Google Cloud( · .+)?$/);
  expect(num(c[COL.views])).toBe(6);
  expect(num(c[COL.people])).toBe(6);
  expect(num(c[COL.downloads])).toBe(3);
  expect(num(c[COL.upvotes])).toBe(1);
  expect(num(c[COL.open])).toBe(1);
  await expect(row.getByRole("link", { name: "1", exact: true })).toHaveAttribute("href", `#/p/${ID}/feedback`);
  await expect(row.getByRole("link", { name: TITLE })).toHaveAttribute("href", `#/p/${ID}/flow`);

  // the totals hold at least what was made here
  const total = (label: string) => page.locator(".stat-totals .stat", { hasText: label }).locator("strong");
  expect(num(await total("views").innerText())).toBeGreaterThanOrEqual(6);
  expect(num(await total("different people").innerText())).toBeGreaterThanOrEqual(6);
  expect(num(await total("skill downloads").innerText())).toBeGreaterThanOrEqual(3);
  expect(num(await total("upvotes").innerText())).toBeGreaterThanOrEqual(1);
  expect(num(await total("feedback given").innerText())).toBeGreaterThanOrEqual(1);

  // sorted by views, the largest first: it is at the top (six views is the most there can be today)
  await table.getByRole("button", { name: /^Name/ }).click();
  await expect(table.locator("th", { has: page.getByRole("button", { name: /^Name/ }) })).toHaveAttribute("aria-sort", "ascending");
  const views = table.locator("th", { has: page.getByRole("button", { name: /^Views/ }) });
  await expect(views).toHaveAttribute("aria-sort", "none");
  await views.getByRole("button").click();
  await expect(views).toHaveAttribute("aria-sort", "descending");
  const column = async () => (await table.locator(`tbody tr td:nth-child(${COL.views + 1})`).allTextContents()).map(num);
  let shown = await column();
  expect(shown).toEqual([...shown].sort((a, b) => b - a));
  expect(shown[0]).toBe(6);
  const names = await table.locator("tbody tr td:first-child a").allTextContents();
  expect(names.indexOf(TITLE)).toBeLessThan(shown.filter((v) => v === 6).length);
  // and the other way round
  await views.getByRole("button").click();
  await expect(views).toHaveAttribute("aria-sort", "ascending");
  shown = await column();
  expect(shown).toEqual([...shown].sort((a, b) => a - b));
  // only processes, only standards
  const kinds = page.getByRole("group", { name: "Kind" });
  await kinds.getByRole("button", { name: /^Standards/ }).click();
  await expect(row).toHaveCount(0);
  await expect(table.locator("tbody tr .stat-kind.process")).toHaveCount(0);
  for (const k of await table.locator("tbody tr .stat-kind").all()) await expect(k).toHaveAttribute("title", "Standard");
  await kinds.getByRole("button", { name: /^Processes/ }).click();
  await expect(row).toHaveCount(1);

  // totals by platform: Google Cloud has its views
  const grouped = page.getByRole("group", { name: "Totals grouped" });
  await expect(grouped.getByRole("button", { name: "By platform" })).toHaveAttribute("aria-pressed", "true");
  const gcp = page.getByRole("region", { name: "Totals by platform" }).locator("tbody tr", { has: page.locator("td", { hasText: /^Google Cloud$/ }) });
  const g = await cells(gcp);
  expect(num(g[1])).toBeGreaterThanOrEqual(3); // the GCP process, the IaC standard and this one
  expect(num(g[2])).toBeGreaterThanOrEqual(6);
  expect(num(g[4])).toBeGreaterThanOrEqual(3);
  await grouped.getByRole("button", { name: "By owning team" }).click();
  await expect(page.getByRole("region", { name: "Totals by owning team" }).locator("tbody tr", { hasText: "Cloud Platform team" })).toBeVisible();
  await grouped.getByRole("button", { name: "By practice" }).click();
  await expect(page.getByRole("region", { name: "Totals by practice" })).toBeVisible();

  // the period is remembered
  await page.reload();
  await expect(page.getByRole("group", { name: "Period" }).getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
});

test("the trend of views per week has a text alternative", async ({ page }) => {
  await statistics(page);
  // the period shown is 30 days; choosing it again keeps its numbers
  await expect(page.getByRole("group", { name: "Period" }).getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stat-totals")).toBeVisible();
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "30 days" }).click();
  await expect(page.locator(".stat-totals")).toBeVisible();
  const chart = page.locator(".stat-trend svg");
  await expect(chart).toHaveAttribute("role", "img");
  await expect(chart).toHaveAttribute("aria-label", /^Views per week, from the week of .+ to the week of .+: \d+ views in all\./);
  expect(await chart.locator("rect.stat-bar").count()).toBeGreaterThanOrEqual(4);
  // the same numbers as a table for screen readers
  const alt = page.locator(".stat-trend table");
  await expect(alt.locator("caption")).toHaveText("Views per week");
  const weeks = await alt.locator("tbody tr").count();
  expect(weeks).toBe(await chart.locator("rect.stat-bar").count());
  const viewsThisWeek = num(await alt.locator("tbody tr").last().locator("td").nth(1).innerText());
  expect(viewsThisWeek).toBeGreaterThanOrEqual(6);
  // the weeks as the server sends them: Mondays, oldest first, each with how many of its days are in the period
  const { trend, from, to } = await (await page.request.get("/api/admin/statistics?period=30")).json();
  expect(trend.length).toBe(weeks);
  for (const w of trend) {
    expect(new Date(`${w.week}T00:00:00Z`).getUTCDay(), w.week).toBe(1);
    expect(w.days).toBeGreaterThanOrEqual(1);
    expect(w.days).toBeLessThanOrEqual(7);
  }
  expect(trend.reduce((n: number, w: { days: number }) => n + w.days, 0)).toBe(30);
  expect(trend[0].week <= from && from < trend[1].week).toBe(true);
  expect(trend[trend.length - 1].week <= to).toBe(true);
  // a week only partly in the period is drawn lighter, said under the chart and in the table
  const partial = trend.filter((w: { days: number }) => w.days < 7);
  expect(partial.length).toBeGreaterThanOrEqual(1); // 30 days are never whole weeks
  await expect(chart.locator("rect.stat-bar.partial")).toHaveCount(partial.length);
  await expect(page.locator("p.stat-partial-note")).toHaveText("Faint bars with a dashed edge: weeks only partly inside the period (the first or the last).");
  const names = await alt.locator("tbody tr td:first-child").allTextContents();
  trend.forEach((w: { days: number }, i: number) => expect(names[i]).toMatch(w.days < 7 ? new RegExp(`^Week of .+, ${w.days} days?$`) : /^Week of \d+ \w+$/));
});

test("groups end with what belongs to none; deleted documents are explained, not hidden", async ({ page }) => {
  await statistics(page);
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "7 days" }).click();
  // views of a document deleted since are in the totals, with a sentence that says so
  const { totals } = await (await page.request.get("/api/admin/statistics?period=7")).json();
  expect(totals.deletedViews).toBeGreaterThanOrEqual(1);
  await expect(page.locator("p.stat-deleted")).toContainText(/^The totals include \d[\d,]* views?( and \d[\d,]* skill downloads?)? of processes and standards that were deleted since; the table below shows only those that still exist\.$/);
  await expect(page.getByRole("link", { name: "Gone statistics demo" })).toHaveCount(0);

  const { groups } = await (await page.request.get("/api/admin/statistics?period=7")).json();
  const grouped = page.getByRole("group", { name: "Totals grouped" });
  for (const [key, button, none] of [["platform", "By platform", "No platform"], ["practice", "By practice", "No practice"], ["team", "By owning team", "No owning team"]]) {
    await grouped.getByRole("button", { name: button }).click();
    const rows = page.getByRole("region", { name: `Totals ${button.toLowerCase()}` }).locator("tbody tr");
    const hasNone = groups[key].some((g: { id: string }) => g.id === "");
    // the GCP copies belong to no practice; every process and standard has an owning team
    if (key === "practice") expect(hasNone).toBe(true);
    await expect(rows.first()).toBeVisible();
    if (hasNone) await expect(rows.last().locator("td").first()).toHaveText(none);
    await expect(rows.filter({ has: page.locator("td", { hasText: new RegExp(`^${none}$`) }) })).toHaveCount(hasNone ? 1 : 0);
  }
  // the practice of the GCP copies is empty: they are counted under "No practice"
  const noPractice = page.getByRole("region", { name: "Totals by practice" });
  await grouped.getByRole("button", { name: "By practice" }).click();
  expect(num((await cells(noPractice.locator("tbody tr").last()))[2])).toBeGreaterThanOrEqual(6);

  // the explanation on the page
  const about = page.locator(".stat-about");
  await expect(about).toContainText("Views by admins and editors count like everyone else's.");
  await expect(about).toContainText("A skill download counts once per person per skill per day.");
  await expect(about).toContainText("midnight to midnight UTC");
});

test("Download as CSV gives a file with a header line and a line per process and standard", async ({ page }) => {
  await statistics(page);
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "7 days" }).click();
  const header = "Type,Title,Id,Status,Owning team,Platform,Practice,Category,Views,People,Skill downloads,Upvotes in the period,Upvotes in total,Open feedback,Feedback handled in the period";

  const res = await page.request.get("/api/admin/statistics.csv?period=7");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain(`statistics-last-7-days-${serverToday()}.csv`);
  const text = (await res.body()).toString("utf8").replace(/^﻿/, "");
  const lines = text.split("\r\n").filter(Boolean);
  expect(lines[0]).toBe(header);
  const line = lines.find((l) => l.includes(`,${TITLE},`))!;
  expect(line).toBeDefined();
  expect(line).toContain(`Process,${TITLE},${ID},Active,Cloud Platform team,Google Cloud,`);
  expect(line.split(",").slice(-7)).toEqual(["6", "6", "3", "1", "1", "1", "0"]);
  // the status in words, and a title that starts like a formula is not run by a spreadsheet
  expect(lines.find((l) => l.includes(`,${RETIRED},`))).toContain(`Process,Retired statistics demo,${RETIRED},Retired,`);
  const formula = lines.find((l) => l.includes(`,${FORMULA},`))!;
  expect(formula).toMatch(new RegExp(`^Process,'\\s*=1\\+1 Formula demo,${FORMULA},Draft,`));

  // the link on the page downloads the same file
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as CSV" }).click()]);
  expect(download.suggestedFilename()).toBe(`statistics-last-7-days-${serverToday()}.csv`);
  const file = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
  expect(file.split("\r\n")[0]).toBe(header);
  expect(file).toContain(TITLE);

  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "All time" }).click();
  const [all] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as CSV" }).click()]);
  expect(all.suggestedFilename()).toBe(`statistics-all-time-${serverToday()}.csv`);
});

test("a period that is not offered is refused", async ({ page }) => {
  await signIn(page, DANA);
  for (const path of ["/api/admin/statistics?period=5", "/api/admin/statistics?period=week", "/api/admin/statistics.csv?period=0"]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(400);
    expect((await res.json()).error).toBe("Choose a period of 7, 30, 90 or 365 days, or all.");
  }
  expect((await page.request.get("/api/admin/statistics?period=all")).ok()).toBeTruthy();
});
