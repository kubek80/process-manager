import { expect, test, type Page } from "@playwright/test";
import { answer, CASEY, CSRF, JORDAN, open, putDoc, readProcess, readStandard, RILEY, SAM, save, serverToday, signIn, versionOf } from "./helpers";

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

const details = (page: Page) => page.getByRole("button", { name: "Details", exact: true });

test("a platform owner edits a process of the platform and a standard of the practice", async ({ page }) => {
  await signIn(page, JORDAN);
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).perms).toMatchObject({ processes: false, standards: false, platforms: ["google-cloud"], practices: ["engineering"] });

  // a process that belongs to Google Cloud
  const process = (await readProcess(page, GCP))!;
  await open(page, `/p/${GCP}/flow`);
  await expect(page.locator(".mode-switch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
  await details(page).click();
  await page.locator(".modal").getByLabel("Summary").fill("A new project on Google Cloud, set up by the platform owner.");
  await page.locator(".modal").getByRole("button", { name: "Done" }).click();
  await save(page);
  expect((await readProcess(page, GCP))!.summary).toBe("A new project on Google Cloud, set up by the platform owner.");
  expect((await putDoc(page, "process", GCP, process)).ok()).toBeTruthy(); // as it was

  // a standard that belongs to Engineering
  const standard = (await readStandard(page, REVIEW))!;
  await open(page, `/s/${REVIEW}/doc`);
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(4);
  await page.locator('[aria-label="Edit REV-01"]').click();
  await page.locator(".drawer").getByLabel("Short name").fill("Every change is reviewed by somebody else");
  await save(page);
  expect((await readStandard(page, REVIEW))!.requirements[0].title).toBe("Every change is reviewed by somebody else");
  expect((await putDoc(page, "standard", REVIEW, standard)).ok()).toBeTruthy();
});

test("a platform owner cannot change what belongs to neither of his groups; the server refuses it too", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, `/p/${AZURE}/flow`);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
  await expect(page.locator(".edge-add")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "JSON" })).toHaveCount(0);
  await open(page, `/s/${LOGGING}/doc`);
  await expect(page.locator(".req").first()).toBeVisible();
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(0);

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
  await open(page, `/p/${GCP}/flow`);
  await details(page).click();
  const modal = page.locator(".modal");
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
  await modal.getByRole("button", { name: "Done" }).click();
  const saveButton = page.getByRole("button", { name: "Save changes" });
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("title", "Keep it with a platform or practice of yours (in Details).");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".saved")).toBeVisible();

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
  await open(page, `/p/${LIBRARY}/flow`);
  await details(page).click();
  const modal = page.locator(".modal");
  const platform = modal.getByLabel(/^Platform/);
  await expect(platform).toBeDisabled();
  await expect(platform).toHaveValue("github");
  await expect(modal.locator("label.field", { has: page.locator("select:disabled") })).toContainText("PlatformOnly its owners or an editor can change this");
  // the practice is his: he may keep or clear it, but only pick his own
  await expect(modal.getByLabel(/^Practice/)).toBeEnabled();
  await expect(modal.getByLabel(/^Practice/).locator("option")).toHaveText(["None", "Engineering"]);
  // everything else he may change, the owning team included
  await modal.getByLabel("Summary").fill("Share code inside the company, changed by a practice owner.");
  await modal.getByLabel(/^Owning team/).selectOption({ label: "Cloud Platform team" });
  await modal.getByRole("button", { name: "Done" }).click();
  await save(page);
  expect((await readProcess(page, LIBRARY))!).toMatchObject({ summary: "Share code inside the company, changed by a practice owner.", owner: "cloud-platform-team", platform: "github" });

  // the server refuses a change of the platform, also to his own, and also taking it away
  const now = (await readProcess(page, LIBRARY))!;
  for (const platform of ["google-cloud", undefined]) {
    const res = await putDoc(page, "process", LIBRARY, { ...now, platform });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/GitHub/);
  }
  expect((await readProcess(page, LIBRARY))!.platform).toBe("github");
  expect((await putDoc(page, "process", LIBRARY, library)).ok()).toBeTruthy(); // as it was
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
  await expect(page.locator("h1")).toHaveText("Order a Google Cloud quota increase");
  await expect(page.locator(".banner", { hasText: "Draft." })).toBeVisible();
  expect((await readProcess(page, "order-a-google-cloud-quota-increase"))!).toMatchObject({ status: "draft", platform: "google-cloud" });
  await details(page).click();
  await page.locator(".modal").getByRole("button", { name: "Delete process" }).click();
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
  await expect(page.locator("h1")).toHaveText("Pull request templates");
  expect((await readStandard(page, "pull-request-templates"))!).toMatchObject({ status: "draft", practice: "engineering", owner: "developer-experience-team" });
  await details(page).click();
  await page.locator(".modal").getByRole("button", { name: "Delete standard" }).click();
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
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
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
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(5);
  await expect(details(page)).toBeVisible();
  await open(page, `/s/${REVIEW}/doc`);
  await expect(page.locator(".req").first()).toBeVisible();
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(0);
  // the server agrees: the standard of another practice is refused
  const review = (await readStandard(page, REVIEW))!;
  expect((await putDoc(page, "standard", REVIEW, { ...review, title: "Changed by another practice" })).status()).toBe(403);
});

test("a team Owner still cannot edit, but confirms the review", async ({ page }) => {
  await signIn(page, CASEY);
  await open(page, `/p/${GCP}/flow`);
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
  const before = await versionOf(page, "process", GCP);
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect.poll(async () => (await readProcess(page, GCP))!.review).toMatchObject({ lastReviewedAt: serverToday(), reviewedBy: "Casey Owner" });
  expect(await versionOf(page, "process", GCP)).toBe(before + 1);

  const gcp = (await readProcess(page, GCP))!;
  const res = await putDoc(page, "process", GCP, { ...gcp, summary: "Changed by the team owner." });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(PROCESS_DENIED);
});
