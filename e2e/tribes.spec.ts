import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, open, openEditor, outline, readCatalog, save, signIn } from "./helpers";

// Tribes group teams and domains group tribes, all optional: two lists in Admin › Lists (under
// Who), a Tribe on a team and a Domain on a tribe. Teams & tools groups the teams under their
// domain and tribe, and a team's page says where it belongs. Every test puts back what it changed.

const TRIBE = "payments-demo", DOMAIN = "customer-demo";

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

test.afterEach(async ({ request }) => {
  await as(request, DANA);
  const lists = await readCatalog(request);
  if (lists.teams.some((t: { tribe?: string }) => t.tribe === TRIBE) || lists.tribes.some((t: { id: string }) => t.id === TRIBE) || lists.domains.some((d: { id: string }) => d.id === DOMAIN)) {
    const res = await putLists(request, (c) => {
      for (const t of c.teams) if (t.tribe === TRIBE) delete t.tribe;
      c.tribes = c.tribes.filter((t: { id: string }) => t.id !== TRIBE);
      c.domains = c.domains.filter((d: { id: string }) => d.id !== DOMAIN);
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test("a domain, a tribe in it and a team in the tribe: made in Admin › Lists, grouped on Teams & tools, said on the team's page", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await expect(page.getByRole("tablist", { name: "Who", exact: true }).getByRole("tab")).toHaveText([/^Teams/, /^Tribes/, /^Domains/, /^Practices/, /^Platforms/]);

  // a domain
  await tab(page, "Domains").click();
  await page.getByRole("button", { name: "New domain" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Customer demo");
  await page.keyboard.press("Enter");
  await detail(page).locator('[data-field="description"]').fill("Everything customers use to buy from us.");
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("No tribes in this domain yet");
  // a tribe in it: "No domain" first
  await tab(page, "Tribes").click();
  await page.getByRole("button", { name: "New tribe" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Payments demo");
  await page.keyboard.press("Enter");
  const domain = detail(page).getByLabel("Domain");
  await expect(domain.locator("option").first()).toHaveText("No domain");
  await domain.selectOption({ label: "Customer demo" });
  // a team in the tribe: "No tribe" first
  await tab(page, "Teams").click();
  await item(page, "Fulfilment team").click();
  const tribe = detail(page).getByLabel("Tribe");
  await expect(tribe).toHaveValue("");
  await expect(tribe.locator("option").first()).toHaveText("No tribe");
  await tribe.selectOption({ label: "Payments demo" });
  await save(page);
  const lists = await readCatalog(page);
  expect(lists.domains).toContainEqual({ id: DOMAIN, name: "Customer demo", description: "Everything customers use to buy from us." });
  expect(lists.tribes).toContainEqual({ id: TRIBE, name: "Payments demo", domain: DOMAIN });
  expect(lists.teams.find((t: { id: string }) => t.id === "fulfilment-team").tribe).toBe(TRIBE);

  // the tribe shows its team, the domain its tribe; one in use cannot be removed
  await tab(page, "Tribes").click();
  await item(page, "Payments demo").click();
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("1 team in this tribe");
  await expect(detail(page).locator(".cat-inner li")).toHaveText(["Fulfilment team"]);
  await expect(page.getByRole("button", { name: "Remove this tribe" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still the tribe of 1 team. Take it out of it first, then it can be removed.");
  await detail(page).locator(".cat-inner").getByRole("button", { name: "Fulfilment team" }).click();
  await expect(tab(page, "Teams")).toHaveAttribute("aria-selected", "true");
  await expect(detail(page).getByRole("heading", { name: "Fulfilment team" })).toBeVisible();
  await tab(page, "Domains").click();
  await item(page, "Customer demo").click();
  await expect(detail(page).locator(".cat-inner li")).toHaveText(["Payments demo"]);
  await expect(page.getByRole("button", { name: "Remove this domain" })).toBeDisabled();
  // the server refuses both, naming who is still in it
  const tribeGone = await putLists(page.request, (c) => { c.tribes = c.tribes.filter((t: { id: string }) => t.id !== TRIBE); });
  expect(tribeGone.status()).toBe(400);
  expect((await tribeGone.json()).error).toBe(`cannot remove what is still in use: “${TRIBE}” is still used by the team “Fulfilment team”. Change those first.`);
  const domainGone = await putLists(page.request, (c) => { c.domains = c.domains.filter((d: { id: string }) => d.id !== DOMAIN); });
  expect(domainGone.status()).toBe(400);
  expect((await domainGone.json()).error).toBe(`cannot remove what is still in use: “${DOMAIN}” is still used by the tribe “Payments demo”. Change those first.`);

  // Teams & tools: the teams under their domain and tribe, by name; what is in no domain or no tribe after
  await signIn(page, SAM);
  await open(page, "/catalog/teams");
  const list = page.locator(".cat-list");
  await expect(list.locator(".cat-section-domain")).toHaveText(["Customer demo (domain)", "Engineering enablement (domain)", "Platforms and infrastructure (domain)", "Not in a domain"]);
  await expect(list.locator(".cat-section-name")).toHaveText(["Payments demo (tribe)", "Developer tools (tribe)", "Cloud (tribe)", "Connectivity (tribe)", "Trust and service (tribe)"]);
  await expect(page.getByRole("heading", { name: "Payments demo (tribe)" })).toBeVisible();
  await expect(list.locator(".cat-section-tribe", { hasText: "Payments demo" }).locator(".cat-item strong")).toHaveText(["Fulfilment team"]);
  // the first team in that order is the one shown
  await expect(detail(page).getByRole("heading", { name: "Fulfilment team" })).toBeVisible();
  await expect(detail(page).locator(".cat-part-of")).toHaveText("Part of the tribe Payments demo, in the domain Customer demo");
  await detail(page).locator(".cat-part-of").getByRole("button", { name: "Payments demo" }).click();
  await expect(page).toHaveURL(new RegExp(`#/catalog/tribes/${TRIBE}$`));
  await expect(detail(page).locator(".cat-facts")).toContainText(/Domain\s*Customer demo/);
  await expect(detail(page).locator(".cat-inner").getByRole("link", { name: "Fulfilment team" })).toHaveAttribute("href", "#/team/fulfilment-team");

  // the team's page says it in its head; the names lead to their entries
  await open(page, "/team/fulfilment-team");
  const part = page.locator(".group-head .group-part");
  await expect(part).toHaveText("Part of the tribe Payments demo, in the domain Customer demo");
  await expect(part.getByRole("link", { name: "Payments demo" })).toHaveAttribute("href", `#/catalog/tribes/${TRIBE}`);
  await expect(part.getByRole("link", { name: "Customer demo" })).toHaveAttribute("href", `#/catalog/domains/${DOMAIN}`);
  // a team in a tribe without a domain; a team in no tribe says nothing
  await open(page, "/team/security");
  await expect(page.locator(".group-head .group-part")).toHaveText("Part of the tribe Trust and service");
  await open(page, "/team/developer-experience-team");
  await expect(page.locator(".group-head .group-part")).toHaveText("Part of the tribe Developer tools, in the domain Engineering enablement");
});

test("a tribe or domain the lists do not have is said by name; taking the teams out lets a tribe go", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await tab(page, "Tribes").click();
  await item(page, "Developer tools").click();
  await expect(page.getByRole("button", { name: "Remove this tribe" })).toBeDisabled();
  // its one team taken out of it, in the page: then it can be removed (nothing is saved)
  await tab(page, "Teams").click();
  await item(page, "Developer Experience team").click();
  await detail(page).getByLabel("Tribe").selectOption({ label: "No tribe" });
  await tab(page, "Tribes").click();
  await item(page, "Developer tools").click();
  await expect(detail(page).locator(".cat-inner h3")).toHaveText("No teams in this tribe yet");
  await expect(page.getByRole("button", { name: "Remove this tribe" })).toBeEnabled();
  await page.getByRole("button", { name: "Discard" }).click();

  // a team in a tribe that is not in the list (lists imported with a mistake): refused by name
  const res = await putLists(page.request, (c) => { c.teams.find((t: { id: string }) => t.id === "dns-team").tribe = "nowhere"; });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("The team “DNS team” is part of the tribe “nowhere”, which is not in the list of tribes: choose another tribe, or none.");
});

test("the owning team is chosen by tribe on the editing screen", async ({ page }) => {
  await signIn(page, ALEX);
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, "About");
  const owner = page.locator(".edit-fields").getByLabel("Owning team");
  await expect(owner.locator("optgroup")).toHaveCount(5);
  expect(await owner.locator("optgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("label")))).toEqual([
    "Developer tools (Engineering enablement)", "Cloud (Platforms and infrastructure)", "Connectivity (Platforms and infrastructure)", "Trust and service", "Not in a tribe",
  ]);
  await expect(owner.locator('optgroup[label="Not in a tribe"] option')).toHaveText(["Fulfilment team"]);
  await expect(owner).toHaveValue("service-management");
});

test("with no tribes and no domains, everything looks as it did before", async ({ page }) => {
  // the lists as an installation that never named a tribe has them
  await page.route("**/api/catalog", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const lists = await res.json();
    delete lists.tribes; delete lists.domains;
    for (const t of lists.teams) delete t.tribe;
    await route.fulfill({ response: res, json: lists });
  });
  await signIn(page, SAM);
  await open(page, "/catalog/teams");
  await expect(page.getByRole("tablist", { name: "Who", exact: true }).getByRole("tab")).toHaveText([/^Teams/, /^Practices/, /^Platforms/]);
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
  // a lists manager still finds the two lists, empty, to fill
  await open(page, "/admin/lists");
  await item(page, "DNS team").click();
  await expect(detail(page).getByLabel("Tribe")).toHaveCount(0);
  await tab(page, "Tribes").click();
  await expect(page.locator(".cat-list")).toContainText("No tribes yet.");
});
