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

/** Sign in through the API (fast). The sign-in screen itself is covered in auth.spec.ts. */
export async function signIn(page: Page, email: string, opts: { editor?: boolean } = {}) {
  // switching user mid-test: leave the app first, so the next page load starts from the new session
  if (page.url().startsWith("http")) await page.goto("about:blank");
  const res = await page.request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  expect(res.ok(), `sign in as ${email}`).toBeTruthy();
  // the Consumer / Editor choice is remembered in the browser
  await page.addInitScript((mode) => { try { localStorage.setItem("pm:mode", mode); localStorage.setItem("pm:theme", "light"); } catch { /* ignore */ } }, opts.editor ? "editor" : "consumer");
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

export const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".saved")).toBeVisible();
};

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
 * ("Category", "Platform", "Owner", …) and close the dropdown again.
 */
export async function pickFilter(page: Page, filter: string, option: string | RegExp) {
  const panel = page.getByRole("complementary", { name: "Filters" });
  const button = panel.getByRole("button", { name: new RegExp(`^${filter}:`) });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const name = typeof option === "string" ? new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, \\d+ results?$`) : option;
  await panel.getByRole("group", { name: filter, exact: true }).getByRole("checkbox", { name }).click();
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
