import { expect, type APIRequestContext, type Page } from "@playwright/test";

// The built-in development users and what they may do (see server/internal/auth/dev.go).
export const SAM = "sam@example.com"; // consumer
export const ALEX = "alex@example.com"; // edits processes and the lists
export const CASEY = "casey@example.com"; // owner for the Cloud Platform team ("Request a GCP project")
export const RILEY = "riley@example.com"; // edits and owns the standards of Cyber Security
export const DANA = "dana@example.com"; // admin

const CSRF = { "X-Requested-With": "process-manager" };

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
