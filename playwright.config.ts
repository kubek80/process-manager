import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the real thing: the Go server serving the built app, a real
 * Postgres, development sign-in. The database is emptied and refilled from the files of the
 * repository when the server starts, so every run begins with the same content.
 */
export const BASE = "http://127.0.0.1:8090";

export default defineConfig({
  testDir: "e2e",
  // the tests share one server and one database, so they run one after another
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE,
    viewport: { width: 1500, height: 950 },
    trace: process.env.CI ? "on-first-retry" : "off",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: { command: "node scripts/e2e-server.mjs 8090 pm_e2e", url: `${BASE}/healthz`, reuseExistingServer: false, timeout: 120_000, stdout: "ignore", stderr: "pipe" },
});
