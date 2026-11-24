import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  ALEX, CSRF, DANA, SAM, checkerChip, editState, open, openChecker, openEditor, outline, fields, readProcess, readWorkingDraft, refusal, saveDraft, signIn,
} from "./helpers";

// The save model of a document that readers do not see yet ("Save draft always works"): what
// cannot be stored as the process itself yet is kept as its draft; two people (or two tabs) on
// that draft are never overwritten without a question; Discard, the first publication, somebody
// who may not see it, a delete by somebody else, and a save the server refuses. Every test works
// on a copy of its own, removed afterwards.

const SRC = "request-github-repository";
const PREFIX = "savemodel-demo-";

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
/** A never-published copy of a sample process, made by Alex. */
async function draftCopy(request: APIRequestContext, id: string, title: string) {
  await as(request, ALEX);
  const src = (await readProcess(request, SRC))!;
  await request.delete(`/api/processes/${id}`, { headers: CSRF });
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, status: "draft" }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
  return src as Record<string, any>;
}
test.afterEach(async ({ request }) => {
  await as(request, ALEX);
  const { processes } = await (await request.get("/api/processes")).json();
  for (const p of processes.filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/processes/${p.id}`, { headers: CSRF });
});

const bar = (page: Page) => page.locator(".edit-bar");
const firstBlock = (page: Page) => page.locator(".edit-preview .block").first();
/** Renames the first step (its "What happens"), without saving. */
async function renameFirstStep(page: Page, title: string) {
  await firstBlock(page).click();
  await fields(page).getByLabel(/^What happens/).fill(title);
}
/** A second person (or the same one in another window), in a browser of their own. */
async function second(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}
/** Coming back to the tab after a while: the portal fetches what others changed. */
async function comeBackLater(page: Page) {
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
/** The text of the first step in what is stored: the working draft when there is one, else the document. */
async function firstStepNow(page: Page, id: string) {
  const w = await readWorkingDraft(page, "process", id);
  return (w ? w.doc : (await readProcess(page, id))!).steps[0].title as string;
}

test("two people on a never-published draft: the newer draft is told about, kept until decided, theirs or mine", async ({ page, browser, request }) => {
  const id = `${PREFIX}two`;
  const src = await draftCopy(request, id, "Savemodel demo two");
  await page.clock.install();
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await renameFirstStep(page, "Alex's careful wording");

  // Dana saves the draft meanwhile, with something still to fix: kept as its draft
  const dana = await second(browser, DANA);
  await openEditor(dana.page, "process", id);
  await renameFirstStep(dana.page, "D");
  await saveDraft(dana.page);
  await expect(bar(dana.page).locator(".eb-saved")).toHaveText(/^Draft saved \d\d:\d\d$/);
  expect((await readWorkingDraft(dana.page, "process", id))!.doc.steps[0].title).toBe("D");
  expect((await readProcess(dana.page, id))!.steps[0].title).toBe(src.steps[0].title);

  // Alex comes back: told, his changes still there
  await comeBackLater(page);
  const banner = page.locator(".banner", { hasText: "saved newer changes to the draft" });
  await expect(banner.locator(".alert-title")).toHaveText(/^Dana Admin saved newer changes to the draft at \d{4}-\d\d-\d\d \d\d:\d\d$/);
  await expect(banner.locator(".alert-desc")).toHaveText("That was while you were editing. Your changes are still here.");
  await expect(firstBlock(page)).toContainText("Alex's careful wording");
  await expect(banner.getByRole("button", { name: "Compare and decide" })).toBeVisible();

  // Save draft does not go over it: the question first, and Dana's text is kept until he decides
  await bar(page).getByRole("button", { name: "Save draft" }).click();
  const dialog = page.getByRole("dialog", { name: "Somebody else saved the draft first" });
  await expect(dialog).toContainText("Nothing was overwritten.");
  await expect(dialog).toContainText("Undo then puts your whole version back as it was, also where theirs is newer: nothing is merged.");
  expect((await readWorkingDraft(page, "process", id))!.doc.steps[0].title).toBe("D");
  // theirs: Dana's text on his screen, his own one Undo away
  await dialog.getByRole("button", { name: "Use their draft" }).click();
  await expect(firstBlock(page)).toContainText("D");
  await expect(firstBlock(page)).not.toContainText("Alex's careful wording");
  await bar(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstBlock(page)).toContainText("Alex's careful wording");

  // Dana saves again; this time Alex keeps his
  await renameFirstStep(dana.page, "Da");
  await saveDraft(dana.page);
  await comeBackLater(page);
  await bar(page).getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("dialog", { name: "Somebody else saved the draft first" }).getByRole("button", { name: "Save mine over theirs" }).click();
  await expect(page.getByRole("dialog", { name: "Somebody else saved the draft first" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Save draft" })).toBeDisabled();
  await expect.poll(() => firstStepNow(page, id)).toBe("Alex's careful wording");
  // still a draft readers do not see
  expect((await readProcess(page, id))!.status).toBe("draft");
  await dana.close();
});

test("one person in two tabs of a never-published draft is told it was them", async ({ page, browser, request }) => {
  const id = `${PREFIX}tabs`;
  await draftCopy(request, id, "Savemodel demo tabs");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  const other = await second(browser, ALEX);
  await openEditor(other.page, "process", id);
  await renameFirstStep(other.page, "O");
  await saveDraft(other.page);
  await renameFirstStep(page, "From this tab");
  await bar(page).getByRole("button", { name: "Save draft" }).click();
  const dialog = page.getByRole("dialog", { name: "You saved the draft in another window first" });
  await expect(dialog).toContainText("in another window or tab");
  await dialog.getByRole("button", { name: "Save mine over theirs" }).click();
  await expect.poll(() => firstStepNow(page, id)).toBe("From this tab");
  await other.close();
});

test("Discard on a never-published draft goes back to how it was last stored, and Activity says so", async ({ page, request }) => {
  const id = `${PREFIX}discard`;
  const src = await draftCopy(request, id, "Savemodel demo discard");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await renameFirstStep(page, "x");
  await saveDraft(page);
  expect((await readWorkingDraft(page, "process", id))!.doc.steps[0].title).toBe("x");

  // the More menu says where it goes back to
  await bar(page).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /^Discard draft…/ })).toContainText("Back to how it was last stored as the process itself");
  await page.keyboard.press("Escape");
  await bar(page).getByRole("button", { name: "Discard draft…" }).click();
  const ask = page.getByRole("dialog", { name: "Discard the newer changes?" });
  await expect(ask).toContainText("It goes back to how it was last stored as the process itself. This cannot be undone.");
  await ask.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.locator(".toast", { hasText: "The newer changes were discarded. The draft is back to how it was last stored as the process itself." })).toBeVisible();
  await expect(firstBlock(page)).toContainText(src.steps[0].title);
  expect(await readWorkingDraft(page, "process", id)).toBeUndefined();
  expect((await readProcess(page, id))!).toMatchObject({ status: "draft" });

  await signIn(page, DANA);
  await open(page, "/admin/activity");
  await expect(page.locator(".activity li").filter({ hasText: "Savemodel demo discard" }).first()).toContainText("threw away the changes kept in the draft of the process");
});

test("the first publication of a draft that has newer changes kept: readers see it, Activity says published", async ({ page, request }) => {
  const id = `${PREFIX}first`;
  await draftCopy(request, id, "Savemodel demo first");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await renameFirstStep(page, "x");
  await saveDraft(page);
  expect(await readWorkingDraft(page, "process", id)).toBeDefined();
  // fixed, then published
  await renameFirstStep(page, "Ask for the repository");
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish this process" });
  await expect(dialog).toContainText("Everybody who signs in to the portal will be able to find and read it.");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
  expect((await readProcess(page, id))!).toMatchObject({ status: "active" });
  expect(await readWorkingDraft(page, "process", id)).toBeUndefined();

  await signIn(page, SAM);
  await open(page, `/p/${id}/flow`);
  await expect(page.locator("h1")).toHaveText("Savemodel demo first");
  await expect(page.locator(".block").first()).toContainText("Ask for the repository");
  await signIn(page, DANA);
  await open(page, "/admin/activity");
  await expect(page.locator(".activity li").filter({ hasText: "Savemodel demo first" }).first()).toContainText("published the process");
});

test("somebody who may not see a never-published draft gets the page of something that does not exist, also at its editing address", async ({ page, request }) => {
  const id = `${PREFIX}hidden`;
  await draftCopy(request, id, "Savemodel demo hidden");
  // with a working draft too
  await as(request, ALEX);
  const doc = (await readProcess(request, id))!;
  expect((await request.put(`/api/processes/${id}/draft?rev=0`, { data: { ...doc, steps: [{ ...doc.steps[0], title: "x" }, ...doc.steps.slice(1)] }, headers: CSRF })).ok()).toBeTruthy();

  await signIn(page, SAM);
  const seen = async (path: string) => {
    await open(page, path);
    await expect(page.locator("h1")).toBeVisible();
    return (await page.locator("#main").innerText()).replaceAll(id, "ID").replaceAll("no-such-process-here", "ID");
  };
  for (const [hidden, missing] of [[`/p/${id}/flow`, "/p/no-such-process-here/flow"], [`/p/${id}/edit`, "/p/no-such-process-here/edit"]]) {
    const a = await seen(hidden);
    const b = await seen(missing);
    expect(a, hidden).toBe(b);
    expect(a).toContain("Process not found");
    expect(a).not.toContain("Savemodel demo hidden");
  }
  // and the server answers the same: no draft, no count, nothing to tell it apart
  expect((await page.request.get(`/api/processes/${id}/draft`)).status()).toBe(404);
  const { processes, meta } = await (await page.request.get("/api/processes")).json();
  expect(processes.some((p: { id: string }) => p.id === id)).toBe(false);
  expect(meta[id]).toBeUndefined();
});

test("a draft deleted by somebody else while it is edited: the message names who, and bringing it back works", async ({ page, request }) => {
  const id = `${PREFIX}deleted`;
  await draftCopy(request, id, "Savemodel demo deleted");
  await page.clock.install();
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await renameFirstStep(page, "Kept through a delete");
  await as(request, DANA);
  expect((await request.delete(`/api/processes/${id}`, { headers: CSRF })).ok()).toBeTruthy();
  await comeBackLater(page);
  await expect(firstBlock(page)).toContainText("Kept through a delete");
  await bar(page).getByRole("button", { name: "Save draft" }).click();
  const dialog = page.getByRole("dialog", { name: "This process was deleted" });
  await expect(dialog).toContainText("Dana Admin");
  await expect(dialog).not.toContainText("Somebody else");
  await expect(dialog).toContainText("Your changes are still here");
  await dialog.getByRole("button", { name: "Save mine and bring it back" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet\./);
  expect((await readProcess(page, id))!).toMatchObject({ status: "draft" });
  await expect.poll(() => firstStepNow(page, id)).toBe("Kept through a delete");
});

test("a save the server refuses as the process itself is kept as its draft, says why until a save is stored, and Publish… waits", async ({ page, request }) => {
  const id = `${PREFIX}refused`;
  await draftCopy(request, id, "Savemodel demo refused");
  await page.clock.install();
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  const why = "Refused for this test: the owning team cannot take this process.";
  // the document save is refused; the draft save goes through
  await page.route(`**/api/processes/${id}?*`, (route) => (route.request().method() === "PUT"
    ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: why }) })
    : route.continue()));
  await renameFirstStep(page, "Ask for the repository first");
  await bar(page).getByRole("button", { name: "Save draft" }).click();
  const toast = page.locator(".toast", { hasText: "Saved as a draft, not yet as the process itself." });
  await expect(toast).toContainText(`${why} Fix this before publishing.`);
  await expect.poll(async () => (await readWorkingDraft(page, "process", id))?.doc.steps[0].title).toBe("Ask for the repository first");
  expect((await readProcess(page, id))!.steps[0].title).not.toBe("Ask for the repository first");
  // the message stays until it is closed
  await page.clock.fastForward(30_000);
  await expect(toast).toBeVisible();

  // the checker has it to fix, and Publish… waits for it
  await expect(checkerChip(page)).toHaveText("1 to fix");
  await expect(await openChecker(page)).toContainText(`At the last save it could not be stored as the process itself: ${why}`);
  await page.keyboard.press("Escape");
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  await expect(page.getByRole("dialog", { name: "Publish this process" })).toHaveCount(0);
  await expect(refusal(page)).toHaveText("First fix the 1 thing listed under “1 to fix”.");
  await page.keyboard.press("Escape");

  // once a save is stored as the process itself, it is gone
  await page.unroute(`**/api/processes/${id}?*`);
  await renameFirstStep(page, "Ask for the repository");
  await saveDraft(page);
  await expect(checkerChip(page)).toHaveText("Nothing to fix");
  expect((await readProcess(page, id))!.steps[0].title).toBe("Ask for the repository");
  expect(await readWorkingDraft(page, "process", id)).toBeUndefined();
  await outline(page, "About");
  await expect(fields(page).getByRole("textbox", { name: /^Name/ })).toHaveValue("Savemodel demo refused");
});
