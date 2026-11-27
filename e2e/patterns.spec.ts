import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  ALEX, CSRF, DANA, RILEY, SAM, editState, open, openEditor, outline, pickFilter, readCatalog, readProcess, saveDraft, signIn, unfold,
} from "./helpers";

// The architecture patterns: a list in Admin › Tools, and on a process or standard a tag
// ("this is about systems built this way"). A tag hides nothing: it is a fact in the head of the
// page, a filter of the lists and the search, and words the search finds. Every test puts back
// what it changed.

const PROC = "patterns-demo-process"; // a copy of the ServiceNow process (tagged with none)
const NEW = "cell-based";

async function as(request: APIRequestContext, email: string) {
  expect((await request.post("/auth/dev/login", { data: { email }, headers: CSRF })).ok()).toBeTruthy();
}
/** Saves the lists through the API as an admin, changed by `change`. */
async function putLists(request: APIRequestContext, change: (c: Record<string, any>) => void) {
  await as(request, DANA);
  const res = await request.get("/api/catalog");
  const base = Number(res.headers()["x-document-version"]);
  const lists = await res.json();
  change(lists);
  return request.put(`/api/catalog?base=${base}`, { data: lists, headers: CSRF });
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => page.locator(".cat-item", { hasText: name });
const titles = (page: Page) => page.locator(".card .card-title");
const fact = (page: Page) => page.locator(".doc-facts .fact", { has: page.locator(".sr-only", { hasText: "Architecture patterns:" }) });
const chosen = (page: Page) => page.getByRole("group", { name: "Chosen filters" });

test.afterEach(async ({ request }) => {
  await as(request, DANA);
  await request.delete(`/api/processes/${PROC}`, { headers: CSRF });
  if ((await readCatalog(request)).patterns.some((p: { id: string }) => p.id === NEW)) {
    const res = await putLists(request, (c) => { c.patterns = c.patterns.filter((p: { id: string }) => p.id !== NEW); });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test("a process is tagged on the editing screen, shows its patterns in its head, and is found by them", async ({ page, request }) => {
  test.setTimeout(90_000);
  await as(request, ALEX);
  const servicenow = (await readProcess(request, "raise-servicenow-request"))!;
  expect((await request.put(`/api/processes/${PROC}?base=0`, { data: { ...servicenow, id: PROC, title: "Patterns demo process" }, headers: CSRF })).ok()).toBeTruthy();

  // tagged with none: no fact about patterns
  await signIn(page, SAM);
  await open(page, `/p/${PROC}`);
  await expect(page.locator(".doc-facts")).toBeVisible();
  await expect(fact(page)).toHaveCount(0);

  await signIn(page, ALEX);
  await openEditor(page, "process", PROC);
  await outline(page, "About");
  const region = page.locator(".edit-fields").getByRole("region", { name: "Architecture patterns" });
  await expect(page.locator(".edit-fields").getByRole("button", { name: "Architecture patterns", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(region.locator(".fold-summary")).toHaveText("Not tagged");
  await unfold(page, "Architecture patterns");
  const chips = region.getByRole("group", { name: "Architecture patterns" });
  // the patterns of the list, by name; nothing chosen
  await expect(chips.getByRole("button")).toHaveText(["API-first", "Batch and data pipelines", "Event-driven", "Microservices", "Serverless", "Static site behind a CDN"]);
  await expect(chips.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(region).toContainText("not tagged");
  await expect(chips.getByRole("button", { name: "Event-driven" })).toHaveAttribute("title", /^Event-driven, also called event-based or EDA: Services react to events/);
  await chips.getByRole("button", { name: "Microservices" }).click();
  await chips.getByRole("button", { name: "Event-driven" }).click();
  await expect(chips.locator('button[aria-pressed="true"]')).toHaveText(["Event-driven", "Microservices"]);
  await expect(region).toContainText("tagged with the selected patterns");
  // the preview of the head says them at once, in the order of the list
  await expect(page.locator("main.edit-middle .preview-facts")).toContainText("Event-driven, Microservices");
  await saveDraft(page);
  expect((await readProcess(page, PROC))!.patterns).toBeUndefined(); // readers still see the published one
  // the Publish list says the change in words
  await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: /^Publish/ });
  await expect(dialog).toContainText("Architecture patterns: nothing → “Event-driven, Microservices”");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editState(page)).toHaveAttribute("aria-label", /^Published\./);
  expect((await readProcess(page, PROC))!.patterns).toEqual(["event-driven", "microservices"]);

  // the reader's page: one fact with both names
  await signIn(page, SAM);
  await open(page, `/p/${PROC}`);
  await expect(fact(page)).toHaveText("Architecture patterns: Event-driven, Microservices");
  await expect(fact(page)).toHaveAttribute("title", "Architecture patterns: Event-driven, also called event-based or EDA; Microservices, also called microservice architecture");

  // the Processes list: the filter, its counts, the chip, the address
  await open(page, "/processes");
  await pickFilter(page, "Architecture pattern", "Event-driven");
  await expect(page).toHaveURL(/#\/processes\?pattern=event-driven$/);
  await expect(titles(page)).toHaveText(["Patterns demo process"]);
  await expect(chosen(page).getByRole("button", { name: "Remove filter Architecture pattern: Event-driven" })).toBeVisible();
  await pickFilter(page, "Architecture pattern", "API-first");
  await expect(page).toHaveURL(/#\/processes\?pattern=event-driven,api-first$/);
  await expect(titles(page)).toHaveText(["Onboard an API to Apigee", "Patterns demo process"]);
  // the chosen value is read whole: under the long name when the two do not fit on one line
  const dd = page.locator('[data-filter="pattern"]');
  await expect(dd).toHaveClass(/\bstacked\b/);
  const value = dd.locator(".filter-dd-value");
  await expect(value).toHaveText("API-first, Event-driven");
  expect(await value.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
  const [name, shown] = [(await dd.locator(".filter-dd-name").boundingBox())!, (await value.boundingBox())!];
  expect(shown.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  // a short name and value stay on one line
  await expect(page.locator('[data-filter="category"]')).not.toHaveClass(/\bstacked\b/);
  // a link carries it: the same results on a fresh page
  await open(page, "/processes?pattern=api-first");
  await expect(titles(page)).toHaveText(["Onboard an API to Apigee"]);
  // a pattern that no longer exists is dropped from the address, and the page says so once
  await open(page, "/processes?pattern=soa,microservices");
  await expect(page).toHaveURL(/#\/processes\?pattern=microservices$/);
  await expect(page.locator(".alert.alert-info.list-notice")).toHaveText("A filter in this link no longer exists and was left out.");
  await expect(titles(page)).toHaveText(["Patterns demo process"]);
  // the search: the filter, and the words of a pattern's other names
  await open(page, "/search?q=EDA");
  await expect(page.locator(".card .card-title")).toHaveText(["Patterns demo process"]);
  await open(page, "/search?pattern=static-site-cdn");
  await expect(page.locator(".card .card-title")).toHaveText(["Onboard a site to Akamai"]);
  await expect(page.locator('[data-filter="pattern"] .filter-dd-value')).toHaveText("Static site behind a CDN");
  // the Standards list has the filter too; no sample standard is tagged, so it has nothing to choose
  await open(page, "/standards");
  await expect(page.locator('[data-filter="pattern"] .filter-dd-value')).toHaveText("Nothing to choose");
});

test("Admin › Tools has Architecture patterns: other names, a used one that cannot be removed, shown on Tools", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/tools");
  await tab(page, "Architecture patterns").click();
  for (const name of ["API-first", "Event-driven", "Static site behind a CDN"]) await expect(item(page, name)).toBeVisible();
  const detail = page.locator(".cat-detail");
  await item(page, "API-first").click();
  await expect(detail.locator(".eyebrow")).toHaveText("architecture pattern");
  await expect(detail.locator('[data-field="alsoCalled"]')).toHaveValue("contract-first, API-led");
  await expect(page.getByRole("button", { name: "Remove this architecture pattern" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still used by 1 process. Change those first, then it can be removed.");
  await expect(page.locator(".cat-usage")).toContainText("Onboard an API to Apigee");
  await expect(page.locator(".cat-usage")).toContainText("tagged with this pattern");
  // the server refuses it too, naming what uses it
  const refused = await putLists(page.request, (c) => { c.patterns = c.patterns.filter((p: { id: string }) => p.id !== "api-first"); });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("cannot remove what is still in use: “api-first” is still used by “Onboard an API to Apigee”. Change those first.");
  // and the page says the same when it is tried there: Undo is offered by the page, the save is refused
  await signIn(page, ALEX);
  await open(page, "/admin/tools");
  await tab(page, "Architecture patterns").click();
  await item(page, "Serverless").click();
  await expect(page.locator(".cat-danger")).toContainText("Nothing uses it, so it is safe to remove.");

  // a new one, with other names; an other name that is another pattern's is said by name
  await page.getByRole("button", { name: "New architecture pattern" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Cell-based");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("heading", { name: "Cell-based" })).toBeVisible();
  const also = detail.locator('[data-field="alsoCalled"]');
  await also.fill("microservices");
  const issues = page.locator("section.cat-issues").getByRole("list", { name: "What is to fix in the lists" });
  await expect(issues).toContainText("The architecture pattern “Cell-based” is also called “microservices”, which is the name of the architecture pattern “Microservices”: take it off “Cell-based”.");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await also.fill("cells, cellular");
  await detail.locator('[data-field="description"]').fill("The system is split into independent copies, each serving part of the users.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();
  expect((await readCatalog(page)).patterns).toContainEqual({ id: NEW, name: "Cell-based", alsoCalled: ["cells", "cellular"], description: "The system is split into independent copies, each serving part of the users." });

  // Tools shows them to everyone, with their other names
  await signIn(page, SAM);
  await open(page, "/tools");
  await tab(page, "Architecture patterns").click();
  await item(page, "Cell-based").click();
  await expect(page.locator(".cat-detail")).toContainText(/Also called\s*cells, cellular/i);
  await expect(page.locator(".cat-detail")).toContainText(/Used by\s*nothing yet/i);
  await expect(page).toHaveURL(/#\/tools\/patterns\/cell-based$/);
});

test("with no patterns listed, readers see nothing about them; whoever manages the lists is told where to add them", async ({ page }) => {
  // the lists as an installation that never named a pattern has them: without the key
  await page.route("**/api/catalog", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const lists = await res.json();
    delete lists.patterns;
    await route.fulfill({ response: res, json: lists });
  });
  const untagged = async (p: Page) => {
    // the documents are served untagged too, as they would be
    await p.route(/\/api\/(processes|standards)$/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const d of [...(body.processes ?? []), ...(body.standards ?? [])]) delete d.patterns;
      await route.fulfill({ response: res, json: body });
    });
  };
  await untagged(page);
  await signIn(page, SAM);
  await open(page, "/p/onboard-api-to-apigee");
  await expect(page.locator(".doc-facts")).toBeVisible();
  await expect(fact(page)).toHaveCount(0);
  await open(page, "/processes");
  await expect(page.locator('[data-filter="category"]')).toBeVisible();
  await expect(page.locator('[data-filter="pattern"]')).toHaveCount(0);
  await open(page, "/tools");
  await expect(tab(page, "Tools")).toBeVisible();
  await expect(tab(page, "Architecture patterns")).toHaveCount(0);

  // a practice owner who does not manage the lists: no section about patterns
  await signIn(page, RILEY);
  await openEditor(page, "standard", "secure-logging");
  await outline(page, "About");
  await expect(page.locator(".edit-fields").getByRole("button", { name: "Which path it is for", exact: true })).toBeVisible();
  await expect(page.locator(".edit-fields").getByRole("button", { name: "Architecture patterns", exact: true })).toHaveCount(0);
  // a lists manager: told where they are added
  await signIn(page, ALEX);
  await openEditor(page, "process", "raise-servicenow-request");
  await outline(page, "About");
  await unfold(page, "Architecture patterns");
  const none = page.locator(".edit-fields .patterns-none");
  await expect(none).toHaveText("No architecture patterns are listed yet. Add the ones your organisation uses in Admin › Tools, under Architecture patterns.");
  await expect(none.getByRole("link", { name: "Admin › Tools" })).toHaveAttribute("href", "#/admin/tools/patterns");
  // the link opens Admin › Tools at the architecture patterns, the empty list to fill
  await none.getByRole("link", { name: "Admin › Tools" }).click();
  await expect(page).toHaveURL(/#\/admin\/tools\/patterns$/);
  await expect(tab(page, "Architecture patterns")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cat-list")).toContainText("No architecture patterns yet.");
});
