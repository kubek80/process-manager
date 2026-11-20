import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, checkerChip, fields, openChecker, openEditor, outline, pickKind, RILEY, signIn } from "./helpers";

// Items without a name: adding a prerequisite, a link, a participant, an action, an answer, a
// step or a requirement with nothing typed, or clearing the name of one, once made the whole
// editing screen fail. Each must leave the screen working, name the item by its place in Undo,
// and be listed by the checker. Works on copies of its own, removed afterwards.

const PREFIX = "unnamed-demo-";

async function copyOf(request: APIRequestContext, kind: "process" | "standard", src: string, id: string, title: string) {
  await request.post("/auth/dev/login", { data: { email: kind === "process" ? ALEX : RILEY }, headers: CSRF });
  const folder = kind === "process" ? "processes" : "standards";
  const doc = JSON.parse(readFileSync(`${folder}/${src}.json`, "utf8"));
  const res = await request.put(`/api/${folder}/${id}?base=0`, { data: { ...doc, id, title, status: "active" }, headers: CSRF });
  expect(res.ok(), `create ${id}: ${await res.text()}`).toBeTruthy();
}
test.afterEach(async ({ request }) => {
  for (const [email, folder] of [[ALEX, "processes"], [RILEY, "standards"]] as const) {
    await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
    const body = await (await request.get(`/api/${folder}`)).json();
    for (const d of body[folder].filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/${folder}/${d.id}`, { headers: CSRF });
  }
});

/** Collects uncaught page errors and console errors. */
function faults(page: Page) {
  const all: string[] = [];
  page.on("pageerror", (e) => all.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") all.push(`console: ${m.text()}`); });
  return all;
}

/** The screen is still there: the editing bar, no error page, no fault in the page or the console. */
async function stillThere(page: Page, errors: string[], after: string) {
  await expect(page.locator(".edit-bar"), `the editing bar after: ${after}`).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.locator(".edit-failed")).toHaveCount(0);
  expect(errors, `no errors after: ${after}`).toEqual([]);
}

const undoTitle = (page: Page) => page.locator(".edit-bar").getByRole("button", { name: "Undo" }).getAttribute("title");

test("a process: empty items added and names cleared never break the screen; Undo names them by their place; the checker lists them", async ({ page, request }) => {
  const id = `${PREFIX}process`;
  await copyOf(request, "process", "publish-internal-library", id, "Unnamed demo process");
  const errors = faults(page);
  await signIn(page, ALEX);
  await openEditor(page, "process", id);

  // a prerequisite with nothing typed
  await outline(page, "Before you start");
  await fields(page).getByRole("button", { name: "Add prerequisite" }).click();
  await expect(fields(page).getByRole("textbox", { name: "Prerequisite 3", exact: true })).toHaveValue("");
  await stillThere(page, errors, "an empty prerequisite");
  expect(await undoTitle(page)).toBe("Undo: prerequisite 3 (no name yet) added (Ctrl+Z)");

  // a link with nothing typed
  await outline(page, "Links and resources");
  await fields(page).getByRole("button", { name: "Add link or skill" }).click();
  await expect(fields(page).getByRole("textbox", { name: "Name of link 3" })).toHaveValue("");
  await stillThere(page, errors, "an empty link");
  // the readers' preview counts it, and says it has no name yet
  await expect(page.locator(".preview-before-part").nth(1)).toHaveText("3 links (1 without a name)");

  // a participant ("Someone else"), then its name cleared, and the name of another cleared too
  await outline(page, "Who takes part");
  await fields(page).getByRole("combobox", { name: "Add a participant" }).selectOption({ label: "Someone else (role, person or system)" });
  const added = fields(page).getByRole("textbox", { name: "Name of participant 4" });
  await expect(added).toBeVisible();
  await added.fill("");
  await stillThere(page, errors, "a participant without a name");
  await fields(page).getByRole("textbox", { name: "Name of participant 2" }).fill("");
  await stillThere(page, errors, "the name of a participant cleared");
  expect(await undoTitle(page)).toMatch(/^Undo: participant 2 \(no name yet\) changed: name \(Ctrl\+Z\)$/);
  // the map still draws its lanes
  await expect(page.locator(".edit-preview .lane-label")).toHaveCount(4);

  // an action with nothing typed, and the name of the step cleared
  await outline(page, /^3 Add the release workflow/);
  const what = fields(page).getByLabel(/^What happens/);
  await what.fill("");
  await stillThere(page, errors, "the name of a step cleared");
  expect(await undoTitle(page)).toMatch(/^Undo: step 3 \(no name yet\) changed: what happens \(Ctrl\+Z\)$/);
  await fields(page).getByRole("button", { name: "Add action" }).click();
  await stillThere(page, errors, "an empty action");
  expect(await undoTitle(page)).toMatch(/^Undo: step 3 \(no name yet\) changed: what to do \(Ctrl\+Z\)$/);
  // Undo says what is true now, by the step's place
  await page.locator(".edit-bar").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".toast", { hasText: "Step 3 (no name yet): what to do as before." })).toBeVisible();
  await stillThere(page, errors, "Undo of the empty action");
  await page.locator(".edit-bar").getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".toast", { hasText: "Step 3 (no name yet): what to do changed again." })).toBeVisible();
  await expect(fields(page).locator(".fields-head h2")).toHaveText("(no name yet)");
  await expect(page.locator('.edit-preview .block[data-step="add-release-workflow"] .block-main')).toHaveAttribute("aria-label", /^3\. \(no name yet\), /);

  // an answer with nothing typed ("Add another way on"), then a decision whose answer's name is cleared
  await fields(page).getByRole("button", { name: "Add another way on" }).click();
  await expect(fields(page).getByRole("textbox", { name: "Name of path 2" })).toHaveValue("");
  await stillThere(page, errors, "an empty answer");
  await outline(page, /^4 Tag the first version/);
  await pickKind(page, "Decision");
  await fields(page).getByRole("textbox", { name: "Name of path 1" }).fill("");
  await stillThere(page, errors, "the name of an answer cleared");

  // a step with nothing typed: from its fields, and at the end of the outline; neither adds a step without a name
  await fields(page).getByRole("button", { name: /^(Add a branch|Add step after)$/ }).first().click();
  const name = fields(page).getByRole("textbox", { name: /^Name of the step (on the new branch|after this one)$/ });
  await expect(name).toBeVisible();
  await name.press("Enter");
  await stillThere(page, errors, "a step added from the fields with nothing typed");
  const outlineNav = page.getByRole("navigation", { name: /^Outline of the/ });
  await outlineNav.getByRole("button", { name: "Add a step" }).click();
  await outlineNav.getByRole("textbox", { name: "Add a step" }).press("Enter");
  await stillThere(page, errors, "a step added in the outline with nothing typed");
  await expect(page.locator(".edit-preview .block")).toHaveCount(6);

  // the name of the process cleared
  await outline(page, "About");
  await fields(page).getByRole("textbox", { name: /^Name/ }).first().fill("");
  await stillThere(page, errors, "the name of the process cleared");
  await expect(page.locator(".eb-title h1")).toHaveText("(no name yet)");

  // Undo takes the last back and says so; the screen is still there
  await page.locator(".edit-bar").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".eb-title h1")).toHaveText("Unnamed demo process");
  await stillThere(page, errors, "Undo");
  await outline(page, /^3 /);
  await page.locator(".edit-bar").getByRole("button", { name: "Redo" }).click();
  await stillThere(page, errors, "Redo");

  // the checker lists what is to fix, by place
  await expect(checkerChip(page)).toHaveText(/\d+ to fix/);
  const pop = await openChecker(page);
  const entries = pop.locator("li button");
  // each said as what to do, by its place; never "is empty" or "minimum 1 characters"
  await expect(entries.filter({ hasText: /^Step 3 \(no name yet\)Write what happens in this step\.$/ })).toHaveCount(1);
  await expect(entries.filter({ hasText: /^Participant 2 \(no name yet\)Write the name of who takes part\.$/ })).toHaveCount(1);
  await expect(entries.filter({ hasText: /^Participant 4 \(no name yet\)Write the name of who takes part\.$/ })).toHaveCount(1);
  await expect(entries.filter({ hasText: /^Prerequisite 3 \(no name yet\)Write the prerequisite\.$/ })).toHaveCount(1);
  await expect(entries.filter({ hasText: /^AboutWrite the name\.$/ })).toHaveCount(1);
  await expect(pop).not.toContainText("is empty");
  await expect(pop).not.toContainText("minimum");
  await expect(pop).not.toContainText("minimum 1 characters");
  await stillThere(page, errors, "the checker opened");
});

test("a standard: an empty requirement and a requirement whose short name is cleared never break the screen", async ({ page, request }) => {
  const id = `${PREFIX}standard`;
  await copyOf(request, "standard", "secure-logging", id, "Unnamed demo standard");
  const errors = faults(page);
  await signIn(page, RILEY);
  await openEditor(page, "standard", id);
  await outline(page, /^SEC-LOG-02/);
  await fields(page).getByRole("button", { name: "Add requirement after" }).click();
  await stillThere(page, errors, "a requirement added");
  const short = fields(page).getByLabel(/^Short name/);
  await short.fill("");
  await stillThere(page, errors, "the short name of a requirement cleared");
  expect(await undoTitle(page)).toMatch(/^Undo: requirement [A-Z0-9-]+ \(no name yet\) (changed: short name|added) \(Ctrl\+Z\)$/);
  // and one that already had a name
  await outline(page, /^SEC-LOG-01/);
  await fields(page).getByLabel(/^Short name/).fill("");
  await stillThere(page, errors, "the short name of an existing requirement cleared");
  expect(await undoTitle(page)).toBe("Undo: requirement SEC-LOG-01 (no name yet) changed: short name (Ctrl+Z)");
  const pop = await openChecker(page);
  await expect(pop).toContainText("SEC-LOG-01");
  await stillThere(page, errors, "the checker opened");
});
