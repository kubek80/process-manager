import { expect, test } from "@playwright/test";
import { ALEX, open, readProcess, save, serverToday, signIn, watchErrors } from "./helpers";

const LIB = "publish-internal-library";
const AZURE = "request-azure-landing-zone";
const NOW = "2026-11-15";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(`${NOW}T10:00:00Z`) }); // review dates depend on "today"; time still runs
  await signIn(page, ALEX, { editor: true });
});

test("insert a step on an arrow of the map, exactly between two blocks", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, `/p/${LIB}/flow`);
  await page.locator(".flow-canvas").hover();
  await page.locator(".edge-add").first().click(); // the arrow from "Request a registry namespace" to "Create the namespace"
  const form = page.locator(".quick-add");
  await expect(form).toContainText("between Request a registry namespace and Create the namespace");
  await form.getByPlaceholder(/What happens/).fill("Agree the namespace name");
  await form.getByRole("button", { name: "Developer Experience team" }).click();
  await form.locator('.quick-types button[title^="Meeting"]').click();
  await page.keyboard.press("Enter"); // Enter on a button only presses that button: nothing is added yet
  await expect(page.locator(".block")).toHaveCount(6);
  await expect(form.locator('.quick-types button[title^="Meeting"]')).toHaveAttribute("aria-pressed", "true");
  await form.getByPlaceholder(/What happens/).press("Enter"); // Enter in the name adds the step

  const block = page.locator(".block", { hasText: "Agree the namespace name" });
  await expect(block).toContainText("Meeting");
  await expect(page.locator(".block")).toHaveCount(7);
  await save(page);

  const steps = (await readProcess(page, LIB))!.steps;
  expect(steps.map((s: { id: string }) => s.id).slice(0, 3)).toEqual(["request-namespace", "agree-the-namespace-name", "create-namespace"]);
  expect(steps[0].next).toEqual([{ to: "agree-the-namespace-name" }]);
  expect(steps[1]).toMatchObject({ actor: "devex", type: "meeting", next: [{ to: "create-namespace" }] });
  expect((await readProcess(page, LIB))!.updatedAt).toBe(NOW);
  expect(errors).toEqual([]);
});

test("drag a block to another lane to change who does it", async ({ page }) => {
  await open(page, `/p/${LIB}/flow`);
  // "Before you start" is open above the map: bring the block and the lane below it into view together
  await page.locator(".lane").nth(2).scrollIntoViewIfNeeded();
  await page.locator(".block", { hasText: "Tag the first version" }).dragTo(page.locator(".lane").nth(2), { targetPosition: { x: 320, y: 30 } });
  await save(page);
  expect((await readProcess(page, LIB))!.steps.find((s: { id: string }) => s.id === "tag-version").actor).toBe("pipeline");
});

test("insert a step in the checklist", async ({ page }) => {
  await open(page, `/p/${LIB}/list`);
  const last = page.locator(".step").last();
  const before = page.locator("#step-publish-version");
  await before.hover();
  await before.getByRole("button", { name: "Insert a step here" }).click();
  await page.locator(".quick-add").getByPlaceholder(/What happens/).fill("Announce the release");
  await page.locator(".quick-add").getByRole("button", { name: "Add step" }).click();
  await expect(page.locator("#step-announce-the-release")).toBeVisible();
  await expect(last).toContainText("Install the library from another project");
  await save(page);

  const steps = (await readProcess(page, LIB))!.steps;
  const i = steps.findIndex((s: { id: string }) => s.id === "announce-the-release");
  expect(steps[i - 1].id).toBe("publish-version");
  expect(steps[i - 1].next).toEqual([{ to: "announce-the-release" }]);
  expect(steps[i].next).toEqual([{ to: "verify-install" }]);
});

test("edit a step in the side panel; the checker blocks saving until it is right", async ({ page }) => {
  await open(page, `/p/${LIB}/flow`);
  await page.locator(".block", { hasText: "Install the library from another project" }).click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Edit step" }).click();

  // retyping the name does not throw you out of the map, it only blocks saving
  await drawer.getByLabel("What happens", { exact: true }).fill("x");
  await expect(page.locator(".status.bad")).toContainText("problem");
  await expect(page.locator(".block").first()).toBeVisible();
  await drawer.getByLabel("What happens", { exact: true }).fill("Install the library from another project");

  // a decision needs two labelled paths: this one has none
  await drawer.locator(".type-opt", { hasText: "Decision" }).click();
  await expect(page.locator(".status.bad")).toContainText("problem");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.locator(".status.bad").click();
  await expect(page.locator(".issues-panel")).toContainText("a decision needs at least two outgoing paths");

  await drawer.locator(".type-opt", { hasText: "Check the result" }).click();
  await expect(page.locator(".status.good")).toBeVisible();
  await drawer.getByRole("button", { name: "Add action" }).click();
  await drawer.getByPlaceholder("Describe one action").last().fill("Tell the team in the channel.");
  await drawer.getByLabel("Tool").selectOption({ label: "GitHub" });
  await drawer.getByLabel("Typical time").fill("15 min");
  await drawer.getByRole("button", { name: "Done editing" }).click();
  await expect(drawer).toContainText("Tell the team in the channel.");
  await save(page);

  const step = (await readProcess(page, LIB))!.steps.find((s: { id: string }) => s.id === "verify-install");
  expect(step).toMatchObject({ type: "verify", tool: "github", duration: "15 min" });
  expect(step.instructions.at(-1)).toBe("Tell the team in the channel.");
});

test("discard throws the draft away", async ({ page }) => {
  await open(page, `/p/${AZURE}/flow`);
  await page.locator(".block").first().click();
  await page.locator(".drawer").getByRole("button", { name: "Edit step" }).click();
  await page.locator(".drawer").getByLabel("What happens", { exact: true }).fill("Something else entirely");
  await expect(page.locator(".block", { hasText: "Something else entirely" })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".block", { hasText: "Something else entirely" })).toHaveCount(0);
  await expect(page.locator(".saved")).toBeVisible();
  expect((await readProcess(page, AZURE))!.steps[0].title).toBe("Complete the landing zone questionnaire");
});

test("details: restrict to tiers, an environment and a language, retire with a replacement", async ({ page }) => {
  await open(page, `/p/${AZURE}/flow`);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("button", { name: "Tier 0", exact: true }).click();
  await modal.getByRole("button", { name: "Tier 1", exact: true }).click();
  await modal.getByRole("button", { name: "Python" }).click();
  await modal.getByRole("button", { name: "Production", exact: true }).click();
  await modal.getByRole("button", { name: "Retired" }).click();
  await modal.getByLabel("Use instead").selectOption({ label: "Request a GCP project" });
  await modal.getByRole("button", { name: "Done" }).click();

  await expect(page.locator(".facts")).toContainText("Tier 0, Tier 1");
  await expect(page.locator(".facts")).toContainText("Python");
  await expect(page.locator(".facts")).toContainText("Production");
  await expect(page.locator(".banner", { hasText: "This process is retired." }).getByRole("link", { name: "Request a GCP project" })).toBeVisible();
  await save(page);
  expect((await readProcess(page, AZURE))!).toMatchObject({ tiers: ["tier-0", "tier-1"], languages: ["python"], environments: ["production"], status: "deprecated", replacedBy: "request-gcp-project" });

  // put it back to active for the tests that follow
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await modal.getByRole("button", { name: "Active" }).click();
  await modal.getByRole("button", { name: "Done" }).click();
  await save(page);
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
  await expect(akamai.locator('[data-line="review"]')).toContainText("Overdue since 2026-09-02");
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);

  await akamai.locator(".card-link").click();
  await expect(page.locator(".banner", { hasText: "Review overdue since 2026-09-02" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.locator(".banner", { hasText: "Review overdue" })).toHaveCount(0);
  await expect(page.locator(".facts")).toContainText(`Reviewed ${serverToday()}`); // dated by the server, not by this browser's clock
  await expect.poll(async () => (await readProcess(page, "onboard-site-to-akamai"))!.review).toEqual({ intervalMonths: 6, lastReviewedAt: serverToday(), reviewedBy: "Alex Editor" });

  // back in the list the filter is still on, and the process confirmed just now has left it
  await page.goBack();
  await expect(page.getByRole("checkbox", { name: /^Only what needs a review/ })).toBeChecked();
  await expect(page.locator(".card", { hasText: "Onboard a site to Akamai" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /^Only what needs a review/ })).toBeChecked();
});

test("the JSON editor marks problems on the line and applies valid edits", async ({ page }) => {
  await open(page, `/p/${AZURE}/json`);
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText('"schemaVersion"');
  const replaceAll = async (text: string) => { await editor.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText(text); };
  const original = JSON.stringify(await readProcess(page, AZURE), null, 2);

  await replaceAll(original.replace('"actor": "cloud-governance"', '"actor": "nobody"'));
  const finding = page.locator(".json-side .issues li", { hasText: '"nobody" is not an actor id' });
  await expect(finding).toBeVisible();
  await expect(page.locator(".json-side .check.bad")).toContainText("Not applied to the draft");
  await finding.getByRole("button").click();
  await expect(page.locator(".cm-lintRange-error")).toHaveText('"nobody"');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('"nobody"');

  await replaceAll(original.replace('"title": "Request an Azure landing zone",', '"title": "Request an Azure landing zone"'));
  await expect(page.locator(".json-side .check.bad")).toContainText("Not valid JSON yet");

  await replaceAll(original.replace('"estimatedDuration": "2-3 weeks"', '"estimatedDuration": "about a month"'));
  await expect(page.locator(".json-side .check.good")).toBeVisible();
  await save(page);
  expect((await readProcess(page, AZURE))!.estimatedDuration).toBe("about a month");
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator(".facts")).toContainText("about a month");
});

test("every save is a version that can be restored", async ({ page }) => {
  await open(page, `/p/${AZURE}/flow`);
  const before = (await readProcess(page, AZURE))!.summary;
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByLabel("Summary").fill("A summary that will be taken back in a moment.");
  await page.locator(".modal").getByRole("button", { name: "Done" }).click();
  await save(page);

  await page.getByRole("button", { name: /^Version \d+$/ }).click();
  const rows = page.locator(".history li");
  await expect(rows.first()).toContainText("current");
  await expect(rows.first()).toContainText("alex@example.com");
  await expect(rows.last()).toContainText("import"); // where it all started
  await rows.nth(1).getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".lead")).toHaveText(before);
  await save(page);
  expect((await readProcess(page, AZURE))!.summary).toBe(before);
});
