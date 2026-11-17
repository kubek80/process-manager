import { expect, test } from "@playwright/test";
import { DANA, JORDAN, RILEY, SAM, open, signIn } from "./helpers";

// What a phone, a tablet and a small laptop show. A page that scrolls sideways hides controls
// off screen, so no page may be wider than the screen.
const PAGES = ["/", "/search?q=gcp", "/search?q=logging&type=standard&rigour=mandatory", "/processes", "/standards", "/p/request-gcp-project/flow", "/p/request-gcp-project/list", "/p/request-gcp-project/flow/raise-request",
  "/s/secure-logging/doc", "/s/secure-logging/doc/SEC-LOG-02", "/catalog", "/guide", "/mine"];
const ADMIN = ["/p/request-gcp-project/json", "/admin/access", "/admin/lists", "/admin/skills", "/admin/health", "/admin/activity", "/admin/system"];

const sideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, width] of [["a small phone", 360], ["a phone", 390], ["a tablet", 768], ["a small laptop", 1024]] as const) {
  test(`no page scrolls sideways on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, SAM);
    for (const hash of PAGES) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as a reader at ${width}px`).toBe(0);
    }
    // owners of a practice and of a platform: one more entry in the top bar, and a page with tables of its own
    for (const who of [RILEY, JORDAN]) {
      await signIn(page, who, { editor: true });
      for (const hash of ["/", "/search?q=gcp", "/mine", "/s/secure-logging/doc", "/p/request-gcp-project/flow"]) {
        await open(page, hash);
        await expect(page.locator("h1").first()).toBeVisible();
        expect(await sideways(page), `${hash} as ${who} at ${width}px`).toBe(0);
      }
    }
    await signIn(page, DANA, { editor: true });
    for (const hash of [...PAGES, ...ADMIN]) {
      await open(page, hash);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await sideways(page), `${hash} as an editor at ${width}px`).toBe(0);
    }
  });
}

for (const width of [390, 360]) {
  test(`on a phone ${width} wide the top bar keeps every control within reach`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // the most entries the top bar can have: an admin who also answers for something
    for (const who of [DANA, JORDAN]) {
      await signIn(page, who, { editor: true });
      await open(page, "/");
      await expect(page.locator("h1").first()).toBeVisible();
      const nav = page.locator(".nav");
      const controls = [
        nav.getByRole("link", { name: "Home" }), nav.getByRole("link", { name: "Processes" }), nav.getByRole("link", { name: "Standards" }),
        nav.getByRole("link", { name: "Teams & tools" }), nav.getByRole("link", { name: "Guide" }),
        page.getByRole("button", { name: "Consumer" }), page.getByRole("button", { name: "Editor", exact: true }), page.getByRole("button", { name: "Your account" }),
      ];
      if (who === DANA) controls.push(nav.getByRole("link", { name: "Admin" }));
      if (who === JORDAN) controls.push(nav.getByRole("link", { name: /My responsibilities/ }));
      for (const control of controls) await expect(control, `${who} at ${width}px`).toBeInViewport({ ratio: 1 });
      expect(await sideways(page), `top bar for ${who} at ${width}px`).toBe(0);
    }
  });
}

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
