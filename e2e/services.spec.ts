import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, navigate, open, openEditor, pickKind, publish, readCatalog, signIn, watchErrors } from "./helpers";
// @ts-expect-error a module of the scripts, without types
import { db } from "../scripts/env.mjs";

// Services: what a team does for others on request. A place of the top bar (#/services) and a page
// of each (#/service/:id); managed in Admin › Services, the same page and draft as Teams and
// Tools, with a rich-text description; requested by a step of a process (a box). Tests that
// change something work on entries and copies of their own and remove them afterwards.

const PREFIX = "svc-demo-";
const card = (page: Page) => page.locator(".svc-card");
const detail = (page: Page) => page.locator(".cat-detail");
const sideMenu = (page: Page) => page.locator(".admin-nav");

async function login(request: APIRequestContext, email = ALEX) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
/** Saves the lists through the API with a change, as a lists manager. */
async function changeLists(request: APIRequestContext, change: (c: Record<string, any>) => void) {
  await login(request);
  const res = await request.get("/api/catalog");
  const version = Number(res.headers()["x-document-version"]);
  const c = await res.json();
  change(c);
  return request.put(`/api/catalog?base=${version}`, { data: c, headers: CSRF });
}

test.afterEach(async ({ request }) => {
  await login(request);
  const { processes } = await (await request.get("/api/processes")).json();
  for (const p of processes.filter((x: { id: string }) => x.id.startsWith(PREFIX))) await request.delete(`/api/processes/${p.id}`, { headers: CSRF });
  const c = await readCatalog(request);
  if ((c.services ?? []).some((s: { id: string }) => s.id.startsWith(PREFIX) || s.id.startsWith("badge"))) {
    const res = await changeLists(request, (x) => { x.services = x.services.filter((s: { id: string }) => !s.id.startsWith(PREFIX) && !s.id.startsWith("badge")); });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test("Services is a place of the top bar: the list finds by words and by team, each service has a page", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, SAM);
  await open(page, "/");
  await expect(page.locator("nav.nav").getByRole("link")).toHaveText(["Home", "Patterns", "Standards", "Services", "Requests", "Teams", "Tools", "Guide"]);
  await navigate(page, "Services");
  await expect(page).toHaveURL(/#\/services$/);
  await expect(page).toHaveTitle(/^Services · /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Services");
  await expect(card(page)).toHaveCount(6);
  await expect(page.locator(".svc-count")).toHaveText("6 services");
  // each card: its name to its page, its summary, the team as a link and the front-door form
  const dns = card(page).filter({ hasText: "DNS record change" });
  await expect(dns.getByRole("link", { name: "DNS record change" })).toHaveAttribute("href", "#/service/dns-record-change");
  await expect(dns.locator(".svc-team")).toHaveText("Performed by DNS team");
  await expect(dns.getByRole("link", { name: "DNS team" })).toHaveAttribute("href", "#/team/dns-team");
  const request = dns.getByRole("link", { name: "Request this service" });
  await expect(request).toHaveAttribute("href", "https://forms.example.com/dns/record-change");
  await expect(request).toHaveAttribute("target", "_blank");
  await expect(request).toHaveAttribute("rel", "noopener noreferrer");
  await expect(card(page).filter({ hasText: "Penetration test" }).getByRole("link", { name: "Book a penetration test" })).toBeVisible();
  // the search, in the address; words of the description count too
  await page.getByLabel("Search services").fill("dig +short");
  await expect(card(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/services\?q=dig%20%2Bshort$/);
  await page.getByLabel("Search services").fill("");
  await page.getByLabel("Performed by").selectOption({ label: "Network team (1)" });
  await expect(page).toHaveURL(/#\/services\?team=network-team$/);
  await expect(card(page)).toHaveText([/Firewall rule change/]);
  await page.reload();
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByLabel("Performed by")).toHaveValue("network-team");

  // the page of a service
  await open(page, "/service/dns-record-change");
  await expect(page).toHaveTitle(/^DNS record change · /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DNS record change");
  await expect(page.locator(".group-kicker")).toHaveText("Service");
  await expect(page.locator(".svc-facts .svc-team")).toContainText("Performed by DNS team");
  // the one main button of the view opens the front-door form in a new tab
  const main = page.locator(".btn.primary");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveText("Request this service");
  await expect(main).toHaveAttribute("href", "https://forms.example.com/dns/record-change");
  await expect(main).toHaveAttribute("rel", "noopener noreferrer");
  // the description, shown from the allow-list
  const about = page.locator(".svc-description .rich-text");
  await expect(about.getByRole("heading", { level: 3 })).toHaveText(["What you get", "What to prepare", "How long it takes"]);
  await expect(about.locator("pre code")).toHaveText("dig +short shop.example.com");
  // used in: the published process whose step requests it, linking to the step
  const used = page.locator(".svc-used");
  await expect(used.getByRole("link", { name: "Onboard a site to Akamai" })).toBeVisible();
  await expect(used.getByRole("link", { name: "Step 9 “Request the DNS change to Akamai”" })).toHaveAttribute("href", "#/p/onboard-site-to-akamai/flow/switch-dns");
  // a reader manages nothing here
  await expect(page.getByRole("link", { name: "Edit in Admin › Services" })).toHaveCount(0);
  await expect(page.locator("nav.nav").getByRole("link", { name: "Services", exact: true })).toHaveAttribute("aria-current", "page");
  // the team's page lists what it performs
  await page.getByRole("link", { name: "DNS team" }).first().click();
  await expect(page).toHaveURL(/#\/team\/dns-team$/);
  const performs = page.locator(".group-services");
  await expect(performs.getByRole("heading")).toHaveText("Services this team performs");
  await expect(performs.getByRole("link", { name: "DNS record change" })).toHaveAttribute("href", "#/service/dns-record-change");
  // a team without services shows no such section
  await open(page, "/team/fulfilment-team");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fulfilment team");
  await expect(page.locator(".group-services")).toHaveCount(0);
  // a service that does not exist
  await open(page, "/service/nope");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service not found");
  await expect(page.getByRole("link", { name: "Back to Services" })).toHaveAttribute("href", "#/services");
  // an address that asks for a service of another place goes to its page
  await open(page, "/teams/services/penetration-test");
  await expect(page).toHaveURL(/#\/service\/penetration-test$/);
  expect(errors).toEqual([]);
});

test("a lists manager adds a service in Admin › Services: its fields, the editor, a paste from Word, one draft with Teams and Tools", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, ALEX);
  await open(page, "/service/dns-record-change");
  await page.getByRole("link", { name: "Edit in Admin › Services" }).click();
  await expect(page).toHaveURL(/#\/admin\/services\/dns-record-change$/);
  await expect(sideMenu(page).getByRole("link")).toHaveText(["Teams", "Tools", "Services", "Skills", "Health"]);
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Services");
  // one list: no row of tabs
  await expect(page.locator(".cat-kinds-groups")).toHaveCount(0);
  await expect(detail(page).locator('[data-field="name"]')).toHaveValue("DNS record change");
  await expect(detail(page).getByRole("heading", { name: "Used by 1 process" })).toBeVisible();
  await expect(detail(page).getByRole("button", { name: "Remove this service" })).toBeDisabled();

  // a new one: what is missing is to fix, by name
  await page.getByRole("button", { name: "New service" }).click();
  await page.getByLabel("Name").fill("Badge request");
  await page.getByRole("button", { name: "Add service" }).click();
  const checker = page.locator(".cat-issues");
  await expect(checker).toContainText("Choose the team that performs the service “Badge request”.");
  await expect(checker).toContainText("Give the front-door form of the service “Badge request”: the link where people request it.");
  await detail(page).getByLabel("Summary").fill("A building badge for a new joiner.");
  await detail(page).getByLabel("Performed by").selectOption({ label: "Service Management" });
  await detail(page).getByLabel("Front-door form").fill("forms.example.com/badge");
  await expect(checker).toContainText("The front-door form of the service “Badge request” is not a whole link: write it with https:// at the start.");
  await detail(page).getByLabel("Front-door form").fill("https://forms.example.com/badge");
  await expect(checker).toHaveCount(0);

  // the description: typed with the keyboard, formatted with the buttons and shortcuts
  const area = detail(page).locator(".rich-edit-area");
  await area.click();
  await page.keyboard.type("Bring an id.");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await detail(page).getByRole("button", { name: "Bulleted list (Ctrl+Shift+8)" }).click();
  await page.keyboard.type("a photo");
  await expect(detail(page).getByRole("button", { name: "Bulleted list (Ctrl+Shift+8)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  // a paste from Word: styles, classes, fonts, a comment and a script go; bold, a heading and the link stay
  await page.evaluate(() => {
    const html = `<!--StartFragment--><h1 class="MsoTitle" style="color:red">How long it takes</h1><p class="MsoNormal"><span style="font-family:Calibri"><b>Two</b> days, see </span><a href="https://wiki.example.com/badge" target="_blank" onclick="x()">the page</a></p><script>window.__pasted = 1</script><img src="https://evil.example/x.png">`;
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "How long it takes\nTwo days, see the page");
    document.querySelector(".rich-edit-area")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(area.getByRole("heading", { level: 3 })).toHaveText("How long it takes");
  await expect(area.locator("a")).toHaveAttribute("href", "https://wiki.example.com/badge");
  expect(await page.evaluate(() => (window as unknown as { __pasted?: number }).__pasted)).toBeUndefined();

  // one draft: the change is still there under Teams, and Discard is offered for all of it
  await sideMenu(page).getByRole("link", { name: "Teams" }).click();
  await expect(page.locator(".cat-save-text")).toHaveText("Unsaved changes to the lists");
  await sideMenu(page).getByRole("link", { name: "Services" }).click();
  await expect(detail(page).locator('[data-field="name"]')).toHaveValue("Badge request");
  await page.locator(".cat-save").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".cat-save-text")).toHaveCount(0);

  const saved = (await readCatalog(page)).services.find((s: { id: string }) => s.id === "badge-request");
  expect(saved).toEqual({
    id: "badge-request", name: "Badge request", summary: "A building badge for a new joiner.", team: "service-management", form: "https://forms.example.com/badge",
    description: "<p>Bring <strong>an id</strong>.</p><ul><li><p>a photo</p></li></ul><h3>How long it takes</h3><p><strong>Two</strong> days, see <a href=\"https://wiki.example.com/badge\">the page</a></p>",
  });
  // and readers see it at once
  await open(page, "/service/badge-request");
  await expect(page.locator(".svc-description .rich-text strong").first()).toHaveText("an id");
  await expect(page.locator(".btn.primary")).toHaveText("Request this service");
});

test("a service in a process: chosen on the editing screen, a box on the map and in the step, listed under Used in", async ({ page, request }) => {
  test.setTimeout(90_000);
  await login(request);
  const { processes } = await (await request.get("/api/processes")).json();
  const src = processes.find((p: { id: string }) => p.id === "request-github-repository");
  const id = `${PREFIX}process`;
  const res = await request.put(`/api/processes/${id}?base=0`, { data: { ...src, id, title: "Service box demo", status: "active" }, headers: CSRF });
  expect(res.ok(), await res.text()).toBeTruthy();
  const step = src.steps.find((s: { actor: string }) => s.actor === "me");

  await signIn(page, ALEX);
  await openEditor(page, "process", id, step.id);
  await pickKind(page, "Service");
  const fieldsPanel = page.locator(".edit-fields");
  // to fix until a service is chosen, on its own field
  await expect(fieldsPanel.locator('[data-field="service"]')).toBeVisible();
  await expect(fieldsPanel.getByText("Services are added and changed in Admin › Services.")).toBeVisible();
  await fieldsPanel.locator('[data-field="service"]').selectOption({ label: "Firewall rule change" });
  await publish(page);

  await open(page, `/p/${id}/flow`);
  const block = page.locator(`.block[data-step="${step.id}"]`);
  await expect(block.locator(".block-type")).toHaveText("Service");
  await expect(block.locator(".meta-service")).toHaveText("Network team");
  await block.locator(".block-main").click();
  const box = page.locator(".drawer .svc-box");
  await expect(box.getByRole("link", { name: "Firewall rule change" })).toHaveAttribute("href", "#/service/firewall-rule-change");
  await expect(box.locator(".svc-box-team")).toHaveText("Performed by Network team");
  await expect(box.getByRole("link", { name: "Request this service" })).toHaveAttribute("href", "https://forms.example.com/network/firewall-rule");
  // the checklist has the same box
  await open(page, `/p/${id}/list`);
  await expect(page.locator(".svc-box").getByRole("link", { name: "Request this service" })).toBeVisible();
  // and the service's page lists the process
  await open(page, "/service/firewall-rule-change");
  await expect(page.locator(".svc-used").getByRole("link", { name: "Service box demo" })).toBeVisible();
  // the skill tells agents where to request it
  const skill = await (await request.get(`/api/skills/process-${id}`)).json();
  expect(skill.content).toContain("Request the service “Firewall rule change” from the team “Network team” through its front-door form: <https://forms.example.com/network/firewall-rule>");
});

test("a service a process uses, and a team that performs services, cannot be removed: the refusal says who", async ({ request }) => {
  const used = await changeLists(request, (c) => { c.services = c.services.filter((s: { id: string }) => s.id !== "dns-record-change"); });
  expect(used.status()).toBe(400);
  expect(await used.text()).toContain("“dns-record-change” is still used by “Onboard a site to Akamai”");
  const team = await changeLists(request, (c) => { c.teams = c.teams.filter((t: { id: string }) => t.id !== "edge-cdn-team"); });
  expect(team.status()).toBe(400);
  expect(await team.text()).toContain("the service “CDN configuration change”");
});

test("a hostile description stored past the gate runs nothing and shows nothing forbidden", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("dialog", (d) => { errors.push(`dialog: ${d.message()}`); void d.dismiss(); });
  const hostile = `<p>Hello <strong>there</strong></p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script>`
    + `<a href="javascript:window.__pwned=3">click</a><svg onload="window.__pwned=4"><circle r="5"/></svg><p style="color:red" onclick="window.__pwned=5" class="x" id="y">styled</p>`
    + `<iframe src="https://example.com"></iframe><noscript><p title="</noscript><img src=x onerror=window.__pwned=6>"></p></noscript><template><img src=x onerror=window.__pwned=7></template>`
    + `<math><mtext><table><mglyph><style><img src=x onerror=window.__pwned=8></style></mglyph></table></mtext></math><base href="https://evil.example/"><form action="https://evil.example"><input></form>`;
  // the server refuses it in words: the gate
  const refused = await changeLists(request, (c) => { c.services.find((s: { id: string }) => s.id === "cloud-project-support").description = hostile; });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("The description of the service “Cloud project support” contains");
  // past the gate, straight into the database, as an older or broken installation might hold it
  const c = await readCatalog(request);
  const at = c.services.findIndex((s: { id: string }) => s.id === "cloud-project-support");
  const before = c.services[at].description;
  const sql = (text: string) => {
    const r = spawnSync("psql", [db("pm_e2e").replace("?sslmode=disable", ""), "-q", "-v", "ON_ERROR_STOP=1", "-v", `d=${text}`, "-f", "-"], {
      input: `update documents set body = jsonb_set(body::jsonb, '{services,${at},description}', to_jsonb(:'d'::text))::json where kind = 'catalog';\n`, encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  };
  sql(hostile);
  try {
    await signIn(page, SAM);
    await open(page, "/service/cloud-project-support");
    const shown = page.locator(".svc-description .rich-text");
    await expect(shown.locator("strong")).toHaveText("there");
    await expect(shown).toContainText("styled");
    const markup = await shown.innerHTML();
    for (const bad of ["<script", "<img", "<svg", "<iframe", "<style", "<math", "<base", "<form", "<input", "<template", "<noscript", "onerror", "onclick", "onload", "javascript:", "style=", "class=", "id="]) {
      expect(markup, bad).not.toContain(bad);
    }
    // the link to javascript: is its words only
    await expect(shown.getByRole("link")).toHaveCount(0);
    await expect(shown).toContainText("click");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
    // nothing outside the page's own host was asked for
    await expect(page.locator("base")).toHaveCount(0);
  } finally {
    sql(before);
  }
});

test("an installation without services: the place is calm and says where to add one", async ({ page }) => {
  // the lists as an installation without the key has them (the sample's own services are in use)
  await page.route("**/api/catalog", async (route) => {
    const r = await route.fetch();
    const { services: _gone, ...rest } = await r.json();
    void _gone;
    await route.fulfill({ response: r, json: rest });
  });
  await signIn(page, DANA);
  await open(page, "/services");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Services");
  await expect(page.locator(".svc-empty")).toContainText("No services are listed yet.");
  await expect(page.locator(".svc-empty").getByRole("link", { name: "Admin › Services" })).toHaveAttribute("href", "#/admin/services");
  await expect(page.locator(".svc-bar")).toHaveCount(0);
  await signIn(page, SAM);
  await open(page, "/services");
  await expect(page.locator(".svc-empty")).toHaveText("No services are listed yet.");
});

test("the editor: white space kept as typed, its own Undo never reaches back past the page's, no Ctrl+Alt shortcut, one Tab stop for its toolbar", async ({ page }) => {
  test.setTimeout(90_000);
  const warnings: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
  await signIn(page, ALEX);
  await open(page, "/admin/services/dns-record-change");
  // one sentence at the top: the place's lead, not the list's words again
  await expect(page.locator(".admin-main > header.admin-head .lead")).toHaveText(/^What teams do for others on request/);
  await expect(page.locator(".cat-blurb")).toHaveText("");
  const area = detail(page).locator(".rich-edit-area");
  await expect(area).toBeVisible();
  // the toolbar: nothing looks pressed while the editor does not have the keyboard
  const tools = detail(page).getByRole("toolbar", { name: "Formatting" });
  await expect(tools.locator('[aria-pressed="true"]')).toHaveCount(0);
  // one Tab stop, the arrows and Home / End inside it, the text next
  await detail(page).getByLabel("Words of the button").focus();
  await page.keyboard.press("Tab");
  await expect(tools.getByRole("button", { name: /^Bold/ })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tools.getByRole("button", { name: /^Italic/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(tools.getByRole("button", { name: /^Link/ })).toBeFocused(); // Undo and Redo cannot be pressed yet
  await page.keyboard.press("Home");
  await expect(tools.getByRole("button", { name: /^Bold/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(area).toBeFocused();
  await expect(tools.getByRole("button", { name: /^Link/ })).toHaveAttribute("aria-expanded", "false");
  await expect(tools.getByRole("button", { name: /^Link/ })).not.toHaveAttribute("aria-pressed", /.*/);
  // no shortcut with Ctrl and Alt (AltGr on Windows types characters with it)
  await area.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("end  two");
  const before = await area.innerHTML();
  for (const k of ["Control+Alt+c", "Control+Alt+3", "Control+Alt+4", "Control+Alt+0"]) await page.keyboard.press(k);
  expect(await area.innerHTML()).toBe(before);
  // the page's Undo takes it all back; then the editor's own Undo has nothing to bring back
  const save = page.locator(".cat-save");
  await expect(page.locator(".cat-save-text")).toHaveText("Unsaved changes to the lists");
  for (let i = 0; i < 10 && await page.locator(".cat-save-text").count(); i++) await save.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cat-save-text")).toHaveCount(0);
  await expect(area).not.toContainText("end");
  await expect(tools.getByRole("button", { name: /^Undo/ })).toBeDisabled();
  await area.click();
  await page.keyboard.press("Control+z");
  await expect(area).not.toContainText("end");
  await expect(page.locator(".cat-save-text")).toHaveCount(0);
  // typed white space is stored as typed: no non-breaking spaces
  await area.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("end  two");
  await save.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".cat-save-text")).toHaveCount(0);
  const stored = (await readCatalog(page)).services.find((s: { id: string }) => s.id === "dns-record-change").description as string;
  expect(stored).toContain("<p>end  two</p>");
  expect(stored).not.toContain(" ");
  expect(stored).not.toContain("&nbsp;");
  expect(warnings.filter((w) => /ProseMirror|white-space/i.test(w))).toEqual([]);
  // put the sample back
  const res = await changeLists(page.request, (c) => { const s = c.services.find((x: { id: string }) => x.id === "dns-record-change"); s.description = stored.replace("<p>end  two</p>", ""); });
  expect(res.ok(), await res.text()).toBeTruthy();
});

test("Admin › Teams names the services a team performs, each leading to it under Services; an unknown team leaves the list's address", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/admin/teams/teams/network-team");
  const usage = detail(page).locator(".cat-usage");
  await expect(usage.getByRole("heading")).toHaveText(["Used by no process or standard", "Performs 1 service"]);
  await usage.getByRole("button", { name: /Firewall rule change/ }).click();
  await expect(page).toHaveURL(/#\/admin\/services$/);
  await expect(page.locator(".admin-main > header.admin-head h1")).toHaveText("Services");
  await expect(detail(page).locator('[data-field="name"]')).toHaveValue("Firewall rule change");
  // a team in the address that performs no service is dropped, as every filter drops what is gone
  await open(page, "/services?q=dns&team=nobody");
  await expect(page).toHaveURL(/#\/services\?q=dns$/);
  await expect(card(page)).toHaveCount(1);
  // the plural with an entry is that service's page
  await open(page, "/services/dns-record-change");
  await expect(page).toHaveURL(/#\/service\/dns-record-change$/);
});
