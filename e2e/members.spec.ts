import { expect, test, type Browser, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, JORDAN, MORGAN, RILEY, SAM, discardWorkingDraft, editState, fields, more, open, openEditor, outline, publishChange, putDoc, readProcess, readWorkingDraft, saveDraft, signIn } from "./helpers";

// Members of a platform or practice (Morgan: Platform member of Google Cloud, Practice member of
// Engineering) create and save drafts there; an owner (Jordan) publishes them. Where two people
// are involved, each has a browser of their own. Everything created here is removed again.

const BASE = "http://127.0.0.1:8090";
const GCP = "request-gcp-project"; // published, platform Google Cloud
const bar = (page: Page) => page.locator(".edit-bar");
const banner = (page: Page) => page.locator(".check.info.banner.publish-right");

async function person(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}
/** A complete process, as a draft, made from the GCP process (nothing left to fix). */
async function draftBody(page: Page, id: string, title: string, place: { platform?: string; practice?: string }) {
  const gcp = (await readProcess(page, GCP))!;
  const body: Record<string, unknown> = { ...gcp, id, title, status: "draft", platform: place.platform, practice: place.practice };
  delete body.review;
  return body;
}
async function deleteAsAdmin(page: Page, id: string) {
  await page.request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  await page.request.delete(`/api/processes/${id}`, { headers: CSRF });
}
/** The number on "My responsibilities" in the top bar (0 when it has none). */
async function waiting(page: Page) {
  const link = page.locator("nav.nav").getByRole("link", { name: /^My responsibilities/ });
  await expect(link).toBeVisible();
  const n = (await link.getAttribute("aria-label")) ?? (await link.innerText());
  return Number(/(\d+) waiting/.exec(n ?? "")?.[1] ?? 0);
}

test("a member creates a draft from the Processes list, saves it, and an owner reviews and publishes it", async ({ browser }) => {
  test.setTimeout(90_000);
  const id = "morgans-quota-increase";
  const morgan = await person(browser, MORGAN);
  const jordan = await person(browser, JORDAN);
  try {
    const m = morgan.page;
    await open(m, "/processes");
    await m.getByRole("button", { name: "New process", exact: true }).click();
    const dialog = m.getByRole("dialog", { name: "New process" });
    await expect(dialog.getByLabel("It belongs to").locator("option")).toHaveText(["Platform: Google Cloud", "Practice: Engineering"]);
    await expect(dialog).toContainText("An owner of the platform or practice publishes it.");
    await dialog.getByLabel("Name of the process").fill("Morgans quota increase");
    await dialog.getByRole("button", { name: "Create process" }).click();
    await expect(m.locator(".eb-title h1")).toHaveText("Morgans quota increase");
    await expect(m).toHaveURL(new RegExp(`#/p/${id}/edit`));
    expect((await readProcess(m, id))!).toMatchObject({ status: "draft", platform: "google-cloud" });

    // who publishes it, said before anything else; Publish… is not hers
    await expect(banner(m)).toContainText("Jordan Platform, an owner of Google Cloud, publishes this.");
    await expect(banner(m).getByRole("link", { name: "Jordan Platform" })).toHaveAttribute("href", "mailto:jordan@example.com");
    await expect(bar(m).getByRole("button", { name: "Publish…" })).toHaveClass(/\bunavailable\b/);
    await bar(m).getByRole("button", { name: "Publish…" }).click();
    await expect(m.getByRole("dialog", { name: "What is to fix" }).locator(".checker-reason")).toHaveText("An owner publishes this: see above.");
    await m.keyboard.press("Escape");
    await expect(m.getByRole("dialog", { name: /^Publish/ })).toHaveCount(0);
    // More has no Retire, Unpublish or Delete for her
    await bar(m).getByRole("button", { name: "More" }).click();
    const menu = m.getByRole("menu", { name: "More" });
    await expect(menu.getByRole("menuitem", { name: /^Versions/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^(Retire|Unpublish|Delete|Bring back)/ })).toHaveCount(0);
    await m.keyboard.press("Escape");

    // the content, complete, then a change on the screen and Save draft
    expect((await putDoc(m, "process", id, await draftBody(m, id, "Morgans quota increase", { platform: "google-cloud" }))).ok()).toBeTruthy();
    await m.goto("about:blank"); // a fresh start of the app, which reads what was just stored
    await openEditor(m, "process", id);
    await outline(m, "About");
    await fields(m).getByLabel(/^Summary/).fill("More quota for a Google Cloud project, drafted by a member.");
    await expect(banner(m)).toContainText("Save draft keeps your work for them.");
    await saveDraft(m);
    await expect(banner(m)).toContainText("Your draft is saved for them.");

    // her My responsibilities: the draft, waiting for an owner
    await open(m, "/mine");
    const mine = m.getByRole("region", { name: /Your unfinished work/ });
    const row = mine.locator("li", { hasText: "Morgans quota increase" });
    await expect(row).toContainText("A draft waiting for an owner to publish it. Readers do not see it yet.");
    await expect(row.getByRole("link", { name: "Continue editing" })).toHaveAttribute("href", `#/p/${id}/edit`);
    await expect(m.locator("nav.nav").getByRole("link", { name: /^My responsibilities/ })).toHaveAttribute("title", "Your drafts, and what waits for an owner to publish it");

    // Jordan: waiting for him to publish, counted in the top bar
    const j = jordan.page;
    await open(j, "/mine");
    const toPublish = j.getByRole("region", { name: /Waiting for you to publish/ });
    const his = toPublish.locator("li", { hasText: "Morgans quota increase" });
    await expect(his).toContainText(/Draft by Morgan Member, \d{4}-\d\d-\d\d\. Readers do not see it until you publish it\./);
    await expect(j.locator(".stat", { hasText: "waiting for you to publish" }).locator("strong")).toHaveText(/^[1-9]\d*$/);
    await expect(j.locator("nav.nav").getByRole("link", { name: /^My responsibilities/ })).toHaveAttribute("title", /^What you answer for: drafts to publish, reviews to do, feedback to handle\. Waiting now: .*\d+ to publish/);
    const before = await waiting(j);
    expect(before).toBeGreaterThan(0);
    await his.getByRole("link", { name: "Review and publish" }).click();
    await expect(j).toHaveURL(new RegExp(`#/p/${id}/edit`));
    await expect(banner(j)).toHaveCount(0);
    await bar(j).getByRole("button", { name: "Publish…" }).click();
    const pub = j.getByRole("dialog", { name: "Publish this process" });
    await expect(pub).toContainText(/Last saved by Morgan Member at \d{4}-\d\d-\d\d \d\d:\d\d\./);
    await pub.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(editState(j)).toHaveAttribute("aria-label", /^Published\./);
    expect((await readProcess(j, id))!.status).toBe("active");
    await open(j, "/mine");
    await expect(j.getByRole("heading", { name: "My responsibilities" })).toBeVisible();
    await expect.poll(() => waiting(j)).toBe(before - 1);

    // the list of versions and Activity say who saved the changes last
    await openEditor(j, "process", id);
    await more(j, "Versions");
    await expect(j.getByRole("dialog", { name: /Versions of/ }).locator(".history > li").first()).toContainText("published by Jordan Platform · changes last saved by Morgan Member");
    await signIn(j, DANA);
    await open(j, "/admin/activity");
    await expect(j.locator(".activity li").first()).toContainText("Jordan Platform published the process");
    await expect(j.locator(".activity li").first()).toContainText("changes last saved by Morgan Member");
  } finally {
    await deleteAsAdmin(morgan.page, id);
    await morgan.close();
    await jordan.close();
  }
});

test("a member's unpublished changes to a published process: the owner publishes “Morgan Member’s changes”", async ({ browser }) => {
  test.setTimeout(90_000);
  const morgan = await person(browser, MORGAN);
  const jordan = await person(browser, JORDAN);
  const original = (await readProcess(jordan.page, GCP))!;
  try {
    const m = morgan.page;
    await open(m, `/p/${GCP}/flow`);
    await m.getByRole("link", { name: "Edit", exact: true }).click();
    await outline(m, "About");
    await fields(m).getByLabel(/^Summary/).fill("A new project on Google Cloud, worded by a member.");
    await saveDraft(m);
    await expect(editState(m)).toHaveAttribute("aria-label", /^Unpublished changes\./);
    // the reader's page tells her who publishes
    await open(m, `/p/${GCP}/flow`);
    await expect(m.locator(".draft-line")).toContainText("An owner of Google Cloud publishes them; readers see the published version until then.");
    // her own refusal from the server, in words
    const refused = await m.request.post(`/api/processes/${GCP}/publish?rev=${(await readWorkingDraft(m, "process", GCP))!.revision}`, { headers: CSRF });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toMatch(/^Only an owner of the platform “Google Cloud”.*, or a process editor, can .*Your draft is saved for them\.$/);
    expect((await m.request.delete(`/api/processes/${GCP}`, { headers: CSRF })).status()).toBe(403);
    await open(m, "/mine");
    await expect(m.getByRole("region", { name: /Your unfinished work/ }).locator("li", { hasText: "Request a GCP project" })).toContainText("An owner publishes the changes.");

    const j = jordan.page;
    await open(j, "/mine");
    const row = j.getByRole("region", { name: /Waiting for you to publish/ }).locator("li", { hasText: "Request a GCP project" });
    await expect(row).toContainText(new RegExp(`Changes by Morgan Member, saved \\d{4}-\\d\\d-\\d\\d\\. Readers still see version ${original.version ?? "\\d+"}`.replace("undefined", "\\d+")));
    await row.getByRole("link", { name: "Review and publish" }).click();
    await bar(j).getByRole("button", { name: "Publish…" }).click();
    const pub = j.getByRole("dialog", { name: "Publish Morgan Member’s changes" });
    await expect(pub).toContainText(/Last saved by Morgan Member at .*\. Until you publish, readers see version \d+\./);
    await pub.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(editState(j)).toHaveAttribute("aria-label", /^Published\./);
    expect((await readProcess(j, GCP))!.summary).toBe("A new project on Google Cloud, worded by a member.");
    const history = await (await j.request.get(`/api/history/process/${GCP}`)).json();
    const newest = (history.versions ?? history)[0];
    expect(newest).toMatchObject({ changesBy: MORGAN, changesByName: "Morgan Member" });
  } finally {
    await discardWorkingDraft(jordan.page, "process", GCP);
    await publishChange(jordan.page, "process", GCP, original);
    await morgan.close();
    await jordan.close();
  }
});

test("a member starts a draft on the Google Cloud page; another platform's draft does not exist for her", async ({ page }) => {
  const mine = "morgans-page-draft", theirs = "azure-draft-not-hers";
  await signIn(page, ALEX);
  expect((await putDoc(page, "process", theirs, await draftBody(page, theirs, "An Azure draft", { platform: "azure" }))).ok()).toBeTruthy();
  try {
    await signIn(page, MORGAN);
    await open(page, "/platform/google-cloud");
    await page.locator("section.group-docs").getByRole("button", { name: "New process" }).click();
    const dialog = page.getByRole("dialog", { name: "New process" });
    await expect(dialog.getByLabel("It belongs to")).toHaveValue(/google-cloud/);
    await dialog.getByLabel("Name of the process").fill("Morgans page draft");
    await dialog.getByRole("button", { name: "Create process" }).click();
    await expect(page).toHaveURL(new RegExp(`#/p/${mine}/edit`));
    expect((await readProcess(page, mine))!).toMatchObject({ status: "draft", platform: "google-cloud" });
    await open(page, "/platform/google-cloud");
    await expect(page.locator("section.group-docs .card", { hasText: "Morgans page draft" })).toBeVisible();

    // the Azure draft: what anybody sees for something that does not exist
    expect(await readProcess(page, theirs)).toBeUndefined();
    await open(page, `/p/${theirs}/flow`);
    await expect(page.locator("h1")).toHaveText("Process not found");
    await open(page, `/p/${theirs}/edit`);
    await expect(page.locator("h1")).toHaveText("Process not found");
    expect((await page.request.get(`/api/processes/${theirs}/draft`)).status()).toBe(404);
    expect((await page.request.get(`/api/history/process/${theirs}`)).status()).toBe(404);
  } finally {
    await deleteAsAdmin(page, mine);
    await deleteAsAdmin(page, theirs);
  }
});

test("a draft on a platform and a practice with different owners: only somebody who owns both publishes it", async ({ page }) => {
  const id = "gc-and-security-draft";
  await signIn(page, ALEX);
  expect((await putDoc(page, "process", id, await draftBody(page, id, "On Google Cloud and Cyber security", { platform: "google-cloud", practice: "security" }))).ok()).toBeTruthy();
  try {
    // Jordan owns only Google Cloud: he may change it as a draft, not publish it
    await signIn(page, JORDAN);
    await openEditor(page, "process", id);
    await expect(banner(page)).toContainText("Nobody owns both Google Cloud and Cyber security yet: a process editor publishes this.");
    await expect(bar(page).getByRole("button", { name: "Publish…" })).toHaveClass(/\bunavailable\b/);
    const res = await putDoc(page, "process", id, { ...(await readProcess(page, id))!, status: "active" });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("Only somebody who owns both the platform “Google Cloud” and the practice “Cyber security”, or a process editor, can publish this process. Save it as a draft for them.");
    expect((await readProcess(page, id))!.status).toBe("draft");
    // Riley owns only Cyber security: the same
    await signIn(page, RILEY);
    expect((await putDoc(page, "process", id, { ...(await readProcess(page, id))!, status: "active" })).status()).toBe(403);

    // once Jordan owns both, Morgan's banner names him
    await signIn(page, DANA);
    expect((await page.request.post("/api/admin/access", { data: { email: JORDAN, role: "practice-owner", scope: "security" }, headers: CSRF })).ok()).toBeTruthy();
    await signIn(page, MORGAN);
    await openEditor(page, "process", id);
    await expect(banner(page)).toContainText("Somebody who owns both Google Cloud and Cyber security publishes this: Jordan Platform.");
    await signIn(page, JORDAN);
    await openEditor(page, "process", id);
    await expect(banner(page)).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: "Publish…" })).not.toHaveClass(/\bunavailable\b/);
  } finally {
    await signIn(page, DANA);
    await page.request.delete("/api/admin/access", { data: { email: JORDAN, role: "practice-owner", scope: "security" }, headers: CSRF });
    await deleteAsAdmin(page, id);
  }
});

// ---------- Admin › Access and Admin › Lists

test("Admin › Access gives and takes the two member roles", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  const people = page.locator(".users-list > li");
  await expect(people.filter({ hasText: "morgan@example.com" })).toContainText("Platform member for Google Cloud");
  await expect(people.filter({ hasText: "morgan@example.com" })).toContainText("Practice member for Engineering");
  try {
    await page.getByRole("button", { name: "Add person" }).click();
    const dialog = page.getByRole("dialog", { name: "Add person" });
    await dialog.getByLabel("Email").fill(SAM);
    await dialog.getByRole("switch", { name: /^Platform member/ }).check();
    await dialog.getByRole("combobox", { name: "Platform member: platform 1" }).selectOption({ label: "Akamai" });
    await dialog.getByRole("switch", { name: /^Practice member/ }).check();
    await dialog.getByRole("combobox", { name: "Practice member: practice 1" }).selectOption({ label: "Engineering" });
    await expect(dialog.locator(".roles-summary")).toContainText("Platform member for Akamai");
    await dialog.getByRole("button", { name: "Add person" }).click();
    await expect(dialog).toHaveCount(0);
    const row = people.filter({ hasText: "sam@example.com" });
    await expect(row).toContainText("Platform member for Akamai");
    await expect(row).toContainText("Practice member for Engineering");
    // it takes effect: Sam is a member of Akamai
    const me = await (await page.request.get("/api/admin/access")).json();
    expect(me.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ email: SAM, role: "platform-member", scope: "akamai" })]));
    await page.goto("/#/platform/akamai");
    await expect(page.locator('.cat-members[data-rank="member"]').getByRole("link", { name: "Sam Consumer" })).toBeVisible();
    // taken away again
    await open(page, "/admin/access");
    await people.filter({ hasText: "sam@example.com" }).getByRole("button", { name: "Delete Sam Consumer" }).click();
    await page.getByRole("dialog", { name: "Delete Sam Consumer?" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(people.filter({ hasText: "sam@example.com" })).toHaveCount(0);
  } finally {
    for (const [role, scope] of [["platform-member", "akamai"], ["practice-member", "engineering"]]) {
      await page.request.delete("/api/admin/access", { data: { email: SAM, role, scope }, headers: CSRF });
    }
  }
});

test("Admin › Lists: contact fields are saved with the lists, an emptied one leaves no trace; a platform with members cannot be removed", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await page.getByRole("tab", { name: /^Platforms/ }).click();
  await page.locator(".cat-item", { hasText: "ServiceNow" }).click();
  const detail = page.locator(".cat-detail");
  try {
    await detail.getByRole("textbox", { name: /^Slack channel/ }).fill("#servicenow");
    await detail.getByRole("textbox", { name: /^Their page/ }).fill("https://intranet.example.com/servicenow");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".saved")).toBeVisible();
    let entry = (await (await page.request.get("/api/catalog")).json()).platforms.find((p: { id: string }) => p.id === "servicenow");
    expect(entry.contacts).toEqual({ slack: "#servicenow", page: "https://intranet.example.com/servicenow" });
    // emptied again: no empty field and no empty "contacts" is stored
    await detail.getByRole("textbox", { name: /^Slack channel/ }).fill("");
    await detail.getByRole("textbox", { name: /^Their page/ }).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".saved")).toBeVisible();
    entry = (await (await page.request.get("/api/catalog")).json()).platforms.find((p: { id: string }) => p.id === "servicenow");
    expect(entry).not.toHaveProperty("contacts");

    // Google Cloud has an owner and a member: the button says why it cannot go
    await page.locator(".cat-item", { hasText: "Google Cloud" }).click();
    await expect(detail.getByRole("button", { name: "Remove this platform" })).toBeDisabled();
    await expect(page.locator(".cat-danger")).toContainText("Still used by 1 process and 1 standard, and 2 people are still its owners or members. Change those first and take their roles, then it can be removed.");
  } finally {
    const cat = await (await page.request.get("/api/catalog")).json();
    const sn = cat.platforms.find((p: { id: string }) => p.id === "servicenow");
    if (sn.contacts) {
      delete sn.contacts;
      const v = Number((await page.request.get("/api/catalog")).headers()["x-document-version"] ?? 0);
      await page.request.put(`/api/catalog?base=${v}`, { data: cat, headers: CSRF });
    }
  }
});
