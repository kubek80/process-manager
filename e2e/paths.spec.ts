import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  ALEX, CSRF, DANA, RILEY, SAM, discardWorkingDraft, open, openApplication, openEditor, outline, pickFilter, publish, putWorkingDraft, readCatalog, readProcess, readStandard, saveDraft, signIn, unfold,
} from "./helpers";

// The path of a process or standard: Greenfield, Brownfield, Paved path (also called the golden
// path), a ninth list in Admin › Lists. A document names none (it applies whatever the path), one
// or more. It shows as plates on cards and rows, as a road on the reader's page, is a filter and
// a choice of My application, and is found by its other names. Every test puts back what it changed.

const PROC = "paths-demo-process"; // a copy of the ServiceNow process (names no path)
const STD = "paths-demo-standard"; // a copy of Secure logging (names no path)
const NEW_PATH = "lift-and-shift";

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
const card = (page: Page, title: string) => page.locator(".card", { has: page.getByRole("heading", { name: title, exact: true }) });
const titles = (page: Page) => page.locator(".card .card-title");
const road = (page: Page) => page.locator("figure.path-road");

test.afterEach(async ({ request }) => {
  // the lists as the sample has them: the three paths, nothing added
  const lists = await readCatalog((await as(request, DANA), request));
  if (lists.paths.some((p: { id: string }) => p.id === NEW_PATH)) {
    const res = await putLists(request, (c) => { c.paths = c.paths.filter((p: { id: string }) => p.id !== NEW_PATH); });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  for (const [kind, id] of [["processes", PROC], ["standards", STD]]) await request.delete(`/api/${kind}/${id}`, { headers: CSRF });
});

test("Admin › Lists has Paths among where it applies: a path with a picture and other names, a used one that cannot be removed", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await expect(page.getByRole("tablist", { name: "Where it applies" }).getByRole("tab")).toHaveText([/^Application tiers/, /^Paths/, /^Environments/, /^Languages/]);
  await tab(page, "Paths").click();
  await expect(page.locator(".cat-item .cat-name, .cat-item strong").first()).toBeVisible();
  for (const name of ["Greenfield", "Brownfield", "Paved path"]) await expect(item(page, name)).toBeVisible();

  // the paved path: its picture chosen, its other names, used by four processes, so it stays
  await item(page, "Paved path").click();
  const detail = page.locator(".cat-detail");
  await expect(detail.locator('[data-field="alsoCalled"]')).toHaveValue("golden path, paved road");
  const picker = detail.locator(".symbol-picker");
  await expect(picker.getByRole("button", { name: "A paved road: the ready-made way" })).toHaveAttribute("aria-pressed", "true");
  await expect(detail.locator(".symbol-caption")).toHaveText("Chosen: A paved road: the ready-made way");
  await picker.getByRole("button", { name: "A bridge: moving across" }).hover();
  await expect(detail.locator(".symbol-caption")).toHaveText("A bridge: moving across");
  await expect(page.getByRole("button", { name: "Remove this path" })).toBeDisabled();
  await expect(page.locator(".cat-danger")).toContainText("Still used by 4 processes. Change those first, then it can be removed.");
  await expect(page.locator(".cat-usage")).toContainText("Request a GCP project");
  await expect(page.locator(".cat-usage")).toContainText("is for this path");
  // the server refuses it too, naming what uses it
  const refused = await putLists(page.request, (c) => { c.paths = c.paths.filter((p: { id: string }) => p.id !== "paved-path"); });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/still used by “Onboard an API to Apigee”, “Request a GCP project”/);
  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await tab(page, "Paths").click();
  // Brownfield is used by nothing in the sample
  await item(page, "Brownfield").click();
  await expect(page.locator(".cat-danger")).toContainText("Nothing uses it, so it is safe to remove.");

  // a new path, with a picture and other names
  await page.getByRole("button", { name: "New path" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Lift and shift");
  await expect(page.locator(".cat-new")).toContainText(NEW_PATH);
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("heading", { name: "Lift and shift" })).toBeVisible();
  await expect(detail.locator(".symbol-caption")).toHaveText("Chosen: None: a neutral signpost");
  await picker.getByRole("button", { name: "A bridge: moving across" }).click();
  await expect(picker.getByRole("button", { name: "A bridge: moving across" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0); // the caption names the picture under the pointer, else the chosen one
  await expect(detail.locator(".symbol-caption")).toHaveText("Chosen: A bridge: moving across");
  await expect(item(page, "Lift and shift").locator(".path-avatar")).toHaveAttribute("data-symbol", "bridge");
  const also = detail.locator('[data-field="alsoCalled"]');

  // an other name another path already has, or another path's name: said by name, nothing saved
  await also.fill("golden path");
  const issues = page.locator("section.cat-issues").getByRole("list", { name: "What is to fix in the lists" });
  await expect(issues).toContainText("The paths “Paved path” and “Lift and shift” are both also called “golden path”: keep it on one of them.");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await also.fill("Brownfield");
  await expect(issues).toContainText("The path “Lift and shift” is also called “Brownfield”, which is the name of the path “Brownfield”: take it off “Lift and shift”.");
  await expect(also).toHaveAttribute("aria-invalid", "true");
  // the server says the same
  const clash = await putLists(page.request, (c) => { c.paths.push({ id: "lift", name: "Lift", alsoCalled: ["Golden Path"] }); });
  expect(clash.status()).toBe(400);
  expect((await clash.json()).error).toContain("The paths “Paved path” and “Lift” are both also called “Golden Path”: keep it on one of them.");

  await signIn(page, ALEX);
  await open(page, "/admin/lists");
  await tab(page, "Paths").click();
  await page.getByRole("button", { name: "New path" }).click();
  await page.locator(".cat-new").getByLabel("Name").fill("Lift and shift");
  await page.keyboard.press("Enter");
  await picker.getByRole("button", { name: "A bridge: moving across" }).click();
  await also.fill("lift, rehost");
  await detail.locator('[data-field="description"]').fill("An existing application moved as it is.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();
  expect((await readCatalog(page)).paths).toContainEqual({ id: NEW_PATH, name: "Lift and shift", symbol: "bridge", alsoCalled: ["lift", "rehost"], description: "An existing application moved as it is." });

  // Teams & tools shows it to everyone, with its other names
  await signIn(page, SAM);
  await open(page, "/catalog");
  await tab(page, "Paths").click();
  await item(page, "Paved path").click();
  await expect(page.locator(".cat-detail")).toContainText(/Also called\s*golden path, paved road/i);
  await item(page, "Lift and shift").click();
  await expect(page.locator(".cat-detail")).toContainText(/Also called\s*lift, rehost/i);
  await expect(page.locator(".cat-detail")).toContainText(/Used by\s*nothing yet/i);
});

test("the editing screen's “Which path it is for”, on a process and a standard: saved, published, shown as the road", async ({ page, request }) => {
  test.setTimeout(90_000);
  await as(request, ALEX);
  const servicenow = (await readProcess(request, "raise-servicenow-request"))!;
  expect((await request.put(`/api/processes/${PROC}?base=0`, { data: { ...servicenow, id: PROC, title: "Paths demo process" }, headers: CSRF })).ok()).toBeTruthy();
  await as(request, RILEY);
  const logging = (await readStandard(request, "secure-logging"))!;
  expect((await request.put(`/api/standards/${STD}?base=0`, { data: { ...logging, id: STD, title: "Paths demo standard" }, headers: CSRF })).ok()).toBeTruthy();

  // a process that names none: one quiet fact, "Any path", no road
  await signIn(page, SAM);
  await open(page, `/p/${PROC}`);
  await expect(page.locator(".path-any .fact-text > [aria-hidden='true']")).toHaveText("Any path"); // in sight; read out as the sentence
  await expect(page.locator(".path-any")).toHaveText("This process applies whatever the path. Any path");
  await expect(page.locator(".path-any")).toHaveAttribute("title", "This process applies whatever the path.");
  await expect(road(page)).toHaveCount(0);

  await signIn(page, ALEX);
  await openEditor(page, "process", PROC);
  await outline(page, "About");
  const section = page.locator(".edit-fields").getByRole("button", { name: "Which path it is for", exact: true });
  await expect(section).toHaveAttribute("aria-expanded", "false"); // folded, with what is chosen
  await expect(page.locator(".edit-fields").getByRole("region", { name: "Which path it is for" }).locator(".fold-summary")).toHaveText("Any path");
  await unfold(page, "Which path it is for");
  const chips = page.locator(".edit-fields").getByRole("group", { name: "Paths" });
  await expect(chips.getByRole("button")).toHaveText(["Any path", "Greenfield", "Brownfield", "Paved path"]);
  await expect(chips.getByRole("button", { name: "Any path" })).toHaveAttribute("aria-pressed", "true");
  await chips.getByRole("button", { name: "Brownfield" }).click();
  await expect(chips.getByRole("button", { name: "Brownfield" })).toHaveAttribute("aria-pressed", "true");
  await expect(chips.getByRole("button", { name: "Any path" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".edit-fields")).toContainText("only for the selected paths");
  // the preview shows the road at once
  await expect(page.locator("main.edit-middle figure.path-road .path-lane.on .path-name")).toHaveText(["Brownfield"]);
  await saveDraft(page);
  expect((await readProcess(page, PROC))!.paths).toBeUndefined(); // readers still see the published one
  await publish(page);
  expect((await readProcess(page, PROC))!.paths).toEqual(["brownfield"]);

  // the reader's page: every path of the list as a lane, this one marked
  await signIn(page, SAM);
  await open(page, `/p/${PROC}`);
  await expect(road(page).locator("figcaption")).toHaveText("Which path is this for");
  await expect(road(page).locator(".path-lane .path-name")).toHaveText(["Greenfield", "Brownfield", "Paved path"]);
  await expect(road(page).locator(".path-lane.on .path-name")).toHaveText(["Brownfield"]);
  await expect(road(page).getByRole("list")).toHaveAccessibleName("This process is for Brownfield.");
  await expect(road(page).locator(".path-lane.on")).toHaveAttribute("title", /^Brownfield, also called brown field: .* \(this one\)$/);
  await expect(road(page).locator(".path-lane.off").first()).toHaveAttribute("title", /\(not this one\)$/);
  await expect(page.locator(".path-any")).toHaveCount(0);

  // a standard, by its practice owner: two paths
  await signIn(page, RILEY);
  await openEditor(page, "standard", STD);
  await outline(page, "About");
  await unfold(page, "Which path it is for");
  await chips.getByRole("button", { name: "Greenfield" }).click();
  await chips.getByRole("button", { name: "Paved path" }).click();
  await saveDraft(page);
  await publish(page);
  expect((await readStandard(page, STD))!.paths).toEqual(["greenfield", "paved-path"]);
  await signIn(page, SAM);
  await open(page, `/s/${STD}`);
  await expect(road(page).locator(".path-lane.on .path-name")).toHaveText(["Greenfield", "Paved path"]);
  await expect(road(page).getByRole("list")).toHaveAccessibleName("This standard is for Greenfield and Paved path.");
  // and Any path again, chosen on its own, takes them off
  await signIn(page, RILEY);
  await openEditor(page, "standard", STD);
  await outline(page, "About");
  await unfold(page, "Which path it is for");
  await chips.getByRole("button", { name: "Any path" }).click();
  await expect(chips.locator('button[aria-pressed="true"]')).toHaveText(["Any path"]);
  await saveDraft(page);
  await publish(page);
  expect((await readStandard(page, STD))!.paths).toBeUndefined();
});

test("plates on cards and rows: one path named, two as plates; each read out", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  const repo = card(page, "Request a repository");
  await expect(repo.locator(".path-marks")).toHaveAttribute("title", "For: Greenfield, Paved path");
  await expect(repo.locator(".path-mark")).toHaveCount(2);
  await expect(repo.locator(".path-mark .path-name")).toHaveCount(0); // plates only
  // read out, the names hidden from sight: "For: Greenfield, Paved path"
  await expect(repo.locator(".path-marks > .sr-only")).toHaveText("For:");
  await expect(repo.locator(".path-mark .sr-only")).toHaveText(["Greenfield", "Paved path"]);
  expect(await repo.locator(".path-mark").evaluateAll((es) => es.map((e) => [e.getAttribute("data-symbol"), e.getAttribute("title")]))).toEqual([
    ["sprout", "Greenfield, also called green field: Something new is built from scratch, with no system to fit into yet."],
    ["road", "Paved path, also called golden path or paved road: The ready-made, supported way, also called the golden path: templates and platforms that already meet the standards."],
  ]);
  const gcp = card(page, "Request a GCP project");
  await expect(gcp.locator(".path-mark .path-name")).toHaveText(["Paved path"]); // one path: named
  await expect(card(page, "Raise a ServiceNow request").locator(".path-marks")).toHaveCount(0); // names none: nothing

  // rows: one path named beside its plate, two as plates
  await page.getByRole("radio", { name: "Rows" }).click();
  const row = (title: string) => page.locator(".row", { hasText: title });
  await expect(row("Request a GCP project").locator(".row-paths .path-name")).toHaveText(["Paved path"]);
  await expect(row("Request a repository").locator(".row-paths .path-mark")).toHaveCount(2);
  await expect(row("Raise a ServiceNow request").locator(".row-paths")).toHaveCount(0);
});

test("the Path filter: made for a path, or not tied to one; in the address, and a link shows the same", async ({ page, context }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  const panel = page.getByRole("complementary", { name: "Filters" });
  const button = panel.locator(".filter-dds").getByRole("button", { name: /^(?:Narrow down, )?Path:/ });
  await button.click();
  const list = button.locator("xpath=..").locator(".filter-dd-list");
  await expect(list.locator(".filter-dd-hint")).toHaveText("Shows what is made for the path you choose; what is for any path is left out. To see everything that applies to your application's path, choose it under My application.");
  await expect(list.locator(".filter-option-name")).toHaveText([/Made for Greenfield$/, /Made for Brownfield$/, /Made for Paved path$/, /Not tied to a path$/]);
  await button.click();

  await pickFilter(page, "Path", "Made for Greenfield");
  await expect(titles(page)).toHaveText(["Request a repository"]);
  await expect(page).toHaveURL(/[?&]path=greenfield(&|$)/);
  await expect(page.getByRole("group", { name: "Chosen filters" }).getByRole("button", { name: "Remove filter Path: Made for Greenfield" })).toBeVisible();
  await pickFilter(page, "Path", "Made for Greenfield");
  await pickFilter(page, "Path", "Not tied to a path");
  await expect(titles(page)).toHaveCount(3);
  expect((await titles(page).allInnerTexts()).sort()).toEqual(["Onboard a site to Akamai", "Publish an internal library", "Raise a ServiceNow request"]);
  await expect(page).toHaveURL(/[?&]path=-(&|$)/);

  // the search: the paved path, from a link
  const other = await context.newPage();
  await other.goto("/#/processes?path=paved-path");
  await expect(other.locator(".card .card-title")).toHaveCount(4);
  expect((await other.locator(".card .card-title").allInnerTexts()).sort()).toEqual(["Onboard an API to Apigee", "Request a GCP project", "Request a repository", "Request an Azure landing zone"]);
  await expect(other.getByRole("complementary", { name: "Filters" }).locator(".filter-dds").getByRole("button", { name: /^Narrow down, Path:/ })).toHaveAccessibleName(/^Narrow down, Path: Made for Paved path/);
  // in the search, the same filter from the address
  await other.goto("/#/search?q=gcp&path=paved-path");
  await expect(other.locator(".card .card-title")).toHaveCount(2); // Infrastructure as code, found for "gcp" too, names no path
  expect((await other.locator(".card .card-title").allInnerTexts()).sort()).toEqual(["Onboard an API to Apigee", "Request a GCP project"]);
  await expect(other.getByRole("complementary", { name: "Filters" }).locator(".filter-dds").getByRole("button", { name: /^Narrow down, Path:/ })).toHaveAccessibleName(/^Narrow down, Path: Made for Paved path/);
  await other.close();
});

test("My application › Path hides what is made only for other paths and keeps what is for any path", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/processes");
  await expect(titles(page)).toHaveCount(7);
  await openApplication(page);
  const app = page.getByRole("complementary", { name: "Filters" }).locator(".filter-app");
  const path = app.getByRole("button", { name: /^My application, Path:/ });
  await path.click();
  await expect(path.locator("xpath=..").locator(".filter-dd-hint")).toHaveText("Shows what applies to an application on this path: what is made for it and what is for any path. What is made only for other paths is hidden.");
  await path.click();
  await pickFilter(page, "Path", /^Brownfield, \d+ results?$/, "application");
  await expect(titles(page)).toHaveCount(3);
  expect((await titles(page).allInnerTexts()).sort()).toEqual(["Onboard a site to Akamai", "Publish an internal library", "Raise a ServiceNow request"]);
  await pickFilter(page, "Path", /^Greenfield, \d+ results?$/, "application");
  await expect(titles(page)).toHaveCount(4);
  expect((await titles(page).allInnerTexts()).sort()).toEqual(["Onboard a site to Akamai", "Publish an internal library", "Raise a ServiceNow request", "Request a repository"]);
  // remembered in this browser
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("pm:profile")))!)).toMatchObject({ path: "greenfield" });
  await page.reload();
  await expect(titles(page)).toHaveCount(4);
  await pickFilter(page, "Path", /^Any path, \d+ results?$/, "application");
  await expect(titles(page)).toHaveCount(7);
});

test("searching “golden path” finds what is on the paved path", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=golden%20path");
  await expect(titles(page)).toHaveCount(4);
  expect((await titles(page).allInnerTexts()).sort()).toEqual(["Onboard an API to Apigee", "Request a GCP project", "Request a repository", "Request an Azure landing zone"]);
});

test("on a phone and in dark nothing runs past the road or the card", async ({ page }) => {
  await signIn(page, SAM);
  await page.addInitScript(() => { try { localStorage.setItem("pm:theme", "dark"); } catch { /* ignore */ } }); // after signIn's "light"
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/p/request-github-repository");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(road(page)).toBeVisible();
  const boxes = await road(page).evaluate((r) => {
    const box = r.getBoundingClientRect();
    return { road: [box.left, box.right], parts: [...r.querySelectorAll(".path-lane, .path-lane *")].filter((e) => e.getBoundingClientRect().width > 0 && !e.closest(".sr-only")).map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1 && e.classList.contains("path-name") ? "cut" : ""]; }) };
  });
  expect(boxes.road[0]).toBeGreaterThanOrEqual(0);
  expect(boxes.road[1]).toBeLessThanOrEqual(390);
  for (const [l, r, cut] of boxes.parts) {
    expect(l as number).toBeGreaterThanOrEqual(boxes.road[0] - 0.5);
    expect(r as number).toBeLessThanOrEqual(boxes.road[1] + 0.5);
    expect(cut).toBe("");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // the cards' corner on a phone
  await open(page, "/processes");
  const repo = card(page, "Request a repository");
  await expect(repo.locator(".path-mark")).toHaveCount(2);
  const [cardBox, marks] = [(await repo.boundingBox())!, (await repo.locator(".path-marks").boundingBox())!];
  expect(marks.x + marks.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("the paths of a working draft are shown to nobody who may not see the draft", async ({ page, request }) => {
  await as(request, ALEX);
  const servicenow = (await readProcess(request, "raise-servicenow-request"))!;
  expect((await request.put(`/api/processes/${PROC}?base=0`, { data: { ...servicenow, id: PROC, title: "Paths demo process" }, headers: CSRF })).ok()).toBeTruthy();
  const draft = await putWorkingDraft(request, "process", PROC, { ...servicenow, id: PROC, title: "Paths demo process", paths: ["brownfield"] });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  try {
    await signIn(page, SAM);
    expect((await readProcess(page, PROC))!.paths).toBeUndefined();
    await open(page, `/p/${PROC}`);
    await expect(page.locator(".path-any")).toHaveText("This process applies whatever the path. Any path");
    await expect(road(page)).toHaveCount(0);
    await open(page, "/processes");
    await expect(card(page, "Paths demo process").locator(".path-marks")).toHaveCount(0);
    // not in the filter's counts, not under the path in Teams & tools
    await pickFilter(page, "Path", "Not tied to a path");
    await expect(card(page, "Paths demo process")).toBeVisible();
    await open(page, "/catalog");
    await tab(page, "Paths").click();
    await item(page, "Brownfield").click();
    await expect(page.locator(".cat-detail")).not.toContainText("Paths demo process");
    // the editor sees it in the draft only
    await signIn(page, ALEX);
    await openEditor(page, "process", PROC);
    await expect(page.locator("main.edit-middle figure.path-road .path-lane.on .path-name")).toHaveText(["Brownfield"]);
  } finally {
    await discardWorkingDraft(request, "process", PROC);
  }
});
