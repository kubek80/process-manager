import { expect, type APIRequestContext, type Page } from "@playwright/test";

// The built-in development users and what they may do (see server/internal/auth/dev.go).
export const SAM = "sam@example.com"; // a reader (consumer), no role
export const ALEX = "alex@example.com"; // process editor (every process) and lists manager
export const CASEY = "casey@example.com"; // Owner of the team Cloud Platform team: confirms reviews, cannot edit
export const RILEY = "riley@example.com"; // Practice owner of Cyber security (edits what belongs to it) and Owner of the team Cyber Security
export const JORDAN = "jordan@example.com"; // a reader who is Platform owner of Google Cloud, Practice owner of Engineering and Owner of the Cloud Platform team
export const DANA = "dana@example.com"; // admin

export const CSRF = { "X-Requested-With": "process-manager" };


/** Today as the server sees it. A review is dated by the server, whatever the clock of the browser says. */
export const serverToday = () => new Date().toISOString().slice(0, 10);

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

/** The state on the editing bar: its aria-label, e.g. "Unpublished changes. Readers still see version 1." */
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

/** The fields panel on the right of the editing screen. */
export const fields = (page: Page) => page.locator(".edit-fields");

/** "Save draft" and wait until it is saved (the state on the editing bar no longer says "not saved yet"). */
export async function saveDraft(page: Page) {
  await page.locator(".edit-bar").getByRole("button", { name: "Save draft" }).click();
  await expect(editState(page)).not.toHaveAttribute("aria-label", /not saved yet/);
  await expect(page.locator(".edit-bar").getByRole("button", { name: "Save draft" })).toBeDisabled();
}

/** "Publish…" -> (an optional note) -> "Publish", and wait until the editing bar says it is published. */
export async function publish(page: Page, note = "") {
  await page.locator(".edit-bar").getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: /^Publish (your changes|this (process|standard))$/ });
  if (note) await dialog.getByLabel(/^Note for the list of versions/).fill(note);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editState(page)).toHaveAttribute("aria-label", /^(Published|Retired)\./);
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
 * Choose (or un-choose) a value in a dropdown of the filter panel on the left of a list
 * ("Category", "Platform", "Owner", and the single-choice "Tier", "Environment", "Language")
 * and close the dropdown again.
 */
export async function pickFilter(page: Page, filter: string, option: string | RegExp) {
  const panel = page.getByRole("complementary", { name: "Filters" });
  const button = panel.getByRole("button", { name: new RegExp(`^${filter}:`) });
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
