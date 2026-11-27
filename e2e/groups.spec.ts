import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, JORDAN, MORGAN, SAM, navigate, open, putDoc, readCatalog, readProcess, signIn } from "./helpers";

// The pages of a platform, a practice and a team (`#/platform/:id`, `#/practice/:id`,
// `#/team/:id`): what it is, how to reach it, who is behind it and what belongs to it; the way
// there from Home's Browse and from Teams; its details changed by an owner. Every test
// puts back what it changed: the lists and the people are shared with every other test.

const GC = "google-cloud";

const reach = (page: Page) => page.locator("section.group-reach");
const people = (page: Page) => page.getByRole("region", { name: "People" });
const docs = (page: Page) => page.locator("section.group-docs");
const owners = (page: Page) => people(page).locator('.cat-members[data-rank="owner"]');
const members = (page: Page) => people(page).locator('.cat-members[data-rank="member"]');

/** The details of a group as stored now (description, the free line and the contact details). */
async function detailsOf(request: APIRequestContext, list: "teams" | "platforms" | "practices", id: string) {
  const entry = (await readCatalog(request))[list].find((e: { id: string }) => e.id === id);
  return { description: entry.description ?? "", contact: entry.contact ?? "", contacts: entry.contacts ?? null };
}
/** Puts the details of a group back as they were, through the call the page uses (as an admin). */
async function putDetails(request: APIRequestContext, list: "teams" | "platforms" | "practices", id: string, d: object) {
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const res = await request.put(`/api/groups/${list}/${id}/details`, { data: d, headers: CSRF });
  expect(res.ok(), await res.text()).toBeTruthy();
}
/** The members (not owners) of a platform or practice, as stored. */
async function membersOf(request: APIRequestContext, kind: "platform" | "practice", id: string): Promise<string[]> {
  const all = await (await request.get("/api/members")).json();
  const list: { email: string; role: string; scope: string }[] = Array.isArray(all) ? all : all.members ?? all.assignments ?? [];
  return list.filter((m) => m.role === `${kind}-member` && m.scope === id).map((m) => m.email).sort();
}

// ---------- Home › Browse

test("Home › Browse: counts in brackets, chips that open a group's page, a category that searches", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/");
  const browse = page.getByRole("complementary", { name: "Browse" });
  const platforms = browse.getByRole("region", { name: "By platform" });
  await expect(platforms).toContainText("Each opens the platform’s page");
  await expect(browse.getByRole("region", { name: "By practice" })).toContainText("Each opens the practice’s page");
  await expect(browse.getByRole("region", { name: "By team" })).toContainText("Each opens the team’s page");
  await expect(browse.getByRole("region", { name: "By category" })).toContainText("Each shows what is filed under it, in the search");

  // the count is grey, in brackets, and not read out twice: the chip's accessible name says it once
  const chip = platforms.getByRole("link", { name: "Google Cloud, 2 results" });
  await expect(chip).toHaveText("Google Cloud(2)");
  await expect(chip.locator(".chip-count")).toHaveText("(2)");
  await expect(chip.locator(".chip-count")).toHaveAttribute("aria-hidden", "true");
  const grey = await chip.locator(".chip-count").evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e.parentElement!).color]);
  expect(grey[0]).not.toBe(grey[1]);

  // a platform, a practice and a team open their pages
  await chip.click();
  await expect(page).toHaveURL(/#\/platform\/google-cloud$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Google Cloud");
  await page.goBack();
  await browse.getByRole("region", { name: "By practice" }).getByRole("link", { name: /^Engineering, \d+ results?$/ }).click();
  await expect(page).toHaveURL(/#\/practice\/engineering$/);
  await page.goBack();
  await browse.getByRole("region", { name: "By team" }).getByRole("link", { name: /^Cloud Platform team, \d+ results?$/ }).click();
  await expect(page).toHaveURL(/#\/team\/cloud-platform-team$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cloud Platform team");
  // the top bar marks Teams on a group's page, and the tab is the group's name
  await expect(page.locator("nav.nav").getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/^Cloud Platform team/);
  await page.goBack();
  // a category still runs a search
  await browse.getByRole("region", { name: "By category" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/#\/search\?/);
});

// ---------- the page, for each person

test("a reader sees a platform's page: how to reach it, who is behind it, what belongs to it; nothing to change", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/platform/${GC}`);
  await expect(page).toHaveTitle(/^Google Cloud/);
  await expect(page.locator("a.back")).toHaveText("Teams");
  await expect(page.locator("a.back")).toHaveAttribute("href", "#/teams/platforms/google-cloud");
  await expect(page.locator(".group-kind")).toHaveText("Platform");
  await expect(page.locator(".rank-mark")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Google Cloud");
  await expect(page.locator(".group-lead")).toContainText("Google Cloud as the company runs it");
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);

  // how to reach them, each detail drawn as what it is
  const form = reach(page).getByRole("link", { name: "Open the request form" });
  await expect(form).toHaveAttribute("href", "https://forms.example.com/cloud-platform/request");
  await expect(form).toHaveAttribute("target", "_blank");
  await expect(form).toHaveAccessibleDescription("Where people ask them for something");
  await expect(reach(page).locator('[data-contact="email"] a')).toHaveAttribute("href", "mailto:cloud-platform@example.com");
  await expect(reach(page).locator('[data-contact="email"] a')).not.toHaveAttribute("target", /.*/);
  const slack = reach(page).locator('[data-contact="slack"]');
  await expect(slack.locator("dt")).toHaveText("Slack channel");
  await expect(slack.getByRole("link", { name: "#cloud-platform" })).toHaveAttribute("href", "https://example.slack.com/archives/C0CLOUDPLAT");
  const confluence = reach(page).locator('[data-contact="confluence"] a');
  await expect(confluence).toHaveText("example.atlassian.net/wiki/spaces/CLOUD");
  await expect(confluence).toHaveAttribute("title", "https://example.atlassian.net/wiki/spaces/CLOUD");
  await expect(reach(page).locator('[data-contact="other"]')).toHaveCount(0);

  // who is behind it: by name, a line per role for a reader
  await expect(owners(page).getByRole("heading", { level: 2 })).toHaveText("Owners 1");
  await expect(owners(page)).toContainText("Owners decide what is published here.");
  await expect(owners(page)).not.toContainText("An admin gives and takes this role.");
  await expect(owners(page).getByRole("link", { name: "Jordan Platform" })).toHaveAttribute("href", "mailto:jordan@example.com");
  await expect(members(page).getByRole("heading", { level: 2 })).toHaveText("Members 1");
  await expect(members(page)).toContainText("Members write drafts for the owners.");
  await expect(members(page).getByRole("link", { name: "Morgan Member" })).toBeVisible();
  await expect(people(page).getByRole("textbox")).toHaveCount(0);
  await expect(people(page).getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // what belongs to it: the cards of the lists, counted, and the same filter in the search
  await expect(docs(page).getByRole("heading", { level: 2 })).toHaveText("What belongs to this platform");
  await expect(docs(page).locator(".group-count")).toHaveText("1 process and 1 standard");
  await expect(docs(page).locator(".card")).toHaveCount(2);
  await expect(docs(page).getByRole("button", { name: /^New (process|standard)$/ })).toHaveCount(0);
  await docs(page).getByRole("link", { name: "Open in the search" }).click();
  await expect(page).toHaveURL(/#\/search\?.*platform=google-cloud/);
  await expect(page.locator(".card")).toHaveCount(2);

  // the server does not let a reader change the details either
  const res = await page.request.put(`/api/groups/platforms/${GC}/details`, { data: { description: "Taken over" }, headers: CSRF });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("Only an owner of the platform “Google Cloud”, a lists manager or an admin can change its details.");
});

test("a member, an owner and an admin each see what they are and what they may do", async ({ page }) => {
  // Morgan, a member: the mark, the long texts, no Edit details, no changing the members
  await signIn(page, MORGAN);
  await open(page, `/platform/${GC}`);
  await expect(page.locator(".rank-mark")).toHaveText("You are a member");
  await expect(page.locator(".rank-mark")).toHaveClass(/\bmember\b/);
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await expect(members(page)).toContainText("Members can create and change drafts here. An owner publishes them.");
  await expect(members(page).locator("li", { hasText: "Morgan Member" })).toContainText("You");
  await expect(members(page).getByRole("textbox", { name: "Email of the new member" })).toHaveCount(0);
  await expect(docs(page).getByRole("button", { name: "New process" })).toBeVisible();
  const refused = await page.request.post(`/api/groups/platforms/${GC}/members`, { data: { email: SAM }, headers: CSRF });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe("Only an owner of the platform “Google Cloud”, or an admin, can add or remove its members.");
  expect((await page.request.put(`/api/groups/platforms/${GC}/details`, { data: { description: "x" }, headers: CSRF })).status()).toBe(403);

  // Jordan, an owner: Edit details, the members to change, the owners not
  await signIn(page, JORDAN);
  await open(page, `/platform/${GC}`);
  await expect(page.locator(".rank-mark")).toHaveText("You are an owner");
  await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  await expect(owners(page)).toContainText("Owners change and publish what belongs to this platform");
  await expect(owners(page)).toContainText("An admin gives and takes this role.");
  await expect(owners(page).getByRole("textbox", { name: "Email of the new owner" })).toHaveCount(0);
  await expect(members(page).getByRole("textbox", { name: "Email of the new member" })).toBeVisible();
  await expect(members(page).getByRole("button", { name: "Remove morgan@example.com as Platform member" })).toBeVisible();
  // the practice he does not own is read-only for him
  await open(page, "/practice/security");
  await expect(page.locator(".rank-mark")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);

  // Dana, an admin: owners and members to change, no mark of her own
  await signIn(page, DANA);
  await open(page, `/platform/${GC}`);
  await expect(page.locator(".rank-mark")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  await expect(owners(page).getByRole("textbox", { name: "Email of the new owner" })).toBeVisible();
  await expect(owners(page).getByRole("button", { name: "Remove jordan@example.com as Platform owner" })).toBeVisible();
  await expect(members(page).getByRole("textbox", { name: "Email of the new member" })).toBeVisible();
});

test("an address that is not a web link is never drawn as a link; a channel without its link is its name", async ({ page }) => {
  await signIn(page, SAM);
  // the lists as an older installation might have stored them, bypassing today's checks
  await page.route("**/api/catalog", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const akamai = body.platforms.find((p: { id: string }) => p.id === "akamai");
    akamai.contacts = { slack: "#edge-cdn", email: "not an address", page: "javascript:alert(1)", form: "ftp://forms.example.com/x", confluence: "www.example.com/no-scheme", chatUrl: "https://chat.google.com/room/X" };
    akamai.contact = "Slack #edge-cdn";
    await route.fulfill({ response: res, json: body });
  });
  await open(page, "/platform/akamai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Akamai");
  await expect(reach(page).getByRole("link", { name: "Open the request form" })).toHaveCount(0);
  await expect(reach(page).locator('[data-contact="slack"] dd')).toHaveText("#edge-cdn");
  await expect(reach(page).locator('[data-contact="slack"] a')).toHaveCount(0);
  await expect(reach(page).locator('[data-contact="email"] dd')).toHaveText("not an address");
  await expect(reach(page).locator('[data-contact="email"] a')).toHaveCount(0);
  await expect(reach(page).locator('[data-contact="page"]')).toHaveCount(0);
  await expect(reach(page).locator('[data-contact="confluence"]')).toHaveCount(0);
  // a link alone, without a name: "Open the space"
  await expect(reach(page).locator('[data-contact="chat"]').getByRole("link", { name: "Open the space" })).toHaveAttribute("href", "https://chat.google.com/room/X");
  // the free line only repeats the Slack channel: left out
  await expect(reach(page).locator('[data-contact="other"]')).toHaveCount(0);
  for (const a of await reach(page).locator("a").all()) expect(await a.getAttribute("href")).toMatch(/^(https?:|mailto:)/);
});

test("a group that does not exist, and an empty team", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/platform/no-such-platform");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform not found");
  await expect(page.getByText("This platform does not exist (any more). It may have been removed from the lists.")).toBeVisible();
  await page.getByRole("link", { name: "Back to Teams" }).click();
  await expect(page).toHaveURL(/#\/teams$/);

  // the DNS team: nothing known, no owner, nothing looked after
  await open(page, "/team/dns-team");
  await expect(page.locator(".group-kind")).toHaveText("Team");
  await expect(page.getByText("No description yet.")).toBeVisible();
  await expect(reach(page)).toContainText("Nothing is known yet about how to reach them.");
  await expect(people(page)).toHaveText("No owner yet. Use the ways to reach them above.");
  await expect(members(page)).toHaveCount(0); // a team has no members
  await expect(docs(page).getByRole("heading", { level: 2 })).toHaveText("What this team looks after");
  await expect(docs(page).locator(".group-count")).toHaveText("Nothing yet");
  await expect(docs(page)).toContainText("This team does not look after any process or standard yet.");
  await expect(docs(page).getByRole("link", { name: "Open in the search" })).toHaveCount(0);

  // whoever may change its details is told how to add them
  await signIn(page, ALEX);
  await open(page, "/team/dns-team");
  await expect(reach(page)).toContainText("Nothing is known yet. Use Edit details to add how people reach them.");
  // and may start a process the team owns
  await docs(page).getByRole("button", { name: "New process" }).click();
  const dialog = page.getByRole("dialog", { name: "New process" });
  await expect(dialog).toContainText("Owned by DNS team. You can change that later.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a draft on a group's page only for whoever may see it; Show all after twelve", async ({ page }) => {
  await signIn(page, ALEX);
  const gcp = (await readProcess(page, "request-gcp-project"))!;
  const res = await page.request.put("/api/processes/gc-draft-on-page?base=0", {
    data: { ...gcp, id: "gc-draft-on-page", title: "A Google Cloud draft on its page", status: "draft" }, headers: CSRF,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  try {
    for (const [who, sees] of [[MORGAN, true], [JORDAN, true], [SAM, false], [DANA, true]] as const) {
      await signIn(page, who);
      await open(page, `/platform/${GC}`);
      await expect(docs(page).locator(".card").first()).toBeVisible();
      await expect(docs(page).locator(".card", { hasText: "A Google Cloud draft on its page" }), who).toHaveCount(sees ? 1 : 0);
      await expect(docs(page).locator(".group-count"), who).toHaveText(sees ? "2 processes and 1 standard" : "1 process and 1 standard");
    }
  } finally {
    await signIn(page, ALEX);
    expect((await page.request.delete("/api/processes/gc-draft-on-page", { headers: CSRF })).ok()).toBeTruthy();
  }
});

test("printing the page and reading it on a phone", async ({ page }) => {
  await signIn(page, JORDAN);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `/platform/${GC}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Google Cloud");
  // one column, in the order of the page, and nothing wider than the screen
  const top = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!.y;
  expect(await top(reach(page))).toBeLessThan(await top(people(page)));
  expect(await top(people(page))).toBeLessThan(await top(docs(page)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // the details dialog keeps Save in view on a phone
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Details of Google Cloud" });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 1500, height: 950 });
  // two columns from 1000 pixels
  expect(Math.abs(await top(reach(page)) - await top(docs(page)))).toBeLessThan(40);
  await page.emulateMedia({ media: "print" });
  try {
    await expect(page.getByRole("button", { name: "Edit details" })).toBeHidden();
    await expect(members(page).getByRole("textbox")).toBeHidden();
    await expect(reach(page).getByRole("link", { name: "Open the request form" })).toBeHidden();
    await expect(reach(page).locator(".contact-form-print")).toHaveText("Request form: https://forms.example.com/cloud-platform/request");
    await expect(reach(page).locator(".contact-form-print")).toBeVisible();
    await expect(docs(page).getByRole("link", { name: "Open in the search" })).toBeHidden();
    // a Slack channel prints its address after the name
    const after = await reach(page).locator('[data-contact="slack"] dd a').evaluate((e) => getComputedStyle(e, "::after").content);
    expect(after).toContain("https://example.slack.com/archives/C0CLOUDPLAT");
  } finally {
    await page.emulateMedia({ media: "screen" });
  }
});

// ---------- the details, changed by an owner

test("an owner changes the details: a bad link is marked and focused, https:// is added, the log names only what changed", async ({ page }) => {
  await signIn(page, JORDAN);
  const before = await detailsOf(page.request, "platforms", GC);
  try {
    await open(page, `/platform/${GC}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: "Details of Google Cloud" });
    await expect(dialog.getByLabel("What it is")).toHaveValue(before.description);
    const pageField = dialog.getByRole("textbox", { name: /^Their page/ });
    const chat = dialog.getByRole("textbox", { name: /^Google Chat space/ });

    // a link with spaces: marked on its field, Save refused, the cursor put there
    await pageField.fill("intranet example com");
    await chat.focus();
    await expect(dialog.locator('[data-contact-field="page"] .field-error')).toHaveText("Write the link without spaces.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Fix the marked fields first.");
    await expect(pageField).toHaveAttribute("aria-invalid", "true");
    await expect(pageField).toBeFocused();
    // a bad email, in its own words
    await dialog.getByRole("textbox", { name: /^Group email/ }).fill("cloud at example");
    await dialog.getByRole("textbox", { name: /^Group email/ }).blur();
    await expect(dialog.locator('[data-contact-field="email"] .field-error')).toHaveText("Write one email address, like team@company.com.");
    await dialog.getByRole("textbox", { name: /^Group email/ }).fill(before.contacts.email);

    // a bare host gets https:// when the field is left; something with another scheme is left as it is
    await pageField.fill("intranet.example.com/cloud");
    await chat.focus();
    await expect(pageField).toHaveValue("https://intranet.example.com/cloud");
    await expect(pageField).not.toHaveAttribute("aria-invalid", /.*/);
    await chat.fill("Cloud questions");

    // Cancel with changes asks first
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog", { name: "Discard your changes?" }).getByRole("button", { name: "Keep editing" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".toast", { hasText: "The details of Google Cloud are saved." })).toBeVisible();
    await expect(reach(page).locator('[data-contact="page"] a')).toHaveAttribute("href", "https://intranet.example.com/cloud");
    await expect(reach(page).locator('[data-contact="chat"] dd')).toHaveText("Cloud questions");
    const now = await detailsOf(page.request, "platforms", GC);
    expect(now.contacts).toEqual({ ...before.contacts, page: "https://intranet.example.com/cloud", chat: "Cloud questions" });

    // Activity names only what changed, by its label
    await signIn(page, DANA);
    await open(page, "/admin/activity");
    const entry = page.locator(".activity li").first();
    await expect(entry).toContainText("Jordan Platform");
    await expect(entry).toContainText("Google Cloud");
    await expect(entry).toContainText("Google Chat space, Their page");
    await expect(entry).not.toContainText("description");
    await expect(entry).not.toContainText("other ways to reach them");

    // a save that changes nothing stores nothing
    const { version } = await (await page.request.put(`/api/groups/platforms/${GC}/details`, { data: now, headers: CSRF })).json();
    const again = await page.request.put(`/api/groups/platforms/${GC}/details`, { data: now, headers: CSRF });
    expect(again.status()).toBe(200);
    expect((await again.json()).version).toBe(version);
  } finally {
    await putDetails(page.request, "platforms", GC, before);
  }
});

// ---------- the members of a platform, changed by its owner

test("an owner adds and removes members: a bad address, an unknown one, himself, Undo, a confirmation", async ({ page }) => {
  await signIn(page, JORDAN);
  const before = await membersOf(page.request, "platform", GC);
  try {
    await open(page, `/platform/${GC}`);
    const field = members(page).getByRole("textbox", { name: "Email of the new member" });
    // not an address: said under the field, Enter submits
    await field.fill("not an address");
    await field.press("Enter");
    await expect(members(page).locator(".member-problem")).toHaveText("Write one email address, like team@company.com.");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();

    // somebody the portal knows nothing of: added, with a hint to check the address, and Undo
    await field.fill("new.person@example.com");
    await members(page).getByRole("button", { name: "Add member" }).click();
    const added = page.locator(".toast", { hasText: "new.person@example.com can now create and change drafts for Google Cloud." });
    await expect(added).toBeVisible();
    await expect(members(page).locator(".member-note")).toHaveText("Nobody with this address has done anything in the portal yet. Check it is right.");
    await expect(members(page).getByRole("link", { name: "new.person@example.com" })).toBeVisible();
    await expect(field).toHaveValue("");
    await added.getByRole("button", { name: "Undo" }).click();
    await expect(members(page).getByRole("link", { name: "new.person@example.com" })).toHaveCount(0);
    expect(await membersOf(page.request, "platform", GC)).toEqual(before);

    // himself: he is already an owner, said as information
    await field.fill(JORDAN);
    await field.press("Enter");
    await expect(members(page).locator(".member-note")).toHaveText("You are already an owner of Google Cloud.");

    // somebody known, by name; removing asks first, and Cancel keeps them
    await field.fill(SAM);
    await field.press("Enter");
    await expect(page.locator(".toast", { hasText: "Sam Consumer can now create and change drafts for Google Cloud." })).toBeVisible();
    const remove = members(page).getByRole("button", { name: "Remove sam@example.com as Platform member" });
    await remove.click();
    const ask = page.getByRole("dialog", { name: "Remove this member?" });
    await expect(ask).toContainText("Sam Consumer will no longer be a Platform member of Google Cloud and will no longer be able to create or change its drafts. Their drafts stay.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(members(page).getByRole("link", { name: "Sam Consumer" })).toBeVisible();
    await remove.click();
    await ask.getByRole("button", { name: "Remove" }).click();
    await expect(members(page).getByRole("link", { name: "Sam Consumer" })).toHaveCount(0);
    expect(await membersOf(page.request, "platform", GC)).toEqual(before);

    // the server: not an address, a group that does not exist, a team
    const bad = await page.request.post(`/api/groups/platforms/${GC}/members`, { data: { email: "nope" }, headers: CSRF });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("That is not an email address.");
    const none = await page.request.post("/api/groups/platforms/nope/members", { data: { email: SAM }, headers: CSRF });
    expect(none.status()).toBe(404);
    expect((await none.json()).error).toBe("There is no platform “nope” in the lists.");
    expect((await page.request.post("/api/groups/teams/cloud-platform-team/members", { data: { email: SAM }, headers: CSRF })).status()).toBe(404);
  } finally {
    await signIn(page, DANA);
    for (const who of await membersOf(page.request, "platform", GC)) {
      if (!before.includes(who)) await page.request.delete(`/api/groups/platforms/${GC}/members?email=${encodeURIComponent(who)}`, { headers: CSRF });
    }
  }
});

test("an admin adds and removes owners on the page; an owner as a member is a note, not a change", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/practice/service-management");
  try {
    await expect(people(page)).toBeVisible();
    const ownersField = owners(page).getByRole("textbox", { name: "Email of the new owner" });
    await ownersField.fill(ALEX);
    await owners(page).getByRole("button", { name: "Add owner" }).click();
    await expect(page.locator(".toast", { hasText: "Alex Editor is now a Practice owner of Service management." })).toBeVisible();
    await expect(owners(page).getByRole("link", { name: "Alex Editor" })).toBeVisible();
    // the same person again: nothing changes
    await ownersField.fill(ALEX);
    await ownersField.press("Enter");
    await expect(owners(page).locator(".member-note")).toHaveText("Alex Editor is already an owner of Service management: nothing changed.");
    // an owner added as a member: the server's note, as information
    await members(page).getByRole("textbox", { name: "Email of the new member" }).fill(ALEX);
    await members(page).getByRole("button", { name: "Add member" }).click();
    await expect(members(page).locator(".member-note")).toHaveText("alex@example.com is already an owner of the practice “Service management”: nothing changed.");
    // removing an owner asks, in words about what they lose
    await owners(page).getByRole("button", { name: "Remove alex@example.com as Practice owner" }).click();
    const ask = page.getByRole("dialog", { name: "Remove this owner?" });
    await expect(ask).toContainText("Alex Editor will no longer be a Practice owner of Service management and will no longer be able to change or publish what belongs to it, unless another role lets them.");
    await ask.getByRole("button", { name: "Remove" }).click();
    await expect(owners(page).getByRole("link", { name: "Alex Editor" })).toHaveCount(0);
  } finally {
    await page.request.delete("/api/admin/access", { data: { email: ALEX, role: "practice-owner", scope: "service-management" }, headers: CSRF }).catch(() => {});
    const access = await (await page.request.get("/api/admin/access")).json();
    expect(access.assignments.filter((a: { email: string; scope: string }) => a.email === ALEX && a.scope === "service-management")).toEqual([]);
  }
});

// ---------- Teams

test("Teams: own groups first with a mark, “N yours” on the tabs, the entry in the address", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, "/");
  await navigate(page, "Teams");
  await expect(page).toHaveURL(/#\/teams$/);
  const tabs = page.getByRole("group", { name: "Lists of teams" });
  await expect(tabs.getByRole("tab", { name: /^Teams/ }).locator(".tab-yours")).toHaveText("1 yours");
  await expect(tabs.getByRole("tab", { name: /^Platforms/ }).locator(".tab-yours")).toHaveText("1 yours");
  await expect(tabs.getByRole("tab", { name: /^Practices/ }).locator(".tab-yours")).toHaveText("1 yours");
  await expect(tabs.getByRole("tab", { name: /^Tools/ }).locator(".tab-yours")).toHaveCount(0);

  // the teams are under their pillars (the sample has pillars): in his pillar his own team first,
  // with the mark on its line; in every pillar the rest by name
  const rows = page.locator(".cat-item");
  const cloud = page.locator(".cat-section-tribe", { has: page.getByRole("heading", { name: "Cloud foundations (pillar)" }) }).locator(".cat-item");
  await expect(cloud.first()).toContainText("Cloud Platform team");
  await expect(cloud.first().locator(".cat-item-line .rank-mark")).toHaveText("You are an owner");
  await expect(rows.locator(".rank-mark")).toHaveCount(1);
  const tribes = page.locator(".cat-section-tribe");
  expect(await tribes.count()).toBeGreaterThan(3);
  for (const section of await tribes.all()) {
    const names = (await section.locator(".cat-item-line").allTextContents()).map((t) => t.replace("You are an owner", "").trim()).filter((t) => t !== "Cloud Platform team");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  }
  await expect(cloud.first()).toContainText("Slack #cloud-platform"); // the summary says what it is

  // the tab and the entry follow in the address, and survive a reload
  await tabs.getByRole("tab", { name: /^Platforms/ }).click();
  await expect(page).toHaveURL(/#\/teams\/platforms(\/google-cloud)?$/);
  await expect(rows.first()).toContainText("Google Cloud");
  await page.locator(".cat-item", { hasText: "Akamai" }).click();
  await expect(page).toHaveURL(/#\/teams\/platforms\/akamai$/);
  await page.reload();
  await expect(tabs.getByRole("tab", { name: /^Platforms/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cat-detail h2")).toHaveText("Akamai");
  await expect(page.locator(".cat-detail .contact-list")).toContainText("edge-cdn@example.com");
  // the old address still works
  await open(page, "/teams");
  await expect(page.locator(".cat-item").first()).toBeVisible();

  // into the group's page, and its back link returns to that tab and entry
  await open(page, "/teams/platforms/google-cloud");
  await expect(page.locator(".cat-detail .rank-mark")).toHaveText("You are an owner");
  await page.locator(".cat-detail").getByRole("link", { name: "Open the page of Google Cloud" }).click();
  await expect(page).toHaveURL(/#\/platform\/google-cloud$/);
  await page.locator("a.back").click();
  await expect(page).toHaveURL(/#\/teams\/platforms\/google-cloud$/);
  await expect(tabs.getByRole("tab", { name: /^Platforms/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cat-detail h2")).toHaveText("Google Cloud");

  // a reader has no marks and no "yours"
  await signIn(page, SAM);
  await open(page, "/teams");
  await expect(page.locator(".cat-item").first()).toBeVisible();
  await expect(page.locator(".tab-yours")).toHaveCount(0);
  await expect(page.locator(".cat-item .rank-mark")).toHaveCount(0);
});

test("the head of a process links its team, platform and practice to their pages", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  await page.getByRole("link", { name: "Cloud Platform team" }).first().click();
  await expect(page).toHaveURL(/#\/team\/cloud-platform-team$/);
  await open(page, "/p/request-gcp-project/flow");
  await page.getByRole("link", { name: "Google Cloud", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/platform\/google-cloud$/);
});

test("a member starts a new process from the group's page, placed there", async ({ page }) => {
  await signIn(page, MORGAN);
  await open(page, `/platform/${GC}`);
  await docs(page).getByRole("button", { name: "New process" }).click();
  const dialog = page.getByRole("dialog", { name: "New process" });
  await expect(dialog.getByLabel("It belongs to")).toHaveValue(/google-cloud/);
  await expect(dialog).toContainText("An owner of the platform or practice publishes it.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  // the API refuses what the dialog would not offer: a document of another platform
  const gcp = (await readProcess(page, "request-gcp-project"))!;
  const res = await putDoc(page, "process", "morgans-azure", { ...gcp, id: "morgans-azure", platform: "azure", practice: undefined, status: "draft" });
  expect(res.status()).toBe(403);
});
