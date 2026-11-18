import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, JORDAN, open, report, SAM, signIn } from "./helpers";

// How much a process or standard is used, upvotes, bookmarks and sharing. The numbers are kept
// by the server for everyone, so these tests work on a process of their own and count from
// what was there before.

const ID = "engage-demo";
const TITLE = "Engage demo";
const DRAFT = "engage-draft-demo";
const SUMMARY = "A copy of the GCP process for counting views & upvotes.";

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  for (const [id, title, status] of [[ID, TITLE, "active"], [DRAFT, "Engage draft demo", "draft"]]) {
    await request.delete(`/api/processes/${id}`, { headers: CSRF });
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, summary: SUMMARY, status }, headers: CSRF });
    expect(res.ok(), `create ${id}`).toBeTruthy();
  }
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  for (const id of [ID, DRAFT]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

const stats = (page: Page) => page.locator(".doc-engage .engage-stats");
const views = (page: Page) => stats(page).locator("li").nth(0);

/** Opens the process and waits until the server has counted the view. */
async function visit(page: Page, hash = `/p/${ID}/flow`) {
  await page.goto("about:blank"); // a new page load: the page counts once per load
  const counted = page.waitForResponse((r) => r.url().includes(`/api/views/process/${ID}`) && r.request().method() === "POST");
  await open(page, hash);
  expect((await counted).status()).toBe(204);
}

test("a view counts once per person per day; another person adds a view and a person", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  await expect(page.getByRole("group", { name: "Use and feedback" })).toBeVisible();
  // the first view shows at once
  await expect(views(page)).toHaveText("Viewed once by 1 person");
  await expect(stats(page)).toContainText("Skill not downloaded yet");
  await expect(stats(page)).toContainText("No feedback open");
  await expect(stats(page)).toContainText("0 pieces of feedback handled");

  // again the same day: no more
  await visit(page);
  await page.reload();
  await expect(views(page)).toHaveText("Viewed once by 1 person");
  await open(page, `/p/${ID}/list`); // another tab of the same page is no new view either
  await expect(views(page)).toHaveText("Viewed once by 1 person");

  // somebody else: one more view, one more person
  await signIn(page, CASEY);
  await visit(page);
  await page.reload();
  await expect(views(page)).toHaveText("Viewed 2 times by 2 people");
  await signIn(page, SAM);
  await visit(page);
  await page.reload();
  await expect(views(page)).toHaveText("Viewed 2 times by 2 people");

  // the server counts the same: through the API, a second view is no view
  expect((await page.request.post(`/api/views/process/${ID}`, { headers: CSRF })).status()).toBe(204);
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[ID]).toMatchObject({ views: 2, people: 2 });
});

test("a view of what a person may not see is refused, and its numbers are not shown to them", async ({ page }) => {
  await signIn(page, SAM);
  expect((await page.request.post(`/api/views/process/${DRAFT}`, { headers: CSRF })).status()).toBe(404);
  expect((await page.request.post("/api/views/process/no-such-process", { headers: CSRF })).status()).toBe(404);
  expect((await page.request.put(`/api/upvotes/process/${DRAFT}`, { headers: CSRF })).status()).toBe(404);
  // the draft is counted for those who may see it, and never listed for those who may not
  await signIn(page, ALEX);
  expect((await page.request.post(`/api/views/process/${DRAFT}`, { headers: CSRF })).status()).toBe(204);
  await signIn(page, SAM);
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[DRAFT]).toBeUndefined();
});

test("downloading the skill counts", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, `/p/${ID}/skills`);
  const before = (await (await page.request.get("/api/engagement")).json()).counts.process[ID]?.downloads ?? 0;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("SKILL.md");
  await page.reload();
  await expect(stats(page)).toContainText(before === 0 ? "Skill downloaded once" : `Skill downloaded ${before + 1} times`);
  // each download counts, also one made without the page
  await page.request.get(`/api/skills/process-${ID}/download`);
  await page.reload();
  await expect(stats(page)).toContainText(`Skill downloaded ${before + 2} times`);
});

test("an upvote is one per person and can be taken back", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  const engage = page.getByRole("group", { name: "Use and feedback" });
  await engage.getByRole("button", { name: `Upvote ${TITLE} (0)` }).click();
  const mine = engage.getByRole("button", { name: `Take back your upvote of ${TITLE} (1)` });
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await expect(mine).toHaveText(/^1\s*upvote$/);
  // a second upvote by the same person, straight to the server, adds nothing
  const again = await page.request.put(`/api/upvotes/process/${ID}`, { headers: CSRF });
  expect(await again.json()).toEqual({ upvotes: 1 });
  await page.reload();
  await expect(mine).toHaveText(/^1\s*upvote$/);

  // another person adds one
  await signIn(page, ALEX);
  await open(page, `/p/${ID}/flow`);
  await engage.getByRole("button", { name: `Upvote ${TITLE} (1)` }).click();
  await expect(engage.getByRole("button", { name: `Take back your upvote of ${TITLE} (2)` })).toHaveText(/^2\s*upvotes$/);
  await engage.getByRole("button", { name: `Take back your upvote of ${TITLE} (2)` }).click();
  await expect(engage.getByRole("button", { name: `Upvote ${TITLE} (1)` })).toHaveAttribute("aria-pressed", "false");

  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  await engage.getByRole("button", { name: `Take back your upvote of ${TITLE} (1)` }).click();
  await expect(engage.getByRole("button", { name: `Upvote ${TITLE} (0)` })).toHaveText(/^0\s*upvotes$/);
  const off = await page.request.delete(`/api/upvotes/process/${ID}`, { headers: CSRF }); // twice is still none
  expect(await off.json()).toEqual({ upvotes: 0 });
});

test("a standard shows its numbers, upvote and bookmark too", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/s/code-review/doc");
  const engage = page.getByRole("group", { name: "Use and feedback" });
  await expect(engage.locator(".engage-stats li").nth(0)).toHaveText(/^Viewed (once|\d+ times) by \d+ (person|people)$/);
  await expect(engage.locator(".engage-stats li").nth(1)).toHaveText(/^Skill (not downloaded yet|downloaded (once|\d+ times))$/);
  await expect(engage.locator(".engage-stats")).toContainText(/feedback open/);
  await expect(engage.locator(".engage-stats")).toContainText(/feedback handled/);
  await expect(page.getByRole("button", { name: "Report a problem", exact: true })).toHaveCount(0);
  const up = engage.getByRole("button", { name: /^Upvote Code review \(\d+\)$/ });
  const n = Number((await up.getAttribute("aria-label"))!.match(/\((\d+)\)/)![1]);
  await up.click();
  await expect(engage.getByRole("button", { name: `Take back your upvote of Code review (${n + 1})` })).toBeVisible();
  await engage.getByRole("button", { name: "Bookmark Code review" }).click();
  await expect(engage.getByRole("button", { name: "Remove bookmark from Code review" })).toContainText("Bookmarked");
  await page.reload();
  await engage.getByRole("button", { name: `Take back your upvote of Code review (${n + 1})` }).click();
  await engage.getByRole("button", { name: "Remove bookmark from Code review" }).click();
  await expect(engage.getByRole("button", { name: "Bookmark Code review" })).toContainText("Bookmark");
  await expect(engage.getByRole("button", { name: `Upvote Code review (${n})` })).toBeVisible();
  await engage.getByRole("button", { name: "Give feedback" }).click();
  await expect(page).toHaveURL(/#\/s\/code-review\/feedback$/);
  await expect(page.getByRole("textbox", { name: "Your feedback" })).toBeFocused();
});

test("open and handled feedback follow reporting and “Mark as fixed”", async ({ page, request }) => {
  await report(request, SAM, { targetId: ID, text: "The budget form moved to another page." });
  await report(request, SAM, { targetId: ID, itemId: "approve-budget", text: "Who approves above 10,000?" });
  await signIn(page, ALEX, { editor: true });
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page).locator(".engage-open")).toHaveText("2 pieces of feedback open");
  await expect(stats(page).locator(".engage-open")).toHaveClass(/\bhas\b/);
  await expect(stats(page)).toContainText("0 pieces of feedback handled");

  await page.getByRole("tab", { name: /Feedback/ }).click();
  await page.locator(".fb-item", { hasText: "The budget form moved" }).getByRole("button", { name: "Mark as fixed" }).click();
  await expect(page.getByRole("heading", { name: "1 open · 1 handled" })).toBeVisible();
  await expect(stats(page).locator(".engage-open")).toHaveText("1 piece of feedback open");
  await expect(stats(page)).toContainText("1 piece of feedback handled");
  await page.locator(".fb-item", { hasText: "Who approves" }).getByRole("button", { name: "Mark as fixed" }).click();
  await expect(stats(page).locator(".engage-open")).toHaveText("No feedback open");
  await expect(stats(page).locator(".engage-open")).not.toHaveClass(/\bhas\b/);
  await expect(stats(page)).toContainText("2 pieces of feedback handled");

  // a reader sees the same, and "handled" is in the numbers of the server
  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page)).toContainText("2 pieces of feedback handled");
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[ID].handled).toBe(2);
});

test.describe("sharing", () => {
  test("Copy link, Slack and Google Chat put the right text on the clipboard; Email fills in a mail", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, SAM);
    await open(page, `/p/${ID}/flow/approve-budget`); // a step is open: the link is still to the process itself
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: `Share “${TITLE}”` });
    const url = `http://127.0.0.1:8090/#/p/${ID}`;
    await expect(dialog.locator(".share-url")).toHaveText(url);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    await dialog.getByRole("button", { name: /Copy link/ }).click();
    await expect(dialog.getByRole("status")).toHaveText("Copied. Paste it where you want to share it.");
    await expect(dialog.getByRole("button", { name: /^Copied/ })).toBeFocused();
    expect(await clipboard()).toBe(url);

    const options = dialog.locator(".share-option");
    await dialog.getByRole("button", { name: /Copy message for Slack/ }).click();
    await expect(options.nth(1)).toHaveClass(/\bcopied\b/);
    await expect(options.nth(0)).not.toHaveClass(/\bcopied\b/); // one at a time
    expect(await clipboard()).toBe(`*${TITLE}*\n${SUMMARY}\n${url}`);
    const html = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return item.types.includes("text/html") ? (await item.getType("text/html")).text() : "";
    });
    expect(html).toContain(`<b>${TITLE}</b>`);
    expect(html).toContain("views &amp; upvotes");
    expect(html).toContain(`<a href="${url}">`);

    await page.evaluate(() => navigator.clipboard.writeText("")); // so that the next copy is seen
    await dialog.getByRole("button", { name: /Copy message for Google Chat/ }).click();
    await expect(options.nth(2)).toHaveClass(/\bcopied\b/);
    expect(await clipboard()).toBe(`*${TITLE}*\n${SUMMARY}\n${url}`);

    const mail = dialog.getByRole("link", { name: /Email/ });
    const href = (await mail.getAttribute("href"))!;
    expect(href.startsWith(`mailto:?subject=${encodeURIComponent(TITLE)}&body=`)).toBe(true);
    const body = decodeURIComponent(href.split("&body=")[1]);
    expect(body).toContain(`“${TITLE}”`);
    expect(body).toContain(SUMMARY);
    expect(body).toContain(url);
    expect(href).not.toMatch(/\s/); // nothing in it left unencoded
    expect(href).toContain(encodeURIComponent("&")); // "&" in the summary is encoded, so the body is not cut short

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share" })).toBeFocused();
  });

  test("when the browser refuses to copy, the text is shown to copy by hand", async ({ page }) => {
    await signIn(page, SAM);
    await page.addInitScript(() => {
      const refuse = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: refuse, write: refuse, readText: refuse } });
      document.execCommand = () => false;
    });
    await open(page, "/s/secure-logging/doc");
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: "Share “Secure logging”" });
    await dialog.getByRole("button", { name: /Copy link/ }).click();
    const field = dialog.getByRole("textbox", { name: "Text to copy" });
    await expect(field).toHaveValue("http://127.0.0.1:8090/#/s/secure-logging");
    await expect(field).toBeFocused();
    await expect(dialog).toContainText("Your browser did not allow copying.");
    await expect(dialog.getByRole("status")).toHaveText("");
    await dialog.getByRole("button", { name: /Copy message for Google Chat/ }).click();
    await expect(field).toHaveValue(/^\*Secure logging\*\n.+\nhttp:\/\/127\.0\.0\.1:8090\/#\/s\/secure-logging$/);
  });
});
