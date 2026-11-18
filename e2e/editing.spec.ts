import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  ALEX, CSRF, DANA, SAM, answer, discardWorkingDraft, editState, fields, meaningReady, more, open, openEditor, outline, publish, readProcess,
  readSkill, readWorkingDraft, saveDraft, signIn,
} from "./helpers";

// The editing screen and its drafts, through the real app and server. Changes to a published
// process are kept as unpublished changes (one shared draft) that only its editors see; readers,
// the skill and search keep the published version until somebody presses Publish.
//
// Every test works on copies of its own, removed afterwards: other tests count what there is.

const SRC = "request-github-repository";
const PREFIX = "editing-demo-";

async function copyOf(request: APIRequestContext, id: string, title: string, status: "active" | "draft" = "active", patch: Record<string, unknown> = {}) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === SRC);
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, status, ...patch }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
  return src as Record<string, any>;
}

test.afterEach(async ({ request }) => {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes } = await (await request.get("/api/processes")).json();
  for (const p of processes.filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/processes/${p.id}`, { headers: CSRF });
});

const bar = (page: Page) => page.locator(".edit-bar");
const firstBlock = (page: Page) => page.locator(".edit-preview .block").first();
/** What search by meaning finds, as ids ("process:<id>"), for the signed-in person. */
async function meaningIds(page: Page, q: string): Promise<string[]> {
  const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()).results ?? []).map((r: { kind: string; id: string }) => `${r.kind}:${r.id}`);
}
async function readerPage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const page = await ctx.newPage();
  await signIn(page, SAM);
  return { page, close: () => ctx.close() };
}

test("a reader has no Edit, and the editing screen tells them they may not change it", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.locator(".draft-line")).toHaveCount(0);
  await open(page, "/p/request-gcp-project/edit");
  await expect(page.getByText("You may not change this process. Its editors, and the owners of its platform or practice, can.")).toBeVisible();
  await expect(page.locator(".edit-bar")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to reading" }).click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow/);
  await open(page, "/s/secure-logging/edit");
  await expect(page.getByText("You may not change this standard.")).toBeVisible();
});

test("unpublished changes: saved as a draft only editors see, published with a note, then everybody sees them", async ({ page, browser, request }) => {
  test.setTimeout(90_000);
  await meaningReady(request);
  const id = `${PREFIX}publish`;
  await copyOf(request, id, "Editing demo publish");
  await signIn(page, ALEX);
  await open(page, `/p/${id}/flow`);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${id}/edit`));
  await expect(page.locator(".topbar")).toHaveCount(0); // a screen of its own
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 1.");
  await expect(bar(page).locator(".state-pill")).toHaveText("Published");
  await expect(bar(page).getByRole("button", { name: "Save draft" })).toBeDisabled();
  await expect(bar(page).getByRole("button", { name: "Save draft" })).toHaveAttribute("title", "Nothing to save: all changes are saved.");

  await outline(page, /^1 /);
  await fields(page).getByLabel(/^What happens/).fill("Ask for the quokka repository");
  await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1. Changes not saved yet.");
  await expect(bar(page).locator(".state-pill")).toHaveText("Unpublished changes");
  await expect(bar(page).locator(".eb-sentence")).toContainText("Readers still see version 1");
  await saveDraft(page);
  await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1.");
  // the draft is kept for the editors, beside the published version
  const w = (await readWorkingDraft(page, "process", id))!;
  expect(w).toMatchObject({ base: 1, revision: 1 });
  expect(w.doc.steps[0].title).toBe("Ask for the quokka repository");

  // leaving and coming back: the draft is what is edited
  await bar(page).getByRole("button", { name: "Back to reading" }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${id}/flow`));
  // the reader's page shows the published version, and the editor a calm line about the draft
  await expect(page.locator(".block").first()).not.toContainText("quokka");
  const line = page.locator(".draft-line");
  await expect(line).toContainText(/There are unpublished changes by (Alex Editor|alex@example\.com) from today at \d\d:\d\d\. Readers see the published version\./);
  await line.getByRole("link", { name: "Continue editing" }).click();
  await expect(firstBlock(page)).toContainText("Ask for the quokka repository");
  await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1.");
  // the list marks it for its editors
  await open(page, "/processes");
  await expect(page.locator(`li.card[data-id="${id}"] .card-mark.changes`)).toHaveText("Unpublished changes");

  // readers: nothing of the draft anywhere
  const reader = await readerPage(browser);
  const r = reader.page;
  await open(r, `/p/${id}/flow`);
  await expect(r.locator(".block").first()).toBeVisible();
  await expect(r.locator(".block").first()).not.toContainText("quokka");
  await expect(r.locator(".draft-line")).toHaveCount(0);
  await expect(r.getByRole("button", { name: "Version 1" })).toBeVisible();
  expect((await readProcess(r, id))!.steps[0].title).not.toContain("quokka");
  const { meta } = await (await r.request.get("/api/processes")).json();
  expect(meta[id].version).toBe(1);
  expect(meta[id].draft).toBeUndefined();
  expect((await r.request.get(`/api/processes/${id}/draft`)).status()).toBe(404);
  await open(r, "/processes");
  await expect(r.locator(`li.card[data-id="${id}"]`)).toBeVisible();
  await expect(r.locator(`li.card[data-id="${id}"] .card-mark`)).toHaveCount(0);
  await open(r, "/search?q=quokka");
  await expect(r.locator(".search-empty h2")).toHaveText("Nothing found");
  await r.waitForTimeout(1000); // the index would have had the time to follow, if it followed drafts
  expect(await meaningIds(r, "quokka repository")).not.toContain(`process:${id}`);
  const history = await (await r.request.get(`/api/processes/${id}/history`)).json().catch(() => null);
  if (history) expect(JSON.stringify(history)).not.toContain("quokka");
  expect((await readSkill(r, `process-${id}`)).content).not.toContain("quokka");

  // Publish…: what changed, a note, the sentence for readers
  await open(page, `/p/${id}/edit`);
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish your changes" });
  await expect(dialog.locator(".change-list")).toContainText("Ask for the quokka repository");
  await expect(dialog).toContainText("Readers see it as soon as you publish.");
  await dialog.getByLabel(/^Note for the list of versions/).fill("A clearer first step");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 2.");
  await expect(page.locator(".toast", { hasText: "Readers now see version 2" })).toBeVisible();
  expect(await readWorkingDraft(page, "process", id)).toBeUndefined();

  // readers now see it everywhere: the page, the version, the note, search by words and by meaning, the skill
  await open(r, `/p/${id}/flow`);
  await r.reload();
  await expect(r.locator(".block").first()).toContainText("Ask for the quokka repository");
  await r.getByRole("button", { name: "Version 2" }).click();
  await expect(r.getByRole("dialog", { name: /Versions of/ }).locator("li").first()).toContainText("A clearer first step");
  await r.keyboard.press("Escape");
  await open(r, "/search?q=quokka");
  await expect(r.locator(`li.card[data-id="${id}"]`)).toBeVisible();
  await expect.poll(() => meaningIds(r, "quokka repository"), { timeout: 15_000 }).toContain(`process:${id}`);
  expect((await readSkill(r, `process-${id}`)).content).toContain("Ask for the quokka repository");
  // and the editors' marks are gone
  await open(page, "/processes");
  await expect(page.locator(`li.card[data-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`li.card[data-id="${id}"] .card-mark.changes`)).toHaveCount(0);
  await reader.close();
});

test("an unfinished draft can be saved, but not published: the reason is given and the outline shows where", async ({ page, request }) => {
  const id = `${PREFIX}unfinished`;
  await copyOf(request, id, "Editing demo unfinished");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^2 /);
  await fields(page).locator(".type-opt", { hasText: "Decision" }).click(); // a decision needs two labelled paths
  await expect(bar(page).locator(".eb-status.bad")).toHaveText("1 problem");
  const nav = page.getByRole("navigation", { name: "Outline of the process" });
  await expect(nav.getByRole("button", { name: /^2 .*, 1 problem/ }).locator(".outline-mark.bad")).toHaveText("1");
  await expect(nav.getByRole("button", { name: /^Steps/ }).locator(".outline-mark.bad")).toHaveText("1");
  // saving the unfinished work is possible: it is a draft
  await saveDraft(page);
  expect((await readWorkingDraft(page, "process", id))!.doc.steps[1].type).toBe("decision");
  expect((await readProcess(page, id))!.steps[1].type).not.toBe("decision");
  // publishing is not, with the reason
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish your changes" });
  await expect(dialog.getByRole("alert")).toHaveText("Fix the problem the checker found first.");
  await expect(dialog.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await expect(dialog).not.toContainText("Readers see it as soon as you publish.");
  await dialog.getByRole("button", { name: "Not yet" }).click();
  // the server refuses it as well
  const w = (await readWorkingDraft(page, "process", id))!;
  const refused = await page.request.post(`/api/processes/${id}/publish?rev=${w.revision}`, { headers: CSRF });
  expect(refused.status()).toBe(400);
  expect((await readProcess(page, id))!.steps[1].type).not.toBe("decision");
  // the checker's list leads to the place
  await outline(page, "About");
  await bar(page).locator(".eb-status.bad").click();
  await page.getByRole("dialog", { name: "What the checker found" }).getByRole("button").first().click();
  await expect(nav.locator('[aria-current="true"]')).toContainText((await readProcess(page, id))!.steps[1].title);
});

test("Discard changes goes back to the saved draft and can be undone; Discard draft… asks and leaves readers as they were", async ({ page, request }) => {
  const id = `${PREFIX}discard`;
  await copyOf(request, id, "Editing demo discard");
  await signIn(page, ALEX);
  await openEditor(page, "process", id, "create-repo");
  const name = fields(page).getByLabel(/^What happens/);
  const before = await name.inputValue();
  await name.fill("Saved in the draft");
  await saveDraft(page);
  await name.fill("Typed and not saved");
  // with unsaved changes the bar offers Discard changes: back to the saved draft, not to the published version
  await expect(bar(page).getByRole("button", { name: "Discard draft…" })).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(name).toHaveValue("Saved in the draft");
  await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1.");
  await bar(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(name).toHaveValue("Typed and not saved");
  await bar(page).getByRole("button", { name: "Discard changes" }).click();

  // without unsaved changes: Discard draft…, which asks, because it cannot be undone
  await bar(page).getByRole("button", { name: "Discard draft…" }).click();
  const ask = page.getByRole("dialog", { name: "Discard the unpublished changes?" });
  await expect(ask).toContainText("Readers keep seeing version 1. This cannot be undone.");
  await ask.getByRole("button", { name: "Keep the draft" }).click();
  expect(await readWorkingDraft(page, "process", id)).toBeDefined();
  await bar(page).getByRole("button", { name: "Discard draft…" }).click();
  await answer(page, "Discard the unpublished changes?", "Discard draft");
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 1.");
  await expect(name).toHaveValue(before);
  expect(await readWorkingDraft(page, "process", id)).toBeUndefined();
  const { meta } = await (await page.request.get("/api/processes")).json();
  expect(meta[id].version).toBe(1); // readers never saw anything else
  // and it is in the activity log, in words
  await signIn(page, DANA);
  await open(page, "/admin/activity");
  await expect(page.locator(".activity li").filter({ hasText: id }).first()).toContainText("threw away the unpublished changes of the process");
});

test("a new process is a draft nobody else sees until it is published", async ({ page, browser }) => {
  await signIn(page, ALEX);
  await open(page, "/processes");
  await page.getByRole("button", { name: "Blank process" }).click();
  const named = page.getByRole("dialog", { name: "New process" });
  await named.getByLabel("Name of the process").fill("Editing demo new one");
  await named.getByRole("button", { name: "Create process" }).click();
  const id = `${PREFIX}new-one`;
  await expect(page).toHaveURL(new RegExp(`#/p/${id}/edit`));
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet/);
  await expect(bar(page).locator(".state-pill")).toHaveText("Draft");
  await expect(bar(page).locator(".state-pill.draft")).toBeVisible();
  // the example text is replaced, then it is saved: an ordinary version of a draft
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("A demo of a process that starts as a draft.");
  await outline(page, /^1 /);
  await fields(page).getByLabel(/^What happens/).fill("Do the one thing");
  await fields(page).getByLabel("Action a").fill("Do it carefully.");
  await saveDraft(page);
  expect((await readProcess(page, id))!).toMatchObject({ status: "draft", summary: "A demo of a process that starts as a draft." });

  const reader = await readerPage(browser);
  expect(await readProcess(reader.page, id)).toBeUndefined();
  await open(reader.page, `/p/${id}/flow`);
  await expect(reader.page.locator("h1")).toHaveText("Process not found");
  await open(reader.page, "/processes");
  await expect(reader.page.locator(".card").first()).toBeVisible();
  await expect(reader.page.locator(`li.card[data-id="${id}"]`)).toHaveCount(0);
  // the editor finds it, marked as a draft; its page says so, without views, share or bookmark
  await open(page, "/processes");
  await expect(page.locator(`li.card[data-id="${id}"] .card-mark.draft`)).toHaveText("Draft");
  await open(page, `/p/${id}/flow`);
  await expect(page.locator(".draft-line.never")).toContainText("Readers do not see this process yet.");
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Use and feedback" })).toHaveCount(0);

  await page.locator(".draft-line").getByRole("link", { name: "Continue editing" }).click();
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish this process" });
  await expect(dialog).toContainText("Until now only the people who may change it could see it.");
  await expect(dialog).toContainText("Everybody who signs in to the portal will be able to find and read it.");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
  expect((await readProcess(page, id))!.status).toBe("active");

  await open(reader.page, `/p/${id}/flow`);
  await reader.page.reload();
  await expect(reader.page.locator("h1")).toHaveText("Editing demo new one");
  await reader.close();
});

test("Retire… with a replacement, Bring back into use…, Unpublish… and Delete…, and what readers see after each", async ({ page, browser, request }) => {
  const id = `${PREFIX}lifecycle`;
  await copyOf(request, id, "Editing demo lifecycle");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  const reader = await readerPage(browser);
  const r = reader.page;
  const readerSees = async () => { await open(r, `/p/${id}/flow`); await r.reload(); };

  await more(page, "Retire…");
  const retire = page.getByRole("dialog", { name: "Retire this process?" });
  await expect(retire.getByLabel(/^Use instead/).locator("option", { hasText: "Request a GCP project" })).toHaveCount(1);
  await retire.getByLabel(/^Use instead/).selectOption({ label: "Request a GCP project" });
  await retire.getByRole("button", { name: "Retire" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", "Retired. Readers see version 2, marked as retired.");
  await expect(bar(page).locator(".state-pill.retired")).toHaveText("Retired");
  await readerSees();
  await expect(r.locator(".banner", { hasText: "This process is retired." }).getByRole("link", { name: "Request a GCP project" })).toBeVisible();

  await more(page, "Bring back into use…");
  await answer(page, "Bring it back into use?", "Bring back into use");
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 3.");
  await readerSees();
  await expect(r.locator(".block").first()).toBeVisible();
  await expect(r.locator(".banner", { hasText: "retired" })).toHaveCount(0);

  await more(page, "Unpublish…");
  await answer(page, "Unpublish this process?", "Unpublish");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet/);
  expect((await readProcess(page, id))!.status).toBe("draft");
  await readerSees();
  await expect(r.locator("h1")).toHaveText("Process not found");
  // there is nothing to retire or unpublish in a draft
  await page.locator(".edit-bar").getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu.getByRole("menuitem", { name: /^Retire…/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Unpublish…/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await publish(page);
  await readerSees();
  await expect(r.locator("h1")).toHaveText("Editing demo lifecycle");

  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  expect(await readProcess(page, id)).toBeUndefined();
  await readerSees();
  await expect(r.locator("h1")).toHaveText("Process not found");
  await reader.close();
});

test("while unpublished changes exist, Retire… and Unpublish… are unavailable with the reason; the server refuses them too", async ({ page, request }) => {
  const id = `${PREFIX}blocked`;
  const src = await copyOf(request, id, "Editing demo blocked");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("A summary in the draft.");
  // unsaved changes: save or discard them first
  await page.locator(".edit-bar").getByRole("button", { name: "More" }).click();
  let menu = page.getByRole("menu", { name: "More" });
  for (const item of [/^Retire…/, /^Unpublish…/]) {
    await expect(menu.getByRole("menuitem", { name: item })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: item })).toContainText("Save or discard your changes first.");
  }
  await page.keyboard.press("Escape");
  await saveDraft(page);
  // a saved draft: publish or discard it first
  await page.locator(".edit-bar").getByRole("button", { name: "More" }).click();
  menu = page.getByRole("menu", { name: "More" });
  for (const item of [/^Retire…/, /^Unpublish…/]) {
    await expect(menu.getByRole("menuitem", { name: item })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: item })).toContainText("Publish or discard the unpublished changes first.");
  }
  await menu.getByRole("menuitem", { name: /^Retire…/ }).click(); // nothing happens
  await expect(page.getByRole("dialog", { name: "Retire this process?" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // the server says the same to an ordinary save of the published process
  const res = await page.request.put(`/api/processes/${id}?base=1`, { data: { ...src, id, title: "Editing demo blocked", status: "deprecated" }, headers: CSRF });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toMatch(/publish|discard/i);
  expect((await readProcess(page, id))!.status).toBe("active");
  await discardWorkingDraft(page, "process", id);
});

test("More > Versions restores an old version into the draft; readers keep the published one until Publish", async ({ page, request }) => {
  const id = `${PREFIX}restore`;
  await copyOf(request, id, "Editing demo restore");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("The second summary.");
  await publish(page, "Second summary");
  await more(page, "Versions");
  const versions = page.getByRole("dialog", { name: /Versions of/ });
  await expect(versions.locator(".history > li").first()).toContainText("Second summary");
  await versions.locator(".history > li").nth(1).getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".toast", { hasText: "Version 1 is now in your draft" })).toBeVisible();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Unpublished changes\. Readers still see version 2\./);
  await saveDraft(page);
  expect((await readProcess(page, id))!.summary).toBe("The second summary.");
  // Undo takes the restore back
  await bar(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".edit-preview .preview-head p")).toHaveText("The second summary.");
  await bar(page).getByRole("button", { name: "Redo" }).click();
  await publish(page);
  expect((await readProcess(page, id))!.summary).not.toBe("The second summary.");
});

// ---------- two people at once (two browsers)

async function second(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090", viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

test.describe("two people", () => {
  test("both edit the same draft: the second save meets the first, and decides", async ({ page, browser, request }) => {
    const id = `${PREFIX}both`;
    await copyOf(request, id, "Editing demo both");
    await signIn(page, ALEX);
    const dana = await second(browser, DANA);
    const d = dana.page;
    await openEditor(page, "process", id, "create-repo");
    await openEditor(d, "process", id, "create-repo");

    await fields(d).getByLabel(/^What happens/).fill("Dana's wording");
    await saveDraft(d);
    await fields(page).getByLabel(/^What happens/).fill("Alex's wording");
    await bar(page).getByRole("button", { name: "Save draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Somebody else saved the draft first" });
    await expect(dialog).toContainText("Nothing was overwritten.");
    await expect(dialog.locator(".change-list")).toContainText("Dana's wording");
    expect((await readWorkingDraft(page, "process", id))!.doc.steps[1].title).toBe("Dana's wording");

    // theirs first: Undo brings mine back
    await dialog.getByRole("button", { name: "Use their draft" }).click();
    await expect(fields(page).getByLabel(/^What happens/)).toHaveValue("Dana's wording");
    await bar(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(fields(page).getByLabel(/^What happens/)).toHaveValue("Alex's wording");

    // Dana saves again; this time mine goes over theirs
    await fields(d).getByLabel(/^What happens/).fill("Dana's second wording");
    await saveDraft(d);
    await bar(page).getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("dialog", { name: "Somebody else saved the draft first" }).getByRole("button", { name: "Save mine over theirs" }).click();
    await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1.");
    expect((await readWorkingDraft(page, "process", id))!.doc.steps[1].title).toBe("Alex's wording");
    expect((await readProcess(page, id))!.version ?? 1).toBe(1);
    await dana.close();
  });

  test("the draft is discarded by one while the other edits: the changes are gone, mine can start a new draft", async ({ page, browser, request }) => {
    const id = `${PREFIX}gone`;
    await copyOf(request, id, "Editing demo gone");
    await signIn(page, ALEX);
    const dana = await second(browser, DANA);
    const d = dana.page;
    await openEditor(d, "process", id, "create-repo");
    await fields(d).getByLabel(/^What happens/).fill("Dana's draft");
    await saveDraft(d);

    await openEditor(page, "process", id, "create-repo");
    await expect(fields(page).getByLabel(/^What happens/)).toHaveValue("Dana's draft");
    await fields(page).getByLabel(/^What happens/).fill("Alex continues the draft");

    await bar(d).getByRole("button", { name: "Discard draft…" }).click();
    await answer(d, "Discard the unpublished changes?", "Discard draft");
    await expect(editState(d)).toHaveAttribute("aria-label", "Published. Version 1.");

    await bar(page).getByRole("button", { name: "Save draft" }).click();
    const gone = page.getByRole("dialog", { name: "The unpublished changes are gone" });
    await expect(gone).toContainText("Your changes are still here and not saved.");
    await gone.getByRole("button", { name: "Save mine as a new draft" }).click();
    await expect(editState(page)).toHaveAttribute("aria-label", "Unpublished changes. Readers still see version 1.");
    const w = (await readWorkingDraft(page, "process", id))!;
    expect(w.doc.steps[1].title).toBe("Alex continues the draft");
    expect(w.base).toBe(1);
    await dana.close();
  });

  test("one publishes while the other has changes: “Somebody else published first”, then theirs or mine", async ({ page, browser, request }) => {
    const id = `${PREFIX}published-first`;
    await copyOf(request, id, "Editing demo published first");
    await signIn(page, ALEX);
    const dana = await second(browser, DANA);
    const d = dana.page;
    /** Dana changes the summary and publishes it, as version `v`. */
    const danaPublishes = async (summary: string) => {
      await openEditor(d, "process", id);
      await outline(d, "About");
      await fields(d).getByLabel(/^Summary/).fill(summary);
      await publish(d, "Dana's change");
    };

    // Alex works on version 1; meanwhile Dana publishes version 2
    await openEditor(page, "process", id, "create-repo");
    await fields(page).getByLabel(/^What happens/).fill("Alex's wording");
    await danaPublishes("Dana's published summary.");
    expect((await readProcess(page, id))!.summary).toBe("Dana's published summary.");

    // Alex publishes: nothing of Dana's is overwritten without a decision
    await bar(page).getByRole("button", { name: "Publish…" }).click();
    await page.getByRole("dialog", { name: "Publish your changes" }).getByRole("button", { name: "Publish", exact: true }).click();
    const conflict = page.getByRole("dialog", { name: "Somebody else published first" });
    await expect(conflict).toContainText("Nothing was published and nothing was overwritten.");
    await expect(conflict.locator(".change-list")).toContainText("Summary");
    expect((await readProcess(page, id))!.summary).toBe("Dana's published summary.");

    // continue from theirs: their version on screen, not saved yet; Undo brings his own back, Redo theirs
    await conflict.getByRole("button", { name: "Continue from theirs" }).click();
    await expect(page.locator(".edit-preview .preview-head p")).toHaveText("Dana's published summary.");
    await expect(editState(page)).toHaveAttribute("aria-label", /Changes not saved yet\.$/);
    await bar(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(fields(page).getByLabel(/^What happens/)).toHaveValue("Alex's wording");
    await bar(page).getByRole("button", { name: "Redo" }).click();
    await expect(page.locator(".edit-preview .preview-head p")).toHaveText("Dana's published summary.");
    // his change made again on top of theirs: published, with both
    await outline(page, /^2 /);
    await fields(page).getByLabel(/^What happens/).fill("Alex's wording");
    await publish(page);
    const both = (await readProcess(page, id))!;
    expect(both.summary).toBe("Dana's published summary.");
    expect(both.steps[1].title).toBe("Alex's wording");

    // the other way: his own version over theirs; theirs stays in the versions
    await fields(page).getByLabel(/^What happens/).fill("Alex's second wording");
    await danaPublishes("Dana's second summary.");
    await bar(page).getByRole("button", { name: "Publish…" }).click();
    await page.getByRole("dialog", { name: "Publish your changes" }).getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog", { name: "Somebody else published first" }).getByRole("button", { name: "Publish mine over theirs" }).click();
    await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
    const mine = (await readProcess(page, id))!;
    expect(mine.steps[1].title).toBe("Alex's second wording");
    expect(mine.summary).toBe("Dana's published summary."); // his version, made before her second change
    await more(page, "Versions");
    await expect(page.getByRole("dialog", { name: /Versions of/ })).toContainText("Dana's change");
    await dana.close();
  });

  test("a review confirmed by somebody else while a draft exists does not get in the way of publishing", async ({ page, browser, request }) => {
    const id = `${PREFIX}reviewed`;
    await copyOf(request, id, "Editing demo reviewed", "active", { owner: "cloud-platform-team" });
    await signIn(page, ALEX);
    await openEditor(page, "process", id, "create-repo");
    await fields(page).getByLabel(/^What happens/).fill("Changed while it was reviewed");
    await saveDraft(page);

    // Casey, Owner of the team, confirms the review on the reader's page
    const casey = await second(browser, "casey@example.com");
    await open(casey.page, `/p/${id}/flow`);
    await casey.page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect.poll(async () => (await readProcess(casey.page, id))!.review?.reviewedBy).toBe("Casey Owner");
    await casey.close();

    // no banner about an older version, and Publish goes through, keeping the review
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".banner", { hasText: "were started from version" })).toHaveCount(0);
    await publish(page);
    const now = (await readProcess(page, id))!;
    expect(now.steps[1].title).toBe("Changed while it was reviewed");
    expect(now.review.reviewedBy).toBe("Casey Owner");
  });
});
