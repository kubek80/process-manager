import { expect, test } from "@playwright/test";
import { DANA, RILEY, SAM, open, signIn } from "./helpers";

// What a phone, a tablet and a small laptop show. A page that scrolls sideways hides controls
// off screen, so no page may be wider than the screen.
const PAGES = ["/", "/standards", "/p/request-gcp-project/flow", "/p/request-gcp-project/list", "/p/request-gcp-project/flow/raise-request",
  "/s/secure-logging/doc", "/s/secure-logging/doc/SEC-LOG-02", "/catalog", "/guide", "/mine"];
const ADMIN = ["/p/request-gcp-project/json", "/admin/access", "/admin/lists", "/admin/skills", "/admin/health", "/admin/activity", "/admin/system"];

const sideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, width] of [["a phone", 390], ["a tablet", 768], ["a small laptop", 1024]] as const) {
  test(`no page scrolls sideways on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, SAM);
    for (const hash of PAGES) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as a reader at ${width}px`).toBe(0);
    }
    // an owner: one more entry in the top bar, and a page with tables of its own
    await signIn(page, RILEY, { editor: true });
    for (const hash of ["/", "/mine", "/s/secure-logging/doc"]) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as an owner at ${width}px`).toBe(0);
    }
    await signIn(page, DANA, { editor: true });
    for (const hash of [...PAGES, ...ADMIN]) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as an editor at ${width}px`).toBe(0);
    }
  });
}

test("on a phone the top bar keeps every control within reach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, DANA, { editor: true });
  await open(page, "/");
  for (const control of [
    page.getByRole("link", { name: "Standards" }), page.getByRole("link", { name: "Admin" }),
    page.getByRole("button", { name: "Consumer" }), page.getByRole("button", { name: "Your account" }),
  ]) await expect(control).toBeInViewport({ ratio: 1 });
});

test("a step opens as a panel that works with the keyboard alone", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/p/request-gcp-project/flow");
  const first = page.locator(".block-main").first();
  await first.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Decide the project details" });
  await expect(panel).toBeVisible();
  // focus has moved into the panel, Escape closes it and focus goes back to where it was
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(first).toBeFocused();
});
