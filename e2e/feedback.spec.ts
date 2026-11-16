import { expect, test } from "@playwright/test";
import { ALEX, answer, CASEY, clearFeedback, open, report, SAM, signIn } from "./helpers";

const GCP = "request-gcp-project"; // owned by the Cloud Platform team (Casey)
const REPO = "request-github-repository"; // owned by another team

test.beforeEach(async ({ request }) => { await clearFeedback(request, "process", GCP); await clearFeedback(request, "process", REPO); });

test("a consumer flags a step from the checklist and everyone sees the flag", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/list`);
  const step = page.locator("#step-raise-request");
  await step.hover();
  await step.getByRole("button", { name: /Tell us/ }).click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Out of date" }).click();
  await drawer.getByPlaceholder(/What happened/).fill("The catalogue item is now called Cloud project.");
  await drawer.getByRole("button", { name: "Send feedback" }).click();

  // shown on the step straight away, with who wrote it taken from the sign-in
  await expect(drawer.locator(".fb-item")).toContainText("The catalogue item is now called Cloud project.");
  await expect(drawer.locator(".fb-item")).toContainText("You");
  await expect(step.locator(".report.has")).toHaveText("1");

  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator(".block", { hasText: "Raise the 'New GCP project' request" }).locator(".block-flag")).toHaveText("1");
  await expect(page.getByRole("tab", { name: /Feedback/ }).locator(".tab-count")).toHaveText("1");

  await open(page, "/");
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toContainText("1 open feedback");
});

test("report on the whole process from the feedback tab; send needs a sentence", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  await page.getByRole("button", { name: "Report a problem" }).click();
  const send = page.getByRole("button", { name: "Send feedback" });
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Suggestion" }).click();
  await page.getByPlaceholder(/What happened/).fill("A diagram of the folders would help.");
  await send.click();
  await expect(page.getByText("Thanks - the owner has been told.")).toBeVisible();
  const item = page.locator(".fb-item");
  await expect(item).toContainText("Whole process");
  await expect(item).toContainText("Suggestion");
  await expect(page.getByRole("heading", { name: /1 open/ })).toBeVisible();
});

test("a consumer cannot mark feedback as fixed, but can delete their own", async ({ page, request }) => {
  await report(request, CASEY, { targetId: REPO, text: "Reported by someone else." });
  await report(request, SAM, { targetId: REPO, text: "Reported by me." });
  await signIn(page, SAM);
  await open(page, `/p/${REPO}/feedback`);
  await expect(page.locator(".fb-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Mark as fixed" })).toHaveCount(0);

  const mine = page.locator(".fb-item", { hasText: "Reported by me." });
  const theirs = page.locator(".fb-item", { hasText: "Reported by someone else." });
  await expect(theirs.getByRole("button", { name: "Delete feedback" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "I hit this too" })).toHaveCount(0);
  await mine.getByRole("button", { name: "Delete feedback" }).click();
  await answer(page, "Delete this feedback?", "Cancel"); // it asks first, and "Cancel" keeps it
  await expect(page.locator(".fb-item")).toHaveCount(2);
  await mine.getByRole("button", { name: "Delete feedback" }).click();
  await answer(page, "Delete this feedback?", "Delete feedback");
  await expect(page.locator(".fb-item")).toHaveCount(1);
});

test("“I hit this too” adds one per person and can be withdrawn", async ({ page, request }) => {
  await report(request, SAM, { targetId: GCP, itemId: "raise-request", text: "Form renamed." });
  await signIn(page, CASEY);
  await open(page, `/p/${GCP}/feedback`);
  const item = page.locator(".fb-item");
  await item.getByRole("button", { name: "I hit this too" }).click();
  await expect(item).toContainText("+1 also hit this");
  await expect(item.getByRole("button", { name: "You hit this too" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(item).toContainText("+1 also hit this");
  await item.getByRole("button", { name: "You hit this too" }).click();
  await expect(item).not.toContainText("also hit this");
});

test("the owner team closes feedback on its own process only", async ({ page, request }) => {
  await report(request, SAM, { targetId: GCP, itemId: "raise-request", text: "Form renamed." });
  await report(request, SAM, { targetId: REPO, text: "Template is gone." });
  await signIn(page, CASEY); // owner of the GCP process, not an editor

  await open(page, `/p/${REPO}/feedback`);
  await expect(page.locator(".fb-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mark as fixed" })).toHaveCount(0);

  await open(page, `/p/${GCP}/feedback`);
  await page.getByRole("button", { name: "Mark as fixed" }).click();
  const item = page.locator(".fb-item");
  await expect(item).toContainText("Marked as fixed by Casey Owner");
  await expect(page.getByRole("heading", { name: /0 open/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Feedback/ }).locator(".tab-count")).toHaveCount(0);
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator(".block-flag")).toHaveCount(0);

  await page.getByRole("tab", { name: /Feedback/ }).click();
  await item.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("heading", { name: /1 open/ })).toBeVisible();
});

test("a process editor closes feedback on any process; feedback on a step that changed is marked", async ({ page, request }) => {
  await report(request, SAM, { targetId: REPO, itemId: "finish-setup", text: "CODEOWNERS format changed." });
  await signIn(page, ALEX, { editor: true });
  await open(page, `/p/${REPO}/flow`);

  // the owner rewrites the step the feedback is about
  await page.locator(".block", { hasText: "Finish the repository setup" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer.locator(".fb-stale")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Edit step" }).click();
  await drawer.getByLabel("What happens", { exact: true }).fill("Finish setting up the repository");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();

  await page.getByRole("tab", { name: /Feedback/ }).click();
  const item = page.locator(".fb-item");
  await expect(item.locator(".fb-stale")).toContainText("It may already be fixed");
  await item.getByRole("button", { name: "Mark as fixed" }).click();
  await expect(item.locator(".fb-stale")).toHaveCount(0);
  await expect(item).toContainText("Marked as fixed by Alex Editor");
});
