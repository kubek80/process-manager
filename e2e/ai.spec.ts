import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ALEX, answer, editState, fields, more, open, outline, publish, readProcess, readWorkingDraft, saveDraft, SAM, signIn } from "./helpers";

const example = JSON.parse(fs.readFileSync(path.join(process.cwd(), "schema/example.process.json"), "utf8"));
const draft = { ...example, status: "draft", review: { intervalMonths: 6 } };

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.beforeEach(async ({ page }) => { await signIn(page, ALEX); });

test("create a process from text with any chat assistant", async ({ page }) => {
  await open(page, "/processes");
  await page.getByRole("button", { name: "Create from text with AI" }).click();
  const modal = page.locator(".modal");
  const [description, answer] = [modal.locator("textarea").nth(0), modal.locator("textarea").nth(1)];

  // 1-2: the prompt is self-contained
  await description.fill("To get VPN access you fill in the VPN form, your manager approves, the network team enables it.");
  await modal.getByRole("button", { name: "Copy prompt" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  for (const part of ["# JSON SCHEMA", "# PLATFORMS", '"google-cloud" - Google Cloud', '"source-control" - Source control', '"servicenow" - ServiceNow', '"production" - Production', '"secure-logging" - Secure logging', '"cloud-platform-team" - Cloud Platform team', '"request-gcp-project" - Request a GCP project', "To get VPN access you fill in the VPN form"])
    expect(prompt).toContain(part);

  // 3: whatever comes back is checked
  const create = modal.getByRole("button", { name: "Create process" });
  await answer.fill("Sorry, I cannot do that.");
  await expect(modal.locator(".check.bad")).toContainText("No JSON object found");
  await expect(create).toBeDisabled();

  const wrong = JSON.parse(JSON.stringify(draft));
  wrong.steps[1].actor = "the-boss";
  await answer.fill("Here you go:\n```json\n" + JSON.stringify(wrong, null, 2) + "\n```");
  await expect(modal.locator(".issues")).toContainText('"the-boss" is not an actor id');
  await expect(create).toBeDisabled();
  await modal.getByRole("button", { name: "Copy fix request" }).click();
  const fix = await page.evaluate(() => navigator.clipboard.readText());
  expect(fix).toContain('steps[1].actor: "the-boss" is not an actor id');

  await answer.fill("```json\n" + JSON.stringify(draft, null, 2) + "\n```");
  await expect(modal.locator(".check.good")).toContainText("Valid: Request VPN access - 6 steps, 3 participants, 1 prerequisites");
  await create.click();

  // saved, opened on the editing screen, and still a draft
  await expect(page).toHaveURL(/#\/p\/request-vpn-access\/edit/);
  await expect(page.locator(".eb-title h1")).toHaveText("Request VPN access");
  await expect(page.locator(".edit-preview .block")).toHaveCount(6);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\. Readers do not see this yet/);
  expect((await readProcess(page, "request-vpn-access"))!).toMatchObject({ id: "request-vpn-access", status: "draft", $schema: "../schema/process.schema.json" });
});

test("a draft is invisible to readers until it is published", async ({ page }) => {
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "Request VPN access" })).toContainText("Draft");

  await signIn(page, SAM);
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Request VPN access" })).toHaveCount(0);

  await signIn(page, ALEX);
  await open(page, "/p/request-vpn-access/flow");
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await outline(page, "About");
  await fields(page).getByLabel(/^Owning team/).selectOption({ label: "Service Management" });
  await publish(page);
  expect((await readProcess(page, "request-vpn-access"))!).toMatchObject({ status: "active", owner: "service-management" });

  await signIn(page, SAM);
  await open(page, "/processes");
  await expect(page.locator(".card", { hasText: "Request VPN access" })).toBeVisible();
});

test("change an existing process with AI, then delete it", async ({ page }) => {
  await open(page, "/p/request-vpn-access/edit");
  await more(page, "Change with AI");
  const modal = page.locator(".modal");
  await modal.locator("textarea").nth(0).fill("Rename the last step to 'Connect and test the VPN'.");
  await modal.getByRole("button", { name: "Copy prompt" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("CURRENT PROCESS JSON START");
  expect(prompt).toContain('"id": "request-vpn-access"');
  expect(prompt).toContain("Rename the last step");

  // the assistant renames the step and, wrongly, the process id: the id is kept
  const changed = JSON.parse(JSON.stringify((await readProcess(page, "request-vpn-access"))!));
  changed.steps.at(-1).title = "Connect and test the VPN";
  changed.id = "get-vpn";
  await modal.locator("textarea").nth(1).fill(JSON.stringify(changed));
  await expect(modal.locator(".check.warn")).toContainText("The current id “request-vpn-access” is kept");
  await modal.getByRole("button", { name: "Apply to draft" }).click();
  await expect(page.locator(".edit-preview .block", { hasText: "Connect and test the VPN" })).toBeVisible();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Unpublished changes\./);
  // saved as unpublished changes: readers keep the published version until it is published
  await saveDraft(page);
  expect((await readWorkingDraft(page, "process", "request-vpn-access"))!.doc.steps.at(-1).title).toBe("Connect and test the VPN");
  expect((await readProcess(page, "request-vpn-access"))!.steps.at(-1).title).not.toBe("Connect and test the VPN");
  await publish(page);
  expect((await readProcess(page, "request-vpn-access"))!.steps.at(-1).title).toBe("Connect and test the VPN");
  expect(await readProcess(page, "get-vpn")).toBeUndefined();

  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Request VPN access" })).toHaveCount(0);
  expect(await readProcess(page, "request-vpn-access")).toBeUndefined();
});

test("a blank process starts as a valid draft", async ({ page }) => {
  await open(page, "/processes");
  await page.getByRole("button", { name: "Blank process" }).click();
  // it is named first: the name gives it its address, which never changes
  await page.getByRole("dialog", { name: "New process" }).getByLabel("Name of the process").fill("Order a laptop");
  await page.getByRole("dialog", { name: "New process" }).getByRole("button", { name: "Create process" }).click();
  await expect(page).toHaveURL(/#\/p\/order-a-laptop\/edit/);
  await expect(page.locator(".eb-title h1")).toHaveText("Order a laptop");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\./);
  await expect(page.locator(".eb-status.good, .eb-status.warn")).toBeVisible();
  expect((await readProcess(page, "order-a-laptop"))!.status).toBe("draft");
  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.locator(".card").first()).toBeVisible();
});
