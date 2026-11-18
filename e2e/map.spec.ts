import { expect, test, type Page } from "@playwright/test";
import { ALEX, clearFeedback, CSRF, open, SAM, signIn } from "./helpers";

// The map of a process: what to prepare is open on arrival, a hint says a step can be opened, a
// decision is a diamond, the map can be dragged, and every step has its own flag for problems.

const GCP = "request-gcp-project";
const block = (page: Page, title: string) => page.locator(".block", { hasText: title });

test.afterEach(async ({ request }) => { await clearFeedback(request, "process", GCP); });

test("“Before you start” is open on arrival and stays closed once the person closed it", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  const toggle = page.getByRole("button", { name: /^Before you start/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#before-body")).toBeVisible();
  await expect(page.locator("#before-body .prereq")).toHaveCount(4);
  // it is above the map
  const [panel, map] = [(await page.locator("section.before-panel").boundingBox())!, (await page.locator(".flow-scroll").boundingBox())!];
  expect(panel.y + panel.height).toBeLessThanOrEqual(map.y);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".prereq")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Before you start/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".prereq")).toHaveCount(0);
  // the same for another process, and it opens again on demand
  await open(page, "/p/onboard-api-to-apigee/flow");
  await expect(page.getByRole("button", { name: /^Before you start/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /^Before you start/ }).click();
  await expect(page.locator(".prereq")).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Before you start/ })).toHaveAttribute("aria-expanded", "true");
});

test("the hint shows how to use the map until the person opened a step", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  const hint = page.locator(".map-hint");
  await expect(hint).toHaveText("Select a step on the map to see what to do, who does it and with which tool.");
  // in the row of the tabs, above the map
  await expect(page.locator(".tabs-row .map-hint")).toBeVisible();
  // how to move and zoom the map is said above it, and stays
  await expect(page.locator(".flow-head .map-pan-hint")).toHaveText(/^Drag to move · Ctrl\s*\+ scroll to zoom$/);
  await block(page, "Approve the monthly budget").locator(".block-main").click();
  await expect(page.locator(".drawer h3")).toHaveText("Approve the monthly budget");
  await expect(hint).toHaveCount(0);
  await expect(page.locator(".map-pan-hint")).toBeVisible();
  await page.reload();
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(hint).toHaveCount(0);
  await open(page, "/p/onboard-api-to-apigee/flow");
  await expect(page.locator(".block").first()).toBeVisible();
  await expect(hint).toHaveCount(0);
  // it is remembered per person: somebody else in this browser still gets it
  await signIn(page, ALEX);
  await open(page, `/p/${GCP}/flow`);
  await expect(hint).toBeVisible();
});

test("a decision is a diamond and opens when it is clicked", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  const decision = block(page, "Details complete?");
  await expect(decision).toHaveClass(/\bdecision\b/);
  await expect(decision.locator("svg.diamond polygon.diamond-shape")).toHaveCount(1);
  const points = (await decision.locator("polygon.diamond-shape").getAttribute("points"))!.trim().split(/\s+/);
  expect(points).toHaveLength(4); // four corners
  await expect(page.locator(".block:not(.decision) svg.diamond")).toHaveCount(0);
  // the word is there for screen readers only; the step type icon is not drawn
  await expect(decision.locator(".block-type")).toHaveText("Decision");
  await expect(decision.locator(".type-icon")).toHaveCount(0);

  // a click in a corner of its box, outside the diamond, opens nothing
  await decision.scrollIntoViewIfNeeded();
  const box = (await decision.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await expect(page.locator(".drawer")).toHaveCount(0);
  // the middle opens it
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".drawer h3")).toHaveText("Details complete?");
  await expect(decision).toHaveClass(/\bselected\b/);
});

test("dragging the map with the mouse moves it and opens nothing; a plain click still opens a step", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await signIn(page, SAM);
  await page.addInitScript(() => { try { localStorage.setItem("pm:map-before", "closed"); } catch { /* ignore */ } });
  await open(page, `/p/${GCP}/flow`);
  const scroller = page.locator(".flow-scroll");
  await expect(scroller).toHaveClass(/\bpannable\b/);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  const room = await scroller.evaluate((el) => ({ x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight }));
  expect(room.x, "the map is wider than its box").toBeGreaterThan(150);
  const scroll = () => scroller.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  expect(await scroll()).toEqual({ left: 0, top: 0 });

  // from an empty place of a lane (the legend and the zoom above the map push it down: it is brought into view first)
  await page.locator(".lane").nth(1).scrollIntoViewIfNeeded();
  const start = (await scroll()).left;
  const lane = (await page.locator(".lane").nth(1).boundingBox())!;
  const head = (await page.locator(".lane-head").nth(1).boundingBox())!;
  const fromX = head.x + head.width + 20, fromY = lane.y + 6;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX - 60, fromY, { steps: 4 });
  await page.mouse.move(fromX - 150, fromY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await scroll()).left).toBeGreaterThanOrEqual(start + 140);
  await expect(page.locator(".drawer")).toHaveCount(0);

  // starting on a step: the map moves back, and the step does not open
  const step = page.locator(".block-main", { hasText: "Raise the 'New GCP project' request" });
  const s = (await step.boundingBox())!;
  const before = (await scroll()).left;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 40, s.y + s.height / 2, { steps: 4 });
  await page.mouse.move(s.x + s.width / 2 + 100, s.y + s.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await scroll()).left).toBeLessThanOrEqual(before - 90);
  await expect(page.locator(".drawer")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/p/${GCP}/flow$`));

  // a move of a pixel or two is still a click
  const t = (await step.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 2, t.y + t.height / 2 + 1);
  await page.mouse.up();
  await expect(page.locator(".drawer h3")).toHaveText("Raise the 'New GCP project' request");
});

test("the flag on a step reports a problem with that step, without opening it", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  const budget = block(page, "Approve the monthly budget");
  const flag = budget.getByRole("button", { name: "Report a problem with step 3: Approve the monthly budget" });
  // shown when the pointer is on the step
  await expect.poll(() => flag.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await budget.hover();
  await expect.poll(() => flag.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await flag.click();
  const dialog = page.getByRole("dialog", { name: "Report a problem with this step" });
  await expect(dialog).toContainText("Step 3: Approve the monthly budget");
  await expect(page.locator(".drawer")).toHaveCount(0); // the step itself did not open
  await expect(dialog.getByRole("textbox", { name: "Your feedback" })).toBeFocused();
  await dialog.getByRole("button", { name: "Out of date" }).click();
  await dialog.getByRole("textbox", { name: "Your feedback" }).fill("Budgets above 5,000 now need the finance team as well.");
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog).toHaveCount(0);

  // stored on that step, as the person who sent it
  const { process } = await (await page.request.get("/api/feedback")).json();
  const sent = (process[GCP] ?? []).filter((f: { text: string }) => f.text.startsWith("Budgets above 5,000"));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ itemId: "approve-budget", kind: "outdated", resolved: false, author: { email: SAM } });
  // and the step says so
  await expect(budget.locator(".block-flag")).toHaveText("1");
  await expect(block(page, "Decide the project details").locator(".block-flag")).toHaveCount(0);
  await expect(page.locator(".doc-engage .engage-open")).toHaveText("1 piece of feedback open");
});

test("the map works with the keyboard: Tab reaches a step and its flag, Enter opens", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  const first = page.locator(".block-main").first();
  await first.focus();
  await page.keyboard.press("Tab");
  const flag = page.getByRole("button", { name: "Report a problem with step 1: Decide the project details" });
  await expect(flag).toBeFocused();
  await expect.poll(() => flag.evaluate((el) => getComputedStyle(el).opacity)).toBe("1"); // visible when it has the focus
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Report a problem with this step" });
  await expect(dialog).toContainText("Step 1: Decide the project details");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // on to the next step, which opens with Enter
  await page.locator(".block-main").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".drawer h3")).toHaveText("Raise the 'New GCP project' request");
});

test("a reader cannot report on a process through another person's name", async ({ page }) => {
  // the flag sends as the person signed in, whatever the page says
  await signIn(page, SAM);
  const res = await page.request.post("/api/feedback", {
    data: { targetKind: "process", targetId: GCP, itemId: "approve-budget", kind: "broken", text: "Sent as someone else?", author: { name: "Dana Admin", email: "dana@example.com" } },
    headers: CSRF,
  });
  expect(res.status()).toBe(201);
  expect((await res.json()).author.email).toBe(SAM);
});

test("on a phone the map says nothing about dragging: a finger scrolls it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, SAM);
  await open(page, `/p/${GCP}/flow`);
  await expect(page.locator(".map-hint")).toBeVisible();
  await expect(page.locator(".map-pan-hint")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("the legend and the zoom are above the map; Ctrl + scroll over the map zooms, a plain scroll scrolls the page", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 700 });
  await signIn(page, SAM);
  await page.addInitScript(() => { try { localStorage.setItem("pm:map-before", "closed"); } catch { /* ignore */ } });
  await open(page, `/p/${GCP}/flow`);
  const scroller = page.locator(".flow-scroll");
  await expect(page.locator(".block").first()).toBeVisible();
  // above the map, not in a bar below it
  const legend = page.getByRole("group", { name: "Kinds of steps" });
  const zoom = page.getByRole("group", { name: "Zoom" });
  const map = (await scroller.boundingBox())!;
  for (const part of [legend, zoom]) {
    const b = (await part.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(map.y + 1);
  }
  await expect(page.locator(".flow-foot")).toHaveCount(0);
  for (const name of ["Zoom out", "Zoom in"]) await expect(zoom.getByRole("button", { name })).toBeVisible();
  await expect(zoom.getByRole("button", { name: /^Fit/ })).toBeVisible();
  const value = zoom.locator(".zoom-val");
  const percent = async () => Number((await value.innerText()).replace("%", ""));
  const pageScroll = () => page.evaluate(() => window.scrollY);

  // Ctrl + wheel over the map zooms in, around the pointer, and the page stays where it is
  await scroller.scrollIntoViewIfNeeded();
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 300) / 2);
  const [z0, y0] = [await percent(), await pageScroll()];
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(percent).toBeGreaterThan(z0);
  expect(await pageScroll()).toBe(y0);
  const z1 = await percent();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await expect.poll(percent).toBeLessThan(z1);
  expect(await pageScroll()).toBe(y0);

  // a plain scroll over the map scrolls the page and leaves the zoom alone
  const z2 = await percent();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(box.x + box.width / 2, (await scroller.boundingBox())!.y + 40);
  await page.mouse.wheel(0, 300);
  await expect.poll(pageScroll).toBeGreaterThan(0);
  expect(await percent()).toBe(z2);

  // the buttons and Fit still work
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(percent).toBeGreaterThan(z2);
  // and so does a click on a step
  await page.locator(".block-main", { hasText: "Approve the monthly budget" }).click();
  await expect(page.locator(".drawer h3")).toHaveText("Approve the monthly budget");
});
