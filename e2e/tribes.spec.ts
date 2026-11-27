import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, open, openEditor, outline, readCatalog, save, signIn } from "./helpers";

// Pillars group teams, tribes group pillars and domains group tribes, all optional: three lists in
// Admin › Teams, a Pillar on a team, a Tribe on a pillar and a Domain on a tribe. The reader's list
// of teams groups them under their domain, tribe and pillar; a team's page says where it belongs;
// a pillar, a tribe and a domain have pages. Every test puts back what it changed.

const PILLAR = "checkout-demo", TRIBE = "payments-demo", DOMAIN = "customer-demo";
/** The reader's lists of teams, at a list and an entry. */
const teamsAt = (list = "", id = "") => `/teams${list ? `/${list}` : ""}${id ? `/${id}` : ""}`;
const teamsAddress = (list: string, id: string) => new RegExp(`#/teams/${list}/${id}$`);

async function as(request: APIRequestContext, email: string) {
  expect((await request.post("/auth/dev/login", { data: { email }, headers: CSRF })).ok()).toBeTruthy();
}
async function putLists(request: APIRequestContext, change: (c: Record<string, any>) => void) {
  await as(request, DANA);
  const res = await request.get("/api/catalog");
  const base = Number(res.headers()["x-document-version"]);
  const lists = await res.json();
  change(lists);
  return request.put(`/api/catalog?base=${base}`, { data: lists, headers: CSRF });
}
const tab = (page: Page, name: string) => page.locator(".cat-kinds").getByRole("tab", { name: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => page.locator(".cat-item", { hasText: name });
const detail = (page: Page) => page.locator(".cat-detail");
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.afterEach(async ({ request }) => {
  await as(request, DANA);
  const lists = await readCatalog(request);
  if (lists.teams.some((t: { pillar?: string }) => t.pillar === PILLAR) || lists.pillars.some((p: { id: string }) => p.id === PILLAR)
    || lists.tribes.some((t: { id: string }) => t.id === TRIBE) || lists.domains.some((d: { id: string }) => d.id === DOMAIN)) {
    const res = await putLists(request, (c) => {
      for (const t of c.teams) if (t.pillar === PILLAR) delete t.pillar;
      c.pillars = c.pillars.filter((p: { id: string }) => p.id !== PILLAR);
      c.tribes = c.tribes.filter((t: { id: string }) => t.id !== TRIBE);
      c.domains = c.domains.filter((d: { id: string }) => d.id !== DOMAIN);
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test("a domain, a tribe in it, a pillar in the tribe and a team in the pillar: made in Admin › Teams, grouped for readers, said on the team's page", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, ALEX);
  await open(page, "/admin/teams");
  await expect(page.getByRole("tablist", { name: "Teams and how they are grouped" }).getByRole("tab")).toHaveText([/^Teams/, /^Pillars/, /^Tribes/, /^Domains/]);

  // a domain, a tribe in it ("No domain" first), a pillar in the tribe ("No tribe" first)
  await tab(page, "Domains").click();
  await page.getByRole("button", { name: "New domain" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Customer demo");
  await page.keyboard.press("Enter");
  await detail(page).locator('[data-field="description"]').fill("Everything customers use to buy from us.");
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("No tribes in this domain yet");
  await tab(page, "Tribes").click();
  await page.getByRole("button", { name: "New tribe" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Payments demo");
  await page.keyboard.press("Enter");
  const domain = detail(page).getByLabel("Domain");
  await expect(domain.locator("option").first()).toHaveText("No domain");
  await domain.selectOption({ label: "Customer demo" });
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("No pillars in this tribe yet");
  await tab(page, "Pillars").click();
  await page.getByRole("button", { name: "New pillar" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Checkout demo");
  await page.keyboard.press("Enter");
  const tribe = detail(page).getByLabel("Tribe");
  await expect(tribe.locator("option").first()).toHaveText("No tribe");
  await tribe.selectOption({ label: "Payments demo" });
  // a team in the pillar: "No pillar" first; a team has no tribe of its own any more
  await tab(page, "Teams").click();
  await item(page, "Fulfilment team").click();
  const pillar = detail(page).getByLabel("Pillar");
  await expect(pillar).toHaveValue("");
  await expect(pillar.locator("option").first()).toHaveText("No pillar");
  await expect(detail(page).getByLabel("Tribe")).toHaveCount(0);
  await pillar.selectOption({ label: "Checkout demo" });
  await save(page);
  const lists = await readCatalog(page);
  expect(lists.domains).toContainEqual({ id: DOMAIN, name: "Customer demo", description: "Everything customers use to buy from us." });
  expect(lists.tribes).toContainEqual({ id: TRIBE, name: "Payments demo", domain: DOMAIN });
  expect(lists.pillars).toContainEqual({ id: PILLAR, name: "Checkout demo", tribe: TRIBE });
  expect(lists.teams.find((t: { id: string }) => t.id === "fulfilment-team")).toMatchObject({ pillar: PILLAR });

  // a pillar shows its teams, a tribe its pillars, a domain its tribes; one in use cannot be removed
  await tab(page, "Pillars").click();
  await item(page, "Checkout demo").click();
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("1 team in this pillar");
  await expect(detail(page).locator(".cat-inner li")).toHaveText(["Fulfilment team"]);
  await expect(page.getByRole("button", { name: "Remove this pillar" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still the pillar of 1 team. Take it out of it first, then it can be removed.");
  await tab(page, "Tribes").click();
  await item(page, "Payments demo").click();
  await expect(detail(page).locator(".cat-inner li")).toHaveText(["Checkout demo"]);
  await expect(page.getByRole("button", { name: "Remove this tribe" })).toBeDisabled();
  await detail(page).locator(".cat-inner").getByRole("button", { name: "Checkout demo" }).click();
  await expect(tab(page, "Pillars")).toHaveAttribute("aria-selected", "true");
  await tab(page, "Domains").click();
  await item(page, "Customer demo").click();
  await expect(detail(page).locator(".cat-inner li")).toHaveText(["Payments demo"]);
  await expect(page.getByRole("button", { name: "Remove this domain" })).toBeDisabled();
  // the server refuses all three, naming who is still in it
  for (const [list, id, who] of [["pillars", PILLAR, "the team “Fulfilment team”"], ["tribes", TRIBE, "the pillar “Checkout demo”"], ["domains", DOMAIN, "the tribe “Payments demo”"]]) {
    const gone = await putLists(page.request, (c) => { c[list] = c[list].filter((x: { id: string }) => x.id !== id); });
    expect(gone.status()).toBe(400);
    expect((await gone.json()).error).toBe(`cannot remove what is still in use: “${id}” is still used by ${who}. Change those first.`);
  }

  // readers: the teams under their domain, then each pillar with its tribe
  await signIn(page, SAM);
  await open(page, teamsAt("teams"));
  const list = page.locator(".cat-list");
  await expect(list.locator(".cat-section-domain")).toHaveText(["Customer demo (domain)", "Engineering enablement (domain)", "Platforms and infrastructure (domain)", "Not in a domain", "Not in a tribe"]);
  await expect(list.locator(".cat-section-name").first()).toHaveText("Payments demo (tribe) › Checkout demo (pillar)");
  await expect(list.locator(".cat-section-tribe", { hasText: "Checkout demo" }).locator(".cat-item strong")).toHaveText(["Fulfilment team"]);
  // the first team in that order is the one shown, and says where it belongs
  await expect(detail(page).getByRole("heading", { name: "Fulfilment team" })).toBeVisible();
  await expect(detail(page).locator(".cat-part-of")).toHaveText("Part of the pillar Checkout demo, in the tribe Payments demo, in the domain Customer demo");
  await expect(detail(page).locator(".cat-part-of").getByRole("link", { name: "Checkout demo" })).toHaveAttribute("href", `#/pillar/${PILLAR}`);
  await open(page, teamsAt("pillars", PILLAR));
  await expect(detail(page).locator(".cat-facts")).toContainText(/Tribe\s*Payments demo/);
  await expect(detail(page).locator(".cat-inner").getByRole("link", { name: "Fulfilment team" })).toHaveAttribute("href", "#/team/fulfilment-team");
  await expect(detail(page).getByRole("link", { name: "Open the page of Checkout demo" })).toHaveAttribute("href", `#/pillar/${PILLAR}`);

  // the team's page says it in its head; the names lead to their pages
  await open(page, "/team/fulfilment-team");
  const part = page.locator(".group-head .group-part");
  await expect(part).toHaveText("Part of the pillar Checkout demo, in the tribe Payments demo, in the domain Customer demo");
  await expect(part.getByRole("link", { name: "Checkout demo" })).toHaveAttribute("href", `#/pillar/${PILLAR}`);
  await expect(part.getByRole("link", { name: "Payments demo" })).toHaveAttribute("href", `#/tribe/${TRIBE}`);
  await expect(part.getByRole("link", { name: "Customer demo" })).toHaveAttribute("href", `#/domain/${DOMAIN}`);
  // only the levels that exist
  await open(page, "/team/security");
  await expect(page.locator(".group-head .group-part")).toHaveText("Part of the pillar Cyber defence, in the tribe Trust and service");
  await open(page, "/team/service-management");
  await expect(page.locator(".group-head .group-part")).toHaveText("Part of the pillar Service operations");
});

test("a pillar or tribe the lists do not have is said by name; taking the teams out lets a pillar go", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/teams");
  await tab(page, "Pillars").click();
  await item(page, "Engineering productivity").click();
  await expect(page.getByRole("button", { name: "Remove this pillar" })).toBeDisabled();
  // its one team taken out of it, in the page: then it can be removed (nothing is saved)
  await tab(page, "Teams").click();
  await item(page, "Developer Experience team").click();
  await detail(page).getByLabel("Pillar").selectOption({ label: "No pillar" });
  await tab(page, "Pillars").click();
  await item(page, "Engineering productivity").click();
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("No teams in this pillar yet");
  await expect(page.getByRole("button", { name: "Remove this pillar" })).toBeEnabled();
  await page.getByRole("button", { name: "Discard" }).click();

  // lists imported with a mistake: refused by name
  let res = await putLists(page.request, (c) => { c.teams.find((t: { id: string }) => t.id === "dns-team").pillar = "nowhere"; });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("The team “DNS team” is part of the pillar “nowhere”, which is not in the list of pillars: choose another pillar, or none.");
  res = await putLists(page.request, (c) => { c.pillars.find((p: { id: string }) => p.id === "core-network").tribe = "nowhere"; });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("The pillar “Core network” is part of the tribe “nowhere”, which is not in the list of tribes: choose another tribe, or none.");
});

test("the owning team is chosen by pillar, each with its tribe, on the editing screen", async ({ page }) => {
  await signIn(page, ALEX);
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, "About");
  const owner = page.locator(".edit-fields").getByLabel("Owning team");
  expect(await owner.locator("optgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("label")))).toEqual([
    "Engineering productivity (Developer tools)", "Cloud foundations (Cloud)", "Core network (Connectivity)", "Edge and APIs (Connectivity)",
    "Cyber defence (Trust and service)", "Service operations", "Not in a pillar",
  ]);
  await expect(owner.locator('optgroup[label="Not in a pillar"] option')).toHaveText(["Fulfilment team"]);
  await expect(owner).toHaveValue("service-management");
});

test("with no pillars, tribes or domains, everything looks as it did before", async ({ page }) => {
  // the lists as an installation that never named one has them
  await page.route("**/api/catalog", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const lists = await res.json();
    delete lists.pillars; delete lists.tribes; delete lists.domains;
    for (const t of lists.teams) delete t.pillar;
    await route.fulfill({ response: res, json: lists });
  });
  await signIn(page, SAM);
  await open(page, teamsAt("teams"));
  await expect(page.locator(".cat-kinds-groups").getByRole("tab")).toHaveText([/^Teams/, /^Practices/, /^Platforms/]);
  await expect(page.locator(".cat-list .cat-section-domain, .cat-list .cat-section-name")).toHaveCount(0);
  const names = await page.locator(".cat-list .cat-item strong").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  await expect(page.locator(".cat-part-of")).toHaveCount(0);
  await open(page, "/team/cloud-platform-team");
  await expect(page.locator(".group-head h1")).toHaveText("Cloud Platform team");
  await expect(page.locator(".group-part")).toHaveCount(0);
  await signIn(page, ALEX);
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, "About");
  await expect(page.locator(".edit-fields").getByLabel("Owning team").locator("optgroup")).toHaveCount(0);
  // a lists manager still finds the three lists, empty, to fill
  await open(page, "/admin/teams");
  await item(page, "DNS team").click();
  await expect(detail(page).getByLabel("Pillar")).toHaveCount(0);
  await tab(page, "Pillars").click();
  await expect(page.locator(".cat-list")).toContainText("No pillars yet.");
});

test("a pillar, a tribe and a domain have pages: from the reader's list to a pillar, its tribe, its domain, a team and back", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, teamsAt("teams"));
  await page.locator(".cat-list .cat-section-name").getByRole("link", { name: "Engineering productivity" }).click();
  await expect(page).toHaveURL(/#\/pillar\/engineering-productivity$/);
  await expect(page).toHaveTitle(/^Engineering productivity · /);
  const head = page.locator(".group-head");
  await expect(head.locator(".group-kind")).toHaveText("Pillar");
  await expect(head.locator(".group-part")).toHaveText("Part of the tribe Developer tools, in the domain Engineering enablement");
  await expect(head.getByRole("link", { name: "Edit in Admin › Teams" })).toHaveCount(0); // a reader
  const members = page.getByRole("region", { name: "Teams in this pillar" });
  await expect(members.locator(".cluster-team a")).toHaveText(["Developer Experience team"]);
  await expect(members.locator(".cluster-team-line")).toHaveText(["Slack #devex"]);
  // what its teams own: the cards of the team's page
  const docs = page.getByRole("region", { name: "What its teams look after" });
  await expect(docs.locator(".group-count")).toHaveText("2 processes and 1 standard");
  await expect(docs.locator(".card .card-title")).toHaveCount(3);
  expect((await docs.locator(".card .card-title").allTextContents()).sort()).toEqual(["Code review", "Publish an internal library", "Request a repository"]);
  await expect(docs.getByRole("link", { name: /Open in the search/ })).toHaveAttribute("href", "#/search?owner=developer-experience-team");
  // its tribe: its pillars with their teams
  await head.locator(".group-part").getByRole("link", { name: "Developer tools" }).click();
  await expect(page).toHaveURL(/#\/tribe\/developer-tools-tribe$/);
  await expect(page.locator(".group-head .group-part")).toHaveText("Part of the domain Engineering enablement");
  const pillars = page.getByRole("region", { name: "Pillars in this tribe" });
  await expect(pillars.locator(".cluster-tribe h3")).toHaveText(["Engineering productivity"]);
  await expect(pillars.locator(".cluster-team a")).toHaveText(["Developer Experience team"]);
  await expect(page.getByRole("region", { name: "What the teams of its pillars look after" }).locator(".group-count")).toHaveText("2 processes and 1 standard");
  // its domain: its tribes with their pillars and how many teams each has
  await page.locator(".group-head .group-part").getByRole("link", { name: "Engineering enablement" }).click();
  await expect(page).toHaveURL(/#\/domain\/engineering-enablement$/);
  const tribes = page.getByRole("region", { name: "Tribes in this domain" });
  await expect(tribes.locator(".cluster-tribe h3")).toHaveText(["Developer tools"]);
  await expect(tribes.locator(".cluster-team")).toHaveText(["Engineering productivity1 team"]);
  await expect(page.getByRole("region", { name: "What the teams of its tribes look after" }).locator(".group-count")).toHaveText("2 processes and 1 standard");
  // a pillar, then a team, whose page leads back to its pillar
  await tribes.getByRole("link", { name: "Engineering productivity" }).click();
  await page.getByRole("region", { name: "Teams in this pillar" }).getByRole("link", { name: "Developer Experience team" }).click();
  await expect(page).toHaveURL(/#\/team\/developer-experience-team$/);
  await page.locator(".group-part").getByRole("link", { name: "Engineering productivity" }).click();
  await expect(page).toHaveURL(/#\/pillar\/engineering-productivity$/);
  // back to the reader's list, at the entry
  await page.locator(".group-page > a.back").click();
  await expect(page).toHaveURL(teamsAddress("pillars", "engineering-productivity"));

  // a pillar without a tribe says nothing about one; an unknown id is not found
  await open(page, "/pillar/service-operations");
  await expect(page.locator(".group-head .group-part")).toHaveCount(0);
  for (const [kind, word] of [["pillar", "Pillar"], ["tribe", "Tribe"], ["domain", "Domain"]]) {
    await open(page, `/${kind}/no-such-${kind}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${word} not found`);
  }

  // a lists manager: one way to change it, in Admin › Teams, at its entry
  await signIn(page, ALEX);
  await open(page, "/pillar/core-network");
  await page.getByRole("link", { name: "Edit in Admin › Teams" }).click();
  await expect(page).toHaveURL(/#\/admin\/teams\/pillars\/core-network$/);
  await expect(page.getByRole("tab", { name: /^Pillars/ })).toHaveAttribute("aria-selected", "true");
  await expect(detail(page).locator('[data-field="name"]')).toHaveValue("Core network");
});

test("an empty pillar, tribe and domain say so; the pages fit a phone without sideways scroll", async ({ page }) => {
  const res = await putLists(page.request, (c) => {
    c.domains.push({ id: DOMAIN, name: "Customer demo" });
    c.tribes.push({ id: TRIBE, name: "Payments demo", domain: DOMAIN });
    c.pillars.push({ id: PILLAR, name: "Checkout demo", tribe: TRIBE });
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  await open(page, `/pillar/${PILLAR}`);
  await expect(page.getByRole("region", { name: "Teams in this pillar" }).locator(".cluster-empty")).toHaveText("No team is part of this pillar yet.");
  await expect(page.getByRole("region", { name: "What its teams look after" }).locator(".group-empty")).toHaveText("No team is part of this pillar yet.");
  await expect(page.locator(".alert")).toHaveCount(0);
  expect(await noScroll(page)).toBeLessThanOrEqual(0);
  await open(page, `/tribe/${TRIBE}`);
  await expect(page.getByRole("region", { name: "Pillars in this tribe" }).locator(".cluster-empty")).toHaveText("No team is part of this pillar yet.");
  await expect(page.getByRole("region", { name: "What the teams of its pillars look after" }).locator(".group-empty")).toHaveText("No team is part of the pillars of this tribe yet.");
  await open(page, "/domain/platforms-infrastructure");
  await expect(page.locator(".cluster-tribe h3")).toHaveText(["Cloud", "Connectivity"]);
  expect(await noScroll(page)).toBeLessThanOrEqual(0);
  // a tribe without pillars, a domain without tribes
  const res2 = await putLists(page.request, (c) => { c.pillars = c.pillars.filter((p: { id: string }) => p.id !== PILLAR); });
  expect(res2.ok()).toBeTruthy();
  await signIn(page, SAM);
  await open(page, `/tribe/${TRIBE}`);
  await expect(page.getByRole("region", { name: "Pillars in this tribe" }).locator(".cluster-empty")).toHaveText("No pillar is part of this tribe yet.");
  const res3 = await putLists(page.request, (c) => { c.tribes = c.tribes.filter((t: { id: string }) => t.id !== TRIBE); });
  expect(res3.ok()).toBeTruthy();
  await signIn(page, SAM);
  await open(page, `/domain/${DOMAIN}`);
  await expect(page.getByRole("region", { name: "Tribes in this domain" }).locator(".cluster-empty")).toHaveText("No tribe is part of this domain yet.");
});

test("Admin › Teams keeps its unsaved changes while its address changes: the side menu, Back, another entry", async ({ page }) => {
  await signIn(page, ALEX);
  // from a pillar's page to its entry in Admin › Teams
  await open(page, "/pillar/cloud-foundations");
  await page.getByRole("link", { name: "Edit in Admin › Teams" }).click();
  await expect(page).toHaveURL(/#\/admin\/teams\/pillars\/cloud-foundations$/);
  await detail(page).locator('[data-field="description"]').fill("Changed and not saved yet.");
  const unsaved = page.locator(".cat-save-text");
  await expect(unsaved).toHaveText("Unsaved changes to the lists");
  // "Teams" in the side menu: the same place, nothing asked, nothing lost, still on the pillar
  await page.locator(".admin-nav").getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/#\/admin\/teams$/);
  await expect(page.getByRole("dialog", { name: "Leave without saving?" })).toHaveCount(0);
  await expect(unsaved).toHaveText("Unsaved changes to the lists");
  await expect(detail(page).locator('[data-field="description"]')).toHaveValue("Changed and not saved yet.");
  // another entry by its address, then Back: the entry the address names, the changes kept
  await page.evaluate(() => { location.hash = "#/admin/teams/domains/engineering-enablement"; });
  await expect(page.getByRole("tab", { name: /^Domains/ })).toHaveAttribute("aria-selected", "true");
  await expect(detail(page).locator('[data-field="name"]')).toHaveValue("Engineering enablement");
  await page.goBack();
  await expect(page).toHaveURL(/#\/admin\/teams$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/admin\/teams\/pillars\/cloud-foundations$/);
  await expect(page.getByRole("tab", { name: /^Pillars/ })).toHaveAttribute("aria-selected", "true");
  await expect(detail(page).locator('[data-field="description"]')).toHaveValue("Changed and not saved yet.");
  await expect(unsaved).toHaveText("Unsaved changes to the lists");
  // leaving Admin › Teams altogether still asks, as before
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Guide" }).click();
  const ask = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/#\/admin\/teams/);
  await expect(detail(page).locator('[data-field="description"]')).toHaveValue("Changed and not saved yet.");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(unsaved).toHaveCount(0);
});

test("the reader's teams: the domains and what is in none are headings of one level, each pillar with its tribe one under", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, teamsAt("teams"));
  const list = page.locator(".cat-list");
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Engineering enablement (domain)", "Platforms and infrastructure (domain)", "Not in a domain", "Not in a tribe", "Not in a pillar"]);
  await expect(list.getByRole("heading", { level: 3 })).toHaveText([
    "Developer tools (tribe) › Engineering productivity (pillar)", "Cloud (tribe) › Cloud foundations (pillar)", "Connectivity (tribe) › Core network (pillar)",
    "Connectivity (tribe) › Edge and APIs (pillar)", "Trust and service (tribe) › Cyber defence (pillar)", "Service operations (pillar)",
  ]);
  // each section is named by its heading; the teams in no pillar are their own, last
  await expect(page.getByRole("region", { name: "Not in a pillar" }).locator(".cat-item strong")).toHaveText(["Fulfilment team"]);
  await expect(page.getByRole("region", { name: "Not in a tribe" }).locator(".cat-item strong")).toHaveText(["Service Management"]);
  await expect(page.getByRole("region", { name: "Not in a domain" }).getByRole("heading", { level: 3 })).toHaveText(["Trust and service (tribe) › Cyber defence (pillar)"]);
});

test("a pillar's, a tribe's and a domain's entry in Admin › Teams leads to its page, as a team's does", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/teams/teams/dns-team");
  await expect(detail(page).getByRole("heading", { level: 2 }).getByRole("link", { name: "DNS team" })).toHaveAttribute("href", "#/team/dns-team");
  await open(page, "/admin/teams/pillars/core-network");
  await expect(detail(page).getByRole("heading", { level: 2 }).getByRole("link", { name: "Core network" })).toHaveAttribute("href", "#/pillar/core-network");
  await open(page, "/admin/teams/tribes/connectivity-tribe");
  await expect(detail(page).getByRole("heading", { level: 2 }).getByRole("link", { name: "Connectivity" })).toHaveAttribute("href", "#/tribe/connectivity-tribe");
  await open(page, "/admin/teams/domains/platforms-infrastructure");
  await detail(page).getByRole("heading", { level: 2 }).getByRole("link", { name: "Platforms and infrastructure" }).click();
  await expect(page).toHaveURL(/#\/domain\/platforms-infrastructure$/);
});
