import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, open, RILEY, SAM, signIn } from "./helpers";

// Requests for processes and standards that do not exist yet: anyone asks and votes; whoever
// could make it plans it, marks it done or declines it; the person who asked may withdraw it
// while it is open. Requests stay for the whole run, so each test asks with titles of its own.

const run = Date.now().toString(36);
const title = (what: string) => `${what} ${run}`;

interface Req { id: number; title: string; state: string; votes: number; canManage: boolean; mine: boolean; linkedId: string }

async function as(request: APIRequestContext, email: string) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
}
async function ask(request: APIRequestContext, email: string, body: { kind: "process" | "standard"; title: string; description?: string; platform?: string; practice?: string }): Promise<Req> {
  await as(request, email);
  const res = await request.post("/api/requests", { data: { description: "Needed by several teams, and nobody knows how today.", ...body }, headers: CSRF });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}
const setState = (request: APIRequestContext, id: number, body: Record<string, string>) =>
  request.put(`/api/requests/${id}/state`, { data: body, headers: CSRF });
async function list(request: APIRequestContext): Promise<Req[]> {
  return (await (await request.get("/api/requests")).json()).requests;
}

const item = (page: Page, t: string) => page.locator("li.req-item", { has: page.getByRole("heading", { name: t, exact: true }) });

test("Sam asks for a process: checked as he types, similar titles offered, then listed as his with no votes", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/");
  await page.locator(".nav").getByRole("link", { name: "Requests" }).click();
  await expect(page).toHaveURL(/#\/requests$/);
  await expect(page.getByRole("heading", { name: "Requests", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Ask for a process or standard" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Ask for a process or standard" });
  const kinds = dialog.getByRole("group", { name: "What is missing" });
  await expect(kinds.getByRole("button", { name: "A process: how to get something done" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Name")).toBeFocused();

  // too short: said in words, and nothing is sent
  await dialog.getByLabel("Name").fill("GCP");
  await dialog.getByLabel("What is needed and why").fill("Short");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog.getByText("Give it a name of at least 5 characters.")).toBeVisible();
  await expect(dialog.getByText(/Say in a sentence what is needed and why \(at least 10 characters\)\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send request" })).toBeDisabled();
  await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");

  // what exists with a similar name is offered first
  await dialog.getByLabel("Name").fill(title("Request a GCP project folder"));
  const similar = dialog.locator(".req-similar");
  await expect(similar).toContainText("Is it one of these?");
  await expect(similar.getByRole("link", { name: "Request a GCP project" })).toHaveAttribute("href", "#/p/request-gcp-project/flow");
  await dialog.getByLabel("What is needed and why").fill("A folder groups the projects of one department; today people ask in Slack.");
  await expect(dialog.getByText("Give it a name of at least 5 characters.")).toHaveCount(0);
  await dialog.getByLabel("Platform").selectOption({ label: "Google Cloud" });
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".toast", { hasText: "Your request was sent. Others can now vote for it." })).toBeVisible();

  // in the open list, his, with no votes yet
  await expect(page.getByRole("group", { name: "State" }).getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "true");
  const mine = item(page, title("Request a GCP project folder"));
  await expect(mine).toHaveClass(/state-open/);
  await expect(mine.locator(".req-mine")).toHaveText("Yours");
  await expect(mine.locator(".req-kind")).toHaveText("Process");
  await expect(mine.locator(".req-votes")).toHaveText("0");
  await expect(mine.getByRole("button", { name: `Vote for ${title("Request a GCP project folder")}, 0 votes` })).toHaveAttribute("aria-pressed", "false");
  await expect(mine.locator(".req-meta")).toContainText("Asked by Sam Consumer on");
  await expect(mine.locator(".req-meta")).toContainText("Platform: Google Cloud");
  // a reader manages nothing, not even his own: he may only withdraw it
  await expect(mine.locator(".req-actions").getByRole("button")).toHaveText(["Withdraw"]);
  await page.reload();
  await expect(mine.locator(".req-votes")).toHaveText("0");

  // the server checks the same
  const short = await page.request.post("/api/requests", { data: { kind: "process", title: "abc", description: "Long enough description." }, headers: CSRF });
  expect(short.status()).toBe(400);
  const unknown = await page.request.post("/api/requests", { data: { kind: "process", title: title("Unknown platform"), description: "Long enough description.", platform: "mars" }, headers: CSRF });
  expect(unknown.status()).toBe(400);
  expect((await unknown.json()).error).toContain("mars");
});

test("votes: one per person, most wanted first", async ({ page, request }) => {
  const a = await ask(request, RILEY, { kind: "process", title: title("Rotate a service account key") });
  const b = await ask(request, RILEY, { kind: "process", title: title("Request a Kafka topic") });
  for (const who of [ALEX, JORDAN]) {
    await signIn(page, who);
    await open(page, "/requests");
    await item(page, b.title).getByRole("button", { name: /^Vote for / }).click();
    await expect(item(page, b.title).getByRole("button", { name: /^Vote for / })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(item(page, b.title).locator(".req-votes")).toHaveText("2");
  await expect(item(page, b.title).getByRole("button", { name: `Vote for ${b.title}, 2 votes` })).toBeVisible();
  // a second vote by the same person, straight to the server, does not count twice
  const again = await page.request.put(`/api/requests/${b.id}/vote`, { headers: CSRF });
  expect(await again.json()).toEqual({ votes: 2 });

  // most wanted first: b (2 votes) before a (0)
  await page.reload();
  await expect(item(page, b.title)).toBeVisible();
  const titles = await page.locator("li.req-item h3.req-title").allTextContents();
  expect(titles.indexOf(b.title)).toBeGreaterThanOrEqual(0);
  expect(titles.indexOf(b.title)).toBeLessThan(titles.indexOf(a.title));
  const votes = (await page.locator("li.req-item .req-votes").allTextContents()).map(Number);
  expect(votes).toEqual([...votes].sort((x, y) => y - x));

  // a vote can be taken back
  await item(page, b.title).getByRole("button", { name: `Vote for ${b.title}, 2 votes` }).click();
  await expect(item(page, b.title).getByRole("button", { name: `Vote for ${b.title}, 1 vote` })).toHaveAttribute("aria-pressed", "false");
  const off = await page.request.delete(`/api/requests/${b.id}/vote`, { headers: CSRF });
  expect(await off.json()).toEqual({ votes: 1 });
});

test("Jordan, owner of Google Cloud, manages the requests that name it, and only those", async ({ page, request }) => {
  const gcp = await ask(request, CASEY, { kind: "process", title: title("Delete a GCP project"), platform: "google-cloud" });
  const azure = await ask(request, CASEY, { kind: "process", title: title("Delete an Azure subscription"), platform: "azure" });
  const declined = await ask(request, CASEY, { kind: "process", title: title("Move a GCP project to another folder"), platform: "google-cloud" });
  await signIn(page, JORDAN);
  await open(page, "/requests");

  // nothing to do on the Azure one, and the server refuses it too
  await expect(item(page, azure.title).locator(".req-actions")).toHaveCount(0);
  const refused = await setState(page.request, azure.id, { state: "planned" });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe("Only admins, process editors and the owners of the platform or practice it names can change the state of this request.");

  // plan the Google Cloud one, with a note
  const mine = item(page, gcp.title);
  await expect(mine.locator(".req-actions").getByRole("button")).toHaveText(["Plan", "Mark as done", "Decline"]);
  await mine.getByRole("button", { name: "Plan", exact: true }).click();
  const plan = page.getByRole("dialog", { name: "Mark as planned" });
  await plan.getByLabel("Note").fill("In the next sprint.");
  await plan.getByRole("button", { name: "Mark as planned" }).click();
  await expect(page.locator(".toast", { hasText: "Marked as planned." })).toBeVisible();
  // it left the open list
  await expect(mine).toHaveCount(0);
  await page.getByRole("group", { name: "State" }).getByRole("button", { name: /^Planned/ }).click();
  await expect(page).toHaveURL(/#\/requests\?state=planned$/);
  await expect(mine.locator(".req-outcome.planned")).toContainText("Planned by Jordan Platform");
  await expect(mine.locator(".req-outcome.planned")).toContainText("In the next sprint.");

  // done needs an existing process, and links to it
  const noDoc = await setState(page.request, gcp.id, { state: "done", linkedId: "no-such-process" });
  expect(noDoc.status()).toBe(400);
  expect((await noDoc.json()).error).toBe("There is no process “no-such-process”.");
  expect((await setState(page.request, gcp.id, { state: "done" })).status()).toBe(400);
  await mine.getByRole("button", { name: "Mark as done" }).click();
  const done = page.getByRole("dialog", { name: "Mark as done" });
  await done.getByLabel("The process that answers it").selectOption({ label: "Request a GCP project" });
  await done.getByRole("button", { name: "Mark as done" }).click();
  await expect(page.locator(".toast", { hasText: "Marked as done. Everyone sees what answers it." })).toBeVisible();
  await page.getByRole("group", { name: "State" }).getByRole("button", { name: /^Done/ }).click();
  await expect(page).toHaveURL(/#\/requests\?state=done$/);
  const answer = mine.locator("a.req-answer");
  await expect(answer).toHaveText("Request a GCP project");
  await expect(answer).toHaveAttribute("href", "#/p/request-gcp-project/flow");

  // declined needs a reason
  await page.getByRole("group", { name: "State" }).getByRole("button", { name: /^Open/ }).click();
  await item(page, declined.title).getByRole("button", { name: "Decline" }).click();
  const decline = page.getByRole("dialog", { name: "Decline request" });
  await expect(decline.getByRole("button", { name: "Decline request" })).toBeDisabled();
  expect((await setState(page.request, declined.id, { state: "declined" })).status()).toBe(400);
  await decline.getByLabel("Why not").fill("Use “Request a GCP project” and choose the new folder there.");
  await decline.getByRole("button", { name: "Decline request" }).click();
  await expect(page.locator(".toast", { hasText: "Declined. Everyone sees the reason." })).toBeVisible();

  // a reader sees all of it, and no buttons to manage
  await signIn(page, SAM);
  await open(page, "/requests?state=all");
  await expect(page.getByRole("group", { name: "State" }).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  for (const t of [gcp.title, azure.title, declined.title]) await expect(item(page, t)).toBeVisible();
  await expect(item(page, gcp.title).locator("a.req-answer")).toHaveText("Request a GCP project");
  await expect(item(page, declined.title).locator(".req-outcome.declined")).toContainText("Use “Request a GCP project” and choose the new folder there.");
  for (const t of [gcp.title, azure.title, declined.title]) await expect(item(page, t).locator(".req-actions")).toHaveCount(0);
  expect((await setState(page.request, azure.id, { state: "planned" })).status()).toBe(403);
});

test("Alex, a process editor, manages process requests but not standard requests", async ({ page, request }) => {
  const process = await ask(request, RILEY, { kind: "process", title: title("Request a service mesh namespace") });
  const standard = await ask(request, RILEY, { kind: "standard", title: title("Retention of audit logs") });
  await signIn(page, ALEX);
  await open(page, "/requests");
  await expect(item(page, process.title).getByRole("button", { name: "Plan", exact: true })).toBeVisible();
  await expect(item(page, standard.title).locator(".req-actions")).toHaveCount(0);
  const refused = await setState(page.request, standard.id, { state: "planned" });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toContain("standards editors");
  expect((await list(page.request)).find((r) => r.id === standard.id)!.canManage).toBe(false);
  expect((await list(page.request)).find((r) => r.id === process.id)!.canManage).toBe(true);

  // done with a standard of the right kind only
  const wrongKind = await setState(page.request, process.id, { state: "done", linkedId: "secure-logging" });
  expect(wrongKind.status()).toBe(400);
  await item(page, process.title).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("dialog", { name: "Mark as planned" }).getByRole("button", { name: "Mark as planned" }).click();
  await expect(page.locator(".toast", { hasText: "Marked as planned." })).toBeVisible();
  // and back to open
  await open(page, "/requests?state=planned");
  await item(page, process.title).getByRole("button", { name: "Back to open" }).click();
  await expect(item(page, process.title)).toHaveCount(0);
  await open(page, "/requests");
  await expect(item(page, process.title)).toHaveClass(/state-open/);

  // an admin manages both
  await signIn(page, DANA);
  await open(page, "/requests");
  await expect(item(page, standard.title).getByRole("button", { name: "Plan", exact: true })).toBeVisible();
  await expect(item(page, process.title).getByRole("button", { name: "Plan", exact: true })).toBeVisible();
});

test("the person who asked may withdraw an open request of their own, nothing else", async ({ page, request }) => {
  const other = await ask(request, CASEY, { kind: "standard", title: title("Naming of cloud resources") });
  const planned = await ask(request, SAM, { kind: "process", title: title("Request a DNS record") });
  const open1 = await ask(request, SAM, { kind: "process", title: title("Request a TLS certificate") });
  await as(request, ALEX);
  expect((await setState(request, planned.id, { state: "planned" })).ok()).toBeTruthy();

  await signIn(page, SAM);
  // somebody else's: no button, and the server refuses
  await open(page, "/requests");
  await expect(item(page, other.title).getByRole("button", { name: "Withdraw" })).toHaveCount(0);
  const theirs = await page.request.delete(`/api/requests/${other.id}`, { headers: CSRF });
  expect(theirs.status()).toBe(403);
  expect((await theirs.json()).error).toBe("You can only withdraw your own request.");
  // his own, but planned already: no button, and the server says why
  await open(page, "/requests?state=planned");
  await expect(item(page, planned.title)).toBeVisible();
  await expect(item(page, planned.title).getByRole("button", { name: "Withdraw" })).toHaveCount(0);
  const late = await page.request.delete(`/api/requests/${planned.id}`, { headers: CSRF });
  expect(late.status()).toBe(409);
  expect((await late.json()).error).toBe("This request is no longer open, so it cannot be withdrawn.");

  // his own and open: it asks first
  await open(page, "/requests");
  await item(page, open1.title).getByRole("button", { name: "Withdraw" }).click();
  const confirm = page.getByRole("dialog", { name: "Withdraw your request?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(item(page, open1.title)).toBeVisible();
  await item(page, open1.title).getByRole("button", { name: "Withdraw" }).click();
  await confirm.getByRole("button", { name: "Withdraw request" }).click();
  await expect(page.locator(".toast", { hasText: "Your request was withdrawn." })).toBeVisible();
  await expect(item(page, open1.title)).toHaveCount(0);
  expect((await list(page.request)).some((r) => r.id === open1.id)).toBe(false);
});

test("the state and kind filters and the address agree", async ({ page, request }) => {
  const std = await ask(request, RILEY, { kind: "standard", title: title("Encryption of backups") });
  await signIn(page, SAM);
  await open(page, "/requests?state=done");
  const states = page.getByRole("group", { name: "State" });
  await expect(states.getByRole("button", { name: /^Done/ })).toHaveAttribute("aria-pressed", "true");
  await expect(states.getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "false");
  for (const s of await page.locator("li.req-item").all()) await expect(s).toHaveClass(/state-done/);

  await states.getByRole("button", { name: /^Open/ }).click();
  await expect(page).toHaveURL(/#\/requests$/);
  await expect(item(page, std.title)).toBeVisible();
  const kinds = page.getByRole("group", { name: "Kind" });
  await kinds.getByRole("button", { name: "Processes", exact: true }).click();
  await expect(page).toHaveURL(/#\/requests\?kind=process$/);
  await expect(item(page, std.title)).toHaveCount(0);
  await kinds.getByRole("button", { name: "Standards", exact: true }).click();
  await expect(page).toHaveURL(/#\/requests\?kind=standard$/);
  await expect(item(page, std.title)).toBeVisible();
  for (const s of await page.locator("li.req-item .req-kind").allTextContents()) expect(s).toBe("Standard");
  await states.getByRole("button", { name: /^Declined/ }).click();
  await expect(page).toHaveURL(/#\/requests\?state=declined&kind=standard$/);
  await page.reload();
  await expect(states.getByRole("button", { name: /^Declined/ })).toHaveAttribute("aria-pressed", "true");
  await expect(kinds.getByRole("button", { name: "Standards", exact: true })).toHaveAttribute("aria-pressed", "true");
  // the number on each state is how many there are of it
  await open(page, "/requests?state=all");
  const all = await list(page.request);
  await expect(states.getByRole("button", { name: /^All/ })).toContainText(String(all.length));
  await expect(page.locator("li.req-item")).toHaveCount(all.length);
});

test("the lists and the empty search lead to the requests", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=zzqx");
  await page.locator(".search-empty").getByRole("link", { name: "Ask for it, or vote for what others asked for" }).click();
  await expect(page).toHaveURL(/#\/requests$/);
  await open(page, "/");
  await expect(page.locator(".home-ask").getByRole("link", { name: "Ask for it, or vote for what others asked for" })).toHaveAttribute("href", "#/requests");
});
