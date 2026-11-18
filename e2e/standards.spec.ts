import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ALEX, answer, clearFeedback, open, pickFilter, putDoc, readSkill, readStandard, report, RILEY, SAM, save, serverToday, signIn, watchErrors } from "./helpers";

const LOGGING = "secure-logging"; // belongs to the practice Cyber security: Riley edits it
const IAC = "infrastructure-as-code"; // issued by the Cloud Platform team
const REVIEW = "code-review"; // issued by the Developer Experience team, belongs to the practice Engineering
const example = JSON.parse(fs.readFileSync(path.join(process.cwd(), "schema/example.standard.json"), "utf8"));

test("a consumer finds standards by the team that issues them and by what applies to their application", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, SAM);
  await open(page, "/standards");
  await expect(page.getByRole("heading", { name: "What must I meet?" })).toBeVisible();
  const cards = page.locator(".card");
  await expect(cards.filter({ hasText: "Secure logging" }).locator('[data-line="owner"] dd')).toHaveText("Cyber Security");
  await expect(cards.filter({ hasText: "Secure logging" }).locator('[data-line="rigour"] dd')).toContainText("4 mandatory");
  await expect(page.getByRole("button", { name: /Blank standard/ })).toHaveCount(0);

  await page.getByPlaceholder(/Search/).fill("IAC-03"); // requirement ids are searchable
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Infrastructure as code");
  await page.getByPlaceholder(/Search/).fill("");

  await pickFilter(page, "Owner", "Developer Experience team");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Code review");
  await expect(cards.first().locator('[data-line="practice"] dd')).toHaveText("Engineering"); // the practice it belongs to
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(cards).toHaveCount(3);

  // for a development environment one of the four mandatory logging rules falls away
  await page.locator(".profile-filter").getByLabel("Environment").selectOption({ label: "Development" });
  await expect(cards.filter({ hasText: "Secure logging" }).locator('[data-line="rigour"] dd')).toContainText("3 mandatory");
  expect(errors).toEqual([]);
});

test("a standard reads as a document: rule, reason, how to comply, examples, how it is checked", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/s/${LOGGING}/doc`);
  await expect(page.getByRole("heading", { name: "Secure logging", exact: true })).toBeVisible();
  await expect(page.locator(".eyebrow").first()).toContainText("issued by Cyber Security");
  await expect(page.locator(".standard-intro")).toContainText("All services and jobs");
  const reqs = page.locator(".req");
  await expect(reqs).toHaveCount(5);

  const first = page.locator("#req-SEC-LOG-01");
  await expect(first.locator(".level")).toHaveText("Must");
  await expect(first).toContainText("never written to logs");
  await expect(first).toContainText("Logs are read by many people");
  await expect(first).toContainText("Log the name of a credential, never its value.");
  await expect(first.locator("figure.good pre")).toContainText("key.ID");
  await expect(first.locator("figure.bad")).toHaveCount(2);
  await expect(first).toContainText("Checked automatically");
  await first.getByRole("button", { name: "What reviewers look for" }).click();
  await expect(first.locator(".req-review")).toContainText("passed to a log call");
  await expect(first.locator(".req-review")).toContainText("Reported as blocker");

  // nothing to edit for a consumer
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "JSON" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add requirement" })).toHaveCount(0);

  // only what applies to my application
  await page.locator(".req-bar").getByRole("button", { name: /Should/ }).click();
  await expect(reqs).toHaveCount(1);
  await page.locator(".req-bar").getByRole("button", { name: /All/ }).click();
  const mine = page.locator(".profile-filter");
  await mine.getByLabel("Tier").selectOption({ label: "Tier 3" });
  await expect(page.locator("#req-SEC-LOG-03")).toContainText("Does not apply to your application");
  await mine.getByLabel("Environment").selectOption({ label: "Test" });
  await expect(page.locator("#req-SEC-LOG-04")).toContainText("Does not apply to your application");
  await expect(page.locator(".req.na")).toHaveCount(2);
  await expect(page.locator(".req-bar .chip", { hasText: "Must" })).toContainText("2");
});

test("standards and processes point to each other", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/s/${IAC}/doc`);
  await expect(page.locator(".standard-intro")).toContainText("Follow “Raise a ServiceNow request”"); // how to ask for an exception
  await page.locator("#req-IAC-01").getByRole("button", { name: /How: Request a GCP project/ }).click();
  await expect(page.getByRole("heading", { name: "Request a GCP project" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Before you start/ })).toHaveAttribute("aria-expanded", "true"); // open on arrival
  await page.locator(".link-list.row").getByRole("link", { name: "Infrastructure as code" }).click();
  await expect(page.getByRole("heading", { name: "Infrastructure as code", exact: true })).toBeVisible();
  await expect(page.locator(".standard-intro .link-list").getByRole("link", { name: "Request a GCP project" })).toBeVisible();
});

test("feedback on a requirement goes to the people who answer for the standard", async ({ page, request }) => {
  await clearFeedback(request, "standard", LOGGING);
  await signIn(page, SAM);
  await open(page, `/s/${LOGGING}/doc`);
  const req = page.locator("#req-SEC-LOG-02");
  await req.hover();
  await req.getByRole("button", { name: /Report a problem/ }).click();
  const drawer = page.locator(".drawer");
  await drawer.getByRole("button", { name: "Unclear" }).click();
  await drawer.getByPlaceholder(/What is wrong or unclear/).fill("Is a hashed email still personal data?");
  await drawer.getByRole("button", { name: "Send feedback" }).click();
  await expect(drawer.locator(".fb-item")).toContainText("Is a hashed email still personal data?");
  await expect(req.locator(".report.has")).toHaveText("1");
  await expect(page.getByRole("tab", { name: /Feedback/ }).locator(".tab-count")).toHaveText("1");
  await open(page, "/standards");
  await expect(page.locator(".card", { hasText: "Secure logging" })).toContainText("1 open feedback");

  // a process editor has no say over a standard
  await signIn(page, ALEX, { editor: true });
  await open(page, `/s/${LOGGING}/feedback`);
  await expect(page.locator(".fb-item")).toContainText("SEC-LOG-02: No personal data in logs");
  await expect(page.getByRole("button", { name: "Mark as fixed" })).toHaveCount(0);

  // the owner of its practice does
  await signIn(page, RILEY);
  await open(page, `/s/${LOGGING}/feedback`);
  await page.getByRole("button", { name: "Mark as fixed" }).click();
  await expect(page.locator(".fb-item")).toContainText("Marked as fixed by Riley Security");
  await expect(page.getByRole("heading", { name: /0 open/ })).toBeVisible();
});

test("a practice owner edits the standards of the practice only", async ({ page }) => {
  await signIn(page, RILEY, { editor: true });
  await open(page, `/s/${REVIEW}/doc`); // belongs to another practice: reading only
  await expect(page.locator(".req").first()).toBeVisible();
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
  const theirs = await readStandard(page, REVIEW);
  const res = await putDoc(page, "standard", REVIEW, { ...theirs, title: "Hijacked" });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toContain("You can only save a standard that belongs to a platform or practice you own.");
  // nor take it over by moving it into her practice: what it belongs to now counts as well
  const takeOver = await putDoc(page, "standard", REVIEW, { ...theirs, practice: "security" });
  expect(takeOver.status()).toBe(403);
  expect((await takeOver.json()).error).toContain("Only standards editors and the owners of its platform or practice can change this standard.");

  await open(page, `/s/${LOGGING}/doc`);
  await expect(page.locator('[aria-label^="Edit "]')).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Add requirement" })).toBeVisible();
});

test("changing a requirement gives the skill and the review agent a new version and marks old feedback", async ({ page, request }) => {
  await clearFeedback(request, "standard", LOGGING);
  await report(request, SAM, { targetKind: "standard", targetId: LOGGING, itemId: "SEC-LOG-05", text: "Which logger for Python?" });
  await signIn(page, RILEY, { editor: true });
  const before = await readSkill(page, `review-${LOGGING}`);

  await open(page, `/s/${LOGGING}/doc`);
  await page.locator('[aria-label="Edit SEC-LOG-05"]').click();
  const drawer = page.locator(".drawer");
  await drawer.getByLabel("The rule").fill("Logs are written as structured key/value records in JSON, not free text.");
  await drawer.getByRole("button", { name: "Add" }).first().click(); // how to comply
  await drawer.getByPlaceholder("Use the logging library's redaction list.").last().fill("Use structlog for Python.");
  await drawer.locator(".field", { hasText: "Signs of a violation" }).getByRole("button", { name: "Add" }).click();
  await drawer.getByPlaceholder(/A variable named like password/).last().fill("logging.info with an f-string");
  await expect(page.locator("#req-SEC-LOG-05")).toContainText("in JSON, not free text");
  await save(page);

  const stored = (await readStandard(page, LOGGING))!.requirements.find((r: { id: string }) => r.id === "SEC-LOG-05");
  expect(stored.statement).toContain("in JSON");
  expect(stored.guidance.at(-1)).toBe("Use structlog for Python.");
  expect(stored.review.lookFor.at(-1)).toBe("logging.info with an f-string");

  // both generated items follow, each with a new version; the old one is kept
  await page.getByRole("tab", { name: "Skills" }).click();
  const picker = page.locator(".skill-picker");
  await expect(picker.getByRole("tab", { name: /Skill/ }).first()).toContainText(`v${before.skill.version + 1}`);
  await expect(page.locator(".skill-content")).toContainText("Use structlog for Python.");
  await picker.getByRole("tab", { name: /Review agent/ }).click();
  await expect(page.locator(".skill-content")).toContainText("logging.info with an f-string");
  await expect(page.locator(".skill-content")).toContainText(`This is version ${before.skill.version + 1} of the generated text.`);
  await expect(page.locator(".skill-source")).toContainText("of the standard"); // which version of the standard it was made from
  await page.locator(".skill-version select").selectOption(String(before.skill.version));
  await expect(page.locator(".skill-content")).not.toContainText("logging.info with an f-string");

  // feedback written about the old wording is marked
  await page.getByRole("tab", { name: /Feedback/ }).click();
  await expect(page.locator(".fb-item .fb-stale")).toContainText("This requirement was changed after the feedback was written");
});

test("add and remove a requirement; the checker guards the format", async ({ page }) => {
  await signIn(page, RILEY, { editor: true });
  await open(page, `/s/${LOGGING}/doc`);
  await page.getByRole("button", { name: "Add requirement" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer.getByLabel("Id")).toHaveValue("SEC-LOG-06"); // continues the numbering
  await expect(page.locator(".req")).toHaveCount(6);

  await drawer.getByLabel("Short name").fill("x"); // too short
  await expect(page.locator(".status.bad")).toContainText("problem");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await drawer.getByLabel("Short name").fill("Rotate log access keys");
  await drawer.getByRole("button", { name: "Must", exact: true }).click();
  await drawer.getByLabel("The rule").fill("Keys that give access to the log platform are rotated every 90 days.");
  await drawer.getByLabel("Why").fill("A leaked key is useful for a limited time only.");
  await drawer.getByRole("button", { name: "by a person" }).click();
  await drawer.locator(".field", { hasText: "Environments" }).getByRole("button", { name: "Production", exact: true }).click();
  await expect(page.locator(".status.good")).toBeVisible();
  await save(page);
  const added = (await readStandard(page, LOGGING))!.requirements.at(-1);
  expect(added).toMatchObject({ id: "SEC-LOG-06", level: "must", verification: { method: "manual" }, environments: ["production"] });
  expect(added.review).toBeUndefined(); // nothing for a reviewer to see: no review block
  await expect(page.locator("#req-SEC-LOG-06")).toContainText("Checked by a person");

  await page.locator('[aria-label="Edit SEC-LOG-06"]').click();
  await drawer.getByRole("button", { name: "Delete requirement" }).click();
  await answer(page, "Delete SEC-LOG-06?", "Delete requirement");
  await save(page);
  expect((await readStandard(page, LOGGING))!.requirements).toHaveLength(5);
});

test("create a standard from a policy text with AI; it is a draft without skills until published", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, RILEY, { editor: true });
  await open(page, "/standards");
  await page.getByRole("button", { name: "Create from text with AI" }).click();
  const modal = page.locator(".modal");
  await modal.locator("textarea").nth(0).fill("Dependencies with critical vulnerabilities must be updated within 7 days.");
  await modal.getByRole("button", { name: "Copy prompt" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  for (const part of ["# TEAMS", "# PRACTICES", "# PLATFORMS", "# CATEGORIES", '"engineering" - Engineering', '"google-cloud" - Google Cloud', '"security" - Cyber Security', '"production" - Production', "# JSON SCHEMA", '"id": "dependency-updates"', "must be updated within 7 days"]) expect(prompt).toContain(part);

  const wrong = JSON.parse(JSON.stringify(example));
  wrong.requirements[0].level = "always";
  await modal.locator("textarea").nth(1).fill(JSON.stringify(wrong));
  await expect(modal.locator(".issues")).toContainText("must be one of: must, should, may");
  await expect(modal.getByRole("button", { name: "Create standard" })).toBeDisabled();

  await modal.locator("textarea").nth(1).fill("```json\n" + JSON.stringify(example, null, 2) + "\n```");
  await expect(modal.locator(".check.good")).toContainText("Valid: Dependency updates - 3 requirements (2 must)");
  await modal.getByRole("button", { name: "Create standard" }).click();

  await expect(page.getByRole("heading", { name: "Dependency updates" })).toBeVisible();
  await expect(page.locator(".banner", { hasText: "Draft." })).toBeVisible();
  await expect(page.locator(".req")).toHaveCount(3);
  await page.getByRole("tab", { name: "Skills" }).click();
  await expect(page.locator(".skills-empty")).toContainText("No skill yet");

  // invisible to consumers until it is published
  await signIn(page, SAM);
  await open(page, "/standards");
  await expect(page.locator(".card", { hasText: "Secure logging" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Dependency updates" })).toHaveCount(0);

  await signIn(page, RILEY, { editor: true });
  await open(page, "/s/dependency-updates/doc");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Active" }).click();
  await page.locator(".modal").getByRole("button", { name: "Done" }).click();
  await save(page);
  await page.getByRole("tab", { name: "Skills" }).click();
  await expect(page.locator(".skill-picker").getByRole("tab")).toHaveCount(2); // a skill and a review agent
  await expect(page.locator(".skill-content")).toContainText("# Standard: Dependency updates");
  await expect(page.locator(".skill-head code")).toHaveText(".claude/skills/standard-dependency-updates/SKILL.md");

  // retire it: the skills are withdrawn, the document stays for reference
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Retired" }).click();
  await page.locator(".modal").getByLabel("Use instead").selectOption({ label: "Secure logging" });
  await page.locator(".modal").getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(page.locator(".banner", { hasText: "This standard is retired." }).getByRole("link", { name: "Secure logging" })).toBeVisible();
  expect((await readSkill(page, "standard-dependency-updates")).skill.active).toBe(false);

  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Delete standard" }).click();
  await answer(page, "Delete this standard?", "Delete standard");
  await expect(page.getByRole("heading", { name: "What must I meet?" })).toBeVisible();
  expect(await readStandard(page, "dependency-updates")).toBeUndefined();
});

test("mark a standard as reviewed, look at its history, edit its JSON", async ({ page }) => {
  await page.clock.install({ time: new Date("2027-10-01T10:00:00Z") }); // more than a year after its last review
  await signIn(page, RILEY, { editor: true });
  await open(page, `/s/${LOGGING}/doc`);
  await expect(page.locator(".banner", { hasText: "Review overdue" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.locator(".banner", { hasText: "Review overdue" })).toHaveCount(0);
  await expect.poll(async () => (await readStandard(page, LOGGING))!.review).toEqual({ intervalMonths: 12, lastReviewedAt: serverToday(), reviewedBy: "Riley Security" });

  await page.getByRole("button", { name: /^Version \d+$/ }).click();
  await expect(page.locator(".history li").first()).toContainText("riley@example.com");
  await expect(page.locator(".history li").first()).toContainText("Reviewed: confirmed as still correct");
  await expect(page.locator(".history li").last()).toContainText("import");
  await page.locator(".modal-foot").getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.locator(".cm-content")).toContainText('"requirements"');
  const original = JSON.stringify(await readStandard(page, LOGGING), null, 2);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(original.replace('"id": "SEC-LOG-02"', '"id": "SEC-LOG-01"'));
  await expect(page.locator(".json-side .issues")).toContainText('duplicate requirement id "SEC-LOG-01"');
  await expect(page.locator(".json-side .check.bad")).toContainText("Not applied to the draft");
});
