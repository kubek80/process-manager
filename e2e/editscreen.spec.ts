import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { addInOutline, ALEX, CSRF, deleteSelected, editState, fields, moveTo, openEditor, outline, outlineNav, outlineTitles, pickKind, readWorkingDraft, RILEY, saveDraft, signIn } from "./helpers";

// The editing screen of a process, part by part: adding steps by name, moving them in the flow,
// decisions and their answers, deleting with Undo instead of a question, who does a step, its
// kind, its actions and what comes next, the keyboard, the outline and the map. Every test works
// on a copy of its own, removed afterwards.

const PREFIX = "editscreen-demo-";
const GCP = "request-gcp-project";
const LIB = "publish-internal-library";

/** A copy of a sample process as it is in its file (other tests change the stored one). */
async function copyOf(request: APIRequestContext, src: string, id: string, title: string) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const doc = JSON.parse(readFileSync(`processes/${src}.json`, "utf8"));
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...doc, id, title, status: "active" }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
}
test.afterEach(async ({ request }) => {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const { processes } = await (await request.get("/api/processes")).json();
  for (const p of processes.filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/processes/${p.id}`, { headers: CSRF });
});

const bar = (page: Page) => page.locator(".edit-bar");
const map = (page: Page) => page.locator(".edit-preview");
/** The arrows drawn on the map, as "from>to" (from the insert buttons on them, which name both ends). */
async function drawn(page: Page): Promise<string[]> {
  await map(page).locator(".flow-canvas").hover();
  const names = await map(page).getByRole("button", { name: /^Insert a step between/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
  return names.map((n) => n.replace(/^Insert a step between “(.*)” and “(.*)”$/, "$1>$2")).sort();
}

test("a new process: the first name typed replaces “First step”, the next ones follow; Start here says where to begin", async ({ page }) => {
  await signIn(page, ALEX);
  await page.goto("/#/processes");
  await page.getByRole("button", { name: "New process", exact: true }).click();
  const named = page.getByRole("dialog", { name: "New process" });
  await named.getByLabel("Name of the process").fill("Editscreen demo new");
  await named.getByRole("button", { name: "Create process" }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${PREFIX}new/edit`));

  // Start here: three things to do, each with a button
  const start = page.getByRole("region", { name: "Start here" });
  await expect(start).toBeVisible();
  await expect(start.getByRole("button")).toHaveText(["Write the summary", "Add the steps", "Open the first step"]);
  await start.getByRole("button", { name: "Add the steps" }).click();
  const field = outlineNav(page).getByRole("textbox", { name: "Add a step" });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("placeholder", /next step/);
  await addInOutline(page, "Ask for a laptop", "Collect the laptop", "Sign the receipt");
  await expect.poll(() => outlineTitles(page)).toEqual(["Ask for a laptop", "Collect the laptop", "Sign the receipt"]);
  await expect(map(page).locator(".block")).toHaveCount(3);
  // Escape leaves the field and goes back to "Add a step"
  await field.press("Escape");
  await expect(outlineNav(page).getByRole("button", { name: "Add a step" })).toBeFocused();
  // "Start here" goes once there is more than a beginning
  await expect(start).toHaveCount(0);
  // the steps follow one another (a never-published draft is saved as itself)
  await saveDraft(page);
  const doc = (await (await page.request.get("/api/processes")).json()).processes.find((p: { id: string }) => p.id === `${PREFIX}new`);
  expect(doc.steps.map((s: { title: string }) => s.title)).toEqual(["Ask for a laptop", "Collect the laptop", "Sign the receipt"]);
  expect(doc.steps[0].next).toEqual([{ to: doc.steps[1].id }]);
  expect(doc.steps[1].next).toEqual([{ to: doc.steps[2].id }]);
});

test("Start here: “Write the summary” and “Open the first step”; example text is selected when its field is entered", async ({ page }) => {
  await signIn(page, ALEX);
  await page.goto("/#/processes");
  await page.getByRole("button", { name: "New process", exact: true }).click();
  await page.getByRole("dialog", { name: "New process" }).getByLabel("Name of the process").fill("Editscreen demo start");
  await page.getByRole("dialog", { name: "New process" }).getByRole("button", { name: "Create process" }).click();
  const start = page.getByRole("region", { name: "Start here" });
  await start.getByRole("button", { name: "Write the summary" }).click();
  const summary = fields(page).getByLabel(/^Summary/);
  await expect(summary).toBeFocused();
  // the example sentence is selected: typing replaces it
  const sel = () => summary.evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd, e.value.length]);
  await expect.poll(sel).toEqual([0, (await summary.inputValue()).length, (await summary.inputValue()).length]);
  await page.keyboard.type("A laptop, set up for work.");
  await expect(summary).toHaveValue("A laptop, set up for work.");
  await start.getByRole("button", { name: "Open the first step" }).click();
  await expect(fields(page).locator(".fields-head h2")).toHaveText("First step");
  const name = fields(page).getByLabel(/^What happens/);
  await name.click();
  await expect.poll(() => name.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, "First step".length]);
  const action = fields(page).getByLabel("Action 1", { exact: true });
  await action.click();
  await expect.poll(() => action.evaluate((e: HTMLTextAreaElement) => e.selectionEnd! - e.selectionStart!)).toBe((await action.inputValue()).length);
  // an own text is not selected
  await name.fill("Ask for a laptop");
  await action.click();
  await name.click();
  await expect.poll(() => name.evaluate((e: HTMLInputElement) => e.selectionEnd! - e.selectionStart!)).toBe(0);
});

test("a step is moved in the flow three ways - Move…, Alt + arrows, dragging in the outline - and the arrows follow", async ({ page, request }) => {
  const id = `${PREFIX}moves`;
  await copyOf(request, LIB, id, "Editscreen demo moves");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  const start = await drawn(page);
  expect(start).toContain("Build and publish the version>Install the library from another project");

  // Move…: the last step before the second one
  await outline(page, /^6 Install the library/);
  const select = fields(page).getByRole("combobox", { name: "Move this step" });
  await expect(select.locator("option").first()).toHaveText("Move…");
  await expect(select.locator("option", { hasText: "To the end" })).toHaveCount(0); // it is the last already
  await moveTo(page, "Before 2. Create the namespace");
  await expect.poll(() => outlineTitles(page)).toEqual([
    "Request a registry namespace", "Install the library from another project", "Create the namespace", "Add the release workflow", "Tag the first version", "Build and publish the version",
  ]);
  // the map's arrows follow: in before it, out to the step it now stands before, the gap closed
  const moved = await drawn(page);
  expect(moved).toContain("Request a registry namespace>Install the library from another project");
  expect(moved).toContain("Install the library from another project>Create the namespace");
  expect(moved).not.toContain("Build and publish the version>Install the library from another project");

  // Alt + arrow on the outline item: one place on, the focus stays with it
  const item = outlineNav(page).getByRole("button", { name: /^2 Install the library from another project, / });
  await item.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => (await outlineTitles(page)).slice(1, 3)).toEqual(["Create the namespace", "Install the library from another project"]);
  await expect(outlineNav(page).getByRole("button", { name: /^3 Install the library from another project, / })).toBeFocused();

  // dragging by the grip: back to the end
  const grip = outlineNav(page).getByRole("button", { name: "Move “Install the library from another project”: drag, or press the up and down arrow keys" });
  const last = outlineNav(page).locator(".outline-row.depth-1").last();
  await grip.hover();
  const g = (await grip.boundingBox())!;
  const l = (await last.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 20, { steps: 4 });
  await page.mouse.move(g.x + g.width / 2, l.y + l.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await outlineTitles(page)).at(-1)).toBe("Install the library from another project");
  // back where it started: the arrows are the first ones again, and there is nothing left to save
  expect(await drawn(page)).toEqual(start);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\. Version 1\. Saved\.$/);
});

test("a decision moves with its answers; the message names the answer that changed, and Undo there takes it back", async ({ page, request }) => {
  const id = `${PREFIX}decision`;
  await copyOf(request, GCP, id, "Editscreen demo decision");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^5 Details complete\?/);
  await moveTo(page, /^Before 4\. Check naming/);
  // no refusal: it moved, and says what it did to its answers
  const toast = page.locator(".toast", { hasText: "“Yes” of “Details complete?” now leads to “Check naming, folder and ownership”" });
  await expect(toast).toBeVisible();
  await expect.poll(async () => (await outlineTitles(page)).slice(3, 5)).toEqual(["Details complete?", "Check naming, folder and ownership"]);
  // its "No" still goes where it went
  await expect(fields(page).getByRole("textbox", { name: "Name of path 2" })).toHaveValue("No");
  await expect(fields(page).getByRole("combobox", { name: "Path 2 goes to" }).locator("option:checked")).toContainText("Answer the platform team's questions");
  // Undo, from the message itself
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await outlineTitles(page)).slice(3, 5)).toEqual(["Check naming, folder and ownership", "Details complete?"]);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./); // back to what is saved
});

test("deleting a step inside a branch: no question, both answers kept, “deleted” with Undo", async ({ page, request }) => {
  const id = `${PREFIX}delete`;
  await copyOf(request, GCP, id, "Editscreen demo delete");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^7 Add your project to the project factory/);
  await deleteSelected(page, "Delete step");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // a short message: what was deleted (long names cut) and, on a line of its own, which answer now leads elsewhere
  const toast = page.locator(".toast", { hasText: "deleted." });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Step “Add your project to the proje…” deleted.");
  await expect(toast).toContainText("“Yes” of “Details complete?” now leads elsewhere.");
  const lines = await toast.evaluate((e) => { const t = e.querySelector("p")!; const lh = parseFloat(getComputedStyle(t.querySelector("strong")!).lineHeight) || 20; return Math.round(t.getBoundingClientRect().height / lh); });
  expect(lines, "at most two lines").toBeLessThanOrEqual(2);
  // the focus is on the step now selected, in the outline: a second press cannot delete it
  await expect(outlineNav(page).locator('.outline-item[aria-current="true"]')).toBeFocused();
  await expect(map(page).locator(".block")).toHaveCount(9);
  // the decision keeps both of its answers
  await outline(page, /^5 Details complete\?/);
  await expect(fields(page).getByRole("textbox", { name: "Name of path 1" })).toHaveValue("Yes");
  await expect(fields(page).getByRole("textbox", { name: "Name of path 2" })).toHaveValue("No");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(map(page).locator(".block")).toHaveCount(10);
  await expect.poll(() => outlineTitles(page)).toContain("Add your project to the project factory");
  // what Undo says is what is true now
  await expect(page.locator(".toast", { hasText: /is back\.$/ })).toContainText(/Step “Add your project to the proje(ct factory|…)” is back\./);
});

test("who does it: “Someone else” adds a participant and gives them the step; the kind is chosen in a pop-up", async ({ page, request }) => {
  const id = `${PREFIX}who`;
  await copyOf(request, LIB, id, "Editscreen demo who");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^4 Tag the first version/);
  const who = fields(page).getByRole("group", { name: "Who does it" });
  await expect(who.getByRole("button", { name: "You" })).toHaveAttribute("aria-pressed", "true");
  await who.getByRole("button", { name: "Someone else" }).click();
  const input = fields(page).getByRole("combobox", { name: "Who else takes part" }); // with the teams of the lists to choose from
  await expect(input).toBeFocused();
  await input.fill("Release managers");
  await fields(page).getByRole("button", { name: "Add and give them this step" }).click();
  await expect(who.getByRole("button", { name: "Release managers" })).toHaveAttribute("aria-pressed", "true");
  await expect(who.getByRole("button", { name: "You" })).toHaveAttribute("aria-pressed", "false");
  await expect(map(page).locator(".lane-label", { hasText: "Release managers" })).toBeVisible();
  await expect(outlineNav(page).getByRole("button", { name: /^4 Tag the first version, by Release managers/ })).toBeVisible();

  // the kind: one button, the choice opens as a pop-up of every kind, with a word on when to use it
  const pick = fields(page).locator("button.kind-pick");
  await expect(pick).toHaveText("Task");
  await expect(pick).toHaveAttribute("aria-expanded", "false");
  await pick.click();
  const pop = fields(page).getByRole("group", { name: "Kind of step" });
  await expect(pop.locator(".type-opt")).toHaveCount(13);
  await expect(pop.locator('.type-opt[aria-pressed="true"]')).toHaveText("Task");
  await expect(pop.locator('.type-opt[aria-pressed="true"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await pickKind(page, "Meeting");
  await expect(pick).toHaveText("Meeting");
  await expect(map(page).locator(".block", { hasText: "Tag the first version" })).toContainText("Meeting");
  await saveDraft(page);
  expect((await readWorkingDraft(page, "process", id))!.doc.steps.find((s: { id: string }) => s.id === "tag-version")).toMatchObject({ actor: "release-managers", type: "meeting" });
});

test("actions: Enter adds the next, Backspace in an empty one removes it; what comes next: another way on, a loop back, a decision's answers", async ({ page, request }) => {
  const id = `${PREFIX}actions`;
  await copyOf(request, LIB, id, "Editscreen demo actions");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^4 Tag the first version/);
  const n = await fields(page).getByRole("textbox", { name: /^Action \d+$/ }).count();
  const lastAction = fields(page).getByLabel(`Action ${n}`, { exact: true });
  await lastAction.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const added = fields(page).getByLabel(`Action ${n + 1}`, { exact: true });
  await expect(added).toBeFocused();
  await page.keyboard.type("Tell the team.");
  await page.keyboard.press("Enter");
  await expect(fields(page).getByLabel(`Action ${n + 2}`, { exact: true })).toBeFocused();
  await page.keyboard.press("Backspace"); // empty: removed, back to the one before
  await expect(fields(page).getByLabel(`Action ${n + 2}`, { exact: true })).toHaveCount(0);
  await expect(added).toBeFocused();
  await expect(added).toHaveValue("Tell the team.");

  // what comes next, in sentences
  const next = fields(page).locator(".field.paths");
  await expect(next.locator(".field-label")).toContainText("Then");
  await next.getByRole("button", { name: "Add another way on" }).click();
  await expect(next.locator(".field-label")).toContainText("Several ways on");
  await expect(fields(page).getByRole("textbox", { name: "Name of path 2" })).toBeVisible();
  await fields(page).getByRole("button", { name: "Remove path 2" }).click();
  await next.getByRole("button", { name: "Go back to an earlier step" }).click();
  await expect(next.locator(".path-row.back")).toHaveCount(1);
  await expect(fields(page).getByRole("combobox", { name: "Path 2 goes to" }).locator("option:checked")).toHaveText(/^↩ 3\. Add the release workflow$/);
  await fields(page).getByRole("button", { name: "Remove path 2" }).click();
  // made a decision, the step gets "Yes" and "No", "No" going back to the step before
  await pickKind(page, "Decision");
  await expect(next.locator(".field-label")).toContainText("One branch per answer");
  await expect(fields(page).getByRole("textbox", { name: "Name of path 1" })).toHaveValue("Yes");
  await expect(fields(page).getByRole("textbox", { name: "Name of path 2" })).toHaveValue("No");
  await expect(fields(page).getByRole("combobox", { name: "Path 2 goes to" }).locator("option:checked")).toHaveText(/^↩ 3\. /);
  await expect(fields(page).locator(".item-issues.bad")).toHaveCount(0);
  // "Add a branch" on a decision: a new step on a branch of its own, by its name
  await fields(page).getByRole("button", { name: "Add a branch" }).first().click();
  await fields(page).getByRole("textbox", { name: "Name of the step on the new branch" }).fill("Fix the tag");
  await fields(page).getByRole("textbox", { name: "Name of the step on the new branch" }).press("Enter");
  await expect(fields(page).locator(".fields-head h2")).toHaveText("Fix the tag");
});

test("suggestions about a brand-new step wait until it was left once; Undo says what it takes back", async ({ page, request }) => {
  const id = `${PREFIX}hints`;
  await copyOf(request, LIB, id, "Editscreen demo hints");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await addInOutline(page, "Announce it");
  await outline(page, /^7 Announce it/);
  await expect(fields(page).locator(".fields-head h2")).toHaveText("Announce it");
  await expect(fields(page).locator(".item-issues.hint")).toHaveCount(0);
  await expect(outlineNav(page).getByRole("button", { name: /^7 Announce it, .*suggestion/ })).toHaveCount(0);
  await outline(page, /^1 /);
  await outline(page, /^7 Announce it/);
  await expect(fields(page).locator(".item-issues.hint")).toContainText("Say exactly what the reader does in this step.");
  await expect(outlineNav(page).getByRole("button", { name: /^7 Announce it, by .*, \d+ suggestions?/ })).toBeVisible();
  // Undo names the change it takes back
  await expect(bar(page).getByRole("button", { name: "Undo" })).toHaveAttribute("title", /^Undo: .+ \(Ctrl\+Z\)$/);
});

test("the outline is one Tab stop: arrows move, Enter goes to the fields, Escape comes back", async ({ page, request }) => {
  const id = `${PREFIX}keys`;
  await copyOf(request, LIB, id, "Editscreen demo keys");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^2 /);
  const items = outlineNav(page).locator(".outline-item");
  // only the selected item is in the Tab order
  expect(await items.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
  const second = outlineNav(page).getByRole("button", { name: /^2 Create the namespace/ });
  await second.focus();
  await page.keyboard.press("ArrowDown");
  await expect(outlineNav(page).getByRole("button", { name: /^3 Add the release workflow/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await outlineNav(page).getByRole("button", { name: /^3 Add the release workflow/ }).focus();
  await page.keyboard.press("Enter");
  await expect(fields(page).locator(".fields-head h2")).toHaveText("Add the release workflow");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".edit-fields"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(outlineNav(page).getByRole("button", { name: /^3 Add the release workflow/ })).toBeFocused();
  // Tab leaves the outline at once
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => !document.activeElement?.closest(".outline-row.depth-1"))).toBe(true);
});

test("the outline can be narrowed to a rail of icons, and the choice is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ALEX);
  await openEditor(page, "process", GCP);
  const screen = page.locator(".edit-screen");
  const toggle = page.locator("button.outline-toggle");
  // the person's own choice decides; start from the outline with names
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAccessibleName("Narrow the outline");
  await expect(toggle).toHaveAttribute("aria-controls", "edit-outline");
  const wide = (await page.locator(".edit-outline").boundingBox())!.width;
  await toggle.click();
  await expect(screen).toHaveClass(/\boutline-rail\b/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("Show the outline with names");
  expect((await page.locator(".edit-outline").boundingBox())!.width).toBeLessThan(wide / 2);
  // the map gets the room
  await expect(outlineNav(page).locator(".outline-short").first()).toBeVisible();
  // names stay as tooltips and accessible names
  await expect(outlineNav(page).getByRole("button", { name: /^1 Decide the project details/ })).toHaveAttribute("title", /Decide the project details/);
  await page.reload();
  await expect(page.locator(".edit-screen")).toHaveClass(/\boutline-rail\b/);
  // "Add a step" on the rail widens the outline to type
  await outlineNav(page).getByRole("button", { name: "Add a step" }).click();
  await expect(page.locator(".edit-screen")).not.toHaveClass(/\boutline-rail\b/);
  await expect(outlineNav(page).getByRole("textbox", { name: "Add a step" })).toBeFocused();
  await page.reload();
  await expect(page.locator(".edit-screen")).not.toHaveClass(/\boutline-rail\b/);
});

test("the map: Legend on demand, lane names that keep their size at every zoom, Fit from the start", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, ALEX);
  await openEditor(page, "process", GCP);
  const m = map(page);
  // no legend in the way: a button that shows it
  await expect(m.getByRole("group", { name: "Kinds of steps" })).toHaveCount(0);
  const legend = m.getByRole("button", { name: "Legend" });
  await legend.click();
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await expect(m.locator(".legend-pop")).toBeVisible();
  await expect(m.locator(".legend-pop")).toContainText("Decision");
  await legend.click();
  await expect(m.locator(".legend-pop")).toHaveCount(0);
  // lane names are a column of their own and keep their size
  const label = m.locator(".lane-label").first();
  const size = async () => label.evaluate((e) => e.getBoundingClientRect().height + ":" + getComputedStyle(e.querySelector("strong") ?? e).fontSize);
  const before = await size();
  const zoom = await m.locator(".zoom-val").innerText();
  await m.getByRole("button", { name: "Zoom in" }).click();
  await m.getByRole("button", { name: "Zoom in" }).click();
  await expect(m.locator(".zoom-val")).not.toHaveText(zoom);
  const fontAfter = (await size()).split(":")[1];
  expect(fontAfter).toBe(before.split(":")[1]);
  // Fit: the start of the flow, scrolled to the top left
  const scroller = m.locator(".flow-scroll");
  await scroller.evaluate((e) => { e.scrollLeft = 300; e.scrollTop = 100; });
  await m.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => scroller.evaluate((e) => [Math.round(e.scrollLeft), Math.round(e.scrollTop)])).toEqual([0, 0]);
  await expect(m.getByRole("button", { name: "Fit" })).toHaveAttribute("title", "Show the whole flow");
});

test("a standard: “Where it applies” is under Scope and exceptions, not About", async ({ page }) => {
  await signIn(page, RILEY);
  await openEditor(page, "standard", "secure-logging");
  await outline(page, "About");
  await expect(fields(page).getByRole("heading", { name: "Where it applies" })).toHaveCount(0);
  await outline(page, "Scope and exceptions");
  await expect(fields(page).getByRole("heading", { name: "Scope and exceptions" }).first()).toBeVisible();
  // open there, not folded: it is what the section is about
  await expect(fields(page).getByRole("heading", { name: "Where it applies" })).toBeVisible();
  await expect(fields(page).getByRole("button", { name: "Production", exact: true })).toBeVisible();
});

test("the map: Fit shows the whole flow, a selected step is brought to the middle", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, ALEX);
  await openEditor(page, "process", GCP);
  const m = map(page);
  const scroller = m.locator(".flow-scroll");
  // opened as large as fits the width, never below 60%: this flow is wider than the view
  await expect(m.locator(".zoom-val")).toHaveText(/^\d+%$/);
  expect(Number((await m.locator(".zoom-val").innerText()).replace("%", ""))).toBeGreaterThanOrEqual(60);
  expect(await scroller.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  // a step in the middle of the flow, selected: moved to the middle of the view, not to its edge
  await outline(page, /^10 /);
  await outline(page, /^7 /);
  const block = m.locator(".block.selected");
  await expect.poll(async () => {
    const [b, v] = [(await block.boundingBox())!, (await scroller.boundingBox())!];
    return Math.abs((b.x + b.width / 2) - (v.x + v.width / 2)) / v.width;
  }, { message: "the selected step is near the middle of the map" }).toBeLessThan(0.2);
  // Fit: everything, whatever zoom it takes
  await m.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => scroller.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  expect(await scroller.evaluate((e) => [e.scrollLeft, e.scrollTop])).toEqual([0, 0]);
  await expect(m.locator(".block")).toHaveCount(10);
  for (const b of await m.locator(".block").all()) await expect(b).toBeInViewport();
});

test("a double press on Delete deletes one step, not the next one too", async ({ page, request }) => {
  const id = `${PREFIX}double`;
  await copyOf(request, LIB, id, "Editscreen demo double");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^3 Add the release workflow/);
  await page.waitForTimeout(800);
  await fields(page).getByRole("button", { name: "Delete step" }).dblclick();
  await expect(map(page).locator(".block")).toHaveCount(5);
  await page.waitForTimeout(300);
  await expect(map(page).locator(".block")).toHaveCount(5);
  await expect.poll(() => outlineTitles(page)).toContain("Tag the first version");
});

test("Publish… lists what changed by names, never by ids", async ({ page, request }) => {
  const id = `${PREFIX}names`;
  await copyOf(request, LIB, id, "Editscreen demo names");
  await signIn(page, ALEX);
  await openEditor(page, "process", id);
  await outline(page, /^4 Tag the first version/);
  await fields(page).getByRole("group", { name: "Who does it" }).getByRole("button", { name: "Release pipeline" }).click();
  await bar(page).getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish your changes" });
  await expect(dialog.locator("ul.publish-changes")).toContainText("“You” → “Release pipeline”");
  await expect(dialog.locator("ul.publish-changes")).not.toContainText("“me”");
  await expect(dialog.locator("ul.publish-changes")).not.toContainText("“pipeline”");
  await expect(dialog.getByLabel(/^Note for the list of versions/)).toHaveAttribute("placeholder", /^e\.g\. /);
  await dialog.getByRole("button", { name: "Not yet" }).click();
});
