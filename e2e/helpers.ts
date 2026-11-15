import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const SAM = "sam@example.com"; // consumer
export const ALEX = "alex@example.com"; // editor
export const CASEY = "casey@example.com"; // Cloud Platform team, owner of "Request a GCP project"

const CSRF = { "X-Requested-With": "process-manager" };

/** Sign in through the API (fast). The sign-in screen itself is covered in auth.spec.ts. */
export async function signIn(page: Page, email: string, opts: { editor?: boolean; base?: string } = {}) {
  const base = opts.base ?? "";
  // switching user mid-test: leave the app first, so the next page load starts from the new session
  if (page.url().startsWith("http")) await page.goto("about:blank");
  const res = await page.request.post(`${base}/auth/dev/login`, { data: { email }, headers: CSRF });
  expect(res.ok(), `sign in as ${email}`).toBeTruthy();
  // the Consumer / Editor choice is remembered in the browser
  await page.addInitScript((mode) => { try { localStorage.setItem("pm:mode", mode); localStorage.setItem("pm:theme", "light"); } catch { /* ignore */ } }, opts.editor ? "editor" : "consumer");
}

export async function open(page: Page, hash: string, base = "") {
  await page.goto(`${base}/#${hash}`);
}

/** The content folder the writable test server works on (a copy, never the repository). */
/** Playwright runs from the repository root. */
export const ROOT = process.cwd();
export const contentDir = (port = 8090) => path.join(ROOT, ".e2e", `content-${port}`);
export const readProcess = (id: string, port = 8090) => JSON.parse(fs.readFileSync(path.join(contentDir(port), "processes", `${id}.json`), "utf8"));
export const readCatalog = (port = 8090) => JSON.parse(fs.readFileSync(path.join(contentDir(port), "catalog", "catalog.json"), "utf8"));

/** Report feedback through the API, for tests that are about what happens afterwards. */
export async function report(request: APIRequestContext, email: string, body: { processId: string; stepId?: string; kind?: string; text: string }) {
  await request.post("/auth/dev/login", { data: { email }, headers: CSRF });
  const res = await request.post("/api/feedback", { data: { kind: "broken", ...body }, headers: CSRF });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

export async function clearFeedback(request: APIRequestContext, processId: string) {
  await request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const all = await (await request.get("/api/feedback")).json();
  for (const item of all[processId] ?? []) await request.delete(`/api/feedback/${item.id}`, { headers: CSRF });
}

/** Fail the test on any uncaught error in the page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
