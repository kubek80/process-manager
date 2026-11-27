import { expect, test, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, fields, JORDAN, more, open, openEditor, outline, pickFilter, publish, putDoc, readCatalog, readProcess, SAM, save, signIn, unfold } from "./helpers";

// Categories, practices and platforms are lists of their own, next to the teams. A platform's
// and a practice's members are their owners, who may change what belongs to them; everyone can
// see who they are.

/** A copy of the GCP process that belongs to nothing yet, made by a process editor. */
async function copy(page: Page, id: string, title: string) {
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const src = (await readProcess(page, "request-gcp-project"))!;
  const { category: _c, platform: _p, practice: _r, rigour: _g, ...rest } = src;
  const res = await page.request.put(`/api/processes/${id}?base=0`, { data: { ...rest, id, title, status: "active" }, headers: CSRF });
  expect(res.ok(), `create ${id}`).toBeTruthy();
}
async function remove(page: Page, id: string) {
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  await page.request.delete(`/api/processes/${id}`, { headers: CSRF });
}

// the copies these tests make are removed afterwards, whatever happened: other tests count what there is
const COPIES = ["lists-demo", "details-demo", "other-demo"];
// and Sam, who is made a member here, is a plain reader again
test.afterEach(async ({ request }) => {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  for (const id of COPIES) await request.delete(`/api/processes/${id}`, { headers: CSRF });
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const { assignments } = await (await request.get("/api/admin/access")).json();
  for (const a of assignments.filter((x: { email: string }) => x.email === SAM)) await request.delete("/api/admin/access", { data: { email: a.email, role: a.role, scope: a.scope }, headers: CSRF });
});

const tab = (page: Page, name: string) => page.locator(".cat-kinds").getByRole("tab", { name: new RegExp(`^${name}`) });
/** The lists of the place Tools; the others are in Teams. */
const IN_TOOLS = ["Tools", "Categories", "Architecture patterns", "Application tiers", "Paths", "Environments", "Languages"];
/** Opens a list's tab, going first to its place (Admin's side menu, or the top bar for readers) when the page shows the other. */
async function openTab(page: Page, name: string) {
  await expect(page.locator(".cat-kinds-groups")).toBeVisible();
  if (!(await tab(page, name).count())) {
    const place = IN_TOOLS.includes(name) ? "Tools" : "Teams";
    const admin = page.locator(".admin-nav");
    if (await admin.count()) await admin.getByRole("link", { name: place, exact: true }).click();
    else await open(page, place === "Tools" ? "/tools" : "/teams");
  }
  await tab(page, name).click();
}
const item = (page: Page, name: string) => page.locator(".cat-item", { hasText: name });

test("an admin adds a platform, a practice and a category, uses them, and can remove them only when nothing uses them", async ({ page }) => {
  test.setTimeout(90_000);
  await copy(page, "lists-demo", "Lists demo");
    await signIn(page, DANA);
    await open(page, "/admin/teams");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await openTab(page, list);
      await page.getByRole("button", { name: `New ${noun}` }).click();
      await page.locator(".cat-new").getByLabel("Name").fill(name);
      await page.keyboard.press("Enter");
      await expect(page.locator(".cat-detail").getByRole("heading", { name })).toBeVisible();
      await expect(item(page, name)).toContainText("new");
    }
    await page.locator(".cat-detail").getByLabel("What belongs here").fill("Running containers");
    await save(page);
    const catalog = await readCatalog(page);
    expect(catalog.platforms).toContainEqual({ id: "kubernetes", name: "Kubernetes" });
    expect(catalog.practices).toContainEqual({ id: "data", name: "Data" });
    expect(catalog.categories).toContainEqual({ id: "containers", name: "Containers", description: "Running containers" });

    // the new entries can be picked in a process at once
    await openEditor(page, "process", "lists-demo");
    await outline(page, "About");
    const about = fields(page);
    await unfold(page, "What it belongs to");
    await about.getByLabel(/^Category/).selectOption({ label: "Containers" });
    await about.getByLabel(/^Platform/).selectOption({ label: "Kubernetes" });
    await about.getByLabel(/^Practice/).selectOption({ label: "Data" });
    await publish(page);
    expect((await readProcess(page, "lists-demo"))!).toMatchObject({ category: "containers", platform: "kubernetes", practice: "data" });

    // while it is used, none of them can be removed
    await open(page, "/admin/teams");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await openTab(page, list);
      await item(page, name).click();
      await expect(page.locator(".cat-usage")).toContainText("Lists demo");
      await expect(page.getByRole("button", { name: `Remove this ${noun}` })).toBeDisabled();
      await expect(page.locator(".cat-danger")).toContainText("Still used by");
    }
    // and the server says the same to somebody who tries anyway
    const got = await page.request.get("/api/catalog");
    const lists = await got.json();
    const refused = await page.request.put(`/api/catalog?base=${got.headers()["x-document-version"]}`, { data: { ...lists, platforms: lists.platforms.filter((p: { id: string }) => p.id !== "kubernetes") }, headers: CSRF });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain("“kubernetes” is still used by “Lists demo”");

    // once nothing uses them, they go
    await remove(page, "lists-demo");
    await signIn(page, DANA);
    await open(page, "/admin/teams");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await openTab(page, list);
      await item(page, name).click();
      await expect(page.locator(".cat-usage")).toContainText("nothing yet");
      await page.getByRole("button", { name: `Remove this ${noun}` }).click();
      await expect(item(page, name)).toHaveCount(0);
    }
    await save(page);
    const after = await readCatalog(page);
    expect(after.platforms.map((p: { id: string }) => p.id)).not.toContain("kubernetes");
    expect(after.practices.map((p: { id: string }) => p.id)).not.toContain("data");
    expect(after.categories.map((p: { id: string }) => p.id)).not.toContain("containers");
});

test("an admin makes somebody an owner of a platform and of a practice, and takes it back", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await openTab(page, "Platforms");
  await item(page, "Azure").click();
  const owners = page.locator('.cat-members[data-rank="owner"]');
  await expect(owners).toContainText("Nobody yet. Until somebody is added, only the editors can publish what belongs to this platform.");
  await owners.getByLabel("Email of the new owner").fill(SAM);
  await owners.getByRole("button", { name: "Add owner" }).click();
  await expect(owners.getByRole("button", { name: `Remove ${SAM} as Platform owner` })).toBeVisible();
  await expect(page.locator(".toast", { hasText: "Sam Consumer is now a Platform owner of Azure." })).toBeVisible();

  // Sam can now change what belongs to Azure, and only that
  await signIn(page, SAM);
  await open(page, "/p/request-azure-landing-zone/flow");
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  // and the server agrees: the editing screen of the GCP process tells him so
  await open(page, "/p/request-gcp-project/edit");
  await expect(page.getByText("You may not change this process.")).toBeVisible();

  // a practice works the same way
  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await openTab(page, "Practices");
  await item(page, "Service management").click();
  await owners.getByLabel("Email of the new owner").fill(SAM);
  await owners.getByRole("button", { name: "Add owner" }).click();
  await expect(owners.getByRole("button", { name: `Remove ${SAM} as Practice owner` })).toBeVisible();
  await signIn(page, SAM);
  await open(page, "/p/raise-servicenow-request/flow");
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();

  // taking it away again: the editing controls go with it
  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await openTab(page, "Practices");
  await item(page, "Service management").click();
  await owners.getByRole("button", { name: `Remove ${SAM} as Practice owner` }).click();
  await page.getByRole("dialog", { name: "Remove this owner?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(owners.locator("li", { hasText: "Sam Consumer" })).toHaveCount(0);
  await openTab(page, "Platforms");
  await item(page, "Azure").click();
  await owners.getByRole("button", { name: `Remove ${SAM} as Platform owner` }).click();
  await page.getByRole("dialog", { name: "Remove this owner?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(owners.locator("li", { hasText: "Sam Consumer" })).toHaveCount(0);

  await signIn(page, SAM);
  await open(page, "/p/request-azure-landing-zone/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
});

test("everyone sees who the members of a platform, a practice and a team are", async ({ page }) => {
  await signIn(page, SAM);
  expect((await page.request.get("/api/members")).ok()).toBeTruthy();
  await open(page, "/teams");
  const members = page.locator(".cat-members");
  const check = async (list: string, name: string, owners: string[], drafters: string[] = []) => {
    await openTab(page, list);
    await item(page, name).click();
    await expect(page.locator(".cat-detail h2")).toHaveText(name);
    // by name, each a mail link; the role is said once, by the heading and its sentence, not on every person
    for (const [rank, people] of [["owner", owners], ["member", drafters]] as const) {
      const block = page.locator(`.cat-people .cat-members[data-rank="${rank}"]`);
      if (!people.length && rank === "member") { await expect(block).toHaveCount(0); continue; }
      await expect(block.locator("li")).toHaveCount(people.length);
      for (const who of people) await expect(block.locator("li", { hasText: who }).locator("a.person-link")).toHaveText(who);
    }
  };
  await check("Platforms", "Google Cloud", ["Jordan Platform"], ["Morgan Member"]);
  await expect(page.locator('.cat-members[data-rank="owner"]')).toContainText("Owners decide what is published here.");
  await expect(page.locator('.cat-members[data-rank="member"]')).toContainText("Members write drafts for the owners.");
  await check("Practices", "Engineering", ["Jordan Platform"], ["Morgan Member"]);
  await check("Practices", "Cyber security", ["Riley Security"]);
  await check("Teams", "Cloud Platform team", ["Casey Owner", "Jordan Platform"]);
  await expect(members).toContainText("Owners review what this team looks after and answer its feedback.");
  // reading only: nothing to add or remove
  await expect(members.getByLabel("Email of the new member")).toHaveCount(0);
  await expect(members.getByRole("button")).toHaveCount(0);
  await expect(members.getByRole("textbox")).toHaveCount(0);
  await openTab(page, "Platforms");
  await item(page, "Azure").click();
  // no owner: one line, which points at the ways to reach them; no Members block when there are none
  await expect(members).toHaveText(["No owner yet."]);
  await expect(page.locator(".cat-usage")).toContainText("Request an Azure landing zone");
});

test("My responsibilities lists what belongs to his platform, his practice and his team", async ({ page }) => {
  await signIn(page, JORDAN);
  await open(page, "/");
  await page.getByRole("link", { name: /My responsibilities/ }).click();
  await expect(page.locator(".mine-head")).toContainText("your teams, platforms and practices");
  const chips = page.getByRole("group", { name: "Show what belongs to" }).getByRole("button");
  await expect(chips).toHaveText(["All of mine", "Cloud Platform team", "Google Cloud", "Engineering"]);
  await expect(chips.nth(1).getByLabel("Team")).toBeVisible();
  await expect(chips.nth(2).getByLabel("Platform")).toBeVisible();
  await expect(chips.nth(3).getByLabel("Practice")).toBeVisible();

  const all = page.getByRole("region", { name: /Everything that is yours/ });
  const row = (title: string) => all.locator("tbody tr", { hasText: title });
  await expect(row("Request a GCP project")).toContainText("Google Cloud");
  await expect(row("Request a GCP project")).toContainText("Cloud Platform team");
  await expect(row("Infrastructure as code")).toContainText("Engineering");
  await expect(row("Code review")).toContainText("Engineering");
  await expect(row("Publish an internal library")).toContainText("Engineering");
  await expect(row("Request an Azure landing zone")).toHaveCount(0);
  await expect(row("Secure logging")).toHaveCount(0);

  // one group at a time
  await chips.filter({ hasText: "Engineering" }).click();
  await expect(chips.filter({ hasText: "Engineering" })).toHaveAttribute("aria-pressed", "true");
  await expect(row("Code review")).toBeVisible();
  await expect(row("Request a GCP project")).toHaveCount(0);
  await chips.filter({ hasText: "Google Cloud" }).click();
  await expect(row("Request a GCP project")).toBeVisible();
  await expect(row("Infrastructure as code")).toBeVisible();
  await expect(row("Code review")).toHaveCount(0);
});

test("About: an editor says what a process belongs to and its rigour; readers see it by name", async ({ page }) => {
  test.setTimeout(60_000);
  await copy(page, "details-demo", "Details demo");
    await signIn(page, ALEX);
    await openEditor(page, "process", "details-demo");
    await outline(page, "About");
    const modal = fields(page);
    await expect(modal.getByRole("heading", { name: /What it belongs to/ })).toBeVisible();
    await unfold(page, "What it belongs to"); // folded, with a one-line summary of what is set
    const binding = modal.getByRole("group", { name: "Rigour" });
    await expect(modal.locator(".field", { has: page.getByRole("group", { name: "Rigour" }) }).locator(".field-label")).toHaveText(/^Rigourhow binding it is/);
    await expect(binding.getByRole("button")).toHaveText(["Not stated", "Mandatory", "Recommended", "Optional"]);
    await expect(binding.getByRole("button", { name: "Not stated" })).toHaveAttribute("aria-pressed", "true");
    await modal.getByLabel(/^Category/).selectOption({ label: "Network" });
    await modal.getByLabel(/^Platform/).selectOption({ label: "Akamai" });
    await modal.getByLabel(/^Practice/).selectOption({ label: "Service management" });
    await binding.getByRole("button", { name: "Recommended" }).click();
    await publish(page);
    expect((await readProcess(page, "details-demo"))!).toMatchObject({ category: "network", platform: "akamai", practice: "service-management", rigour: "recommended" });

    await outline(page, "About");
    await unfold(page, "What it belongs to");
    await modal.getByLabel(/^Platform/).selectOption({ label: "Azure" });
    await binding.getByRole("button", { name: "Mandatory" }).click();
    // Publish… says what changed before it is published
    await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
    const publishing = page.getByRole("dialog", { name: "Publish your changes" });
    await expect(publishing).toContainText("Platform changed from “Akamai” to “Azure”");
    await expect(publishing).toContainText("Rigour changed from “Recommended” to “Mandatory”");
    await publishing.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator(".eb-state")).toHaveAttribute("aria-label", /^Published\./);

    // the versions say what changed in words, with the names
    await page.locator(".edit-bar").getByRole("button", { name: "Back to reading" }).click();
    await page.getByRole("button", { name: /^Version \d+$/ }).click();
    const versions = page.getByRole("dialog", { name: /Versions of/ });
    await versions.locator("li").nth(0).getByRole("button", { name: "What changed" }).click();
    await expect(versions.locator(".history-detail")).toContainText("Platform changed from “Akamai” to “Azure”");
    await expect(versions.locator(".history-detail")).toContainText("Rigour changed from “Recommended” to “Mandatory”");
    await versions.locator("li").nth(0).getByRole("button", { name: "What changed" }).click();
    await versions.locator("li").nth(1).getByRole("button", { name: "What changed" }).click();
    const detail = versions.locator(".history-detail");
    for (const said of ["Category set to “Network”", "Platform set to “Akamai”", "Practice set to “Service management”", "Rigour set to “Recommended”"]) await expect(detail).toContainText(said);
    await versions.locator(".modal-foot").getByRole("button", { name: "Close" }).click();

    // a reader sees names, never ids: on the page and in the library
    await signIn(page, SAM);
    await open(page, "/p/details-demo/flow");
    await expect(page.locator("header.doc-head .doc-owner")).toHaveText("Network · Owned by Cloud Platform team");
    const facts = page.locator("header.doc-head");
    for (const name of ["Mandatory", "Azure", "Service management"]) await expect(facts).toContainText(name);
    await expect(facts).not.toContainText("service-management");
    await open(page, "/processes");
    const card = page.locator(".card", { hasText: "Details demo" });
    await expect(card.locator(".card-cat")).toHaveText("Network");
    await expect(card.locator('[data-line="platform"]')).toHaveText("Platform:Azure");
    await expect(card.locator('[data-line="practice"]')).toHaveText("Practice:Service management");
    await expect(card.locator('[data-line="rigour"]')).toContainText("Mandatory");
    await expect(card.locator(".card-facts")).not.toContainText("service-management");
    await pickFilter(page, "Category", "Network");
    await expect(page.locator(".card", { hasText: "Details demo" })).toBeVisible();
    await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.locator(".card", { hasText: "Request a GCP project" })).toBeVisible();

    // an id that is not in its list is refused, with the ones that are
    await signIn(page, ALEX);
    const doc = (await readProcess(page, "details-demo"))!;
    for (const [field, value, said] of [
      ["platform", "mars", "platform: \"mars\" is not a known platform. Known platforms: "],
      ["practice", "astrology", "practice: \"astrology\" is not a known practice. Known practices: "],
      ["category", "misc", "category: \"misc\" is not a known category. Known categories: "],
      ["rigour", "compulsory", "rigour"],
    ]) {
      const res = await putDoc(page, "process", "details-demo", { ...doc, [field]: value });
      expect(res.status(), `${field}: ${value}`).toBe(400);
      expect((await res.json()).error).toContain(said);
    }
    const res = await putDoc(page, "process", "details-demo", { ...doc, platform: "mars" });
    const message = (await res.json()).error as string;
    for (const id of ["google-cloud", "azure", "apigee", "akamai", "github", "servicenow"]) expect(message).toContain(id);
});

test("a process without a category is listed under Other", async ({ page }) => {
  await copy(page, "other-demo", "Other demo");
  await signIn(page, SAM);
  await open(page, "/processes");
  const card = page.locator(".card", { hasText: "Other demo" });
  await expect(card.locator(".card-cat")).toHaveText("Other");
  await page.getByRole("button", { name: /^Category:/ }).click();
  // the place for what has no category comes last
  await expect(page.getByRole("group", { name: "Category", exact: true }).locator(".filter-option-name").last()).toHaveText("Other");
  await page.getByRole("button", { name: /^Category:/ }).click();
  await pickFilter(page, "Category", "Other");
  await expect(card).toBeVisible();
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);
  for (const cat of await page.locator(".card .card-cat").allInnerTexts()) expect(cat.toLowerCase()).toBe("other");
  await page.getByRole("button", { name: "Clear all filters" }).click();
});

test("a platform that still has members cannot be removed until they are gone", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await openTab(page, "Platforms");
  await page.getByRole("button", { name: "New platform" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Mainframe");
  await page.keyboard.press("Enter");
  await save(page);
  const members = page.locator('.cat-members[data-rank="member"]');
  await members.getByLabel("Email of the new member").fill(SAM);
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: "Sam Consumer" })).toBeVisible();

  // nothing belongs to it, but somebody does: it is not safe to remove
  await expect(page.locator(".cat-usage")).toContainText("nothing yet");
  await expect(page.getByRole("button", { name: "Remove this platform" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("1 person is still one of its owners or members. Take their roles first, then it can be removed.");
  // the server refuses it too, in words
  const lists = await readCatalog(page);
  const version = Number((await page.request.get("/api/catalog")).headers()["x-document-version"]);
  const refused = await page.request.put(`/api/catalog?base=${version}`, { data: { ...lists, platforms: lists.platforms.filter((p: { id: string }) => p.id !== "mainframe") }, headers: CSRF });
  expect(refused.ok()).toBeFalsy();
  expect((await refused.json()).error).toBe("cannot remove what is still in use: 1 person is still one of the owners or members of “mainframe” (sam@example.com). Take their roles first, then it can be removed.");

  // a lists manager who is not an admin sees the same, from the members everyone may read
  await signIn(page, ALEX);
  await open(page, "/admin/teams");
  await openTab(page, "Platforms");
  await item(page, "Mainframe").click();
  await expect(members.locator("li", { hasText: "Sam Consumer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove this platform" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("1 person is still one of its owners or members");

  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await openTab(page, "Platforms");
  // without its member it goes
  await item(page, "Mainframe").click();
  await members.getByRole("button", { name: `Remove ${SAM} as Platform member` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: "Sam Consumer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove this platform" }).click();
  await save(page);
  expect((await readCatalog(page)).platforms.map((p: { id: string }) => p.id)).not.toContain("mainframe");
});

for (const [width, theme] of [[1440, "light"], [390, "dark"]] as const) {
  test(`a message about a failed save never covers Save and Discard (${width} wide, ${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, DANA);
    await page.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, theme);
    await open(page, "/admin/teams");
    await item(page, "DNS team").click();
    await page.locator(".cat-detail").getByLabel("What they do").fill("Changed for a test that is not saved.");
    // the server refuses the save, with a long message
    await page.route("**/api/catalog?*", (route) => (route.request().method() === "PUT"
      ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Refused for this test. ".repeat(6) }) })
      : route.continue()));
    await page.getByRole("button", { name: "Save changes" }).click();
    const toast = page.locator(".toast", { hasText: "The lists could not be saved." });
    await expect(toast).toBeVisible();
    const bar = page.locator(".cat-toolbar.with-save.dirty");
    await expect(bar).toBeInViewport();
    const [t, b] = [(await toast.boundingBox())!, (await bar.boundingBox())!];
    // the message and the save bar (under the top bar) do not overlap
    const apart = t.y >= b.y + b.height - 1 || t.y + t.height <= b.y + 1 || t.x >= b.x + b.width - 1 || t.x + t.width <= b.x + 1;
    expect(apart, `message ${JSON.stringify(t)} and save bar ${JSON.stringify(b)}`).toBe(true);
    // Discard can be pressed without closing the message first (a covered button fails this click)
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(bar).toHaveCount(0);
    await expect(toast).toBeVisible();
  });
}

// ---------- problems of the lists, in words

/** What is focused right now, as the lists' problems leave it. */
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return { id: el?.id ?? "", field: el?.dataset.field ?? "", invalid: el?.getAttribute("aria-invalid") ?? "", says: el?.getAttribute("aria-description") ?? "" };
});

/** A field without its length limit (as text pasted from elsewhere, or lists imported), then filled. */
async function fillUnlimited(page: Page, selector: string, text: string) {
  const field = page.locator(".cat-detail").locator(selector);
  await field.evaluate((e) => e.removeAttribute("maxlength"));
  await field.fill(text);
}

for (const who of [DANA, ALEX]) {
  test(`broken lists say what to fix by name, and each problem leads to its field (${who.split("@")[0]})`, async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, who);
    await open(page, "/admin/teams");
    const panel = page.locator("section.issues-panel.cat-issues");
    await expect(item(page, "Cloud Platform team")).toBeVisible();
    await expect(panel).toHaveCount(0);

    // five problems at once, in three lists
    await item(page, "Cloud Platform team").click();
    await page.locator("#lists-team-email").fill("cloud-platform-at-company");
    await page.locator("#lists-team-slackUrl").fill("cloud-platform");
    await openTab(page, "Categories");
    await item(page, "Network").click();
    await fillUnlimited(page, '[data-field="description"]', "Everything about networks. ".repeat(10));
    await openTab(page, "Tools");
    await page.locator(".cat-item", { has: page.getByText("GitHub", { exact: true }) }).click();
    await page.locator('.cat-detail [data-field="url"]').fill("github");
    await item(page, "ServiceNow").click();
    await page.locator('.cat-detail [data-field="name"]').fill("");

    const team = "the team “Cloud Platform team”";
    const wanted: [string, string, string, (f: Awaited<ReturnType<typeof focused>>) => boolean][] = [
      [`The group email of ${team} is not an email address: write one, like team@company.com.`, "Teams", "Cloud Platform team", (f) => f.id === "lists-team-email"],
      [`The link to the Slack channel of ${team} is not a whole link: write it with https:// at the start.`, "Teams", "Cloud Platform team", (f) => f.id === "lists-team-slackUrl"],
      ["Shorten the description of the category “Network” to at most 200 characters.", "Categories", "Network", (f) => f.field === "description"],
      ["The link of the tool “GitHub” is not a whole link: write it with https:// at the start.", "Tools", "GitHub", (f) => f.field === "url"],
      ["Give the tool with the id “servicenow” a name.", "Tools", "Unnamed", (f) => f.field === "name"],
    ];
    await expect(panel.locator("h2#cat-issues-head")).toContainText("5 to fix");
    await expect(panel.locator("h2#cat-issues-head")).toContainText("The lists can be saved once these are fixed. Press one to go to it.");
    const list = panel.getByRole("list", { name: "What is to fix in the lists" });
    await expect(list.locator("li.error")).toHaveCount(5);
    const said = (await list.locator("li").allTextContents()).map((t) => t.trim());
    expect([...said].sort()).toEqual(wanted.map(([s]) => s).sort());
    // in words: never a path or a position in a list
    for (const s of said) expect(s).not.toMatch(/\/(teams|tools|categories|contacts)\/|\[\d+\]|\/\d+\//);
    // nothing can be saved meanwhile
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveAttribute("title", "Fix the problems first");

    // each one leads to its list, its entry and its field, which says the same
    await openTab(page, "Languages");
    for (const [sentence, listName, entry, isField] of wanted) {
      await list.locator("li", { hasText: sentence }).getByRole("button", { name: sentence }).click();
      await expect(tab(page, listName)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".cat-detail h2")).toHaveText(entry);
      await expect.poll(async () => isField(await focused(page)), { message: `the field of “${sentence}” is focused` }).toBe(true);
      expect(await focused(page)).toMatchObject({ invalid: "true", says: sentence });
      await expect(page.locator(".cat-detail [data-problem]", { has: page.locator(":focus") })).toHaveAttribute("data-problem", sentence);
    }
    await expect(list.locator("li button").first()).toHaveAttribute("title", "Go to it");

    // fixing one lowers the count
    await list.getByRole("button", { name: wanted[0][0] }).click();
    await expect.poll(async () => (await focused(page)).id).toBe("lists-team-email");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("cloud-platform@company.com");
    await expect(panel.locator("h2#cat-issues-head")).toContainText("4 to fix");
    await expect(list.locator("li")).toHaveCount(4);
    await expect(page.locator("#lists-team-email")).not.toHaveAttribute("aria-invalid", "true");

    // Discard: nothing left to fix
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(panel).toHaveCount(0);
    expect((await readCatalog(page)).tools.find((t: { id: string }) => t.id === "servicenow").name).toBe("ServiceNow");
  });
}

test("a save the server refuses reads as the same sentences; a reader of Teams sees no problems", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/teams");
  await item(page, "DNS team").click();
  await page.locator(".cat-detail").getByLabel("What they do").fill("Changed for a test that is refused.");
  // the lists as the app sends them, broken on the way: only the server finds it. The server
  // checks the format first (the group email), then its own rules (two tools with one id).
  let breakIt: (lists: Record<string, any>) => void = () => {};
  await page.route("**/api/catalog?*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const lists = route.request().postDataJSON();
    breakIt(lists);
    return route.continue({ postData: JSON.stringify(lists) });
  });
  const toast = page.locator(".toast", { hasText: "The lists could not be saved." });
  for (const [broken, sentence] of [
    [(l: Record<string, any>) => { l.teams = l.teams.map((t: { id: string; contacts?: object }) => (t.id === "dns-team" ? { ...t, contacts: { ...t.contacts, email: "not an address" } } : t)); },
      "The group email of the team “DNS team” is not an email address: write one, like team@company.com."],
    [(l: Record<string, any>) => { l.tools = [...l.tools, { id: "terraform", name: "Terraform Cloud" }]; },
      "Two tools have the id “terraform” (“Terraform” and “Terraform Cloud”): remove one of them."],
  ] as const) {
    breakIt = broken;
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(sentence);
    const said = (await toast.textContent()) ?? "";
    for (const raw of ["tools[", "/tools/", "/teams/", "pattern", "does not match"]) expect(said).not.toContain(raw);
    await toast.getByRole("button", { name: "Close this message" }).click();
    await expect(toast).toHaveCount(0);
  }
  await page.unroute("**/api/catalog?*");
  await page.getByRole("button", { name: "Discard" }).click();
  expect((await readCatalog(page)).teams.find((t: { id: string }) => t.id === "dns-team").description ?? "").not.toContain("refused");

  // the server refuses broken lists sent straight to it as well (in its own terms: the app words them)
  const lists = await readCatalog(page);
  const version = Number((await page.request.get("/api/catalog")).headers()["x-document-version"]);
  const broken = { ...lists, teams: lists.teams.map((t: { id: string; contacts?: object }) => (t.id === "dns-team" ? { ...t, contacts: { ...t.contacts, email: "not an address" } } : t)) };
  const refused = await page.request.put(`/api/catalog?base=${version}`, { data: broken, headers: CSRF });
  expect(refused.status()).toBe(400);

  // the reader's Teams changes nothing, so it shows no problems, even of lists stored broken
  await signIn(page, SAM);
  await page.route("**/api/catalog", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.teams = body.teams.map((t: { id: string }) => (t.id === "dns-team" ? { ...t, name: "", contacts: { email: "not an address" } } : t));
    await route.fulfill({ response: res, json: body });
  });
  await open(page, "/teams");
  await expect(page.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();
  await expect(item(page, "Cloud Platform team")).toBeVisible();
  await expect(page.locator(".cat-issues, .issues-panel")).toHaveCount(0);
});

test("the problems of the lists on a phone in dark: no sideways scroll, readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ALEX);
  await page.addInitScript(() => { try { localStorage.setItem("pm:theme", "dark"); } catch { /* ignore */ } });
  await open(page, "/admin/teams");
  await item(page, "Cloud Platform team").click();
  await page.locator("#lists-team-slackUrl").fill("a channel without a link");
  await page.locator(".cat-detail").getByLabel("Name", { exact: true }).fill("");
  const panel = page.locator("section.cat-issues");
  await expect(panel.locator("h2")).toContainText("2 to fix");
  await expect(panel.locator("li")).toHaveText([
    "Give the team with the id “cloud-platform-team” a name.",
    "The link to the Slack channel of the team with the id “cloud-platform-team” is not a whole link: remove the spaces and write it with https:// at the start.",
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const box of await panel.locator("li button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())))
    expect(box.right).toBeLessThanOrEqual(390);
  // light words on a dark panel
  const [ink, ground] = await panel.locator("li button .issue-words").first().evaluate((e) => {
    const lum = (c: string) => { const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    let bg = "rgba(0, 0, 0, 0)", el: Element | null = e;
    while (el && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    return [lum(getComputedStyle(e).color), lum(bg)];
  });
  expect(ink - ground, "the words are lighter than the panel").toBeGreaterThan(90);
  // pressing one brings its field into view on the narrow screen
  await panel.getByRole("button", { name: /a name\.$/ }).click();
  await expect(page.locator('.cat-detail [data-field="name"]')).toBeFocused();
  await expect(page.locator('.cat-detail [data-field="name"]')).toBeInViewport();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(panel).toHaveCount(0);
});
