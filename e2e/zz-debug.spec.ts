import { expect, test } from "@playwright/test";
import { ALEX, open, signIn } from "./helpers";
test("dbg", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1300 });
  await signIn(page, ALEX, { editor: true });
  await open(page, `/p/publish-internal-library/flow`);
  const b = page.locator(".block", { hasText: "Tag the first version" });
  await b.waitFor();
  console.log("block", await b.boundingBox(), "lane2", await page.locator(".lane").nth(2).boundingBox(), "vh", page.viewportSize());
  page.on("console", m => console.log("C:", m.text()));
  await page.evaluate(() => { for (const ev of ["dragstart","dragover","drop","dragend","pointerdown"]) document.addEventListener(ev, (e) => console.log(ev, (e.target as Element).className), true); });
  await b.dragTo(page.locator(".lane").nth(2), { targetPosition: { x: 320, y: 30 } });
  await page.waitForTimeout(500);
  console.log(await page.getByRole("button", { name: "Save changes" }).count());
});
