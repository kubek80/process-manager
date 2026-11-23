import { expect, test } from "@playwright/test";
import {
  ALEX, answer, checkerChip, editState, fields, more, open, openChecker, openEditor, outline, outlineNav, outlineTitles, pickKind, publish, readProcess, readWorkingDraft,
  refusal, serverToday, signIn, unfold, watchErrors,
} from "./helpers";

// Changing a process on its editing screen: the outline on the left selects, the fields next to
// it change what is selected, the map on the right is always editable.

const LIB = "publish-internal-library";
const AZURE = "request-azure-landing-zone";
const NOW = "2026-11-15";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(`${NOW}T10:00:00Z`) }); // review dates depend on "today"; time still runs
  await signIn(page, ALEX);
});

test("insert a step on an arrow of the map, exactly between two blocks", async ({ page }) => {
  const errors = watchErrors(page);
  await openEditor(page, "process", LIB);
  const map = page.locator(".edit-preview");
  await map.locator(".flow-canvas").hover();
  await map.getByRole("button", { name: "Insert a step between “Request a registry namespace” and “Create the namespace”" }).click();
  const form = page.locator(".quick-add");
  await expect(form).toContainText("between Request a registry namespace and Create the namespace");
  await form.getByPlaceholder(/What happens/).fill("Agree the namespace name");
  await form.getByRole("button", { name: "Developer Experience team" }).click();
  await form.locator('.quick-types button[title^="Meeting"]').click();
  await page.keyboard.press("Enter"); // Enter on a button only presses that button: nothing is added yet
  await expect(map.locator(".block")).toHaveCount(6);
  await expect(form.locator('.quick-types button[title^="Meeting"]')).toHaveAttribute("aria-pressed", "true");
  await form.getByPlaceholder(/What happens/).press("Enter"); // Enter in the name adds the step

  const block = map.locator(".block", { hasText: "Agree the namespace name" });
  await expect(block).toContainText("Meeting");
  await expect(map.locator(".block")).toHaveCount(7);
  // the new step is selected: in the outline, with its fields on the right
  await expect(page.getByRole("navigation", { name: "Outline of the process" }).locator('[aria-current="true"]')).toContainText("Agree the namespace name");
  await expect(fields(page).locator(".fields-head h2")).toHaveText("Agree the namespace name");
  await publish(page);

  const steps = (await readProcess(page, LIB))!.steps;
  expect(steps.map((s: { id: string }) => s.id).slice(0, 3)).toEqual(["request-namespace", "agree-the-namespace-name", "create-namespace"]);
  expect(steps[0].next).toEqual([{ to: "agree-the-namespace-name" }]);
  expect(steps[1]).toMatchObject({ actor: "devex", type: "meeting", next: [{ to: "create-namespace" }] });
  expect((await readProcess(page, LIB))!.updatedAt).toBe(NOW);
  expect(errors).toEqual([]);
});

test("drag a block to another lane to change who does it", async ({ page }) => {
  await openEditor(page, "process", LIB);
  const map = page.locator(".edit-preview");
  // the middle column is narrower than the reader's page: the block is scrolled into view first,
  // then dropped straight below where it is, in the lane of the release pipeline
  const block = map.locator(".block", { hasText: "Tag the first version" });
  const lane = map.locator(".lane").nth(2);
  await lane.scrollIntoViewIfNeeded();
  await block.scrollIntoViewIfNeeded();
  const [b, l] = [(await block.boundingBox())!, (await lane.boundingBox())!];
  await block.dragTo(lane, { targetPosition: { x: b.x - l.x + 30, y: 30 } });
  await expect(editState(page)).toHaveAttribute("aria-label", /^Unpublished changes\./);
  await publish(page);
  expect((await readProcess(page, LIB))!.steps.find((s: { id: string }) => s.id === "tag-version").actor).toBe("pipeline");
});

test("add a step after another from its fields, and move it in the outline with Alt + arrows", async ({ page }) => {
  await openEditor(page, "process", LIB);
  await outline(page, /^\d+ Build and publish the version/);
  await fields(page).getByRole("button", { name: "Add step after" }).click();
  // the name is asked for right there: Enter adds it
  const named = fields(page).getByRole("textbox", { name: "Name of the step after this one" });
  await expect(named).toBeFocused();
  await named.fill("Announce the release");
  await named.press("Enter");
  await expect(fields(page).getByLabel(/^What happens/)).toHaveValue("Announce the release");
  await expect(page).toHaveURL(/\/edit\/announce-the-release$/); // a new step gets its address from its name
  const nav = outlineNav(page);
  const titles = () => outlineTitles(page);
  const at = (await titles()).indexOf("Announce the release");
  expect((await titles())[at - 1]).toBe("Build and publish the version");
  expect((await titles())[at + 1]).toBe("Install the library from another project");
  // moved one later and back again with the keyboard, in the flow: the map's arrows follow
  const item = nav.getByRole("button", { name: /^\d+ Announce the release, by Release pipeline/ });
  await item.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => (await titles()).slice(at)).toEqual(["Install the library from another project", "Announce the release"]);
  await expect(nav.getByRole("button", { name: /^\d+ Announce the release, / })).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(async () => (await titles()).slice(at)).toEqual(["Announce the release", "Install the library from another project"]);
  await publish(page);

  const steps = (await readProcess(page, LIB))!.steps;
  const i = steps.findIndex((s: { id: string }) => s.id === "announce-the-release");
  expect(steps[i - 1].id).toBe("publish-version");
  expect(steps[i - 1].next).toEqual([{ to: "announce-the-release" }]);
  expect(steps[i].next).toEqual([{ to: "verify-install" }]);
});

test("edit a step in its fields; the checker blocks publishing until it is right", async ({ page }) => {
  await openEditor(page, "process", LIB);
  await page.locator(".edit-preview .block", { hasText: "Install the library from another project" }).click();
  const panel = fields(page);
  await expect(panel.locator(".fields-head h2")).toHaveText("Install the library from another project");

  // a decision needs two answers: this one is the last step and has none
  await pickKind(page, "Decision");
  await expect(checkerChip(page)).toHaveText("1 to fix");
  await expect(checkerChip(page)).toHaveClass(/\bbad\b/);
  await expect(panel.locator(".item-issues.bad")).toContainText("1 to fix before publishing");
  // the outline marks the step the problem belongs to
  const item = outlineNav(page).getByRole("button", { name: /Install the library from another project, by You, 1 to fix/ });
  await expect(item.locator(".outline-mark.bad")).toHaveText("1");
  await expect(item.locator(".outline-mark.bad")).toHaveAttribute("title", "1 to fix");
  await expect(await openChecker(page)).toContainText("This decision needs at least two answers that lead somewhere.");
  await page.keyboard.press("Escape");
  // Publish… says why it cannot publish, instead of opening
  await expect(page.locator(".edit-bar").getByRole("button", { name: "Publish…" })).toHaveClass(/\bunavailable\b/);
  await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
  await expect(page.getByRole("dialog", { name: "Publish your changes" })).toHaveCount(0);
  await expect(refusal(page)).toHaveText(/^First fix the 1 thing listed under “1 to fix”\.$/);
  await page.keyboard.press("Escape");

  await pickKind(page, "Check the result");
  await expect(page.locator(".eb-status.bad")).toHaveCount(0);
  await expect(item.locator(".outline-mark.bad")).toHaveCount(0);
  await panel.getByRole("button", { name: "Add action" }).click();
  await panel.getByPlaceholder("Describe one action").last().fill("Tell the team in the channel.");
  // the less used fields are offered as "+ Tool", "+ Typical time"…
  const offers = panel.getByRole("group", { name: "Add to this step" });
  await offers.getByRole("button", { name: "Tool", exact: true }).click();
  await panel.getByRole("combobox", { name: "Tool", exact: true }).selectOption({ label: "GitHub" });
  await offers.getByRole("button", { name: "Typical time", exact: true }).click();
  await expect(panel.getByLabel("Typical time")).toBeFocused();
  await panel.getByLabel("Typical time").fill("15 min");
  await expect(offers.getByRole("button", { name: "Typical time", exact: true })).toHaveCount(0);
  await expect(page.locator(".edit-preview .block", { hasText: "Install the library from another project" })).toContainText("15 min");
  await publish(page);

  const step = (await readProcess(page, LIB))!.steps.find((s: { id: string }) => s.id === "verify-install");
  expect(step).toMatchObject({ type: "verify", tool: "github", duration: "15 min" });
  expect(step.instructions.at(-1)).toBe("Tell the team in the channel.");
});

test("Discard changes goes back to what is saved, and no draft is left behind", async ({ page }) => {
  await openEditor(page, "process", AZURE);
  await outline(page, /^1 /);
  await fields(page).getByLabel(/^What happens/).fill("Something else entirely");
  await expect(page.locator(".edit-preview .block", { hasText: "Something else entirely" })).toBeVisible();
  await expect(editState(page)).toHaveAttribute("aria-label", /Not saved yet/);
  await page.locator(".edit-bar").getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator(".edit-preview .block", { hasText: "Something else entirely" })).toHaveCount(0);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\. Version \d+\. Saved\.$/);
  expect(await readWorkingDraft(page, "process", AZURE)).toBeUndefined();
  expect((await readProcess(page, AZURE))!.steps[0].title).toBe("Complete the landing zone questionnaire");
});

test("About: restrict to tiers, an environment and a language; retire with a replacement and bring it back", async ({ page }) => {
  await openEditor(page, "process", AZURE);
  await outline(page, "About");
  const about = fields(page);
  await unfold(page, "Where it applies"); // folded, with a summary of what is set
  await about.getByRole("button", { name: "Tier 0", exact: true }).click();
  await about.getByRole("button", { name: "Tier 1", exact: true }).click();
  await about.getByRole("button", { name: "Python" }).click();
  await about.getByRole("button", { name: "Production", exact: true }).click();
  await publish(page);
  expect((await readProcess(page, AZURE))!).toMatchObject({ tiers: ["tier-0", "tier-1"], languages: ["python"], environments: ["production"], status: "active" });

  await more(page, "Retire…");
  const retire = page.getByRole("dialog", { name: "Retire this process?" });
  await retire.getByLabel(/^Use instead/).selectOption({ label: "Request a GCP project" });
  await retire.getByRole("button", { name: "Retire" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Retired\. Readers see version \d+, marked as retired/);
  expect((await readProcess(page, AZURE))!).toMatchObject({ status: "deprecated", replacedBy: "request-gcp-project" });

  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await expect(page.locator("header.doc-head")).toContainText("Tier 0, Tier 1");
  await expect(page.locator("header.doc-head")).toContainText("Python");
  await expect(page.locator("header.doc-head")).toContainText("Production");
  await expect(page.locator(".banner", { hasText: "This process is retired." }).getByRole("link", { name: "Request a GCP project" })).toBeVisible();

  // put it back in use for the tests that follow
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await more(page, "Bring back into use…");
  await answer(page, "Bring it back into use?", "Bring back into use");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
  expect((await readProcess(page, AZURE))!.status).toBe("active");
  expect((await readProcess(page, AZURE))!.replacedBy).toBeUndefined();
});

test("reviews: the library shows what is due, and one click confirms a process", async ({ page }) => {
  await open(page, "/processes");
  const due = page.getByRole("checkbox", { name: /^Only what needs a review, \d+ results?$/ });
  await expect(due).not.toBeChecked();
  await due.check();
  await expect(page.locator(".filter-chosen").getByRole("button", { name: "Remove filter Review: due or overdue" })).toBeVisible();
  const akamai = page.locator(".card", { hasText: "Onboard a site to Akamai" });
  await expect(akamai.locator('[data-line="review"]')).toContainText("Review overdue since 2026-09-02");
  await expect(akamai.locator('[data-line="review"]')).toHaveClass(/\bbad\b/); // overdue: the problem colour
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);

  await akamai.locator(".card-link").click();
  await expect(page.locator(".banner", { hasText: "Review overdue since 2026-09-02" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.locator(".banner", { hasText: "Review overdue" })).toHaveCount(0);
  await expect(page.locator("header.doc-head")).toContainText(`Reviewed ${serverToday()}`); // the browser's clock (NOW) is today nowhere on Earth: the server dates it with its own UTC day
  await expect.poll(async () => (await readProcess(page, "onboard-site-to-akamai"))!.review).toEqual({ intervalMonths: 6, lastReviewedAt: serverToday(), reviewedBy: "Alex Editor" });

  // back in the list the filter is still on, and the process confirmed just now has left it
  await page.goBack();
  await expect(page.getByRole("checkbox", { name: /^Only what needs a review/ })).toBeChecked();
  await expect(page.locator(".card", { hasText: "Onboard a site to Akamai" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /^Only what needs a review/ })).toBeChecked();
});

test("the JSON editor marks problems on the line and applies valid edits", async ({ page }) => {
  await openEditor(page, "process", AZURE);
  await more(page, "JSON");
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText('"schemaVersion"');
  const replaceAll = async (text: string) => { await editor.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText(text); };
  const original = JSON.stringify(await readProcess(page, AZURE), null, 2);

  await replaceAll(original.replace('"actor": "cloud-governance"', '"actor": "nobody"'));
  const finding = page.locator(".json-side .issues li", { hasText: "Who does it is not one of the participants" });
  await expect(finding).toBeVisible();
  // where it is in words first, then what to do, then the place in the JSON as a detail
  await expect(finding.locator(".issue-place")).toHaveText("Step 3 “Review the request at the governance board”");
  await expect(finding.locator(".issue-detail")).toHaveText("steps[2].actor");
  await expect(finding.getByRole("button")).toHaveAttribute("title", "Show in the editor");
  await expect(page.locator(".json-side .check.bad")).toContainText("Not applied to the draft");
  await finding.getByRole("button").click();
  await expect(page.locator(".cm-lintRange-error")).toHaveText('"nobody"');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('"nobody"');
  // while the JSON has problems, nothing can be saved or published
  await expect(page.locator(".edit-bar").getByRole("button", { name: "Publish…" })).toHaveClass(/\bunavailable\b/);

  await replaceAll(original.replace('"title": "Request an Azure landing zone",', '"title": "Request an Azure landing zone"'));
  await expect(page.locator(".json-side .check.bad")).toContainText("Not valid JSON yet");

  await replaceAll(original.replace('"estimatedDuration": "2-3 weeks"', '"estimatedDuration": "about a month"'));
  await expect(page.locator(".json-side .check.good")).toBeVisible();
  await publish(page);
  expect((await readProcess(page, AZURE))!.estimatedDuration).toBe("about a month");
  await expect(page.locator(".edit-preview .block").first()).toBeVisible(); // after publishing, the screen starts afresh on the map
  await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
  await expect(page.locator("header.doc-head")).toContainText("about a month");
});

test("every publish is a version; an old one is restored into the draft, not for readers", async ({ page }) => {
  await openEditor(page, "process", AZURE);
  const before = (await readProcess(page, AZURE))!.summary;
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("A summary that will be taken back in a moment.");
  await publish(page, "A summary to take back");

  await more(page, "Versions");
  const versions = page.getByRole("dialog", { name: /Versions of/ });
  const rows = versions.locator(".history > li");
  await expect(rows.first()).toContainText("current");
  await expect(rows.first()).toContainText("Alex Editor"); // the name, not the address
  await expect(rows.first()).not.toContainText("alex@example.com");
  await expect(rows.first()).toContainText("A summary to take back");
  await expect(rows.last()).toContainText("Imported"); // where it all started
  await rows.nth(1).getByRole("button", { name: "Restore" }).click();
  await expect(versions).toHaveCount(0);
  await expect(page.locator(".edit-preview .preview-head p")).toHaveText(before);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Unpublished changes\./);
  // readers still have the newest version until the restored one is published
  expect((await readProcess(page, AZURE))!.summary).toBe("A summary that will be taken back in a moment.");
  await publish(page);
  expect((await readProcess(page, AZURE))!.summary).toBe(before);
});
