import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the real thing: the Go server serving the built app, a real
 * Postgres, development sign-in. Two servers are started: one where content can be edited
 * (like local development) and one where it is read-only (like production).
 */
export const WRITABLE = "http://127.0.0.1:8090";
export const READONLY = "http://127.0.0.1:8091";

export default defineConfig({
  testDir: "e2e",
  // the tests share one server and one content folder, so they run one after another
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: WRITABLE,
    viewport: { width: 1500, height: 950 },
    trace: process.env.CI ? "on-first-retry" : "off",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: [
    { command: "node scripts/e2e-server.mjs 8090 writable pm_e2e", url: `${WRITABLE}/healthz`, reuseExistingServer: false, timeout: 120_000, stdout: "ignore", stderr: "pipe" },
    { command: "node scripts/e2e-server.mjs 8091 readonly pm_e2e_ro", url: `${READONLY}/healthz`, reuseExistingServer: false, timeout: 120_000, stdout: "ignore", stderr: "pipe" },
  ],
});
