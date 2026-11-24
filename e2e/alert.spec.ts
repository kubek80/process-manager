import { expect, test, type Page } from "@playwright/test";
import { DANA, JORDAN, MORGAN, open, signIn } from "./helpers";

// The designer's alert (Alert.tsx): the measured instance, each state in light and dark, and a real
// notice of each kind on its page.

const SAMPLE = { title: "This is an alert title", desc: "This is an alert description. Max character count is 140 characters." };
const TONES = ["info", "success", "warning", "problem"] as const;
const DESIGNER = { info: "rgb(235, 247, 255)", success: "rgb(244, 255, 219)", warning: "rgb(255, 250, 224)", problem: "rgb(255, 235, 235)" };
const TEXT = "rgb(19, 19, 12)";

/** The Theming preview's alert of a state, copied out into the page as the designer's instance: 335 wide, the sample texts. */
async function instance(page: Page, tone: (typeof TONES)[number]) {
  return page.evaluate(({ tone, s }) => {
    document.querySelector("#alert-instance")?.remove();
    const from = document.querySelector(`.preview-pane.look-light .alert-${tone}`)!;
    const a = from.cloneNode(true) as HTMLElement;
    a.id = "alert-instance";
    a.style.width = "335px";
    a.style.margin = "0";
    a.querySelector(".alert-title")!.textContent = s.title;
    a.querySelector(".alert-desc")!.textContent = s.desc;
    document.querySelector(".theme-settings")!.prepend(a);
    const box = a.getBoundingClientRect();
    const at = (sel: string) => { const r = a.querySelector(sel)!.getBoundingClientRect(); return [Math.round(r.left - box.left), Math.round(r.top - box.top), Math.round(r.width), Math.round(r.height)]; };
    const cs = getComputedStyle(a), title = getComputedStyle(a.querySelector(".alert-title")!), desc = getComputedStyle(a.querySelector(".alert-desc")!);
    const icon = getComputedStyle(a.querySelector(".alert-icon")!);
    return {
      w: Math.round(box.width), h: Math.round(box.height), icon: at(".alert-icon"), art: at(".alert-icon svg"), body: at(".alert-body"), title: at(".alert-title"), desc: at(".alert-desc"),
      radius: cs.borderTopLeftRadius + " " + cs.borderBottomRightRadius, border: cs.borderTopWidth, shadow: cs.boxShadow, bg: cs.backgroundColor, color: cs.color, iconColor: icon.color,
      titleFont: [title.fontFamily.split(",")[0], title.fontSize, title.lineHeight, title.fontWeight, title.letterSpacing, title.color],
      descFont: [desc.fontFamily.split(",")[0], desc.fontSize, desc.lineHeight, desc.fontWeight, desc.color],
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
    };
  }, { tone, s: SAMPLE });
}

async function theming(page: Page, mode: "light" | "dark") {
  await signIn(page, DANA);
  await page.addInitScript((m) => { try { localStorage.setItem("pm:theme", m); } catch { /* ignore */ } }, mode);
  await page.setViewportSize({ width: 1600, height: 900 });
  await open(page, "/admin/theming");
  await expect(page.locator(".preview-pane.look-light .alert-info")).toBeVisible();
}

test("the designer's instance: 335 wide, the sample title and description, 100 high, every measure as specified", async ({ page }) => {
  await theming(page, "light");
  const m = await instance(page, "info");
  expect([m.w, m.h]).toEqual([335, 100]);
  expect(m.padding).toEqual(["12px", "12px", "12px", "16px"]);
  expect(m.icon).toEqual([16, 12, 24, 24]); // the icon's place
  expect(m.art).toEqual([18, 14, 20, 20]); // its artwork, inset 2
  expect(m.body).toEqual([52, 12, 271, 76]); // the text stack
  expect(m.title).toEqual([52, 12, 271, 24]); // one line
  expect(m.desc).toEqual([52, 40, 271, 48]); // two lines, 4 under the title
  expect(m.radius).toBe("8px 8px");
  expect(m.border).toBe("0px");
  expect(m.shadow).toBe("none");
  expect(m.titleFont).toEqual(["\"Roboto Variable\"", "16px", "24px", "500", "normal", TEXT]);
  expect(m.descFont).toEqual(["\"Roboto Variable\"", "16px", "24px", "400", TEXT]);
  // the three colours the designer gave
  expect(m.bg).toBe(DESIGNER.info);
  expect(m.iconColor).toBe("rgb(0, 116, 188)");
  expect(m.color).toBe(TEXT);
});

test("each state in the light look: the designer's ground, one text colour, its own filled icon; the same anatomy", async ({ page }) => {
  await theming(page, "light");
  const shapes = new Set<string>();
  for (const tone of TONES) {
    const m = await instance(page, tone);
    expect([m.w, m.h, ...m.icon, ...m.title, ...m.desc], tone).toEqual([335, 100, 16, 12, 24, 24, 52, 12, 271, 24, 52, 40, 271, 48]);
    expect(m.bg, tone).toBe(DESIGNER[tone]);
    expect(m.color, tone).toBe(TEXT);
    expect(m.iconColor, tone).not.toBe(TEXT);
    shapes.add(await page.locator("#alert-instance .alert-icon svg").innerHTML());
    // drawn here, hidden from screen readers: the words say it
    await expect(page.locator("#alert-instance .alert-icon")).toHaveAttribute("aria-hidden", "true");
  }
  expect(shapes.size).toBe(4); // four shapes: circle-i, circle-tick, triangle, circle-exclamation
  expect([...shapes].filter((s) => s.includes("<path d=\"M8.27"))).toHaveLength(1); // only the warning is a triangle
});

test("each state in the dark look: its ground over Midnight, light text, the same anatomy; the four grounds apart", async ({ page }) => {
  await theming(page, "dark");
  const grounds = new Set<string>();
  for (const tone of TONES) {
    // the dark preview's alert, as the dark look draws it
    const a = page.locator(`.preview-pane.look-dark .alert-${tone}`);
    const look = await a.evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, color: c.color, icon: getComputedStyle(e.querySelector(".alert-icon")!).color }; });
    expect(look.bg, tone).not.toBe(DESIGNER[tone]);
    expect(look.color, tone).not.toBe(TEXT);
    grounds.add(look.bg);
    // the instance in the page itself, which is dark: the same measures
    const m = await page.evaluate((tone) => {
      document.querySelector("#alert-instance")?.remove();
      const a = document.querySelector(`.preview-pane.look-dark .alert-${tone}`)!.cloneNode(true) as HTMLElement;
      a.id = "alert-instance"; a.style.width = "335px"; a.style.margin = "0";
      a.querySelector(".alert-title")!.textContent = "This is an alert title";
      a.querySelector(".alert-desc")!.textContent = "This is an alert description. Max character count is 140 characters.";
      document.querySelector(".theme-settings")!.prepend(a);
      const c = getComputedStyle(a);
      return { h: Math.round(a.getBoundingClientRect().height), bg: c.backgroundColor, color: c.color };
    }, tone);
    expect(m.h, tone).toBe(100);
    expect(m.bg, tone).toBe(look.bg);
    expect(m.color, tone).toBe(look.color);
  }
  expect(grounds.size).toBe(4);
});

test("a real notice of each kind is the alert on its page", async ({ page }) => {
  // problem: review overdue, title and description, on the reader's page
  await signIn(page, DANA);
  await open(page, "/p/onboard-site-to-akamai/flow");
  const overdue = page.locator(".doc-notices .alert.alert-problem");
  await expect(overdue.locator(".alert-title")).toHaveText(/^Review overdue since \d{4}-\d\d-\d\d$/);
  await expect(overdue.locator(".alert-desc")).toHaveText("Read it through, correct what changed on the editing screen, then press “Mark as reviewed”.");
  expect(await overdue.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(DESIGNER.problem);
  // information: a link with a filter that no longer exists
  await open(page, "/processes?platform=mars");
  const gone = page.locator(".alert.alert-info.list-notice");
  await expect(gone).toHaveRole("status");
  await expect(gone.locator(".alert-desc")).toHaveText("A filter in this link no longer exists and was left out.");
  await expect(gone.locator(".alert-title")).toHaveCount(0);
  expect(await gone.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(DESIGNER.info);
  // warning: an example text left in a field of the editing screen
  await signIn(page, JORDAN);
  await open(page, "/p/request-gcp-project/edit");
  await page.locator(".edit-fields").getByRole("textbox", { name: /^Summary/ }).fill("Describe in one or two sentences what the reader gets at the end.");
  const example = page.locator(".edit-fields .alert.alert-warning.item-issues");
  await expect(example.locator(".alert-title")).toHaveText("1 to fix before publishing: example text");
  expect(await example.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(DESIGNER.warning);
  // success: nothing waits for a member
  await signIn(page, MORGAN);
  await open(page, "/mine");
  const fine = page.locator(".alert.alert-success").first();
  await expect(fine.locator(".alert-title")).toHaveText("No draft is waiting for an owner");
  expect(await fine.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(DESIGNER.success);
});

test("on a phone an alert fits its column and grows with its text, nothing cut", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, DANA);
  await open(page, "/p/onboard-site-to-akamai/flow");
  const a = page.locator(".doc-notices .alert");
  const box = await a.evaluate((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, sw: e.scrollWidth, cw: e.clientWidth }));
  expect(box.w).toBeLessThanOrEqual(390 - 2 * 14);
  expect(box.sw).toBeLessThanOrEqual(box.cw);
  expect(box.h).toBeGreaterThan(100); // the longer description wraps: content-driven height
});
