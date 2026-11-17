import { expect, test, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, JORDAN, open, putDoc, readCatalog, readProcess, SAM, save, signIn } from "./helpers";

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

const tab = (page: Page, name: string) => page.locator(".cat-tabs").getByRole("tab", { name: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => page.locator(".cat-item", { hasText: name });

test("an admin adds a platform, a practice and a category, uses them, and can remove them only when nothing uses them", async ({ page }) => {
  test.setTimeout(90_000);
  await copy(page, "lists-demo", "Lists demo");
    await signIn(page, DANA, { editor: true });
    await open(page, "/admin/lists");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await tab(page, list).click();
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
    await open(page, "/p/lists-demo/flow");
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const modal = page.locator(".modal");
    await modal.getByLabel(/^Category/).selectOption({ label: "Containers" });
    await modal.getByLabel(/^Platform/).selectOption({ label: "Kubernetes" });
    await modal.getByLabel(/^Practice/).selectOption({ label: "Data" });
    await modal.getByRole("button", { name: "Done" }).click();
    await save(page);
    expect((await readProcess(page, "lists-demo"))!).toMatchObject({ category: "containers", platform: "kubernetes", practice: "data" });

    // while it is used, none of them can be removed
    await open(page, "/admin/lists");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await tab(page, list).click();
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
    await signIn(page, DANA, { editor: true });
    await open(page, "/admin/lists");
    for (const [list, noun, name] of [["Platforms", "platform", "Kubernetes"], ["Practices", "practice", "Data"], ["Categories", "category", "Containers"]]) {
      await tab(page, list).click();
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

test("an admin makes somebody a member of a platform and of a practice, and takes it back", async ({ page }) => {
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await tab(page, "Platforms").click();
  await item(page, "Azure").click();
  const members = page.locator(".cat-members");
  await expect(members).toContainText("Nobody yet. Until somebody is added, only the editors can change what belongs to this platform.");
  await members.getByLabel("Email of the new member").fill(SAM);
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: SAM })).toContainText("Platform owner");

  // Sam can now change what belongs to Azure, and only that
  await signIn(page, SAM, { editor: true });
  await open(page, "/p/request-azure-landing-zone/flow");
  await expect(page.locator(".mode-switch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Details", exact: true })).toBeVisible();
  await open(page, "/p/request-gcp-project/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);

  // a practice works the same way
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await tab(page, "Practices").click();
  await item(page, "Service management").click();
  await members.getByLabel("Email of the new member").fill(SAM);
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: SAM })).toContainText("Practice owner");
  await signIn(page, SAM, { editor: true });
  await open(page, "/p/raise-servicenow-request/flow");
  await expect(page.getByRole("button", { name: "Details", exact: true })).toBeVisible();

  // taking it away again: the editing controls go with it
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await tab(page, "Practices").click();
  await item(page, "Service management").click();
  await members.getByRole("button", { name: `Remove ${SAM} as Practice owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: SAM })).toHaveCount(0);
  await tab(page, "Platforms").click();
  await item(page, "Azure").click();
  await members.getByRole("button", { name: `Remove ${SAM} as Platform owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: SAM })).toHaveCount(0);

  await signIn(page, SAM, { editor: true });
  await open(page, "/p/request-azure-landing-zone/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
});

test("everyone sees who the members of a platform, a practice and a team are", async ({ page }) => {
  await signIn(page, SAM);
  expect((await page.request.get("/api/members")).ok()).toBeTruthy();
  await open(page, "/catalog");
  const members = page.locator(".cat-members");
  const check = async (list: string, name: string, people: [string, string][]) => {
    await tab(page, list).click();
    await item(page, name).click();
    await expect(page.locator(".cat-detail h2")).toHaveText(name);
    await expect(members.locator("li")).toHaveCount(people.length);
    for (const [email, role] of people) await expect(members.locator("li", { hasText: email })).toContainText(role);
  };
  await check("Platforms", "Google Cloud", [[JORDAN, "Platform owner"]]);
  await check("Practices", "Engineering", [[JORDAN, "Practice owner"]]);
  await check("Practices", "Cyber security", [["riley@example.com", "Practice owner"]]);
  await check("Teams", "Cloud Platform team", [["casey@example.com", "Owner"], [JORDAN, "Owner"]]);
  await expect(members).toContainText("A member is Owner of this team");
  // reading only: nothing to add or remove
  await expect(members.getByLabel("Email of the new member")).toHaveCount(0);
  await expect(members.getByRole("button")).toHaveCount(0);
  await tab(page, "Platforms").click();
  await item(page, "Azure").click();
  await expect(members).toContainText("Nobody yet.");
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

test("Details: an editor says what a process belongs to and how binding it is; readers see it by name", async ({ page }) => {
  test.setTimeout(60_000);
  await copy(page, "details-demo", "Details demo");
    await signIn(page, ALEX, { editor: true });
    await open(page, "/p/details-demo/flow");
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const modal = page.locator(".modal");
    await expect(modal.getByRole("heading", { name: /What it belongs to/ })).toBeVisible();
    const binding = modal.getByRole("group", { name: "How binding" });
    await expect(binding.getByRole("button")).toHaveText(["Not stated", "Mandatory", "Recommended", "Optional"]);
    await expect(binding.getByRole("button", { name: "Not stated" })).toHaveAttribute("aria-pressed", "true");
    await modal.getByLabel(/^Category/).selectOption({ label: "Network" });
    await modal.getByLabel(/^Platform/).selectOption({ label: "Akamai" });
    await modal.getByLabel(/^Practice/).selectOption({ label: "Service management" });
    await binding.getByRole("button", { name: "Recommended" }).click();
    await modal.getByRole("button", { name: "Done" }).click();
    await save(page);
    expect((await readProcess(page, "details-demo"))!).toMatchObject({ category: "network", platform: "akamai", practice: "service-management", rigour: "recommended" });

    await page.getByRole("button", { name: "Details", exact: true }).click();
    await modal.getByLabel(/^Platform/).selectOption({ label: "Azure" });
    await binding.getByRole("button", { name: "Mandatory" }).click();
    await modal.getByRole("button", { name: "Done" }).click();
    await save(page);

    // the versions say what changed in words, with the names
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
    await expect(page.locator(".eyebrow").first()).toHaveText("Network · owned by Cloud Platform team");
    const facts = page.locator(".facts");
    for (const name of ["Mandatory", "Azure", "Service management"]) await expect(facts).toContainText(name);
    await expect(facts).not.toContainText("service-management");
    await open(page, "/processes");
    const card = page.locator(".card", { hasText: "Details demo" });
    await expect(card.locator(".card-cat")).toHaveText("Network");
    for (const name of ["Mandatory", "Azure", "Service management"]) await expect(card.locator(".card-tags")).toContainText(name);
    await page.locator(".filters .chip", { hasText: "Network" }).click();
    await expect(page.locator(".card", { hasText: "Details demo" })).toBeVisible();
    await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);
    await page.locator(".filters .chip", { hasText: "All" }).click();

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
  await expect(page.locator(".filters .chip").last()).toContainText("Other"); // the place for what has no category comes last
  await page.locator(".filters .chip", { hasText: "Other" }).click();
  await expect(card).toBeVisible();
  await expect(page.locator(".card", { hasText: "Request a GCP project" })).toHaveCount(0);
  for (const cat of await page.locator(".card .card-cat").allInnerTexts()) expect(cat.toLowerCase()).toBe("other");
  await page.locator(".filters .chip", { hasText: "All" }).click();
});

test("a platform that still has members is not removed: the admin is told who they are", async ({ page }) => {
  await signIn(page, DANA, { editor: true });
  await open(page, "/admin/lists");
  await tab(page, "Platforms").click();
  await page.getByRole("button", { name: "New platform" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Mainframe");
  await page.keyboard.press("Enter");
  await save(page);
  const members = page.locator(".cat-members");
  await members.getByLabel("Email of the new member").fill(SAM);
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: SAM })).toBeVisible();

  // nothing belongs to it, but somebody does: removing it is refused when the lists are saved
  await expect(page.locator(".cat-usage")).toContainText("nothing yet");
  await page.getByRole("button", { name: "Remove this platform" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast", { hasText: "The lists could not be saved." })).toContainText("the roles of sam@example.com");
  expect((await readCatalog(page)).platforms.map((p: { id: string }) => p.id)).toContain("mainframe");
  // the message stays until it is closed, over the bottom of the page where Save and Discard are
  await page.locator(".toast", { hasText: "The lists could not be saved." }).getByRole("button", { name: "Close this message" }).click();
  await page.getByRole("button", { name: "Discard" }).click();

  // without its member it goes
  await item(page, "Mainframe").click();
  await members.getByRole("button", { name: `Remove ${SAM} as Platform owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: SAM })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove this platform" }).click();
  await save(page);
  expect((await readCatalog(page)).platforms.map((p: { id: string }) => p.id)).not.toContain("mainframe");
});
