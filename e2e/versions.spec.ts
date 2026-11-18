import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, DANA, SAM, answer, open, readProcess, save, signIn, watchErrors } from "./helpers";

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

const renameFirstStep = async (page: Page, title: string) => {
  await page.locator(".block-main").first().click();
  await page.getByRole("button", { name: "Edit step" }).click();
  await page.locator(".drawer").getByLabel("What happens", { exact: true }).fill(title);
};

test("every save is a version with a note, and everyone can see what changed", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "versions-demo", "Versions demo");
  await open(page, "/p/versions-demo/flow");
  await expect(page.getByRole("button", { name: "Version 1" })).toBeVisible();

  await renameFirstStep(page, "Ask for a namespace");
  await page.getByLabel("What changed? (optional)").fill("Plainer wording for the first step");
  await save(page);
  await expect(page.getByRole("button", { name: "Version 2" })).toBeVisible();

  await page.getByRole("button", { name: "Version 2" }).click();
  const versions = page.getByRole("dialog", { name: /Versions of/ });
  await expect(versions.locator("li").first()).toContainText("Version 2");
  await expect(versions.locator("li").first()).toContainText("current");
  await expect(versions.locator("li").first()).toContainText("Plainer wording for the first step");
  await expect(versions.locator("li").first()).toContainText(ALEX);
  await versions.locator("li").first().getByRole("button", { name: "What changed" }).click();
  await expect(versions.locator(".history-detail")).toContainText("Step “Ask for a namespace” changed: title");

  // an editor can bring the earlier version back; it only becomes real with a save
  await versions.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".block").first()).toContainText("Request a registry namespace");
  await page.getByLabel("What changed? (optional)").fill("Back to the old wording");
  await save(page);
  await expect(page.getByRole("button", { name: "Version 3" })).toBeVisible();

  // a reader sees the versions and the notes, but cannot restore
  await signIn(page, SAM);
  await open(page, "/p/versions-demo/flow");
  await page.getByRole("button", { name: "Version 3" }).click();
  const forReaders = page.getByRole("dialog", { name: /Versions of/ });
  await expect(forReaders).toContainText("Back to the old wording");
  await expect(forReaders.getByRole("button", { name: "What changed" }).first()).toBeVisible();
  await expect(forReaders.getByRole("button", { name: "Restore" })).toHaveCount(0);
});

test("when somebody else saved first, nothing is overwritten without a decision", async ({ page, playwright }) => {
  const errors = watchErrors(page);
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "conflict-demo", "Conflict demo");
  await open(page, "/p/conflict-demo/flow");
  await renameFirstStep(page, "My wording");

  const other = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  await otherPersonRenames(other, DANA, "conflict-demo", "Renamed by Dana");

  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Somebody else saved first" });
  await expect(dialog).toContainText(`${DANA} saved version 2`);
  await expect(dialog).toContainText("Title changed");
  expect((await readProcess(page, "conflict-demo"))!.title).toBe("Renamed by Dana"); // theirs is untouched

  // continue from their version: their title is there, my change is one Undo away
  await dialog.getByRole("button", { name: "Use their version" }).click();
  await expect(page.locator("h1")).toHaveText("Renamed by Dana");
  await expect(page.locator(".block").first()).toContainText("Request a registry namespace");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".block").first()).toContainText("My wording");

  // this time keep mine: it is saved on top of theirs, and theirs stays in the versions
  await otherPersonRenames(other, DANA, "conflict-demo", "Renamed by Dana again");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("dialog", { name: "Somebody else saved first" }).getByRole("button", { name: "Save mine over theirs" }).click();
  await expect(page.locator(".saved")).toBeVisible();
  const now = (await readProcess(page, "conflict-demo"))!;
  expect(now.steps[0].title).toBe("My wording");
  await page.getByRole("button", { name: "Version 4" }).click();
  await expect(page.getByRole("dialog", { name: /Versions of/ })).toContainText("Saved over version 3");
  await other.dispose();
  expect(errors).toEqual([]);
});

test("leaving with unsaved changes asks first, whichever way out is taken", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "leave-demo", "Leave demo");
  await open(page, "/processes");
  await page.locator(".card", { hasText: "Leave demo" }).click();
  await renameFirstStep(page, "Not saved yet");
  const mine = page.getByText("Not saved yet").first();

  // moving around inside the process keeps the changes and does not ask
  await page.getByRole("tab", { name: "Checklist" }).click();
  await expect(mine).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Leave without saving?" })).toHaveCount(0);
  await expect(page.locator(".drawer")).toBeVisible(); // the open step stays open across the tabs

  for (const leave of [
    () => page.getByRole("link", { name: "Guide" }).click(),
    () => page.getByRole("button", { name: "All processes" }).click(),
  ]) {
    await leave();
    await answer(page, "Leave without saving?", "Stay");
    await expect(page).toHaveURL(/#\/p\/leave-demo\/list/);
    await expect(mine).toBeVisible();
  }
  // the Back button: back through the checklist and the open step it stays inside the process; the next one would leave
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await answer(page, "Leave without saving?", "Stay");
  await expect(page).toHaveURL(/#\/p\/leave-demo\//);
  await expect(mine).toBeVisible();

  // signing out is a way out too
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("button", { name: "Switch user" }).click();
  await answer(page, "Leave without saving?", "Stay");
  await expect(mine).toBeVisible();

  await page.getByRole("link", { name: "Guide" }).click();
  await answer(page, "Leave without saving?", "Leave without saving");
  await expect(page).toHaveURL(/#\/guide/);
  expect((await readProcess(page, "leave-demo"))!.steps[0].title).toBe("Request a registry namespace");
});

test("changes can be undone step by step, including a deleted step and Discard", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "undo-demo", "Undo demo");
  await open(page, "/p/undo-demo/flow");
  const blocks = page.locator(".block");
  await expect(blocks.first()).toBeVisible();
  const all = await blocks.count();
  await page.locator(".block-main").first().click();
  await page.locator(".drawer").getByRole("button", { name: "Delete step" }).click();
  await answer(page, "Delete this step?", "Delete step");
  await expect(blocks).toHaveCount(all - 1);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(blocks).toHaveCount(all);
  await expect(page.locator(".saved")).toBeVisible(); // back to what is saved
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(blocks).toHaveCount(all - 1);

  // Discard goes back to the saved version - and can be undone like any other change
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(blocks).toHaveCount(all);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(blocks).toHaveCount(all - 1);
  // the keyboard works too, outside text fields
  await page.locator("h1").click();
  await page.keyboard.press("Control+z");
  await expect(blocks).toHaveCount(all);
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
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "session-demo", "Session demo");
  await open(page, "/p/session-demo/flow");
  await renameFirstStep(page, "Typed before the session ended");

  await context.clearCookies(); // the session is gone, as after some hours
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog", { name: "You are signed out" });
  await expect(dialog).toContainText("Nothing on this page is lost");
  await dialog.getByRole("button", { name: "I have signed in" }).click();
  await expect(dialog).toContainText("You are not signed in yet");

  // signing in again (in the test: through the API, as the other tab would) brings the session back
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  await dialog.getByRole("button", { name: "I have signed in" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".block").first()).toContainText("Typed before the session ended");
  await save(page);
  expect((await readProcess(page, "session-demo"))!.steps[0].title).toBe("Typed before the session ended");
});

test("a new process starts with its name, as a draft that readers cannot reach", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await open(page, "/processes");
  await page.getByRole("button", { name: "Blank process" }).click();
  const dialog = page.getByRole("dialog", { name: "New process" });
  await expect(dialog.getByRole("button", { name: "Create process" })).toBeDisabled();
  await dialog.getByLabel("Name of the process").fill("Request a database");
  await expect(dialog).toContainText("Address: …/request-a-database");
  await dialog.getByRole("button", { name: "Create process" }).click();
  await expect(page).toHaveURL(/#\/p\/request-a-database\/flow/);
  await expect(page.locator("h1")).toHaveText("Request a database");
  await expect(page.locator(".banner", { hasText: "Draft." })).toBeVisible();
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
  await signIn(page, DANA, { editor: true });
  const res = await page.goto("/#/p/request-gcp-project/json");
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.locator(".cm-editor")).toBeVisible(); // the code editor and the checker both work under it
  await expect(page.locator(".status.good")).toBeVisible();
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
  await expect(page.getByRole("dialog", { name: /^Share/ })).toBeVisible();
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
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "history-demo", "History demo");
  await open(page, "/guide");
  await page.getByRole("link", { name: "Standards" }).click();
  await page.getByRole("link", { name: "Processes" }).click();
  await page.locator(".card", { hasText: "History demo" }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByLabel("Summary").fill("Changed and not saved, to see what Back does.");
  await page.locator(".modal").getByRole("button", { name: "Done" }).click();

  await page.goBack();
  await answer(page, "Leave without saving?", "Stay");
  await expect(page).toHaveURL(/#\/p\/history-demo\/flow/);
  await expect(page.locator(".lead")).toHaveText("Changed and not saved, to see what Back does.");
  // the same Back again asks again, and leaving goes exactly one step back - not further, not nowhere
  await page.goBack();
  await answer(page, "Leave without saving?", "Leave without saving");
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
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "refresh-demo", "Refresh demo");
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });

  // a page without changes simply follows
  await open(page, "/p/refresh-demo/flow");
  await expect(page.locator("h1")).toHaveText("Refresh demo");
  await otherPersonRenames(other, DANA, "refresh-demo", "Renamed while Alex was away");
  await comeBackLater(page);
  await expect(page.locator("h1")).toHaveText("Renamed while Alex was away");
  await expect(page.getByRole("button", { name: "Version 2" })).toBeVisible();

  // a page with changes keeps them and says that there is a newer version
  await renameFirstStep(page, "Alex's unsaved wording");
  await otherPersonRenames(other, DANA, "refresh-demo", "Renamed a second time");
  await comeBackLater(page);
  const banner = page.locator(".banner", { hasText: "saved a newer version of this process" });
  await expect(banner).toContainText(DANA);
  await expect(page.locator(".block").first()).toContainText("Alex's unsaved wording");
  await expect(page.locator("h1")).toHaveText("Renamed while Alex was away"); // still the version the changes are based on
  // "Compare and decide" shows what they changed without trying to save
  await banner.getByRole("button", { name: "Compare and decide" }).click();
  await expect(page.getByRole("dialog", { name: "Somebody else saved first" })).toContainText("Title changed");
  await page.getByRole("dialog", { name: "Somebody else saved first" }).getByRole("button", { name: "Keep editing" }).click();
  // going back to what was saved (Discard) is going to the newest version
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("h1")).toHaveText("Renamed a second time");
  await other.dispose();
});

test("something deleted by somebody else stays on screen while it has unsaved changes", async ({ page, playwright }) => {
  await page.clock.install();
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "deleted-demo", "Deleted demo");
  await open(page, "/p/deleted-demo/flow");
  await renameFirstStep(page, "Hours of careful work");

  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await other.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  expect((await other.delete("/api/processes/deleted-demo", { headers: CSRF })).ok()).toBeTruthy();
  await comeBackLater(page);
  await expect(page.locator(".block").first()).toContainText("Hours of careful work"); // not "Process not found"

  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog", { name: /was deleted/ });
  await expect(dialog).toContainText("Your changes are still here");
  await dialog.getByRole("button", { name: "Save mine and bring it back" }).click();
  await expect(page.locator(".saved")).toBeVisible();
  expect((await readProcess(page, "deleted-demo"))!.steps[0].title).toBe("Hours of careful work");
  await other.dispose();
});

test("deleting is refused when somebody else changed it since it was opened", async ({ page, playwright }) => {
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "stale-delete-demo", "Stale delete demo");
  await open(page, "/p/stale-delete-demo/flow");
  await expect(page.locator("h1")).toHaveText("Stale delete demo"); // Alex has it open before Dana changes it
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8090" });
  await otherPersonRenames(other, DANA, "stale-delete-demo", "Dana still needs this");

  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Delete process" }).click();
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.locator(".toast", { hasText: "could not be deleted" })).toContainText("changed this process in the meantime");
  expect((await readProcess(page, "stale-delete-demo"))!.title).toBe("Dana still needs this");
  await other.dispose();
});

test("deleting something with unsaved changes does not ask about them afterwards", async ({ page }) => {
  await signIn(page, ALEX, { editor: true });
  await copyOf(page, "delete-dirty-demo", "Delete dirty demo");
  await open(page, "/p/delete-dirty-demo/flow");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByLabel("Summary").fill("A change that goes down with the process.");
  await page.locator(".modal").getByRole("button", { name: "Delete process" }).click();
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
