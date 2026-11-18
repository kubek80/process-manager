import fs from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, open, report, RILEY, SAM, serverToday, signIn } from "./helpers";

// Admin > Statistics: how much each process and standard is used. The numbers are made in the
// test, on a process of its own, by every built-in person.

const ID = "statistics-demo";
const TITLE = "Statistics demo";
const EVERYONE = [SAM, ALEX, CASEY, RILEY, JORDAN, DANA];

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project"); // on Google Cloud
  await request.delete(`/api/processes/${ID}`, { headers: CSRF });
  expect((await request.put(`/api/processes/${ID}?base=0`, { data: { ...src, id: ID, title: TITLE, status: "active" }, headers: CSRF })).ok()).toBeTruthy();
  // six people view it (twice each: still one view a day each), one upvotes, three downloads of its skill, one piece of feedback
  for (const who of EVERYONE) {
    await as(request, who);
    for (let i = 0; i < 2; i++) expect((await request.post(`/api/views/process/${ID}`, { headers: CSRF })).status()).toBe(204);
  }
  await as(request, SAM);
  expect((await request.put(`/api/upvotes/process/${ID}`, { headers: CSRF })).ok()).toBeTruthy();
  for (let i = 0; i < 3; i++) expect((await request.get(`/api/skills/process-${ID}/download`)).ok()).toBeTruthy();
  await report(request, SAM, { targetId: ID, text: "The statistics demo has a problem." });
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  await request.delete(`/api/processes/${ID}`, { headers: CSRF });
});

const cells = async (row: Locator) => (await row.locator("td").allTextContents()).map((t) => t.trim());
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));
/** The columns of the table, after Name, Kind, Owner, Platform, Practice. */
const COL = { views: 5, people: 6, downloads: 7, upvotes: 8, open: 9, handled: 10 };

async function statistics(page: Page) {
  await signIn(page, DANA);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Admin" }).click();
  await page.locator(".admin-nav").getByRole("link", { name: "Statistics" }).click();
  await expect(page).toHaveURL(/#\/admin\/statistics$/);
  await expect(page.locator(".admin-main > header h2")).toHaveText("Statistics");
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
  await expect(page.locator(".admin-main > header h2")).toHaveText("Lists");
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
  expect(c.slice(1, 4)).toEqual(["Process", "Cloud Platform team", "Google Cloud"]); // names, not ids
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
  for (const k of await table.locator("tbody tr td:nth-child(2)").allTextContents()) expect(k.trim()).toBe("Standard");
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
  // weeks start on a Monday
  for (const w of await alt.locator("tbody tr td:first-child").allTextContents()) expect(new Date(`${w}T00:00:00Z`).getUTCDay(), w).toBe(1);
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
