import { expect, test, type APIRequestContext } from "@playwright/test";
import { ALEX, CSRF, DANA, JORDAN, SAM, answer, open, signIn } from "./helpers";

// Admin > Access: one entry per person with all their roles in words, one dialog that sets all of
// a person's roles at once, and Delete that takes them all away. The protections are said in the
// page and kept by the server.

const NEW = "morgan@example.com"; // nobody in the sample

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
/** Jordan and Sam back as they were, Morgan without roles. */
async function reset(request: APIRequestContext) {
  await as(request, DANA);
  const put = (email: string, roles: { role: string; scope: string }[]) => request.put(`/api/admin/users/${email}`, { data: { roles }, headers: CSRF });
  expect((await put(JORDAN, [{ role: "owner", scope: "cloud-platform-team" }, { role: "platform-owner", scope: "google-cloud" }, { role: "practice-owner", scope: "engineering" }])).ok()).toBeTruthy();
  await request.delete(`/api/admin/users/${NEW}`, { headers: CSRF });
  await request.delete(`/api/admin/users/${SAM}`, { headers: CSRF });
}
test.afterEach(async ({ request }) => { await reset(request); });

test("Access lists people with their roles in words, and can be searched", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  const row = (name: string) => page.locator("li.user-row", { hasText: name });
  await expect(row("Jordan Platform").getByRole("list", { name: "Roles of Jordan Platform" }).locator("li")).toHaveText(["Platform owner for Google Cloud", "Practice owner for Engineering", "Owner for Cloud Platform team"]);
  await expect(row("Alex Editor").locator(".user-roles li")).toHaveText(["Lists manager", "Process editor"]);
  await expect(row("Dana Admin")).toContainText("you");
  await expect(row("Dana Admin").locator(".user-fixed")).toHaveText("server settings");
  await expect(row("Jordan Platform")).toContainText(JORDAN);

  const search = page.getByRole("searchbox", { name: "Search people" });
  await search.fill("google");
  await expect(page.locator("li.user-row")).toHaveCount(1);
  await expect(page.locator("li.user-row")).toContainText("Jordan Platform");
  await search.fill("riley");
  await expect(page.locator("li.user-row")).toHaveText([/Riley Security/]);
  await search.fill("nobody at all");
  await expect(page.locator(".users-list")).toContainText("Nobody matches your search.");
});

test("Add person with two roles, one of them for a platform; it takes effect at once", async ({ page, browser }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  await page.getByRole("button", { name: "Add person" }).click();
  const dialog = page.getByRole("dialog", { name: "Add person" });
  await dialog.getByLabel("Email").fill(SAM); // a reader so far
  await dialog.getByRole("switch", { name: /^Process editor/ }).check();
  await dialog.getByRole("switch", { name: /^Platform owner/ }).check();
  // the platform is asked for: without it the dialog says what is missing
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog.locator(".roles-problems")).toContainText("Choose the platform for Platform owner, or remove that line.");
  await dialog.getByRole("combobox", { name: "Platform owner: platform 1" }).selectOption({ label: "Azure" });
  await expect(dialog.locator(".roles-summary")).toHaveText("Gives: Process editor, Platform owner for Azure");
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("li.user-row", { hasText: SAM }).locator(".user-roles li")).toHaveText(["Process editor", "Platform owner for Azure"]);

  // Sam, in another browser, may now edit processes
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const m = await ctx.newPage();
  await signIn(m, SAM);
  expect((await (await m.request.get("/api/me")).json()).perms).toMatchObject({ processes: true, platforms: ["azure"] });
  await open(m, "/p/request-gcp-project/flow");
  await expect(m.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await ctx.close();
});

test("Edit adds a second platform and takes a role away in one save; the summary says what is given and taken", async ({ page, browser }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  await page.getByRole("button", { name: "Edit Jordan Platform" }).click();
  const dialog = page.getByRole("dialog", { name: "Roles of Jordan Platform" });
  await expect(dialog.locator(".roles-summary")).toHaveText("Nothing changed yet.");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Another platform" }).click();
  await dialog.getByRole("combobox", { name: "Platform owner: platform 2" }).selectOption({ label: "Azure" });
  await dialog.getByRole("button", { name: "Remove Practice owner line 1" }).click();
  await expect(dialog.getByRole("switch", { name: /^Practice owner/ })).not.toBeChecked();
  await expect(dialog.locator(".roles-summary")).toHaveText("Gives: Platform owner for Azure · Takes away: Practice owner for Engineering");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("li.user-row", { hasText: "Jordan Platform" }).locator(".user-roles li")).toHaveText(["Platform owner for Azure", "Platform owner for Google Cloud", "Owner for Cloud Platform team"]);

  // his rights changed at once: Azure is his, Engineering no longer
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const j = await ctx.newPage();
  await signIn(j, JORDAN);
  expect((await (await j.request.get("/api/me")).json()).perms).toMatchObject({ platforms: ["azure", "google-cloud"], practices: [] });
  await open(j, "/p/request-azure-landing-zone/flow");
  await expect(j.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await open(j, "/s/code-review/doc");
  await j.reload();
  await expect(j.locator(".req").first()).toBeVisible();
  await expect(j.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await ctx.close();

  // the activity log says it in words
  await open(page, "/admin/activity");
  await expect(page.locator(".activity li").first()).toContainText("changed the roles of jordan@example.com");
  await expect(page.locator(".activity li").first()).toContainText("added Platform owner for the platform Azure; removed Practice owner for the practice Engineering");
});

test("Delete asks, removes every role, and the person can still read", async ({ page, request }) => {
  await as(request, DANA);
  expect((await request.put(`/api/admin/users/${SAM}`, { data: { roles: [{ role: "standards-editor", scope: "" }, { role: "owner", scope: "dns-team" }] }, headers: CSRF })).ok()).toBeTruthy();
  await signIn(page, DANA);
  await open(page, "/admin/access");
  await page.getByRole("button", { name: "Delete Sam Consumer" }).click();
  const ask = page.getByRole("dialog", { name: "Delete Sam Consumer?" });
  await expect(ask).toContainText("All of their roles are removed: Standards editor, Owner for DNS team.");
  await expect(ask).toContainText("can still sign in and read");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("li.user-row", { hasText: SAM })).toBeVisible();
  await page.getByRole("button", { name: "Delete Sam Consumer" }).click();
  await answer(page, "Delete Sam Consumer?", "Delete");
  await expect(page.locator("li.user-row", { hasText: SAM })).toHaveCount(0);
  const { users } = await (await page.request.get("/api/admin/users")).json();
  expect(users.some((u: { email: string }) => u.email === SAM)).toBe(false);
  await signIn(page, SAM);
  expect((await (await page.request.get("/api/me")).json()).perms).toMatchObject({ processes: false, standards: false, admin: false });
  await open(page, "/processes");
  await expect(page.locator(".card").first()).toBeVisible();
});

test("the protections are said on the page, and the server keeps them too", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/access");
  // herself, an admin named in the server settings
  const me = page.locator("li.user-row", { hasText: "Dana Admin" });
  await expect(me.getByRole("button", { name: "Delete Dana Admin" })).toBeDisabled();
  await expect(me.locator(".user-note")).toHaveText("You cannot delete yourself. Ask another admin to do it.");
  await me.getByRole("button", { name: "Edit Dana Admin" }).click();
  const dialog = page.getByRole("dialog", { name: "Roles of Dana Admin" });
  await expect(dialog.getByRole("switch", { name: /^Admin/ })).toBeDisabled();
  await expect(dialog.getByRole("switch", { name: /^Admin/ })).toBeChecked();
  await expect(dialog).toContainText("Named in the server setting PM_ADMINS, where the server is deployed. It cannot be taken away here.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // the server: deleting yourself is refused; the admin from the settings stays admin whatever is sent
  const del = await page.request.delete(`/api/admin/users/${DANA}`, { headers: CSRF });
  expect(del.status()).toBe(409);
  expect((await del.json()).error).toBe("You cannot remove all of your own roles. Ask another admin to do it.");
  expect((await page.request.put(`/api/admin/users/${DANA}`, { data: { roles: [] }, headers: CSRF })).ok()).toBeTruthy();
  expect((await (await page.request.get("/api/me")).json()).perms.admin).toBe(true);
  const { users } = await (await page.request.get("/api/admin/users")).json();
  expect(users.find((u: { email: string }) => u.email === DANA)).toMatchObject({ bootstrap: true });

  // a stored admin taking the admin role from themself is stated before sending
  await page.request.put(`/api/admin/users/${SAM}`, { data: { roles: [{ role: "admin", scope: "" }] }, headers: CSRF });
  await signIn(page, SAM);
  await open(page, "/admin/access");
  await page.getByRole("button", { name: "Edit Sam Consumer" }).click();
  const own = page.getByRole("dialog", { name: "Roles of Sam Consumer" });
  await own.getByRole("switch", { name: /^Admin/ }).uncheck();
  await own.getByRole("switch", { name: /^Process editor/ }).check();
  await own.getByRole("button", { name: "Save" }).click();
  await expect(own.locator(".roles-problems")).toContainText("You cannot take away your own admin role: you would lose access to this page. Ask another admin to do it.");
  await own.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("li.user-row", { hasText: "Sam Consumer" }).getByRole("button", { name: "Delete Sam Consumer" })).toBeDisabled();
  expect((await page.request.delete(`/api/admin/users/${SAM}`, { headers: CSRF })).status()).toBe(409);
});

test("nobody but an admin gets the people with their roles, or changes them", async ({ page }) => {
  for (const who of [SAM, ALEX, JORDAN]) {
    await signIn(page, who);
    expect((await page.request.get("/api/admin/users")).status(), who).toBe(403);
    expect((await page.request.put(`/api/admin/users/${NEW}`, { data: { roles: [{ role: "admin", scope: "" }] }, headers: CSRF })).status(), who).toBe(403);
    expect((await page.request.delete(`/api/admin/users/${JORDAN}`, { headers: CSRF })).status(), who).toBe(403);
  }
  // and mistakes are refused with the reason
  await signIn(page, DANA);
  const wrong = await page.request.put(`/api/admin/users/${NEW}`, { data: { roles: [{ role: "platform-owner", scope: "mars" }] }, headers: CSRF });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toContain("There is no platform “mars” in the lists.");
});

test("the Members section of a platform still adds and removes", async ({ page }) => {
  await signIn(page, DANA);
  await open(page, "/admin/lists");
  await page.locator(".cat-tabs").getByRole("tab", { name: /^Platforms/ }).click();
  await page.locator(".cat-item", { hasText: "Akamai" }).click();
  const members = page.locator(".cat-members");
  await members.getByLabel("Email of the new member").fill(NEW);
  await members.getByRole("button", { name: "Add member" }).click();
  await expect(members.locator("li", { hasText: NEW })).toContainText("Platform owner");
  await open(page, "/admin/access");
  await expect(page.locator("li.user-row", { hasText: NEW }).locator(".user-roles li")).toHaveText(["Platform owner for Akamai"]);
  await open(page, "/admin/lists");
  await page.locator(".cat-tabs").getByRole("tab", { name: /^Platforms/ }).click();
  await page.locator(".cat-item", { hasText: "Akamai" }).click();
  await members.getByRole("button", { name: `Remove ${NEW} as Platform owner` }).click();
  await page.getByRole("dialog", { name: "Remove this member?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(members.locator("li", { hasText: NEW })).toHaveCount(0);
});
