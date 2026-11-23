import { expect, test, type Locator, type Page } from "@playwright/test";
import { CATEGORIES } from "../src/codemap/index.ts";
import { ALEX, DANA, open, openEditor, SAM, signIn, watchErrors } from "./helpers";

// A process drawn as a picture in a text (`ProcessPicture`): the Guide's charts and the code
// map's. One component everywhere: the map itself, with its Zoom tools and Enlarge; dragging
// pans it, Ctrl + scroll zooms it, a plain scroll over it keeps scrolling the page. It opens
// whole when that is still readable (70% or more), else at 80%, cut, with a faded edge; it keeps
// its height from the first paint, and prints whole.

const guideFigs = (page: Page) => page.locator("figure.process-picture.guide-fig");
const zoomOf = async (fig: Locator) => Number((await fig.locator(".zoom-val").first().textContent())!.replace("%", "")) / 100;
const overflowOf = (fig: Locator) => fig.locator(".flow-scroll").first().evaluate((e) => e.scrollWidth - e.clientWidth);
const drawnWidth = async (fig: Locator) => (await fig.locator(".flow-canvas").first().boundingBox())!.width;
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The name of the chart, from its Enlarge button ("Enlarge the chart “Signing in”"). */
const chartName = async (fig: Locator) => (await fig.locator(".flow-enlarge").getAttribute("aria-label"))!.match(/^Enlarge the chart “(.*)”$/)![1];

async function openGuide(page: Page) {
  // a fresh page each time: a picture chooses its zoom once, when it is first drawn
  if (!page.url().startsWith("http")) await signIn(page, SAM);
  else await page.goto("about:blank");
  await open(page, "/guide");
  await expect(page.getByRole("heading", { name: "How Process Manager works" })).toBeVisible();
  await expect(guideFigs(page).first().locator(".block").first()).toBeVisible();
}

/** Every picture keeps to the opening rule: whole at 70% to 100%, or cut at 80% with the faded edge. Returns how many open whole. */
async function openingRule(page: Page, figs: Locator) {
  const n = await figs.count();
  expect(n).toBeGreaterThan(0);
  let whole = 0;
  for (let i = 0; i < n; i++) {
    const fig = figs.nth(i);
    const z = await zoomOf(fig), over = await overflowOf(fig);
    const faded = await fig.locator(".flow-viewport").evaluate((e) => e.classList.contains("fade-right"));
    const name = await chartName(fig);
    if (over <= 0) {
      whole++;
      expect(z, `“${name}” is whole at a readable zoom`).toBeGreaterThanOrEqual(0.7);
      expect(z).toBeLessThanOrEqual(1);
      expect(faded, `“${name}” is whole: no faded edge`).toBe(false);
    } else {
      expect(z, `“${name}” is cut: it opens at 80%`).toBe(0.8);
      expect(faded, `“${name}” is cut: its right edge fades`).toBe(true);
    }
  }
  return { whole, n };
}

/** The first picture that is cut (it can be dragged sideways), brought into the middle of the window. */
async function cutPicture(page: Page, figs: Locator) {
  const n = await figs.count();
  for (let i = 0; i < n; i++) {
    const fig = figs.nth(i);
    if ((await overflowOf(fig)) > 40) {
      await fig.evaluate((e) => e.scrollIntoView({ block: "center" }));
      return fig;
    }
  }
  throw new Error("no picture is cut");
}

/** Drags a picture to the left with the mouse, from the middle of its drawing. */
async function drag(page: Page, fig: Locator, dx: number, dy = 0) {
  const box = (await fig.locator(".flow-scroll").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

test("the Guide's charts: the opening rule at 1440, 1366 and 390, and no box changes its height by itself", async ({ page }) => {
  const errors = watchErrors(page);
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await openGuide(page);
    const heights = await guideFigs(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    const { whole, n } = await openingRule(page, guideFigs(page));
    expect(n).toBeGreaterThanOrEqual(14);
    if (width === 1440) expect(whole, "on a wide screen some charts open whole").toBeGreaterThan(0);
    // each figure has the tools and Enlarge, named for a screen reader
    for (const fig of await guideFigs(page).all()) {
      await expect(fig.getByRole("group", { name: "Zoom" })).toHaveCount(1);
      await expect(fig.locator(".flow-wrap.picture.picture-inline")).toHaveCount(1);
      await expect(fig.getByRole("button", { name: /^Enlarge the chart “.+”$/ })).toHaveCount(1);
    }
    expect(await sideways(page), `${width} wide: no sideways scroll of the page`).toBeLessThanOrEqual(0);
    // nothing below jumps: the boxes keep the height they were first drawn with
    await page.waitForTimeout(1000);
    expect(await guideFigs(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))).toEqual(heights);
  }
  expect(errors).toEqual([]);
});

test("a Guide chart moves: dragging pans it, the tools zoom it, Fit shows it whole", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  const fig = await cutPicture(page, guideFigs(page));
  const scroller = fig.locator(".flow-scroll");
  const y = await scrollY(page);

  // dragging with the mouse moves the picture, not the page
  await drag(page, fig, -220, -120);
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
  expect(await scrollY(page)).toBe(y);
  // and the drag opened nothing
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // the tools
  const z0 = await zoomOf(fig), w0 = await drawnWidth(fig);
  await fig.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => zoomOf(fig)).toBeGreaterThan(z0);
  expect(await drawnWidth(fig)).toBeGreaterThan(w0);
  await fig.getByRole("button", { name: "Zoom out" }).click();
  await fig.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(() => zoomOf(fig)).toBeLessThan(z0);
  expect(await drawnWidth(fig)).toBeLessThan(w0);
  const pct = fig.locator(".zoom-val");
  await expect(pct).toHaveAttribute("aria-label", /^Zoom \d+%, press for 100%$/);
  await pct.click();
  await expect(pct).toHaveText("100%");
  await expect(pct).toHaveAttribute("aria-label", "Zoom 100%, press for 100%");

  // Fit: the whole flow, nothing left to scroll sideways
  await fig.getByRole("button", { name: "Fit" }).click();
  await expect(fig.getByRole("button", { name: "Fit" })).toHaveAttribute("title", "Show the whole flow");
  await expect.poll(() => overflowOf(fig)).toBeLessThanOrEqual(0);
  await expect(fig.locator(".flow-viewport")).not.toHaveClass(/fade-right/);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("over a Guide chart Ctrl + scroll zooms it; a plain scroll scrolls the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  const fig = await cutPicture(page, guideFigs(page));
  const box = (await fig.locator(".flow-scroll").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const z0 = await zoomOf(fig), y0 = await scrollY(page);

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomOf(fig)).toBeGreaterThan(z0);
  expect(await scrollY(page), "Ctrl + scroll does not scroll the page").toBe(y0);
  const z1 = await zoomOf(fig);

  await page.mouse.wheel(0, 400);
  await expect.poll(() => scrollY(page), { message: "a plain scroll over the chart scrolls the page" }).toBeGreaterThan(y0 + 100);
  expect(await zoomOf(fig)).toBe(z1);
});

test("Enlarge opens a Guide chart as large as the window with its own tools; Escape returns", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGuide(page);
  const fig = guideFigs(page).nth(2);
  await fig.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const name = await chartName(fig);
  const enlarge = fig.locator(".flow-enlarge");
  await expect(enlarge).toHaveText("Enlarge");
  await enlarge.click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toHaveClass(/\bpicture-dialog\b/);
  await expect(dialog.locator(".flow-wrap.picture-enlarged")).toHaveCount(1);
  const wide = (await dialog.boundingBox())!.width;
  expect(wide).toBeGreaterThan(1366 - 80);
  // the same tools, its own zoom
  const z = await zoomOf(dialog);
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => zoomOf(dialog)).toBeGreaterThan(z);
  await expect(dialog.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Fit" })).toBeVisible();
  await expect(dialog.locator(".flow-enlarge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(enlarge).toBeFocused();
});

test("a Guide chart by keyboard: the tools in order, then its steps as one stop with the arrow keys", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  const fig = guideFigs(page).nth(1);
  const fit = fig.getByRole("button", { name: "Fit" });
  await fit.focus();
  for (const name of [/^Zoom out$/, /^Zoom \d+%, press for 100%$/, /^Zoom in$/, /^Enlarge the chart “.+”$/]) {
    await page.keyboard.press("Tab");
    await expect(fig.getByRole("button", { name })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  const steps = fig.locator(".block-main[role=img]");
  await expect(steps.first()).toBeFocused();
  await expect(steps.first()).toHaveAttribute("aria-label", /^1\. /);
  await page.keyboard.press("ArrowRight");
  await expect(steps.nth(1)).toBeFocused();
  await expect(steps.nth(1)).toHaveAttribute("aria-label", /^2\. /);
  await page.keyboard.press("End");
  await expect(steps.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(steps.first()).toBeFocused();
  // the steps are one stop: Tab leaves the picture (to the next picture's tools or the text after it)
  await page.keyboard.press("Tab");
  expect(await fig.evaluate((e) => e.contains(document.activeElement))).toBe(false);
});

test("printed, every Guide chart is whole and has no tools", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGuide(page);
  const n = await guideFigs(page).count();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".flow-wrap.picture-print")).toHaveCount(n);
  await expect(guideFigs(page).locator(".map-tools")).toHaveCount(0);
  await expect(guideFigs(page).locator(".flow-enlarge")).toHaveCount(0);
  const over = await guideFigs(page).locator(".flow-scroll").evaluateAll((els) => els.map((e) => e.scrollWidth - e.clientWidth));
  expect(over.every((px) => px <= 0), `every chart whole on paper: ${over}`).toBe(true);
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".flow-wrap.picture-inline")).toHaveCount(n);
  await expect(guideFigs(page).getByRole("group", { name: "Zoom" })).toHaveCount(n);
});

test("the Guide's contents still land on their section below the charts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  const toc = page.locator("nav.guide-toc").first();
  for (const [id, title] of [["lifecycle", "Life-cycle and reviews"], ["catalog", "The lists"], ["files", "Files, schema and checker"]]) {
    await toc.getByRole("button", { name: title, exact: true }).click();
    const head = page.locator(`#guide-${id} h2`);
    await expect(head).toBeInViewport();
    await page.waitForTimeout(800);
    // still there once everything settled: no picture above changed its height
    const top = await head.evaluate((e) => e.getBoundingClientRect().top);
    expect(top, `#guide-${id} near the top`).toBeGreaterThan(-4);
    expect(top).toBeLessThan(260);
  }
});

test("touch: a vertical swipe over a Guide chart scrolls the page, a sideways one moves the chart", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: "http://127.0.0.1:8090" });
  const page = await context.newPage();
  try {
    await openGuide(page);
    const fig = await cutPicture(page, guideFigs(page));
    const scroller = fig.locator(".flow-scroll");
    const cdp = await context.newCDPSession(page);
    // a finger put down in the middle of the chart and moved in ten steps (the touch screen's own scrolling, no script of the app)
    const swipe = async (dx: number, dy: number) => {
      const box = (await scroller.boundingBox())!;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let k = 1; k <= 10; k++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * k) / 10, y: y + (dy * k) / 10 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const y0 = await scrollY(page);
    await swipe(0, -250);
    await expect.poll(() => scrollY(page), { message: "the page scrolled under the finger" }).toBeGreaterThan(y0 + 150);
    expect(await scroller.evaluate((e) => e.scrollLeft)).toBe(0);
    await fig.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800); // what is left of the swipe's momentum
    const y1 = await scrollY(page);
    await swipe(-200, 0);
    await expect.poll(() => scroller.evaluate((e) => e.scrollLeft), { message: "the chart moved sideways" }).toBeGreaterThan(80);
    expect(Math.abs((await scrollY(page)) - y1)).toBeLessThan(20);
  } finally {
    await context.close();
  }
});

// ---------- the code map's charts

const CHARTED = [...CATEGORIES].filter((c) => c.charts.length).sort((a, b) => b.charts.length - a.charts.length)[0];
const cmCharts = (page: Page) => page.locator("figure.process-picture.cm-chart");

test("a code map chart is the same picture: tools, dragging, Enlarge, the opening rule", async ({ page }) => {
  await signIn(page, DANA);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await open(page, `/admin/code/${CHARTED.id}`);
    await expect(cmCharts(page)).toHaveCount(CHARTED.charts.length);
    await expect(cmCharts(page).first().locator(".block").first()).toBeVisible();
    await openingRule(page, cmCharts(page));
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, `/admin/code/${CHARTED.id}`);
  const fig = cmCharts(page).first();
  await expect(fig.locator("h3.picture-title")).toHaveText(CHARTED.charts[0].process.title);
  await expect(fig.getByRole("group", { name: "Zoom" })).toBeVisible();
  await fig.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const z = await zoomOf(fig);
  await fig.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => zoomOf(fig)).toBeGreaterThan(z);
  if ((await overflowOf(fig)) > 40) {
    const y = await scrollY(page);
    await drag(page, fig, -200);
    await expect.poll(() => fig.locator(".flow-scroll").evaluate((e) => e.scrollLeft)).toBeGreaterThan(80);
    expect(await scrollY(page)).toBe(y);
  }
  const enlarge = fig.getByRole("button", { name: `Enlarge the chart “${CHARTED.charts[0].process.title}”` });
  await enlarge.click();
  const dialog = page.getByRole("dialog", { name: CHARTED.charts[0].process.title });
  await expect(dialog).toHaveClass(/\bpicture-dialog\b/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(enlarge).toBeFocused();
});

test("a code map address to a chart below other charts lands on it", async ({ page }) => {
  await signIn(page, DANA);
  await page.setViewportSize({ width: 1366, height: 768 });
  const last = CHARTED.charts[CHARTED.charts.length - 1].process;
  await open(page, `/admin/code/${CHARTED.id}?at=chart-${last.id}`);
  const target = page.locator(`figure.cm-chart[data-at="chart-${last.id}"]`);
  await expect(target).toBeInViewport();
  await page.waitForTimeout(800);
  const top = await target.evaluate((e) => e.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(-4);
  expect(top).toBeLessThan(300);
});

// ---------- the maps of a page are unchanged

test("the reader's map and the editing map keep their own tools: no Enlarge, not a picture", async ({ page }) => {
  await signIn(page, ALEX);
  await open(page, "/p/request-gcp-project/flow");
  const map = page.locator(".flow-wrap").first();
  await expect(map.locator(".block").first()).toBeVisible();
  await expect(map).not.toHaveClass(/\bpicture\b/);
  await expect(map.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Fit" })).toBeVisible();
  await expect(map.locator(".flow-enlarge")).toHaveCount(0);
  await expect(map.locator("button.block-main").first()).toBeVisible(); // steps open
  await openEditor(page, "process", "request-gcp-project");
  const edit = page.locator(".edit-preview .flow-wrap");
  await expect(edit).not.toHaveClass(/\bpicture\b/);
  await expect(edit.getByRole("group", { name: "Zoom" })).toBeVisible();
  await expect(edit.locator(".flow-enlarge")).toHaveCount(0);
});
