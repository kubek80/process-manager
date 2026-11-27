import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, JORDAN, open, report, SAM, signIn } from "./helpers";

// How much a process or standard is used, upvotes, bookmarks and sharing. The numbers are kept
// by the server for everyone, so these tests work on a process of their own and count from
// what was there before.

const ID = "engage-demo";
const TITLE = "Engage demo";
const DRAFT = "engage-draft-demo";
const HIDDEN = "engage-hidden-demo"; // active at first, a draft later
const SUMMARY = "A copy of the GCP process for counting views & upvotes.";

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-gcp-project");
  for (const [id, title, status] of [[ID, TITLE, "active"], [DRAFT, "Engage draft demo", "draft"], [HIDDEN, "Engage hidden demo", "active"]]) {
    await request.delete(`/api/processes/${id}`, { headers: CSRF });
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, summary: SUMMARY, status }, headers: CSRF });
    expect(res.ok(), `create ${id}`).toBeTruthy();
  }
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  for (const id of [ID, DRAFT, HIDDEN]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

const stats = (page: Page) => page.locator(".doc-engage .engage-stats");
const views = (page: Page) => stats(page).locator("li").nth(0);

/**
 * Opens the process in a new page load, waits until the server has counted the view, and gives
 * how often the page asked for the numbers.
 */
async function visit(page: Page, hash = `/p/${ID}/flow`) {
  await page.goto("about:blank"); // a new page load: the page counts once per load
  const loads: string[] = [];
  const onRequest = (r: import("@playwright/test").Request) => { if (r.method() === "GET" && new URL(r.url()).pathname === "/api/engagement") loads.push(r.url()); };
  page.on("request", onRequest);
  const counted = page.waitForResponse((r) => r.url().includes(`/api/views/process/${ID}`) && r.request().method() === "POST");
  await open(page, hash);
  const res = await counted;
  expect(res.status()).toBe(200);
  const body = await res.json();
  await expect(views(page)).not.toHaveText("–");
  await page.waitForTimeout(300); // a second load of the numbers would come now
  page.off("request", onRequest);
  return { body, loads: loads.length };
}

test("a view counts once per person per day, shows at once, and the numbers are loaded once", async ({ page }) => {
  await signIn(page, SAM);
  let v = await visit(page);
  expect(v.body).toEqual({ views: 1, people: 1 });
  expect(v.loads).toBe(1);
  // the person's own first view of the day shows without a reload
  await expect(views(page)).toHaveText("1 view by 1 person");
  // what is zero and says nothing is left out: no downloads, no feedback open or handled
  await expect(stats(page).locator(".engage-downloads")).toHaveCount(0);
  await expect(stats(page).locator(".engage-open")).toHaveCount(0);
  await expect(stats(page).locator(".engage-handled")).toHaveCount(0);
  await expect(stats(page)).not.toContainText(/not downloaded|No feedback|0 pieces/);

  // again the same day: no more
  v = await visit(page);
  expect(v.body).toEqual({ views: 1, people: 1 });
  expect(v.loads).toBe(1);
  await expect(views(page)).toHaveText("1 view by 1 person");
  await open(page, `/p/${ID}/list`); // another tab of the same page is no new view either
  await expect(views(page)).toHaveText("1 view by 1 person");

  // somebody else, on a process that already has views: one more view and person, at once, one load
  await signIn(page, CASEY);
  v = await visit(page);
  expect(v.body).toEqual({ views: 2, people: 2 });
  expect(v.loads).toBe(1);
  await expect(views(page)).toHaveText("2 views by 2 people");
  await signIn(page, SAM);
  v = await visit(page);
  expect(v.body).toEqual({ views: 2, people: 2 });
  await expect(views(page)).toHaveText("2 views by 2 people");

  // the server counts the same: through the API, a second view is no view
  const again = await page.request.post(`/api/views/process/${ID}`, { headers: CSRF });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ views: 2, people: 2 });
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[ID]).toMatchObject({ views: 2, people: 2 });
});

test("while the numbers are not known, nothing pretends to know them", async ({ page }) => {
  await signIn(page, SAM);
  await page.route("**/api/engagement", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Refused for this test." }) }));
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page).locator(".engage-unknown")).toHaveText("The numbers are not available right now.");
  await expect(stats(page).locator(".engage-handled")).toHaveCount(0);
  await expect(stats(page).locator(".engage-open")).toHaveCount(0); // the page knows its own feedback: none open, nothing said
  const engage = page.locator(".engage-actions");
  const up = engage.getByRole("button", { name: `Upvote ${TITLE}`, exact: true });
  await expect(up).toHaveText("Upvote");
  await expect(up).not.toHaveAttribute("aria-pressed", /.*/);
  await expect(engage.getByRole("button", { name: `Bookmark ${TITLE}`, exact: true })).not.toHaveAttribute("aria-pressed", /.*/);

  // in the lists: no buttons on the cards, and the bookmark filter says why it cannot be used
  await open(page, "/processes");
  await expect(page.locator(`li.card[data-id="${ID}"] .card-engage`)).toHaveClass(/\bpending\b/);
  await expect(page.locator(`li.card[data-id="${ID}"]`).getByRole("button", { name: /^(Upvote|Bookmark) / })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Only my bookmarks: your bookmarks could not be loaded" })).toBeDisabled();
});

test("a click made while the numbers are still loading is kept", async ({ page, request }) => {
  await signIn(page, SAM);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route("**/api/engagement", async (route) => { await held; await route.continue(); });
  await open(page, `/p/${ID}/flow`);
  const engage = page.locator(".engage-actions");
  await expect(stats(page).locator(".engage-unknown")).toBeVisible();
  const bookmark = engage.getByRole("button", { name: `Bookmark ${TITLE}`, exact: true });
  const put = page.waitForResponse((r) => r.url().includes(`/api/bookmarks/process/${ID}`) && r.request().method() === "PUT");
  await bookmark.click();
  expect((await put).status()).toBe(204);
  await expect(engage.getByRole("button", { name: `Remove bookmark from ${TITLE}` })).toHaveAttribute("aria-pressed", "true");
  release();
  await expect(views(page)).toHaveText(/^\d+ views? by \d+ (person|people)$/);
  await page.waitForTimeout(300);
  await expect(engage.getByRole("button", { name: `Remove bookmark from ${TITLE}` })).toHaveAttribute("aria-pressed", "true");
  await page.unroute("**/api/engagement");
  await page.reload();
  await expect(engage.getByRole("button", { name: `Remove bookmark from ${TITLE}` })).toHaveAttribute("aria-pressed", "true");
  await as(request, SAM);
  expect((await request.delete(`/api/bookmarks/process/${ID}`, { headers: CSRF })).status()).toBe(204);
});

test("the bookmark filter says it is loading while the bookmarks are on their way", async ({ page }) => {
  await signIn(page, SAM);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route("**/api/engagement", async (route) => { await held; await route.continue(); });
  await open(page, "/processes");
  await expect(page.getByRole("checkbox", { name: "Only my bookmarks: loading your bookmarks…" })).toBeDisabled();
  await expect(page.locator(".card-engage.pending").first()).toBeAttached();
  release();
  await expect(page.getByRole("checkbox", { name: /^Only my bookmarks, \d+ results?$/ })).toBeEnabled();
  await expect(page.locator(".card-engage.pending")).toHaveCount(0);
});

test("a view of what a person may not see is refused, and its numbers are not shown to them", async ({ page }) => {
  await signIn(page, SAM);
  expect((await page.request.post(`/api/views/process/${DRAFT}`, { headers: CSRF })).status()).toBe(404);
  expect((await page.request.post("/api/views/process/no-such-process", { headers: CSRF })).status()).toBe(404);
  expect((await page.request.put(`/api/upvotes/process/${DRAFT}`, { headers: CSRF })).status()).toBe(404);
  // the draft is counted for those who may see it, and never listed for those who may not
  await signIn(page, ALEX);
  expect((await page.request.post(`/api/views/process/${DRAFT}`, { headers: CSRF })).status()).toBe(200);
  await signIn(page, SAM);
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[DRAFT]).toBeUndefined();
});

test("a skill download counts once per person and day", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, `/p/${ID}/skills`);
  await expect(stats(page).locator(".engage-downloads")).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("SKILL.md");
  await page.reload();
  await expect(stats(page)).toContainText("1 skill download");
  // the same person again the same day: no more
  expect((await page.request.get(`/api/skills/process-${ID}/download`)).ok()).toBeTruthy();
  await page.reload();
  await expect(stats(page)).toContainText("1 skill download");
  // another person: one more
  await signIn(page, SAM);
  expect((await page.request.get(`/api/skills/process-${ID}/download`)).ok()).toBeTruthy();
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page)).toContainText("2 skill downloads");
});

test("an upvote can be taken back from what the person no longer sees", async ({ page, request }) => {
  await signIn(page, SAM);
  expect(await (await page.request.put(`/api/upvotes/process/${HIDDEN}`, { headers: CSRF })).json()).toEqual({ upvotes: 1 });
  // the process becomes a draft: Sam no longer sees it
  await as(request, ALEX);
  const { processes, meta } = await (await request.get("/api/processes")).json();
  const doc = processes.find((p: { id: string }) => p.id === HIDDEN);
  expect((await request.put(`/api/processes/${HIDDEN}?base=${meta[HIDDEN].version}`, { data: { ...doc, status: "draft" }, headers: CSRF })).ok()).toBeTruthy();
  const off = await page.request.delete(`/api/upvotes/process/${HIDDEN}`, { headers: CSRF });
  expect(off.status()).toBe(204);
  expect(await off.text()).toBe("");
  const { mine, counts } = await (await page.request.get("/api/engagement")).json();
  expect(mine.upvotes.some((u: { id: string }) => u.id === HIDDEN)).toBe(false);
  expect(counts.process[HIDDEN]).toBeUndefined();
  // and upvoting it again is refused
  expect((await page.request.put(`/api/upvotes/process/${HIDDEN}`, { headers: CSRF })).status()).toBe(404);
  await as(request, ALEX);
  expect((await (await request.get("/api/engagement")).json()).counts.process[HIDDEN]?.upvotes ?? 0).toBe(0);
});

test("an upvote is one per person and can be taken back", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  const engage = page.locator(".engage-actions");
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
  const engage = page.locator(".engage-actions");
  const numbers = page.getByRole("group", { name: "Use and feedback" });
  await expect(numbers.locator(".engage-stats li").nth(0)).toHaveText(/^\d+ views? by \d+ (person|people)$/);
  // downloads and feedback only when there are some
  for (const li of await numbers.locator(".engage-stats li").all()) await expect(li).toHaveText(/^(\d+ views? by \d+ (person|people)|\d+ skill downloads?|\d+ pieces? of feedback (open|handled))$/);
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
  await signIn(page, ALEX);
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page).locator(".engage-open")).toHaveText("2 pieces of feedback open");
  await expect(stats(page).locator(".engage-open")).toHaveClass(/\bhas\b/);
  await expect(stats(page).locator(".engage-handled")).toHaveCount(0);

  await page.getByRole("tab", { name: /Feedback/ }).click();
  await page.locator(".fb-item", { hasText: "The budget form moved" }).getByRole("button", { name: "Mark as fixed" }).click();
  await expect(page.getByRole("heading", { name: "1 open · 1 handled" })).toBeVisible();
  await expect(stats(page).locator(".engage-open")).toHaveText("1 piece of feedback open");
  await expect(stats(page)).toContainText("1 piece of feedback handled");
  await page.locator(".fb-item", { hasText: "Who approves" }).getByRole("button", { name: "Mark as fixed" }).click();
  await expect(stats(page).locator(".engage-open")).toHaveCount(0);
  await expect(stats(page)).toContainText("2 pieces of feedback handled");

  // a reader sees the same, and "handled" is in the numbers of the server
  await signIn(page, SAM);
  await open(page, `/p/${ID}/flow`);
  await expect(stats(page)).toContainText("2 pieces of feedback handled");
  const { counts } = await (await page.request.get("/api/engagement")).json();
  expect(counts.process[ID].handled).toBe(2);
});

test.describe("sharing", () => {
  test("the link with its copy icon, “Copy link and title” and Email; no Slack or Google Chat", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, SAM);
    await open(page, `/p/${ID}/flow/approve-budget`); // a step is open: the link is still to the process itself
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: `Share “${TITLE}”` });
    const url = `http://127.0.0.1:8090/#/p/${ID}`;
    await expect(dialog.getByRole("textbox", { name: "Link" })).toHaveValue(url);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    // the copy icon sits right next to the link
    const copyLink = dialog.getByRole("button", { name: "Copy link", exact: true });
    const [field, icon] = [(await dialog.locator(".share-url").boundingBox())!, (await copyLink.boundingBox())!];
    expect(Math.abs(icon.y + icon.height / 2 - (field.y + field.height / 2))).toBeLessThan(4);
    expect(icon.x).toBeGreaterThanOrEqual(field.x + field.width - 2);
    await copyLink.click();
    await expect(dialog.getByRole("status")).toHaveText("The link was copied. Paste it where you want to share it.");
    await expect(copyLink).toHaveClass(/\bcopied\b/);
    expect(await clipboard()).toBe(url);

    await dialog.getByRole("button", { name: /^Copy link and title/ }).click();
    await expect(dialog.getByRole("status")).toHaveText("The link and title were copied. Paste them where you want to share them.");
    await expect(dialog.locator(".share-option.copied")).toContainText("Copied");
    await expect(copyLink).not.toHaveClass(/\bcopied\b/); // one at a time
    expect(await clipboard()).toBe(`${TITLE} · Pattern Catalog\n${url}`); // with the name of the portal

    await expect(dialog.getByRole("button", { name: /Slack/ })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Google Chat/ })).toHaveCount(0);
    await expect(dialog).not.toContainText("Slack");
    // this browser has no share sheet of its own: no "Share…"
    expect(await page.evaluate(() => typeof navigator.share)).toBe("undefined");
    await expect(dialog.getByRole("button", { name: /^Share…/ })).toHaveCount(0);

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

  test("“Share…” uses the device's own share sheet where the browser has one", async ({ page }) => {
    await signIn(page, SAM);
    // a browser with a share sheet; what it is asked to share is kept, and how it ends is set by the test
    await page.addInitScript(() => {
      const w = window as unknown as { shared: ShareData[]; shareEnds: string };
      w.shared = []; w.shareEnds = "ok";
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (d: ShareData) => {
          w.shared.push(d);
          return w.shareEnds === "ok" ? Promise.resolve() : Promise.reject(new DOMException("No", w.shareEnds));
        },
      });
    });
    await open(page, `/p/${ID}/flow`);
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: `Share “${TITLE}”` });
    const device = dialog.getByRole("button", { name: /^Share…/ });
    await device.click();
    const shared = () => page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared);
    expect(await shared()).toEqual([{ title: TITLE, text: SUMMARY, url: `http://127.0.0.1:8090/#/p/${ID}` }]);
    await expect(dialog.getByRole("status")).toHaveText("");

    // the person closes the share sheet without choosing: nothing to say
    await page.evaluate(() => { (window as unknown as { shareEnds: string }).shareEnds = "AbortError"; });
    await device.click();
    await expect.poll(async () => (await shared()).length).toBe(2);
    await expect(dialog.getByRole("status")).toHaveText("");
    // the device fails: the person is told, and pointed to the link
    await page.evaluate(() => { (window as unknown as { shareEnds: string }).shareEnds = "DataError"; });
    await device.click();
    await expect(dialog.getByRole("status")).toHaveText("This device could not share it. Copy the link instead.");
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
    await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
    const field = dialog.getByRole("textbox", { name: "Text to copy" });
    await expect(field).toHaveValue("http://127.0.0.1:8090/#/s/secure-logging");
    await expect(field).toBeFocused();
    await expect(dialog).toContainText("Your browser did not allow copying.");
    await expect(dialog.getByRole("status")).toHaveText("");
    await dialog.getByRole("button", { name: /^Copy link and title/ }).click();
    await expect(field).toHaveValue("Secure logging · Pattern Catalog\nhttp://127.0.0.1:8090/#/s/secure-logging");
  });
});
