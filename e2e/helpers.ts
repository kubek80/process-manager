import { expect, type APIRequestContext, type Page } from "@playwright/test";

// The built-in development users and what they may do (see server/internal/auth/dev.go).
export const SAM = "sam@example.com"; // a reader (consumer), no role
export const ALEX = "alex@example.com"; // process editor (every process) and lists manager
export const CASEY = "casey@example.com"; // Owner of the team Cloud Platform team: confirms reviews, cannot edit
export const RILEY = "riley@example.com"; // Practice owner of Cyber security (edits what belongs to it) and Owner of the team Cyber Security
export const JORDAN = "jordan@example.com"; // a reader who is Platform owner of Google Cloud, Practice owner of Engineering and Owner of the Cloud Platform team
export const DANA = "dana@example.com"; // admin
export const MORGAN = "morgan@example.com"; // Platform member of Google Cloud and Practice member of Engineering: saves drafts there, an owner publishes them

export const CSRF = { "X-Requested-With": "process-manager" };


/**
 * Today as the server sees it: the day in UTC. The server dates a review with it when the app
 * sends no day, or one that is today nowhere on Earth (a browser clock installed far off).
 */
export const serverToday = () => new Date().toISOString().slice(0, 10);

/**
 * Today for a reader in `zone`, by the real clock: the day "Mark as reviewed" and a save are
 * dated with. Left out, the zone is the browser's own, which is the host's (playwright.config.ts
 * sets no `timezoneId`: UTC here and in CI, but not on every developer's machine).
 */
export const readerToday = (zone?: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * Sign in through the API (fast). The sign-in screen itself is covered in auth.spec.ts. What
 * somebody may do follows from their roles: there is no mode to choose.
 */
export async function signIn(page: Page, email: string) {
  // switching user mid-test: leave the app first, so the next page load starts from the new session
  if (page.url().startsWith("http")) await page.goto("about:blank");
  const res = await page.request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  expect(res.ok(), `sign in as ${email}`).toBeTruthy();
  await page.addInitScript(() => { try { localStorage.setItem("pm:theme", "light"); } catch { /* ignore */ } });
}

/**
 * Goes to a main place ("Processes", "Admin") the way a person does: the navigation in the top
 * bar, or below 1120 px wide the "Menu" button and its sheet.
 */
export async function navigate(page: Page, place: string) {
  const bar = page.locator("nav.nav").getByRole("link", { name: place, exact: true });
  // the top bar or its Menu button, once the app has drawn one of them
  await expect(bar.or(page.locator("button.menu-btn")).first()).toBeVisible();
  if (await bar.isVisible()) return bar.click();
  await page.locator("button.menu-btn").click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${place}(,|$)`) }).click();
}

export async function open(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
}

type Doc = Record<string, any>;
const api = (from: Page | APIRequestContext): APIRequestContext => ("request" in from ? from.request : from);

/** What is stored on the server right now, read through the API as the signed-in user. */
export async function readProcess(from: Page | APIRequestContext, id: string): Promise<Doc | undefined> {
  const { processes } = await (await api(from).get("/api/processes")).json();
  return processes.find((p: Doc) => p.id === id);
}
export async function readStandard(from: Page | APIRequestContext, id: string): Promise<Doc | undefined> {
  const { standards } = await (await api(from).get("/api/standards")).json();
  return standards.find((s: Doc) => s.id === id);
}
export async function readCatalog(from: Page | APIRequestContext): Promise<Doc> {
  return (await api(from).get("/api/catalog")).json();
}
export async function readSkill(from: Page | APIRequestContext, id: string): Promise<{ skill: Doc; content: string; versions: Doc[] }> {
  return (await api(from).get(`/api/skills/${id}`)).json();
}

/** Report feedback through the API, for tests that are about what happens afterwards. */
export async function report(request: APIRequestContext, email: string, body: { targetKind?: "process" | "standard"; targetId: string; itemId?: string; kind?: string; text: string }) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  const res = await request.post("/api/feedback", { data: { targetKind: "process", kind: "broken", ...body }, headers: CSRF });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

export async function clearFeedback(request: APIRequestContext, kind: "process" | "standard", id: string) {
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const all = await (await request.get("/api/feedback")).json();
  for (const item of all[kind]?.[id] ?? []) await request.delete(`/api/feedback/${item.id}`, { headers: CSRF });
}

/** Fail the test on any uncaught error in the page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Answer a question the app asks in its own dialog ("Delete this step?") by pressing one of its buttons. */
export const answer = async (page: Page, title: string | RegExp, button: string) => {
  await page.getByRole("dialog", { name: title }).getByRole("button", { name: button, exact: true }).click();
};

/** Saves the lists (Admin > Lists), which keep the ordinary save bar. */
export const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();
};

// ---------- the editing screen of a process or a standard

const docPath = (kind: "process" | "standard", id: string) => `/api/${kind === "process" ? "processes" : "standards"}/${id}`;

/** Opens the editing screen of a process or standard straight by its address (optionally with a step or requirement selected). */
export async function openEditor(page: Page, kind: "process" | "standard", id: string, item?: string) {
  await page.goto(`/#/${kind === "process" ? "p" : "s"}/${id}/edit${item ? `/${item}` : ""}`);
  await expect(page.locator(".edit-bar")).toBeVisible();
}

/** The state on the editing bar: its aria-label, e.g. "Unpublished changes. Readers still see version 1. Draft saved 14:02." */
export const editState = (page: Page) => page.locator(".edit-bar .eb-state");

/** Selects an entry of the outline on the left of the editing screen ("About", "3 Approve it"). */
export async function outline(page: Page, name: string | RegExp) {
  const nav = page.getByRole("navigation", { name: /^Outline of the/ });
  const strip = page.locator(".panel-strip").getByRole("button", { name: "Outline" });
  // on a narrow screen the outline is a panel that slides over: open it first
  await expect(nav.or(strip).first()).toBeVisible();
  if (!(await nav.isVisible())) await strip.click();
  await nav.getByRole("button", { name: typeof name === "string" ? new RegExp(`^${esc(name)}(\\s|,|$)`) : name }).click();
}

/** The fields panel of the editing screen, next to the outline. */
export const fields = (page: Page) => page.locator(".edit-fields");

/** "Save draft" and wait until it is saved (the state on the editing bar no longer says "Not saved yet"). */
export async function saveDraft(page: Page) {
  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  await expect(editState(page)).not.toHaveAttribute("aria-label", /Not saved yet/i);
  await expect(page.locator(".edit-bar .eb-saved")).toHaveText(/^(Draft saved \d\d:\d\d|Saved( \d\d:\d\d)?)$/);
  await expect(page.locator(".edit-bar").getByRole("button", { name: "Save draft" })).toBeDisabled();
}

/** "Publish…" -> (an optional note) -> "Publish", and wait until the editing bar says it is published. */
export async function publish(page: Page, note = "") {
  await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: /^Publish (your changes|this (process|standard)|.+’s changes)$/ });
  if (note) await dialog.getByLabel(/^Note for the list of versions/).fill(note);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editState(page)).toHaveAttribute("aria-label", /^(Published|Retired)\./);
}

/**
 * Why Save draft or Publish… did not happen: the reason at the top of the checker's list ("What
 * is to fix"), which opens by itself when one of them is refused.
 */
export const refusal = (page: Page) => page.getByRole("dialog", { name: "What is to fix" }).locator(".checker-reason");

/** Opens a folded group of fields ("Where it applies", "Review", "How it is checked"…) when it is folded. */
export async function unfold(page: Page, title: string) {
  const head = fields(page).getByRole("button", { name: title, exact: true });
  if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

/**
 * Presses "Delete step" / "Delete requirement" in the fields. The button ignores presses for
 * 700 ms after it appeared (so that a double press does not delete the next one too): wait first.
 */
export async function deleteSelected(page: Page, label: "Delete step" | "Delete requirement") {
  const button = fields(page).getByRole("button", { name: label });
  await expect(button).toBeEnabled();
  await page.waitForTimeout(750);
  await button.click();
}

/** The checker's chip on the editing bar: "3 to fix", "2 suggestions", "Nothing to fix". */
export const checkerChip = (page: Page) => page.locator(".edit-bar .eb-status");

/** Opens the checker's list ("What is to fix") from its chip on the editing bar. */
export async function openChecker(page: Page) {
  const pop = page.getByRole("dialog", { name: "What is to fix" });
  if (!(await pop.isVisible())) await checkerChip(page).click();
  await expect(pop).toBeVisible();
  return pop;
}

/** Chooses the kind of the selected step ("Decision", "Meeting"…) in the pop-up behind "Kind of step". */
export async function pickKind(page: Page, kind: string) {
  await fields(page).locator("button.kind-pick").click();
  const pop = fields(page).getByRole("group", { name: "Kind of step" });
  await pop.locator(".type-opt", { hasText: new RegExp(`^${esc(kind)}$`) }).click();
  await expect(pop).toHaveCount(0);
}

/** The outline on the left of the editing screen. */
export const outlineNav = (page: Page) => page.getByRole("navigation", { name: /^Outline of the/ });

/** The names of the items (steps or requirements) in the outline, in their order. */
export const outlineTitles = async (page: Page) =>
  (await outlineNav(page).locator(".outline-row.depth-1 .outline-label").allTextContents()).map((t) => t.replace(/^\d+(\.\d+)*/, "").trim());

/**
 * Adds steps (or requirements) by typing their names into the line at the end of the outline
 * ("Add a step" / "Add a requirement"): a name, Enter, the next one.
 */
export async function addInOutline(page: Page, ...names: string[]) {
  const nav = outlineNav(page);
  const open = nav.getByRole("button", { name: /^Add a (step|requirement)$/ });
  const field = nav.getByRole("textbox", { name: /^Add a (step|requirement)$/ });
  if (!(await field.isVisible())) await open.click();
  for (const name of names) {
    await field.fill(name);
    await field.press("Enter");
    await expect(field).toHaveValue("");
  }
}

/** Puts the selected step or requirement somewhere else with "Move…" in its fields ("Before 3. Approve it", "To the end"). */
export async function moveTo(page: Page, option: string | RegExp) {
  const select = fields(page).getByRole("combobox", { name: /^Move this (step|requirement)$/ });
  const label = typeof option === "string" ? option : (await select.locator("option").allTextContents()).find((t) => option.test(t));
  expect(label, `an option ${option} in Move…`).toBeTruthy();
  await select.selectOption({ label: label! });
}

/** An item of the "More" menu on the editing bar ("Versions", "Retire…", "JSON"). */
export async function more(page: Page, item: string) {
  await page.locator(".edit-bar").getByRole("button", { name: "More" }).click();
  await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: new RegExp(`^${esc(item)}`) }).click();
}

/** The working draft of a published document, as the signed-in user sees it (undefined when there is none). */
export async function readWorkingDraft(from: Page | APIRequestContext, kind: "process" | "standard", id: string): Promise<{ doc: Doc; base: number; revision: number; updatedBy: string } | undefined> {
  const res = await api(from).get(`${docPath(kind, id)}/draft`);
  // 204 (or, for somebody who may not edit, 404): there is none
  if (res.status() === 204 || res.status() === 404) return undefined;
  expect(res.ok(), `read the draft of ${id}`).toBeTruthy();
  return res.json();
}

/** Saves a working draft through the API: unpublished changes to a published document. */
export async function putWorkingDraft(from: Page | APIRequestContext, kind: "process" | "standard", id: string, body: Doc) {
  const rev = (await readWorkingDraft(from, kind, id))?.revision ?? 0;
  return api(from).put(`${docPath(kind, id)}/draft?rev=${rev}`, { data: body, headers: CSRF });
}

/** Publishes the working draft through the API. */
export async function publishWorkingDraft(from: Page | APIRequestContext, kind: "process" | "standard", id: string, note = "") {
  const rev = (await readWorkingDraft(from, kind, id))?.revision ?? 0;
  return api(from).post(`${docPath(kind, id)}/publish?rev=${rev}${note ? `&note=${encodeURIComponent(note)}` : ""}`, { headers: CSRF });
}

/** Throws the working draft away, if there is one (for cleaning up after a test). */
export async function discardWorkingDraft(from: Page | APIRequestContext, kind: "process" | "standard", id: string) {
  const w = await readWorkingDraft(from, kind, id);
  if (!w) return;
  const res = await api(from).delete(`${docPath(kind, id)}/draft?rev=${w.revision}`, { headers: CSRF });
  expect(res.status(), `discard the draft of ${id}`).toBe(204);
}

/** Changes a published document straight away, as a working draft that is published at once. */
export async function publishChange(from: Page | APIRequestContext, kind: "process" | "standard", id: string, body: Doc, note = "") {
  const put = await putWorkingDraft(from, kind, id, body);
  expect(put.ok(), `save the draft of ${id}: ${await put.text()}`).toBeTruthy();
  const res = await publishWorkingDraft(from, kind, id, note);
  expect(res.ok(), `publish ${id}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { version: number };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The stored version of a process or standard: what a save sends as `?base=`. */
export async function versionOf(from: Page | APIRequestContext, kind: "process" | "standard", id: string): Promise<number> {
  const body = await (await api(from).get(kind === "process" ? "/api/processes" : "/api/standards")).json();
  return body.meta?.[id]?.version ?? 0;
}

/**
 * Save a process or standard straight through the API, as the signed-in user, from the stored
 * version (or as a new one when it does not exist). For proving what the server allows,
 * whatever the browser shows.
 */
export async function putDoc(from: Page | APIRequestContext, kind: "process" | "standard", id: string, body: Doc) {
  const base = await versionOf(from, kind, id);
  return api(from).put(`/api/${kind === "process" ? "processes" : "standards"}/${id}?base=${base}`, { data: body, headers: CSRF });
}

/**
 * Opens "My application" (Tier, Environment, Language) in the filter panel when it is folded.
 * It opens by itself when something in it is chosen, and stays as it was left for the session.
 */
export async function openApplication(page: Page) {
  const toggle = page.getByRole("complementary", { name: "Filters" }).locator("button.filter-app-toggle");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

/**
 * Choose (or un-choose) a value in a dropdown of the filter panel on the left of a list
 * ("Category", "Platform", "Path", "Owner", and the single-choice "Tier", "Path", "Environment",
 * "Language" of My application) and close the dropdown again. "Path" is both: a filter, and a
 * choice of My application (`where: "application"`).
 */
export async function pickFilter(page: Page, filter: string, option: string | RegExp, where: "filters" | "application" = ["Tier", "Environment", "Language"].includes(filter) ? "application" : "filters") {
  const panel = page.getByRole("complementary", { name: "Filters" });
  const button = panel.locator(where === "application" ? ".filter-app" : ".filter-dds").getByRole("button", { name: new RegExp(`^${filter}:`) });
  await openApplication(page);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const name = typeof option === "string" ? new RegExp(`^${esc(option)}, \\d+ results?$`) : option;
  const list = button.locator("xpath=..").locator(".filter-dd-list");
  await list.getByRole("checkbox", { name }).or(list.getByRole("radio", { name })).click();
  await button.click(); // closes it
  await expect(button).toHaveAttribute("aria-expanded", "false");
}

/**
 * Waits until search by meaning answers: the server listens before its index is complete, and
 * until then `/api/search` answers 503 "not ready yet". Call it before the first test of a file
 * that searches by meaning. Signs in `request` as Alex (who searches by meaning in no test that
 * counts on the limit of 60 a minute).
 */
export async function meaningReady(request: APIRequestContext, timeout = 25_000) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  await expect.poll(async () => (await request.get("/api/search?q=x&limit=1")).status(), {
    message: `search by meaning did not become ready within ${timeout / 1000} seconds: /api/search kept answering 503 "not ready yet"`,
    timeout, intervals: [250, 500, 1000],
  }).not.toBe(503);
  expect((await request.get("/api/search?q=x&limit=1")).status(), "search by meaning answers").toBe(200);
}
