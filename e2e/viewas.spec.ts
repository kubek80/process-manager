import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, MORGAN, RILEY, SAM, clearFeedback, navigate, open, putWorkingDraft, readProcess, readWorkingDraft, report, signIn } from "./helpers";

// Viewing the portal as somebody else (admins): an admin sees what a person sees, their drafts
// and their responsibilities, their refusals, their buttons, and can change nothing while doing
// so. The band at the bottom names the person and has "Stop viewing". The server enforces it;
// these tests ask it directly too. Every test stops viewing and puts back what it changed.

const GCP = "request-gcp-project";
const REFUSAL = (name: string) => `You are viewing the portal as ${name}, so nothing can be changed. Stop viewing first.`;
const EDIT_CLOSED = "The editing screen does not open while you view the portal as somebody else.";
const OUT_OF_DATE = "This page is out of date: it was opened for somebody else than the portal now answers you as. Reload the page, then do it again.";
const GC_DRAFT = "viewas-gc-draft"; // a draft of Google Cloud: Morgan, a member there, may see it
const AZ_DRAFT = "viewas-az-draft"; // a draft of Azure: Morgan may not, the admin may
const COUNTED = "viewas-counted"; // a copy of the GCP process, for counting views and downloads from nothing

const band = (page: Page) => page.getByRole("region", { name: "Viewing the portal as somebody else" });

async function as(request: APIRequestContext, email: string) {
  expect((await request.post("/auth/dev/login", { data: { email }, headers: CSRF })).ok()).toBeTruthy();
}

/** Dana, in Admin › Access, presses "View as" on a person's row; the portal opens afresh as that person, on Home. */
async function viewFromAccess(page: Page, name: string) {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  await page.getByRole("button", { name: `View the portal as ${name}` }).click();
  await expect(band(page)).toContainText(`Viewing the portal as ${name}`);
  await expect(page).toHaveURL(/#\/$/);
}

/** Viewing ends (as "Stop viewing" does) whatever a test left behind; the call is the only change allowed while viewing. */
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/admin/view-as", { headers: CSRF });
});

test.beforeAll(async ({ request }) => {
  await as(request, ALEX);
  const gcp = (await readProcess(request, GCP))!;
  for (const [id, title, extra] of [
    [GC_DRAFT, "View-as Google Cloud draft", { status: "draft" }],
    [AZ_DRAFT, "View-as Azure draft", { status: "draft", platform: "azure" }],
    [COUNTED, "View-as counted copy", {}],
  ] as const) {
    await request.delete(`/api/processes/${id}`, { headers: CSRF });
    const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...gcp, id, title, ...extra }, headers: CSRF });
    expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
  }
});

test.afterAll(async ({ request }) => {
  await as(request, ALEX);
  for (const id of [GC_DRAFT, AZ_DRAFT, COUNTED]) await request.delete(`/api/processes/${id}`, { headers: CSRF });
});

test("an admin views the portal as a person from their row in Admin › Access: their responsibilities, their drafts, their refusals; Stop viewing returns", async ({ page }) => {
  // the admin's own view first: both drafts, nothing assigned to her
  await signIn(page, DANA);
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "View-as Google Cloud draft" })).toHaveCount(1);
  await expect(page.locator(".card", { hasText: "View-as Azure draft" })).toHaveCount(1);
  await open(page, "/mine");
  await expect(page.locator(".page.mine")).toContainText("Nothing is assigned to you.");

  await viewFromAccess(page, "Morgan Member");
  await expect(band(page)).toContainText("Nothing can be changed");
  await expect(band(page)).toContainText(/Ends by itself at \d\d:\d\d/);
  await expect(band(page).getByRole("button", { name: "Stop viewing" })).toBeEnabled();
  // the server answers as Morgan, and says who is looking
  const me = await (await page.request.get("/api/me")).json();
  expect(me.user).toEqual({ email: MORGAN, name: "Morgan Member" });
  expect(me.viewedBy).toMatchObject({ email: DANA, name: "Dana Admin" });
  expect(me.perms).toMatchObject({ admin: false, memberPlatforms: ["google-cloud"], memberPractices: ["engineering"] });

  // Morgan's responsibilities, not the admin's
  await navigate(page, "My responsibilities");
  await expect(page.locator(".mine-head")).toContainText("your platforms and practices");
  await expect(page.getByRole("group", { name: "Show what belongs to" }).getByRole("button")).toHaveText(["All of mine", "Google Cloud", "Engineering"]);
  // the draft Morgan may see, and not the one only the admin may
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "View-as Google Cloud draft" })).toHaveCount(1);
  await expect(page.locator(".card", { hasText: "View-as Azure draft" })).toHaveCount(0);
  expect((await page.request.get(`/api/processes/${AZ_DRAFT}`)).status()).toBe(404);
  // the Admin panel refuses Morgan, on the page and in the server
  await open(page, "/admin/access");
  await expect(page.locator(".page")).toContainText("You do not have access to the Admin panel.");
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);

  // Stop viewing: back where it started (Admin › Access), the admin's own controls back
  await band(page).getByRole("button", { name: "Stop viewing" }).click();
  await expect(page).toHaveURL(/#\/admin\/access$/);
  await expect(band(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add person" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View the portal as Morgan Member" })).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).viewedBy).toBeUndefined();
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "View-as Azure draft" })).toHaveCount(1);
});

test("the picker in Admin › Access: a typed address, its problems in words, and a reader with no roles", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  const picker = page.getByRole("region", { name: "See the portal as somebody else" });
  const field = picker.getByRole("combobox", { name: "Email of the person whose view you want to see" });
  const go = picker.getByRole("button", { name: "View as", exact: true });
  await go.click();
  await expect(picker.getByRole("alert")).toHaveText("Type the person's email address, or choose somebody from the list.");
  await field.fill("not an address");
  await go.click();
  await expect(picker.getByRole("alert")).toHaveText("That is not an email address. Write one, such as name@company.com.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill(DANA.toUpperCase());
  await go.click();
  await expect(picker.getByRole("alert")).toHaveText("This is you: the portal already shows your own view.");
  // the server says the same for oneself
  const self = await page.request.post("/api/admin/view-as", { data: { email: DANA }, headers: CSRF });
  expect(self.status()).toBe(400);
  expect((await self.json()).error).toBe("You cannot view the portal as yourself: this is already your view.");

  // an address the portal has never seen: a signed-in person without roles, shown by the address
  const nobody = "quinn.viewed@example.com";
  await field.fill(nobody);
  await go.click();
  await expect(band(page)).toContainText(`Viewing the portal as ${nobody}`);
  await expect(page).toHaveURL(/#\/$/);
  expect((await (await page.request.get("/api/me")).json()).perms).toMatchObject({ admin: false, processes: false, standards: false, catalog: false });
  await band(page).getByRole("button", { name: "Stop viewing" }).click();
  await expect(page).toHaveURL(/#\/admin\/access$/);
  await expect(band(page)).toHaveCount(0);
  // nothing was stored in that person's name: they are not a person with roles now
  expect(((await (await page.request.get("/api/admin/users")).json()).users ?? []).map((u: { email: string }) => u.email)).not.toContain(nobody);

  // "View as a reader with no roles": no address needed
  await picker.getByRole("button", { name: "View as a reader with no roles" }).click();
  await expect(band(page)).toContainText("Viewing the portal as A reader with no roles");
  await open(page, "/processes");
  await expect(page.locator(".card").first()).toBeVisible();
  await expect(page.locator(".card", { hasText: "View-as Google Cloud draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New process" })).toHaveCount(0);
});

test("the band stays in sight while scrolling, on a phone and in dark, and is not printed", async ({ page }) => {
  await viewFromAccess(page, "Casey Owner");
  await page.addInitScript(() => { try { localStorage.setItem("pm:theme", "dark"); } catch { /* ignore */ } }); // after signIn's "light"
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, `/p/${GCP}/checklist`);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("h1")).toBeVisible();
  for (const where of ["top", "bottom"]) {
    if (where === "bottom") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(band(page), where).toBeInViewport({ ratio: 1 });
    await expect(band(page).getByRole("button", { name: "Stop viewing" }), where).toBeInViewport({ ratio: 1 });
    const box = (await band(page).boundingBox())!;
    expect(Math.round(box.y + box.height), `${where}: on the bottom edge`).toBe(800);
    expect(box.width, where).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // in dark it keeps the warning state's fill and ink
  const [ground, fill] = await band(page).evaluate((e) => {
    const probe = document.createElement("span");
    probe.style.background = "var(--warn-fill)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(e).backgroundColor, want];
  });
  expect(ground).toBe(fill);
  await page.emulateMedia({ media: "print" });
  await expect(band(page)).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(band(page)).toBeVisible();
});

test("while viewing, what would change something is greyed with the sentence, on every page", async ({ page, request }) => {
  test.setTimeout(90_000);
  const disabledWithReason = async (locator: ReturnType<Page["locator"]>, name: string, what: string) => {
    await expect(locator, what).toBeVisible();
    await expect(locator, what).toBeDisabled();
    await expect(locator, what).toHaveAttribute("title", REFUSAL(name));
  };
  await report(request, SAM, { targetId: GCP, itemId: "raise-request", text: "The form has a new name." });
  try {
    // Casey: owner of the team that maintains the GCP process
    await viewFromAccess(page, "Casey Owner");
    await open(page, `/p/${GCP}`);
    for (const label of [/^Bookmark/, /^Upvote /, /^Give feedback$/, /^Mark as reviewed$/]) await disabledWithReason(page.getByRole("button", { name: label }).first(), "Casey Owner", `reader's page: ${label}`);
    await open(page, `/p/${GCP}/feedback`);
    await disabledWithReason(page.locator(".fb-item").getByRole("button", { name: "I hit this too" }), "Casey Owner", "feedback: I hit this too");
    await open(page, "/mine");
    await disabledWithReason(page.locator("#mine-feedback").locator("xpath=..").getByRole("button", { name: "Mark as fixed" }).first(), "Casey Owner", "My responsibilities: Mark as fixed");
    await open(page, "/requests");
    await disabledWithReason(page.getByRole("button", { name: "Ask for a process or standard" }).first(), "Casey Owner", "requests: ask");
    await band(page).getByRole("button", { name: "Stop viewing" }).click();
    await expect(band(page)).toHaveCount(0);

    // Jordan: owner of Google Cloud, on its page: details, a new process, the members
    await viewFromAccess(page, "Jordan Platform");
    await open(page, "/platform/google-cloud");
    await disabledWithReason(page.getByRole("button", { name: "Edit details" }), "Jordan Platform", "group page: Edit details");
    await disabledWithReason(page.locator("section.group-docs").getByRole("button", { name: "New process" }), "Jordan Platform", "group page: New process");
    const people = page.getByRole("region", { name: "People" });
    const add = people.getByRole("textbox", { name: "Email of the new member" });
    await add.fill("someone.new@example.com"); // what is typed stays, adding is not available
    await expect(add).toHaveValue("someone.new@example.com");
    await disabledWithReason(people.locator('.cat-members[data-rank="member"]').getByRole("button", { name: /^Add/ }), "Jordan Platform", "members: Add");
    await disabledWithReason(people.getByRole("button", { name: `Remove ${MORGAN} as Platform member` }), "Jordan Platform", "members: remove");
    await band(page).getByRole("button", { name: "Stop viewing" }).click();
    await expect(band(page)).toHaveCount(0);

    // Alex: process editor and lists manager: the list, a skill's guidance, Admin › Tools
    await viewFromAccess(page, "Alex Editor");
    await open(page, "/processes");
    await disabledWithReason(page.getByRole("button", { name: "New process", exact: true }), "Alex Editor", "list: New process");
    await disabledWithReason(page.getByRole("button", { name: "Create from text with AI" }), "Alex Editor", "list: Create from text with AI");
    await open(page, `/p/${GCP}/skills`);
    const panel = page.locator(".skill-panel");
    await panel.getByRole("button", { name: "Add guidance" }).click();
    await panel.locator(".skill-extra textarea").fill("Typed while viewing.");
    await disabledWithReason(panel.getByRole("button", { name: "Save and regenerate" }), "Alex Editor", "skill: Save and regenerate");
    await open(page, "/admin/tools");
    await page.getByRole("tab", { name: /^Tools/ }).click();
    const desc = page.locator(".cat-detail textarea, .cat-detail input").first();
    await desc.fill(`${await desc.inputValue()} (typed while viewing)`);
    await disabledWithReason(page.getByRole("button", { name: "Save changes" }), "Alex Editor", "Admin › Tools: Save changes");
  } finally {
    await clearFeedback(request, "process", GCP);
  }
});

test("while viewing an admin, Theming and Access are greyed too, and nothing is saved", async ({ page, request }) => {
  await as(request, DANA);
  expect((await request.post("/api/admin/access", { data: { email: RILEY, role: "admin", scope: "" }, headers: CSRF })).ok()).toBeTruthy();
  try {
    await viewFromAccess(page, "Riley Security");
    await open(page, "/admin/access");
    for (const button of [page.getByRole("button", { name: "Add person" }), page.getByRole("button", { name: "Edit Alex Editor" })]) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("title", REFUSAL("Riley Security"));
    }
    // an admin viewed is not an admin who views: no "View as" while viewing
    await expect(page.locator("li.user-row").first()).toBeVisible();
    await expect(page.locator("button.viewas-start")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "See the portal as somebody else" })).toHaveCount(0);
    await open(page, "/admin/theming");
    await page.locator(".theme-section").getByLabel(/^Name of the portal/).fill("Typed while viewing");
    const save = page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save for everyone" });
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("title", REFUSAL("Riley Security"));
    expect((await (await request.get("/api/admin/theme")).json()).look).toEqual({});
  } finally {
    await page.request.delete("/api/admin/view-as", { headers: CSRF });
    expect((await request.delete("/api/admin/access", { data: { email: RILEY, role: "admin", scope: "" }, headers: CSRF })).ok()).toBeTruthy();
  }
});

test("the editing screen does not open while viewing, by no address and no link", async ({ page }) => {
  await viewFromAccess(page, "Morgan Member");
  const closed = page.locator(".toast", { hasText: EDIT_CLOSED });
  for (const [hash, reader] of [
    [`/p/${GCP}/edit`, `/p/${GCP}/flow`], [`/p/${GCP}/json`, `/p/${GCP}/flow`], [`/p/${GCP}/editor`, `/p/${GCP}/flow`],
    [`/p/${GCP}/edit/raise-request`, `/p/${GCP}/flow`], ["/s/infrastructure-as-code/edit?x", "/s/infrastructure-as-code/doc"],
  ]) {
    await open(page, hash);
    await expect(page, hash).toHaveURL(new RegExp(`#${reader.replace(/[.?]/g, "\\$&")}$`));
    await expect(page.locator(".edit-bar"), hash).toHaveCount(0);
    await expect(closed, hash).toContainText(REFUSAL("Morgan Member"));
    await page.locator(".toast").getByRole("button", { name: /Close|Dismiss/ }).first().click().catch(() => { /* gone by itself */ });
  }
  // the Edit link of the reader's page is there, as Morgan sees it, and says why when pressed
  await open(page, `/p/${GCP}`);
  const edit = page.getByRole("link", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(closed).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/p/${GCP}$`));
  await expect(page.locator(".edit-bar")).toHaveCount(0);
});

test("a change sent anyway is refused by the server with the sentence, and nothing changes", async ({ page }) => {
  await viewFromAccess(page, "Morgan Member");
  const refused = async (what: string, res: APIResponse) => {
    expect(res.status(), what).toBe(403);
    expect((await res.json()).error, what).toBe(REFUSAL("Morgan Member"));
  };
  const gcp = (await readProcess(page, GCP))!;
  await refused("a working draft", await putWorkingDraft(page, "process", GCP, { ...gcp, title: "Changed while viewing" }));
  await refused("a bookmark", await page.request.put(`/api/bookmarks/process/${GCP}`, { headers: CSRF }));
  await refused("feedback", await page.request.post("/api/feedback", { data: { targetKind: "process", targetId: GCP, kind: "broken", text: "Sent while viewing." }, headers: CSRF }));
  await refused("a request", await page.request.post("/api/requests", { data: { kind: "process", title: "Asked while viewing", why: "Because." }, headers: CSRF }));
  await refused("the lists", await page.request.put("/api/catalog", { data: {}, headers: CSRF }));
  // starting again, or as somebody else, needs a stop first
  const again = await page.request.post("/api/admin/view-as", { data: { email: SAM }, headers: CSRF });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toBe("You are already viewing the portal as Morgan Member. Stop viewing first, then choose another person.");
  // nothing was stored: no draft, no bookmark, no feedback
  expect(await readWorkingDraft(page, "process", GCP)).toBeUndefined();
  expect((await (await page.request.get("/api/engagement")).json()).mine.bookmarks).toEqual([]);
  expect(JSON.stringify(await (await page.request.get("/api/feedback")).json())).not.toContain("Sent while viewing.");
  await band(page).getByRole("button", { name: "Stop viewing" }).click();
  await expect(band(page)).toHaveCount(0);
  expect(await readWorkingDraft(page, "process", GCP)).toBeUndefined();
  expect(((await (await page.request.get("/api/requests")).json()).requests ?? []).map((r: { title: string }) => r.title)).not.toContain("Asked while viewing");
});

test("no view and no skill download is counted while viewing", async ({ page }) => {
  const counts = async () => ((await (await page.request.get("/api/engagement")).json()).counts.process[COUNTED] ?? { views: 0, downloads: 0 }) as { views: number; downloads: number };
  await viewFromAccess(page, "Morgan Member");
  const sent: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET") sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await open(page, `/p/${COUNTED}/skills`);
  await expect(page.locator(".skill-panel")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("SKILL.md");
  expect((await page.request.get(`/api/skills/process-${COUNTED}/download`)).ok()).toBeTruthy();
  await open(page, `/p/${COUNTED}/flow`);
  await expect(page.locator("h1")).toHaveText("View-as counted copy");
  await page.waitForTimeout(500); // a view would be sent now
  expect(sent).toEqual([]);
  await band(page).getByRole("button", { name: "Stop viewing" }).click();
  await expect(band(page)).toHaveCount(0);
  expect(await counts()).toMatchObject({ views: 0, downloads: 0 });
  // the admin's own visit and download do count: the counting works
  await open(page, `/p/${COUNTED}/flow`);
  await expect.poll(async () => (await counts()).views).toBe(1);
  expect((await page.request.get(`/api/skills/process-${COUNTED}/download`)).ok()).toBeTruthy();
  expect((await counts()).downloads).toBe(1);
});

test("Activity shows the start and the stop in the admin's name; the viewed person sees nothing of it", async ({ page, browser, baseURL }) => {
  await viewFromAccess(page, "Jordan Platform");
  await band(page).getByRole("button", { name: "Stop viewing" }).click();
  await expect(band(page)).toHaveCount(0);
  await open(page, "/admin/activity");
  const log = page.locator(".activity li");
  await expect(log.nth(0)).toContainText("Dana Admin stopped viewing the portal as Jordan Platform");
  await expect(log.nth(1)).toContainText("Dana Admin started viewing the portal as Jordan Platform");
  const { entries } = await (await page.request.get("/api/admin/audit")).json();
  expect(entries.slice(0, 2).map((e: { email: string; action: string; target: string }) => [e.email, e.action, e.target])).toEqual([[DANA, "viewas.stop", JORDAN], [DANA, "viewas.start", JORDAN]]);

  // Jordan, in a browser of his own: no band, no trace, his own controls
  const ctx = await browser.newContext({ baseURL });
  const jordan = await ctx.newPage();
  await as(jordan.request, JORDAN);
  await jordan.goto("/#/platform/google-cloud");
  await expect(jordan.getByRole("button", { name: "Edit details" })).toBeEnabled();
  await expect(band(jordan)).toHaveCount(0);
  const me = await (await jordan.request.get("/api/me")).json();
  expect(me.user.email).toBe(JORDAN);
  expect(me.viewedBy).toBeUndefined();
  expect((await jordan.request.get("/api/admin/audit")).status()).toBe(403);
  await ctx.close();
});

test("nobody but an admin has View as anywhere, and the server refuses them", async ({ page }) => {
  for (const who of [SAM, ALEX, JORDAN]) {
    await signIn(page, who);
    const res = await page.request.post("/api/admin/view-as", { data: { email: CASEY }, headers: CSRF });
    expect(res.status(), who).toBe(403);
    expect((await res.json()).error, who).toBe("Only admins can do that.");
    expect((await (await page.request.get("/api/me")).json()).viewedBy, who).toBeUndefined();
  }
  // Jordan sees the people of his platform, without View as
  await open(page, "/platform/google-cloud");
  await expect(page.getByRole("region", { name: "People" })).toContainText("Morgan Member");
  await expect(page.locator("button.viewas-start")).toHaveCount(0);
  // Alex has an Admin panel (the lists), without Access and without the picker
  await signIn(page, ALEX);
  await open(page, "/admin/access");
  await expect(page.locator(".admin-nav")).not.toContainText("Access");
  await expect(page.locator("button.viewas-start")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "See the portal as somebody else" })).toHaveCount(0);
  // the admin has it on the same group page
  await signIn(page, DANA);
  await open(page, "/platform/google-cloud");
  await expect(page.getByRole("button", { name: "View the portal as Morgan Member" })).toBeVisible();
});

test("a page left open follows when viewing starts or stops in another tab; its stale change gets the out-of-date answer", async ({ page, context }) => {
  await signIn(page, DANA);
  await open(page, `/p/${GCP}`);
  await expect(page.getByRole("button", { name: /^Bookmark/ }).first()).toBeEnabled();
  // another tab of the same browser starts viewing as Morgan
  const other = await context.newPage();
  await other.goto("/#/admin/access");
  await other.getByRole("button", { name: "View the portal as Morgan Member" }).click();
  await expect(band(other)).toBeVisible();
  // the first tab, still drawn for the admin: its change is refused, nothing is done as anybody
  await page.getByRole("button", { name: /^Bookmark/ }).first().click();
  await expect(page.locator(".toast")).toContainText(REFUSAL("Morgan Member"));
  // when it comes back into view it opens afresh as Morgan
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(band(page)).toContainText("Viewing the portal as Morgan Member");
  await expect(page.getByRole("button", { name: /^Bookmark/ }).first()).toBeDisabled();

  // the other tab stops; the first still shows Morgan: a change it sends as Morgan is out of date
  await band(other).getByRole("button", { name: "Stop viewing" }).click();
  await expect(band(other)).toHaveCount(0);
  const stale = await page.evaluate(async (gcp) => {
    const r = await fetch(`/api/bookmarks/process/${gcp}`, { method: "PUT", headers: { "X-Requested-With": "process-manager", "X-Acting-As": encodeURIComponent("morgan@example.com") } });
    return { status: r.status, body: await r.json() };
  }, GCP);
  expect(stale).toEqual({ status: 409, body: { error: OUT_OF_DATE } });
  expect((await (await page.request.get("/api/engagement")).json()).mine.bookmarks).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(band(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bookmark/ }).first()).toBeEnabled();
});

test("a page left open for one person refuses a change once another signed in behind it", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}`);
  const bookmark = page.getByRole("button", { name: /^Bookmark/ }).first();
  await expect(bookmark).toBeEnabled();
  // somebody else signs in, in this browser, behind the open page
  await as(page.request, ALEX);
  await bookmark.click();
  await expect(page.locator(".toast")).toContainText(OUT_OF_DATE);
  expect((await (await page.request.get("/api/engagement")).json()).mine.bookmarks).toEqual([]);
  // back in view, the page is Alex's
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Your account" })).toHaveAttribute("title", /Alex Editor/);
});
