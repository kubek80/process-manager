import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, answer, DANA, editState, fields, meaningReady, more, open, openEditor, outline, publish, readProcess, readWorkingDraft, refusal, SAM, saveDraft, signIn, watchErrors } from "./helpers";

const CSRF = { "X-Requested-With": "process-manager" };

/** A process of its own for a test, copied from a sample one, so tests do not get in each other's way. */
async function copyOf(page: Page, id: string, title: string, status: "active" | "draft" = "active") {
  const src = (await readProcess(page, "publish-internal-library"))!;
  const res = await page.request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title, status }, headers: CSRF });
  expect(res.ok(), `create ${id}`).toBeTruthy();
}

/** Somebody else, in another browser, saves a change to the title. */
async function otherPersonRenames(request: APIRequestContext, email: string, id: string, title: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  const { processes, meta } = await (await request.get("/api/processes")).json();
  const doc = processes.find((p: { id: string }) => p.id === id);
  const res = await request.put(`/api/processes/${id}?base=${meta[id].version}&note=${encodeURIComponent("Clearer title")}`, { data: { ...doc, title }, headers: CSRF });
  expect(res.ok(), "the other person's save").toBeTruthy();
}

/** On the editing screen: the first step gets another name (not saved yet). */
const renameFirstStep = async (page: Page, title: string) => {
  await outline(page, /^1 /);
  await fields(page).getByLabel(/^What happens/).fill(title);
};
const firstBlock = (page: Page) => page.locator(".edit-preview .block").first();

test("every publish is a version with a note, and everyone can see what changed", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "versions-demo", "Versions demo");
  await open(page, "/p/versions-demo/flow");
  await expect(page.getByRole("button", { name: "Version 1" })).toBeVisible();

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await renameFirstStep(page, "Ask for a namespace");
  await publish(page, "Plainer wording for the first step");
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 2. Saved.");
  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await expect(page.getByRole("button", { name: "Version 2" })).toBeVisible();

  await page.getByRole("button", { name: "Version 2" }).click();
  const versions = page.getByRole("dialog", { name: /Versions of/ });
  await expect(versions.locator("li").first()).toContainText("Version 2");
  await expect(versions.locator("li").first()).toContainText("current");
  await expect(versions.locator("li").first()).toContainText("Plainer wording for the first step");
  await expect(versions.locator("li").first()).toContainText("Alex Editor"); // the name, not the address
  await expect(versions.locator("li").first()).not.toContainText(ALEX);
  await versions.locator("li").first().getByRole("button", { name: "What changed" }).click();
  await expect(versions.locator(".history-detail")).toContainText("Step “Ask for a namespace” changed: title");
  // the reader's page restores nothing: that is done on the editing screen
  await expect(versions.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // an editor brings the earlier version back into the draft; it becomes real with Publish
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await more(page, "Versions");
  await page.getByRole("dialog", { name: /Versions of/ }).getByRole("button", { name: "Restore" }).click();
  await expect(firstBlock(page)).toContainText("Request a registry namespace");
  await publish(page, "Back to the old wording");
  await expect(editState(page)).toHaveAttribute("aria-label", "Published. Version 3. Saved.");

  // a reader sees the versions and the notes, but cannot restore
  await signIn(page, SAM);
  await open(page, "/p/versions-demo/flow");
  await page.getByRole("button", { name: "Version 3" }).click();
  const forReaders = page.getByRole("dialog", { name: /Versions of/ });
  await expect(forReaders).toContainText("Back to the old wording");
  await expect(forReaders.getByRole("button", { name: "What changed" }).first()).toBeVisible();
  await expect(forReaders.getByRole("button", { name: "Restore" })).toHaveCount(0);
});

test("a draft that was never published: when somebody else saved first, nothing is overwritten without a decision", async ({ page, playwright }) => {
  const errors = watchErrors(page);
  await signIn(page, ALEX);
  await copyOf(page, "conflict-demo", "Conflict demo", "draft");
  await openEditor(page, "process", "conflict-demo");
  await renameFirstStep(page, "My wording");

  const other = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  await otherPersonRenames(other, DANA, "conflict-demo", "Renamed by Dana");

  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  const dialog = page.getByRole("dialog", { name: "Somebody else saved first" });
  await expect(dialog).toContainText(/(dana@example\.com|Dana Admin) saved version 2/);
  await expect(dialog).toContainText("Title changed");
  expect((await readProcess(page, "conflict-demo"))!.title).toBe("Renamed by Dana"); // theirs is untouched

  // continue from their version: their title is there, my change is one Undo away
  await dialog.getByRole("button", { name: "Use their version" }).click();
  await expect(page.locator(".eb-title h1")).toHaveText("Renamed by Dana");
  await expect(firstBlock(page)).toContainText("Request a registry namespace");
  await page.locator(".edit-bar").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstBlock(page)).toContainText("My wording");

  // this time keep mine: it is saved on top of theirs, and theirs stays in the versions
  await otherPersonRenames(other, DANA, "conflict-demo", "Renamed by Dana again");
  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("dialog", { name: "Somebody else saved first" }).getByRole("button", { name: "Save mine over theirs" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet\. Saved( \d\d:\d\d)?\.$/);
  const now = (await readProcess(page, "conflict-demo"))!;
  expect(now.steps[0].title).toBe("My wording");
  expect(now.status).toBe("draft");
  await more(page, "Versions");
  await expect(page.getByRole("dialog", { name: /Versions of/ })).toContainText("Saved over version 3");
  await other.dispose();
  expect(errors).toEqual([]);
});

test("leaving the editing screen with unsaved changes asks first, whichever way out is taken", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "leave-demo", "Leave demo");
  await open(page, "/processes");
  await page.locator(".card", { hasText: "Leave demo" }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await renameFirstStep(page, "Not saved yet");
  const mine = firstBlock(page);
  const ask = page.getByRole("dialog", { name: "Save your changes before you leave?" });

  // moving around inside the editing screen keeps the changes and does not ask
  await outline(page, "About");
  await outline(page, /^2 /);
  await expect(mine).toContainText("Not saved yet");
  await expect(ask).toHaveCount(0);

  // three choices; saving is the main one, and has the focus
  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await expect(ask).toContainText("Your changes to this process are not saved yet. Save them as a draft, or leave and lose them.");
  await expect(ask.locator(".modal-foot button")).toHaveText(["Leave without saving", "Stay", "Save draft and leave"]);
  await expect(ask.getByRole("button", { name: "Save draft and leave" })).toBeFocused();
  await answer(page, "Save your changes before you leave?", "Stay");
  await expect(page).toHaveURL(/#\/p\/leave-demo\/edit/);
  await expect(mine).toContainText("Not saved yet");

  // the browser's Back button: the steps chosen inside the screen first, then out of it, which asks
  for (let i = 0; i < 5 && !(await ask.isVisible()); i++) {
    await page.goBack();
    await page.waitForTimeout(200);
  }
  await answer(page, "Save your changes before you leave?", "Stay");
  await expect(page).toHaveURL(/#\/p\/leave-demo\/edit/);
  await expect(mine).toContainText("Not saved yet");

  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await answer(page, "Save your changes before you leave?", "Leave without saving");
  await expect(page).toHaveURL(/#\/p\/leave-demo\/flow/);
  expect((await readProcess(page, "leave-demo"))!.steps[0].title).toBe("Request a registry namespace");
  expect(await readWorkingDraft(page, "process", "leave-demo")).toBeUndefined(); // nothing was kept behind the reader's back
});

test("“Save draft and leave” saves the changes as a draft and leaves; a save that is refused stays", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "leave-save-demo", "Leave save demo");
  await openEditor(page, "process", "leave-save-demo");
  await renameFirstStep(page, "Kept in the draft");
  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await answer(page, "Save your changes before you leave?", "Save draft and leave");
  await expect(page).toHaveURL(/#\/p\/leave-save-demo\/flow/);
  await expect(page.locator(".draft-line")).toContainText("You have unpublished changes");
  expect((await readWorkingDraft(page, "process", "leave-save-demo"))!.doc.steps[0].title).toBe("Kept in the draft");
  expect((await readProcess(page, "leave-save-demo"))!.steps[0].title).toBe("Request a registry namespace"); // readers: as it was

  // a never-published draft with something to fix cannot be saved: leaving with saving keeps the person there
  await copyOf(page, "leave-blank-demo", "Leave blank demo", "draft");
  try {
    await openEditor(page, "process", "leave-blank-demo").catch(async () => { await page.reload(); await expect(page.locator(".edit-bar")).toBeVisible(); });
    await renameFirstStep(page, "x"); // too short: something to fix before it can be saved
    await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
    const ask = page.getByRole("dialog", { name: "Save your changes before you leave?" });
    // only when everything can be saved is saving offered
    if (await ask.getByRole("button", { name: "Save draft and leave" }).count()) {
      await ask.getByRole("button", { name: "Save draft and leave" }).click();
      await expect(refusal(page)).toContainText("This draft cannot be saved yet");
    } else await answer(page, "Save your changes before you leave?", "Stay");
    await expect(page).toHaveURL(/#\/p\/leave-blank-demo\/edit/);
    await expect(firstBlock(page)).toContainText("x");
    expect((await readProcess(page, "leave-blank-demo"))!.steps[0].title).toBe("Request a registry namespace");
  } finally {
    await page.request.delete("/api/processes/leave-blank-demo", { headers: CSRF });
    await page.request.delete("/api/processes/leave-save-demo", { headers: CSRF });
  }
});

test("changes can be undone step by step, including a deleted step and Discard changes", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "undo-demo", "Undo demo");
  await openEditor(page, "process", "undo-demo");
  const blocks = page.locator(".edit-preview .block");
  await expect(blocks.first()).toBeVisible();
  const all = await blocks.count();
  const bar = page.locator(".edit-bar");
  await outline(page, /^1 /);
  const first = (await fields(page).locator(".fields-head h2").textContent())!;
  await fields(page).getByRole("button", { name: "Delete step" }).click();
  // no question first: it can be undone, and the message says so
  await expect(page.getByRole("dialog", { name: "Delete this step?" })).toHaveCount(0);
  await expect(blocks).toHaveCount(all - 1);
  await expect(page.locator(".toast", { hasText: `Step “${first}” deleted.` }).getByRole("button", { name: "Undo" })).toBeVisible();

  await bar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(blocks).toHaveCount(all);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./); // back to what is saved
  await bar.getByRole("button", { name: "Redo" }).click();
  await expect(blocks).toHaveCount(all - 1);

  // Discard changes goes back to the saved version - and can be undone like any other change
  await bar.getByRole("button", { name: "Discard changes" }).click();
  await expect(blocks).toHaveCount(all);
  await bar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(blocks).toHaveCount(all - 1);
  // the keyboard works too, outside text fields
  await page.locator(".eb-title h1").click();
  await page.keyboard.press("Control+z");
  await expect(blocks).toHaveCount(all);
  await page.keyboard.press("Control+Shift+z");
  await expect(blocks).toHaveCount(all - 1);
  // and Ctrl+S saves the draft, here as unpublished changes
  await page.keyboard.press("Control+s");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Unpublished changes\. Readers still see version 1\. Draft saved \d\d:\d\d\.$/);
  expect((await readWorkingDraft(page, "process", "undo-demo"))!.doc.steps).toHaveLength(all - 1);
  expect((await readProcess(page, "undo-demo"))!.steps).toHaveLength(all);
});

test("a link can point at one step or one requirement", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow/raise-request");
  await expect(page.locator(".drawer h3")).toHaveText("Raise the 'New GCP project' request");
  // closing it takes it out of the address again; opening another one puts that one in
  await page.locator(".drawer").getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow$/);
  await page.locator(".block-main").first().click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow\/decide-project-details$/);

  await open(page, "/p/request-gcp-project/list/verify-access");
  await expect(page.locator("#step-verify-access")).toBeInViewport();

  await page.locator(".block-main, .step").first().waitFor();
  await open(page, "/s/secure-logging/doc/SEC-LOG-03");
  await expect(page.locator(".drawer")).toContainText("SEC-LOG-03");
});

test("when the session ends in the middle of an edit, the edit survives signing in again", async ({ page, context }) => {
  await signIn(page, ALEX);
  await copyOf(page, "session-demo", "Session demo");
  await openEditor(page, "process", "session-demo");
  await renameFirstStep(page, "Typed before the session ended");

  await context.clearCookies(); // the session is gone, as after some hours
  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  const dialog = page.getByRole("dialog", { name: "You are signed out" });
  await expect(dialog).toContainText("Nothing on this page is lost");
  await dialog.getByRole("button", { name: "I have signed in" }).click();
  await expect(dialog).toContainText("You are not signed in yet");

  // signing in again (in the test: through the API, as the other tab would) brings the session back
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  await dialog.getByRole("button", { name: "I have signed in" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(firstBlock(page)).toContainText("Typed before the session ended");
  await publish(page);
  expect((await readProcess(page, "session-demo"))!.steps[0].title).toBe("Typed before the session ended");
});

test("a new process starts with its name, as a draft that readers cannot reach", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/processes");
  await page.getByRole("button", { name: "Blank process" }).click();
  const dialog = page.getByRole("dialog", { name: "New process" });
  await expect(dialog.getByRole("button", { name: "Create process" })).toBeDisabled();
  await dialog.getByLabel("Name of the process").fill("Request a database");
  await expect(dialog).toContainText("Address: …/request-a-database");
  await dialog.getByRole("button", { name: "Create process" }).click();
  await expect(page).toHaveURL(/#\/p\/request-a-database\/edit/);
  await expect(page.locator(".eb-title h1")).toHaveText("Request a database");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet/);
  expect((await readProcess(page, "request-a-database"))!.status).toBe("draft");

  // a reader does not get it from the server at all: not in the list, not by its link
  await signIn(page, SAM);
  expect(await readProcess(page, "request-a-database")).toBeUndefined();
  await open(page, "/p/request-a-database/flow");
  await expect(page.locator("h1")).toHaveText("Process not found");
});

test("the app runs under a strict security policy", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  // what the browser blocks under the policy is reported in the page as well as on the console
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
  await meaningReady(page.request); // the pages below search by meaning too
  await signIn(page, DANA);
  const res = await page.goto("/#/p/request-gcp-project/edit");
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  // the editing screen of a process: the editable map with its tool icons, the fields, the JSON with its checker
  await expect(page.locator(".edit-preview .block").first()).toBeVisible();
  await expect(page.locator(".edit-preview img.entry-icon").first()).toBeVisible();
  await outline(page, /^2 /);
  await expect(fields(page).locator(".fields-head h2")).toBeVisible();
  await more(page, "JSON");
  await expect(page.locator(".cm-editor")).toBeVisible(); // the code editor and the checker both work under it
  await expect(page.locator(".json-side .check.good")).toBeVisible();
  // and of a standard, with its Publish dialog
  await open(page, "/s/secure-logging/edit/SEC-LOG-02");
  await expect(fields(page).locator(".fields-head h2")).toBeVisible();
  await fields(page).getByLabel(/^Short name/).fill("No personal data in the logs");
  await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
  await expect(page.getByRole("dialog", { name: "Publish your changes" })).toContainText("SEC-LOG-02");
  await page.getByRole("dialog", { name: "Publish your changes" }).getByRole("button", { name: "Not yet" }).click();
  await page.locator(".edit-bar").getByRole("button", { name: "Discard changes" }).click();
  // the icons on the reader's pages
  await open(page, "/catalog");
  await page.getByRole("tab", { name: /Tools/ }).click();
  await expect(page.locator("img.entry-icon").first()).toBeVisible();
  expect(await page.locator("img.entry-icon").first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  for (const hash of ["/", "/search?q=gcp", "/processes", "/standards", "/s/secure-logging/doc", "/catalog", "/guide", "/admin/skills", "/requests", "/requests?state=all", "/admin/statistics"]) {
    await open(page, hash);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await expect(page.locator(".stat-totals")).toBeVisible(); // the statistics, with the chart drawn by hand
  // search by meaning and both ways, with their answers drawn
  for (const mode of ["meaning", "both"]) {
    await open(page, `/search?q=cloud&mode=${mode}`);
    await expect(page.locator(".search-page ol.cards > li.card").first()).toBeVisible();
    await expect(page.locator("section.list-results")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("radio", { name: mode === "meaning" ? "Meaning" : "Both", exact: true })).toHaveAttribute("aria-checked", "true");
  }
  // a process page with the share dialog open
  await open(page, "/p/request-gcp-project/flow");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("dialog", { name: /^Share “/ }).getByRole("textbox", { name: "Link" })).toBeVisible();
  // the request form
  await open(page, "/requests");
  await page.getByRole("button", { name: "Ask for a process or standard" }).first().click();
  await expect(page.getByRole("dialog", { name: "Ask for a process or standard" })).toBeVisible();
  expect(problems).toEqual([]);
});

/** What happens when the person comes back to the tab after a while: the portal fetches what others changed. */
async function comeBackLater(page: Page) {
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("the Back button closes a step and never opens again what was closed", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.locator(".card", { hasText: "Request a GCP project" }).click();
  for (const n of [0, 1]) {
    await page.locator(".block-main").nth(n).click();
    await expect(page.locator(".drawer")).toBeVisible();
    await page.locator(".drawer").getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".drawer")).toHaveCount(0);
  }
  // moving from one open step to the next is not a step back in time either
  await page.locator(".block-main").nth(0).click();
  await page.locator(".block-main").nth(2).click();
  await expect(page.locator(".drawer h3")).toHaveText("Approve the monthly budget");
  await page.goBack(); // closes the open step
  await expect(page.locator(".drawer")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow$/);
  await page.goBack(); // and the next one leaves the process
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
});

test("Back with unsaved changes leaves the history as it was, whatever the answer", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "history-demo", "History demo");
  await open(page, "/guide");
  await page.getByRole("link", { name: "Standards" }).click();
  await page.getByRole("link", { name: "Processes" }).click();
  await page.locator(".card", { hasText: "History demo" }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("Changed and not saved, to see what Back does.");

  await page.goBack();
  await answer(page, "Save your changes before you leave?", "Stay");
  await expect(page).toHaveURL(/#\/p\/history-demo\/edit/);
  await expect(page.locator(".edit-preview .preview-head p")).toHaveText("Changed and not saved, to see what Back does.");
  // the same Back again asks again, and leaving goes exactly one step back - not further, not nowhere
  await page.goBack();
  await answer(page, "Save your changes before you leave?", "Leave without saving");
  await expect(page).toHaveURL(/#\/p\/history-demo\/flow/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/standards/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/guide/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/standards/);
});

test("what others change shows up when coming back to the tab; unsaved changes are kept and told about it", async ({ page, playwright }) => {
  await page.clock.install();
  await signIn(page, ALEX);
  await copyOf(page, "refresh-demo", "Refresh demo");
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });

  // a page without changes simply follows
  await open(page, "/p/refresh-demo/flow");
  await expect(page.locator("h1")).toHaveText("Refresh demo");
  await otherPersonRenames(other, DANA, "refresh-demo", "Renamed while Alex was away");
  await comeBackLater(page);
  await expect(page.locator("h1")).toHaveText("Renamed while Alex was away");
  await expect(page.getByRole("button", { name: "Version 2" })).toBeVisible();

  // on the editing screen, unsaved changes are kept when somebody else saves the shared draft meanwhile
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await renameFirstStep(page, "Alex's unsaved wording");
  await other.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const doc = (await readProcess(other, "refresh-demo"))!;
  expect((await other.put("/api/processes/refresh-demo/draft?rev=0", { data: { ...doc, title: "Renamed in Dana's draft" }, headers: CSRF })).ok()).toBeTruthy();
  await comeBackLater(page);
  const banner = page.locator(".banner", { hasText: "saved the unpublished changes" });
  await expect(banner).toContainText(/dana@example\.com|Dana Admin/);
  await expect(firstBlock(page)).toContainText("Alex's unsaved wording");
  // "Compare and decide" shows what they changed without trying to save
  await banner.getByRole("button", { name: "Compare and decide" }).click();
  await expect(page.getByRole("dialog", { name: "Somebody else saved the draft first" })).toContainText("Title changed");
  await page.getByRole("dialog", { name: "Somebody else saved the draft first" }).getByRole("button", { name: "Keep editing" }).click();
  // going back to what was saved (Discard changes) is going to their draft
  await page.locator(".edit-bar").getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator(".eb-title h1")).toHaveText("Renamed in Dana's draft");
  // readers still see the published title
  expect((await readProcess(page, "refresh-demo"))!.title).toBe("Renamed while Alex was away");
  await other.dispose();
});

for (const status of ["draft", "active"] as const) {
  test(`something deleted by somebody else stays on screen while it has unsaved changes (${status === "draft" ? "never published" : "published"})`, async ({ page, playwright }) => {
    await page.clock.install();
    await signIn(page, ALEX);
    const id = `deleted-demo-${status}`;
    await copyOf(page, id, "Deleted demo", status);
    await openEditor(page, "process", id);
    await renameFirstStep(page, "Hours of careful work");

    const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
    await other.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
    expect((await other.delete(`/api/processes/${id}`, { headers: CSRF })).ok()).toBeTruthy();
    await comeBackLater(page);
    await expect(firstBlock(page)).toContainText("Hours of careful work"); // not "Process not found"

    await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
    const dialog = page.getByRole("dialog", { name: "This process was deleted" });
    await expect(dialog).toContainText("Your changes are still here");
    await expect(dialog).toContainText(status === "active" ? "It comes back as a draft: readers see it again when you publish." : "readers see it when you publish.");
    await expect(editState(page)).toHaveAttribute("aria-label", /^Deleted\. Readers no longer see it\. Saving brings it back as a draft/);
    await dialog.getByRole("button", { name: "Save mine and bring it back" }).click();
    await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet\. Saved( \d\d:\d\d)?\.$/);
    expect((await readProcess(page, id))!).toMatchObject({ status: "draft" });
    expect((await readProcess(page, id))!.steps[0].title).toBe("Hours of careful work");
    await more(page, "Versions");
    await expect(page.getByRole("dialog", { name: /Versions of/ }).locator(".history > li").first()).toContainText("Restored after it was deleted");
    await other.dispose();
    await page.request.delete(`/api/processes/${id}`, { headers: CSRF });
  });
}

test("a deleted process is not brought back while the checker finds a problem: the reason, the changes kept, then saved", async ({ page, playwright }) => {
  await page.clock.install();
  await signIn(page, ALEX);
  const id = "deleted-problem-demo";
  await copyOf(page, id, "Deleted problem demo");
  await openEditor(page, "process", id);
  await renameFirstStep(page, "x"); // too short: a problem
  await expect(page.locator(".eb-status.bad")).toBeVisible();
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await other.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  expect((await other.delete(`/api/processes/${id}`, { headers: CSRF })).ok()).toBeTruthy();
  await other.dispose();
  await comeBackLater(page);

  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("dialog", { name: "This process was deleted" }).getByRole("button", { name: "Save mine and bring it back" }).click();
  await expect(refusal(page)).toHaveText("This process cannot be brought back yet: it comes back as a draft, which is only saved with nothing to fix. Your changes are still here.");
  expect(await readProcess(page, id)).toBeUndefined();
  await expect(firstBlock(page)).toContainText("x");
  // the first thing to fix is selected, with its fields
  await page.keyboard.press("Escape");
  await expect(fields(page).locator(".fields-head h2")).toHaveText("x");
  await fields(page).getByLabel(/^What happens/).fill("A name that is long enough");
  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  const again = page.getByRole("dialog", { name: "This process was deleted" });
  if (await again.isVisible().catch(() => false)) await again.getByRole("button", { name: "Save mine and bring it back" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet\. Saved( \d\d:\d\d)?\.$/);
  expect((await readProcess(page, id))!).toMatchObject({ status: "draft" });
  expect((await readProcess(page, id))!.steps[0].title).toBe("A name that is long enough");
  await page.request.delete(`/api/processes/${id}`, { headers: CSRF });
});

test("deleting is refused when somebody else changed it since it was opened", async ({ page, playwright }) => {
  await signIn(page, ALEX);
  await copyOf(page, "stale-delete-demo", "Stale delete demo");
  await open(page, "/p/stale-delete-demo/flow");
  await expect(page.locator("h1")).toHaveText("Stale delete demo"); // Alex has it open before Dana changes it
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.locator(".edit-preview .block").first()).toBeVisible();
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await otherPersonRenames(other, DANA, "stale-delete-demo", "Dana still needs this");

  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.locator(".toast", { hasText: "could not be deleted" })).toContainText("changed this process in the meantime");
  expect((await readProcess(page, "stale-delete-demo"))!.title).toBe("Dana still needs this");
  await other.dispose();
});

test("deleting something with unsaved changes does not ask about them afterwards", async ({ page }) => {
  await signIn(page, ALEX);
  await copyOf(page, "delete-dirty-demo", "Delete dirty demo");
  await openEditor(page, "process", "delete-dirty-demo");
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("A change that goes down with the process.");
  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await readProcess(page, "delete-dirty-demo")).toBeUndefined();
});

test("closing a step stays on the tab where it was closed", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await page.locator(".card", { hasText: "Request a GCP project" }).click();
  await page.locator(".block-main").nth(1).click(); // opened on the map
  await page.getByRole("tab", { name: "Checklist" }).click(); // still open in the checklist
  await expect(page.locator(".drawer h3")).toHaveText("Raise the 'New GCP project' request");
  await page.locator(".drawer").getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".drawer")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Checklist" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/list$/); // no step left in the address
  await page.reload();
  await expect(page.locator(".step").first()).toBeVisible();
  await expect(page.locator(".drawer")).toHaveCount(0);
});
