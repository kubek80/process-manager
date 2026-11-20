import { expect, test, type Page } from "@playwright/test";
import { answer, CASEY, CSRF, editState, fields, JORDAN, more, open, openEditor, outline, publish, publishChange, putDoc, putWorkingDraft, readProcess, readStandard, readWorkingDraft, refusal, RILEY, SAM, serverToday, signIn, unfold, versionOf } from "./helpers";

// Jordan is an ordinary reader who is Platform owner of Google Cloud and Practice owner of
// Engineering: he may change what belongs to them, and nothing else. Where the app hides a
// control, the server is asked directly, to prove that it refuses as well.

const GCP = "request-gcp-project"; // platform Google Cloud
const AZURE = "request-azure-landing-zone"; // platform Azure, no practice: not his
const REVIEW = "code-review"; // practice Engineering
const LOGGING = "secure-logging"; // practice Cyber security (Riley)
const LIBRARY = "publish-internal-library"; // practice Engineering, platform GitHub

const PROCESS_NOT_YOURS = "You can only save a process that belongs to a platform or practice you own.";
const PROCESS_DENIED = "Only process editors and the owners of its platform or practice can change this process.";

const edit = (page: Page) => page.getByRole("link", { name: "Edit", exact: true });

test("a platform owner edits a process of the platform and a standard of the practice", async ({ page }) => {
  await signIn(page, JORDAN);
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).perms).toMatchObject({ processes: false, standards: false, platforms: ["google-cloud"], practices: ["engineering"] });

  // a process that belongs to Google Cloud
  const process = (await readProcess(page, GCP))!;
  await open(page, `/p/${GCP}/flow`);
  await edit(page).click();
  await outline(page, "About");
  await fields(page).getByLabel(/^Summary/).fill("A new project on Google Cloud, set up by the platform owner.");
  await publish(page);
  expect((await readProcess(page, GCP))!.summary).toBe("A new project on Google Cloud, set up by the platform owner.");
  await publishChange(page, "process", GCP, process); // as it was

  // a standard that belongs to Engineering
  const standard = (await readStandard(page, REVIEW))!;
  await open(page, `/s/${REVIEW}/doc`);
  await edit(page).click();
  await outline(page, "REV-01");
  await fields(page).getByLabel(/^Short name/).fill("Every change is reviewed by somebody else");
  await publish(page);
  expect((await readStandard(page, REVIEW))!.requirements[0].title).toBe("Every change is reviewed by somebody else");
  await publishChange(page, "standard", REVIEW, standard);
});

test("a platform owner cannot change what belongs to neither of his groups; the server refuses it too", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, `/p/${AZURE}/flow`);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
  await expect(page.locator(".edge-add")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "JSON" })).toHaveCount(0);
  // the editing screen, opened by its address, tells him so
  await open(page, `/p/${AZURE}/edit`);
  await expect(page.getByText("You may not change this process. Its editors, and the owners of its platform or practice, can.")).toBeVisible();
  await expect(page.locator(".edit-bar")).toHaveCount(0);
  await open(page, `/s/${LOGGING}/doc`);
  await expect(page.locator(".req").first()).toBeVisible();
  await expect(edit(page)).toHaveCount(0);

  // nor through unpublished changes: no draft, no publishing, and a draft is not even there for him
  const draft = await putWorkingDraft(page, "process", AZURE, { ...(await readProcess(page, AZURE))!, summary: "A draft by somebody who may not." });
  expect(draft.status()).toBe(404);
  expect((await page.request.post(`/api/processes/${AZURE}/publish?rev=1`, { headers: CSRF })).status()).toBe(404);
  expect((await page.request.delete(`/api/processes/${AZURE}/draft?rev=1`, { headers: CSRF })).status()).toBe(404);
  expect((await page.request.get(`/api/processes/${AZURE}/draft`)).status()).toBe(404);

  const azure = (await readProcess(page, AZURE))!;
  let res = await putDoc(page, "process", AZURE, { ...azure, summary: "Changed by somebody who may not." });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(PROCESS_NOT_YOURS);
  // nor can he take it over by moving it to his platform: what it belongs to now counts as well
  res = await putDoc(page, "process", AZURE, { ...azure, platform: "google-cloud" });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(PROCESS_DENIED);
  expect((await page.request.delete(`/api/processes/${AZURE}`, { headers: CSRF })).status()).toBe(403);
  expect((await readProcess(page, AZURE))!.platform).toBe("azure");
});

test("moving a document away from his platform is warned about, blocked, and refused by the server", async ({ page }) => {
  await signIn(page, JORDAN);
  await openEditor(page, "process", GCP);
  await outline(page, "About");
  await unfold(page, "What it belongs to");
  const modal = fields(page);
  const platform = modal.getByLabel(/^Platform/);
  // he is offered only his own platform and practice
  await expect(platform.locator("option")).toHaveText(["None", "Google Cloud"]);
  await expect(modal.getByLabel(/^Practice/).locator("option")).toHaveText(["None", "Engineering"]);
  await platform.selectOption({ label: "None" });
  await expect(modal.getByRole("alert")).toContainText("it would no longer be yours, so you could not save it");
  await expect(modal.getByRole("alert")).toContainText("Keep it with the platform Google Cloud or the practice Engineering");
  // with his practice it stays his: no warning
  await modal.getByLabel(/^Practice/).selectOption({ label: "Engineering" });
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await modal.getByLabel(/^Practice/).selectOption({ label: "None" });
  await expect(modal.getByRole("alert")).toBeVisible();
  const bar = page.locator(".edit-bar");
  // both buttons say why when pressed, and nothing is sent
  await expect(bar.getByRole("button", { name: "Publish…" })).toHaveClass(/\bunavailable\b/);
  await bar.getByRole("button", { name: "Save draft" }).click();
  await expect(refusal(page)).toHaveText(/This draft cannot be saved yet\. Keep it with a platform or practice of yours \(under About\)\./);
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Publish…" }).click();
  await expect(refusal(page)).toHaveText(/This cannot be published yet\. Keep it with a platform or practice of yours \(under About\)\./);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Publish your changes" })).toHaveCount(0);
  await bar.getByRole("button", { name: "Discard changes" }).click();
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
  // a draft that moves it away is refused by the server too
  const res0 = await putWorkingDraft(page, "process", GCP, { ...(await readProcess(page, GCP))!, platform: "azure" });
  expect(res0.status()).toBe(403);
  expect(await readWorkingDraft(page, "process", GCP)).toBeUndefined();

  const gcp = (await readProcess(page, GCP))!;
  const res = await putDoc(page, "process", GCP, { ...gcp, platform: "azure" });
  expect(res.status()).toBe(403);
  expect((await readProcess(page, GCP))!.platform).toBe("google-cloud");
});

test("a platform that is not his stays as it is on a document of his practice", async ({ page }) => {
  // "Publish an internal library" belongs to his practice Engineering and to the platform GitHub, which is not his
  await signIn(page, JORDAN);
  const library = (await readProcess(page, LIBRARY))!;
  expect(library).toMatchObject({ practice: "engineering", platform: "github" });
  await openEditor(page, "process", LIBRARY);
  await outline(page, "About");
  await unfold(page, "What it belongs to");
  const modal = fields(page);
  const platform = modal.getByLabel(/^Platform/);
  await expect(platform).toBeDisabled();
  await expect(platform).toHaveValue("github");
  await expect(modal.locator("label.field", { has: page.locator("select:disabled") })).toContainText("PlatformOnly its owners or an editor can change this");
  // the practice is his: he may keep or clear it, but only pick his own
  await expect(modal.getByLabel(/^Practice/)).toBeEnabled();
  await expect(modal.getByLabel(/^Practice/).locator("option")).toHaveText(["None", "Engineering"]);
  // everything else he may change, the owning team included
  await modal.getByLabel(/^Summary/).fill("Share code inside the company, changed by a practice owner.");
  await modal.getByLabel(/^Owning team/).selectOption({ label: "Cloud Platform team" });
  await publish(page);
  expect((await readProcess(page, LIBRARY))!).toMatchObject({ summary: "Share code inside the company, changed by a practice owner.", owner: "cloud-platform-team", platform: "github" });

  // the server refuses a change of the platform, also to his own, and also taking it away
  const now = (await readProcess(page, LIBRARY))!;
  for (const platform of ["google-cloud", undefined]) {
    const res = await putDoc(page, "process", LIBRARY, { ...now, platform });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/GitHub/);
  }
  expect((await readProcess(page, LIBRARY))!.platform).toBe("github");
  await publishChange(page, "process", LIBRARY, library); // as it was
});

test("a platform owner creates a process for his platform and a standard for his practice, and deletes them", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, "/processes");
  await expect(page.getByRole("button", { name: "Create from text with AI" })).toBeVisible();
  await page.getByRole("button", { name: "Blank process" }).click();
  const dialog = page.getByRole("dialog", { name: "New process" });
  const belongs = dialog.getByLabel("It belongs to");
  await expect(belongs.locator("option")).toHaveText(["Platform: Google Cloud", "Practice: Engineering"]);
  await dialog.getByLabel("Name of the process").fill("Order a Google Cloud quota increase");
  await dialog.getByRole("button", { name: "Create process" }).click();
  await expect(page.locator(".eb-title h1")).toHaveText("Order a Google Cloud quota increase");
  await expect(editState(page)).toHaveAttribute("aria-label", /^Draft\./);
  expect((await readProcess(page, "order-a-google-cloud-quota-increase"))!).toMatchObject({ status: "draft", platform: "google-cloud" });
  await more(page, "Delete…");
  await answer(page, "Delete this process?", "Delete process");
  await expect(page.getByRole("heading", { name: "How do I get…?" })).toBeVisible();
  expect(await readProcess(page, "order-a-google-cloud-quota-increase")).toBeUndefined();

  await open(page, "/standards");
  await page.getByRole("button", { name: "Blank standard" }).click();
  const named = page.getByRole("dialog", { name: "New standard" });
  await named.getByLabel("Name of the standard").fill("Pull request templates");
  await named.getByLabel("It belongs to").selectOption({ label: "Practice: Engineering" });
  await expect(named.getByLabel("Issued by")).toHaveValue("cloud-platform-team"); // his own team comes first
  await named.getByLabel("Issued by").selectOption({ label: "Developer Experience team" });
  await named.getByRole("button", { name: "Create standard" }).click();
  await expect(page.locator(".eb-title h1")).toHaveText("Pull request templates");
  expect((await readStandard(page, "pull-request-templates"))!).toMatchObject({ status: "draft", practice: "engineering", owner: "developer-experience-team" });
  await more(page, "Delete…");
  await answer(page, "Delete this standard?", "Delete standard");
  await expect(page.getByRole("heading", { name: "What must I meet?" })).toBeVisible(); // deleted: back to the list
  expect(await readStandard(page, "pull-request-templates")).toBeUndefined();

  // the server will not let him create one for somebody else's platform
  const gcp = (await readProcess(page, GCP))!;
  const res = await page.request.put("/api/processes/not-his?base=0", { data: { ...gcp, id: "not-his", platform: "azure", status: "draft" }, headers: CSRF });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(PROCESS_NOT_YOURS);
});

test("a reader can do none of it", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark as reviewed" })).toHaveCount(0);
  await open(page, "/processes");
  await expect(page.locator(".card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Blank process" })).toHaveCount(0);

  const gcp = (await readProcess(page, GCP))!;
  const res = await putDoc(page, "process", GCP, { ...gcp, summary: "Changed by a reader." });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(PROCESS_DENIED);
  expect((await page.request.put("/api/processes/sams-own?base=0", { data: { ...gcp, id: "sams-own", status: "draft" }, headers: CSRF })).status()).toBe(403);
  expect((await page.request.delete(`/api/processes/${GCP}`, { headers: CSRF })).status()).toBe(403);
  const review = (await readStandard(page, REVIEW))!;
  expect((await putDoc(page, "standard", REVIEW, { ...review, title: "Changed by a reader" })).status()).toBe(403);
});

test("a practice owner edits the standards of her practice, not those of another", async ({ page }) => {
  await signIn(page, RILEY);
  await open(page, `/s/${LOGGING}/doc`);
  await expect(edit(page)).toBeVisible();
  await open(page, `/s/${REVIEW}/doc`);
  await expect(page.locator(".req").first()).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
  await open(page, `/s/${REVIEW}/edit`);
  await expect(page.getByText("You may not change this standard.")).toBeVisible();
  // the server agrees: the standard of another practice is refused
  const review = (await readStandard(page, REVIEW))!;
  expect((await putDoc(page, "standard", REVIEW, { ...review, title: "Changed by another practice" })).status()).toBe(403);
});

test("a team Owner cannot edit and never sees unpublished changes, but confirms the review", async ({ page }) => {
  // an editor has unpublished changes to the GCP process
  await signIn(page, JORDAN);
  const gcp0 = (await readProcess(page, GCP))!;
  expect((await putWorkingDraft(page, "process", GCP, { ...gcp0, summary: "Unpublished words the owner of the team must not see." })).ok()).toBeTruthy();
  try {
    await signIn(page, CASEY);
    await open(page, `/p/${GCP}/flow`);
    await expect(page.locator(".block").first()).toBeVisible();
    await expect(edit(page)).toHaveCount(0);
    await expect(page.locator(".draft-line")).toHaveCount(0);
    await expect(page.locator(".lead")).toHaveText(gcp0.summary);
    expect((await page.request.get(`/api/processes/${GCP}/draft`)).status()).toBe(404);
    const { meta } = await (await page.request.get("/api/processes")).json();
    expect(meta[GCP].draft).toBeUndefined();
    await open(page, `/p/${GCP}/edit`);
    await expect(page.getByText("You may not change this process.")).toBeVisible();

    await open(page, `/p/${GCP}/flow`);
    const before = await versionOf(page, "process", GCP);
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect.poll(async () => (await readProcess(page, GCP))!.review).toMatchObject({ lastReviewedAt: serverToday(), reviewedBy: "Casey Owner" });
    expect(await versionOf(page, "process", GCP)).toBe(before + 1);

    const gcp = (await readProcess(page, GCP))!;
    const res = await putDoc(page, "process", GCP, { ...gcp, summary: "Changed by the team owner." });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe(PROCESS_DENIED);
  } finally {
    await signIn(page, JORDAN);
    const w = await readWorkingDraft(page, "process", GCP);
    if (w) await page.request.delete(`/api/processes/${GCP}/draft?rev=${w.revision}`, { headers: CSRF });
  }
});
