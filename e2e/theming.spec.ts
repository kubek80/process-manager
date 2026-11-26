import { deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, open, openEditor, signIn } from "./helpers";
import type { Locator } from "@playwright/test";

// Admin › Theming: the name, the logo, the colours and light or dark for the whole portal. Only
// admins change it; everyone, signed in or not, gets it. Every test puts the default look back,
// also when it fails: every other test counts on it.

const BASE = "http://127.0.0.1:8090";

/** A PNG of `w` x `h` pixels in one colour, made here. */
function png(w: number, h: number, rgb: [number, number, number] = [20, 140, 120]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([...rgb, 255], y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** The look as stored, read as an admin. */
async function stored(request: APIRequestContext) {
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const res = await request.get("/api/admin/theme");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { look: Record<string, string>; revision: number; updatedBy?: string };
}
/** Saves a look through the API, as an admin, on top of what is stored. */
async function putLook(request: APIRequestContext, look: Record<string, string>) {
  const { revision } = await stored(request);
  const res = await request.put(`/api/admin/theme?rev=${revision}`, { data: look, headers: CSRF });
  expect(res.ok(), await res.text()).toBeTruthy();
}
/** Back to the default look: after every test, also a failed one. */
async function resetLook(request: APIRequestContext) {
  const s = await stored(request);
  if (Object.keys(s.look).length) await putLook(request, {});
}
test.afterEach(async ({ request }) => { await resetLook(request); });

/** "rgb(255, 212, 0)" -> [255, 212, 0]. */
const rgbOf = (css: string) => css.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]: number[]) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const section = (page: Page) => page.locator(".theme-section");
const saveBar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
/** "Save for everyone"; `warned`: the look has warnings, so Save asks once and is answered "Save anyway". */
async function saveForEveryone(page: Page, warned = false) {
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
  if (warned) await page.getByRole("dialog", { name: /^Save with \d+ warnings?\?$/ }).getByRole("button", { name: "Save anyway" }).click();
  await expect(saveBar(page)).toHaveCount(0);
}
async function openTheming(page: Page) {
  await signIn(page, DANA);
  await open(page, "/admin/theming");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Theming");
  await expect(section(page)).toBeVisible();
}
/** Another person in a browser of their own, signed in, without a light or dark choice of their own. */
async function visitor(browser: Browser, email: string | null, opts: { width?: number; own?: "light" | "dark" } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: opts.width ?? 1300, height: 900 } });
  if (opts.own) await ctx.addInitScript((t) => { try { localStorage.setItem("pm:theme", t); } catch { /* ignore */ } }, opts.own);
  const page = await ctx.newPage();
  if (email) expect((await page.request.post("/auth/dev/login", { data: { email }, headers: CSRF })).ok()).toBeTruthy();
  return { page, ctx, close: () => ctx.close() };
}

test("only admins see Theming and may change the look; everyone, signed in or not, gets it", async ({ page, playwright }) => {
  for (const who of [SAM, ALEX]) {
    await signIn(page, who);
    expect((await page.request.get("/api/admin/theme")).status(), who).toBe(403);
    expect((await page.request.put("/api/admin/theme?rev=0", { data: { name: "Taken over" }, headers: CSRF })).status(), who).toBe(403);
  }
  // Alex manages the lists and has an Admin panel, without Theming; asking for it shows one of his
  await signIn(page, ALEX);
  await open(page, "/admin/theming");
  await expect(page.locator(".admin-nav")).not.toContainText("Theming");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lists");
  await expect(page.locator(".theme-section")).toHaveCount(0);

  // signed out: the look and its logo are there for the sign-in page
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const look = await anon.get("/api/theme");
  expect(look.status()).toBe(200);
  expect(look.headers()["cache-control"]).toBe("no-cache");
  expect(look.headers()["etag"]).toBeTruthy();
  expect(await look.json()).toMatchObject({ look: {}, revision: expect.any(Number) });
  // an unchanged look costs a 304
  expect((await anon.get("/api/theme", { headers: { "If-None-Match": look.headers()["etag"] } })).status()).toBe(304);
  expect((await anon.get("/api/theme/logo")).status()).toBe(404); // no logo set
  expect((await anon.get("/api/admin/theme")).status()).toBe(401);
  await anon.dispose();
});

test("name, colours and logo: the preview follows before saving; saved, everyone gets them", async ({ page, browser, playwright }) => {
  test.setTimeout(90_000);
  // what an editor's Publish button looks like before, to tell that it follows the look
  await signIn(page, ALEX);
  await openEditor(page, "process", "request-gcp-project");
  const publishBefore = await page.locator(".edit-bar .eb-publish").evaluate((e) => getComputedStyle(e).backgroundColor);

  const csp: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await openTheming(page);
  const light = page.getByRole("group", { name: "Preview, light" });
  const dark = page.getByRole("group", { name: "Preview, dark" });
  await expect(light).toBeVisible();
  await expect(dark).toBeVisible();
  await expect(light).toHaveAttribute("inert", /.*/); // nothing in it can be pressed, and the caption says so
  await expect(section(page).locator("figcaption.pv-caption")).toHaveText(["Preview, light: a sample, nothing in it can be pressed", "Preview, dark: a sample, nothing in it can be pressed"]);
  await expect(light).toContainText("Main button");
  await expect(light).not.toContainText("Save changes");

  // the name: the preview's top bar follows at once
  const name = section(page).getByLabel(/^Name of the portal/);
  await expect(name).toHaveAttribute("placeholder", "Process Manager (the default)");
  // Undo and Redo at the top of the settings
  const undo = section(page).getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();
  await name.fill("A first try");
  await undo.click();
  await expect(name).toHaveValue("");
  await name.fill("Acme Ways of Working");
  await expect(light).toContainText("Acme Ways of Working");
  await expect(saveBar(page)).toContainText("Unsaved changes");

  // a yellow brand: filled parts keep the yellow with dark ink, text in the brand colour is made darker to stay readable
  await section(page).getByRole("textbox", { name: "Brand colour as a code, e.g. #0055aa" }).fill("#ffd400");
  const sample = light.locator(".btn.primary").first();
  await expect.poll(async () => rgbOf(await sample.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([255, 212, 0]);
  const ink = rgbOf(await sample.evaluate((e) => getComputedStyle(e).color));
  expect(contrast(ink, [255, 212, 0]), "dark ink on the yellow button").toBeGreaterThanOrEqual(4.5);
  await expect(section(page).locator(".color-field", { hasText: "Brand colour" }).locator(".color-used")).toContainText(/In use:\s*Light #[0-9a-f]{6}\s*Dark #[0-9a-f]{6}/);
  await expect(section(page).locator(".color-field", { hasText: "Brand colour" })).toContainText("Made darker in the light look");

  // a logo: a small square PNG, uploaded, shown in the tiles and the preview
  await section(page).getByLabel("Logo image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(48, 48, [200, 40, 120]) });
  await expect(section(page).getByRole("button", { name: "Use the default mark" })).toBeVisible();
  await expect(section(page).locator(".theme-logo-tile img").first()).toBeVisible();

  // nothing is stored before "Save for everyone"; a yellow brand no longer looks like the warnings
  // (Earth, an orange: the warning about it is in the next test), so it saves without a question
  expect((await stored(page.request)).look).toEqual({});
  await expect(section(page).locator(".color-field", { hasText: "Brand colour" }).locator(".color-note.warn")).toHaveCount(0);
  await saveForEveryone(page);
  const now = await stored(page.request);
  expect(now.look).toMatchObject({ name: "Acme Ways of Working", brand: "#ffd400" });
  expect(now.look.logo).toMatch(/^[0-9a-f]{64}$/);
  await expect(section(page).locator(".theme-status")).toContainText("Last changed by Dana Admin");
  // the activity log says it in words
  await page.goto("/#/admin/activity");
  await expect(page.locator(".activity li").first()).toContainText("Dana Admin changed the look of the portal");
  await page.goto("/#/admin/theming");
  // this page's own top bar follows at once
  await expect(page.locator(".topbar:not(.theme-preview *) .brand")).toHaveAccessibleName("Acme Ways of Working");

  // the logo, signed out
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const logo = await anon.get("/api/theme/logo");
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toBe("image/png");
  await anon.dispose();

  // Sam, in another browser, after a reload: the name in the top bar (from 1200 px), the tab, the colours
  const sam = await visitor(browser, SAM, { width: 1300 });
  const hosts = new Set<string>();
  sam.page.on("request", (r) => hosts.add(new URL(r.url()).host));
  const samCsp: string[] = [];
  sam.page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) samCsp.push(m.text()); });
  await sam.page.goto("/#/");
  await expect(sam.page.locator(".topbar .brand-name")).toHaveText("Acme Ways of Working");
  await expect(sam.page.locator(".topbar .brand .logo img")).toBeVisible();
  await expect(sam.page).toHaveTitle("Acme Ways of Working");
  await sam.page.goto("/#/processes");
  await expect(sam.page).toHaveTitle("Processes · Acme Ways of Working");
  // a primary button: the chosen yellow with dark ink; text in the brand colour: the readable variant
  await sam.page.goto("/#/");
  const button = sam.page.locator(".search-box .btn.primary").first();
  await expect.poll(async () => rgbOf(await button.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([255, 212, 0]);
  expect(contrast(rgbOf(await button.evaluate((e) => getComputedStyle(e).color)), [255, 212, 0])).toBeGreaterThanOrEqual(4.5);
  const accent = await sam.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  expect(accent).toMatch(/^#[0-9a-f]{6}$/i);
  expect(contrast(hexToRgb(accent.toLowerCase()), [255, 255, 255]), "links stay readable on white").toBeGreaterThanOrEqual(4.5);
  // between 1120 and 1200 px the places of the bar need the room: only the logo, the name stays the link's accessible name
  await sam.page.setViewportSize({ width: 1150, height: 900 });
  await expect(sam.page.locator(".topbar .brand-name")).toBeHidden();
  await expect(sam.page.locator(".topbar .brand .logo")).toBeVisible();
  await expect(sam.page.locator(".topbar .brand")).toHaveAccessibleName("Acme Ways of Working");
  // below 1120 the places go behind "Menu", and the name shows again from 600 px up
  await sam.page.setViewportSize({ width: 1100, height: 900 });
  await expect(sam.page.locator(".topbar .brand-name")).toBeVisible();
  await sam.page.setViewportSize({ width: 500, height: 900 });
  await expect(sam.page.locator(".topbar .brand-name")).toBeHidden();
  await expect(sam.page.locator(".topbar .brand .logo")).toBeVisible();
  await expect(sam.page.locator(".topbar:not(.theme-preview *) .brand")).toHaveAccessibleName("Acme Ways of Working");
  // the share text carries the name
  await sam.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sam.page.setViewportSize({ width: 1300, height: 900 });
  await sam.page.goto("/#/s/secure-logging/doc");
  await sam.page.getByRole("button", { name: "Share" }).click();
  await sam.page.getByRole("dialog", { name: "Share “Secure logging”" }).getByRole("button", { name: /^Copy link and title/ }).click();
  expect(await sam.page.evaluate(() => navigator.clipboard.readText())).toBe(`Secure logging · Acme Ways of Working\n${BASE}/#/s/secure-logging`);
  // nothing is fetched from another host, and the policy refuses nothing
  expect([...hosts].filter((h) => h !== "127.0.0.1:8090")).toEqual([]);
  expect(samCsp).toEqual([]);
  await sam.close();

  // the sign-in page, signed out
  const out = await visitor(browser, null);
  await out.page.goto("/");
  await expect(out.page.getByRole("heading", { level: 1 })).toHaveText("Acme Ways of Working");
  await out.close();

  // the editing bar's Publish button follows the brand
  await signIn(page, ALEX);
  await openEditor(page, "process", "request-gcp-project");
  const publishNow = await page.locator(".edit-bar .eb-publish").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(publishNow).not.toBe(publishBefore);
  const fillOnDark = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--accent-fill-on-dark)";
    document.querySelector(".edit-bar")!.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  expect(publishNow).toBe(fillOnDark);
  expect(csp).toEqual([]);
});

test("warnings for colours that mislead, the name limit, and a logo that is refused", async ({ page }) => {
  await openTheming(page);
  const brand = section(page).locator(".color-field", { hasText: "Brand colour" });
  // a red brand: a warning that says what will be confused, never a refusal
  await brand.getByRole("textbox", { name: /as a code/ }).fill("#dc2626");
  await expect(brand.locator(".color-note.warn", { hasText: "This looks like the colour that marks problems:" })).toContainText("Buttons that save or approve will look like buttons that delete, and links like error messages.");
  // information follows the second colour now, not the brand: no word of notices here
  await expect(brand.locator(".color-note.warn", { hasText: "This looks like the colour that marks problems:" })).not.toContainText("Notices");
  // an orange brand looks like the warnings (the designer's Earth)
  await brand.getByRole("textbox", { name: /as a code/ }).fill("#ff6a1a");
  await expect(brand.locator(".color-note.warn")).toHaveCount(1);
  await expect(brand.locator(".color-note.warn")).toContainText("This looks like the colour of warnings such as “Review due”: Buttons and links will look like warnings, and a warning will no longer stand out.");
  await brand.getByRole("textbox", { name: /as a code/ }).fill("#dc2626");
  await expect(saveBar(page).getByRole("button", { name: "Save for everyone" })).toBeEnabled();
  // processes and standards alike
  await section(page).locator(".color-field", { hasText: "Processes" }).getByRole("textbox", { name: /as a code/ }).fill("#0d9488");
  await section(page).locator(".color-field", { hasText: "Standards" }).getByRole("textbox", { name: /as a code/ }).fill("#0f9488");
  await expect(section(page).locator(".color-note.warn", { hasText: "Processes and standards will be hard to tell apart" })).toBeVisible();
  // a colour that is not one
  const hex = brand.getByRole("textbox", { name: /as a code/ });
  await hex.fill("#12");
  await hex.blur();
  await expect(brand.locator(".field-error")).toHaveText("Write the colour as # and six digits or letters a-f, e.g. #0055aa.");
  await expect(hex).toHaveAttribute("aria-invalid", "true");

  // a name longer than 40 characters
  const name = section(page).getByLabel(/^Name of the portal/);
  await name.fill("A portal name that is much too long to fit");
  const over = "A portal name that is much too long to fit".length - 40;
  await expect(section(page).getByRole("alert").filter({ hasText: "The name can have at most 40" })).toHaveText(`The name can have at most 40 characters: remove ${over}.`);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(saveBar(page).getByRole("button", { name: "Save for everyone" })).toBeDisabled();
  // the server refuses it as well, with its own sentence
  const { revision } = await stored(page.request);
  const refused = await page.request.put(`/api/admin/theme?rev=${revision}`, { data: { name: "x".repeat(41) }, headers: CSRF });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("The name is 41 characters long; it can be at most 40.");

  // a wide logo: the server's sentence, word for word
  const wide = png(64, 32);
  const said = await page.request.post("/api/icons", { data: wide, headers: { ...CSRF, "Content-Type": "image/png" } });
  expect(said.status()).toBe(400);
  await section(page).getByLabel("Logo image").setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: wide });
  await expect(section(page).locator(".theme-logo").locator("xpath=..").getByRole("alert")).toHaveText((await said.json()).error);
  // Discard: nothing was stored
  await saveBar(page).getByRole("button", { name: "Discard" }).click();
  await expect(saveBar(page)).toHaveCount(0);
  expect((await stored(page.request)).look).toEqual({});
});

test("a save made from an outdated look is met with a question; Back to the default look asks and restores", async ({ page }) => {
  await openTheming(page);
  const name = section(page).getByLabel(/^Name of the portal/);
  await name.fill("Mine");
  // meanwhile another admin saves a look
  await putLook(page.request, { name: "Theirs" });
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
  const conflict = page.getByRole("dialog", { name: "Another admin changed the look" });
  await expect(conflict).toContainText("Your changes are still here and not saved.");
  expect((await stored(page.request)).look.name).toBe("Theirs"); // nothing overwritten
  await conflict.getByRole("button", { name: "Show theirs" }).click();
  await expect(name).toHaveValue("Theirs");
  // and mine over theirs, the other way
  await name.fill("Mine");
  await putLook(page.request, { name: "Theirs again" });
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
  await page.getByRole("dialog", { name: "Another admin changed the look" }).getByRole("button", { name: "Save mine over theirs" }).click();
  await expect.poll(async () => (await stored(page.request)).look.name).toBe("Mine");

  // back to the default: asks, "Keep this look" keeps it
  await page.reload();
  const back = section(page).getByRole("button", { name: "Back to the default look" });
  await back.click();
  const ask = page.getByRole("dialog", { name: "Go back to the default look?" });
  await expect(ask).toContainText("Everyone sees the name “Process Manager”");
  await ask.getByRole("button", { name: "Keep this look" }).click();
  expect((await stored(page.request)).look.name).toBe("Mine");
  await back.click();
  await ask.getByRole("button", { name: "Go back to the default look" }).click();
  await expect.poll(async () => (await stored(page.request)).look).toEqual({});
  await expect(name).toHaveValue("");
  await expect(back).toBeDisabled(); // nothing to go back from
  await expect(page.locator(".topbar:not(.theme-preview *) .brand")).toHaveAccessibleName("Process Manager");
});

test("“Dark” for new visitors: a fresh browser gets it, a person's own choice wins", async ({ page, browser }) => {
  await openTheming(page);
  const appearance = section(page).getByRole("radiogroup", { name: "Light or dark" });
  await expect(appearance.getByRole("radio")).toHaveText(["As the device is set", "Light", "Dark"]);
  await expect(appearance.getByRole("radio", { name: "As the device is set" })).toHaveAttribute("aria-checked", "true");
  await appearance.getByRole("radio", { name: "Dark" }).click();
  await saveForEveryone(page);
  expect((await stored(page.request)).look.appearance).toBe("dark");
  // the admin chose light with the switch (signIn does): she still sees light, and is told why
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(section(page).locator(".own-note")).toContainText("New visitors see the saved look in dark.");

  // somebody new: dark, also on the sign-in page
  const fresh = await visitor(browser, null);
  await fresh.page.goto("/");
  await expect(fresh.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await fresh.close();
  const sam = await visitor(browser, SAM);
  await sam.page.goto("/#/processes");
  await expect(sam.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sam.close();
  // somebody who chose light with the switch keeps light
  const own = await visitor(browser, SAM, { own: "light" });
  await own.page.goto("/#/processes");
  await expect(own.page.locator(".card").first()).toBeVisible();
  await expect(own.page.locator("html")).toHaveAttribute("data-theme", "light");
  await own.close();

  // "Show me what new visitors see" forgets her own choice
  await section(page).getByRole("button", { name: "Show me what new visitors see" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

// ---------- the colours of buttons and states, and the font

/** What a CSS value of a token comes to in the page right now (as a colour), read with a probe inside `within`. */
async function tokenColour(page: Page, prop: "color" | "background-color", token: string, within = "body") {
  return page.evaluate(({ prop, token, within }) => {
    const probe = document.createElement("span");
    probe.style.setProperty(prop, `var(${token})`);
    document.querySelector(within)!.appendChild(probe);
    const c = getComputedStyle(probe).getPropertyValue(prop);
    probe.remove();
    return c;
  }, { prop, token, within });
}
/** A box drawn with the app's own classes, for the states that only appear in particular moments. */
async function stateBoxes(page: Page) {
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "probe-states";
    // the states as their pills say them, and as their alerts (Alert.tsx) show them
    box.innerHTML = '<span class="status good">Saved</span><span class="status warn">Review due</span><span class="status bad">1 to fix</span><span class="status info">Readers still see version 1</span>'
      + ["success", "warning", "problem", "info"].map((t) => `<div class="alert alert-${t}"><span class="alert-icon"></span><div class="alert-body"><div class="alert-desc">${t}</div></div></div>`).join("");
    document.querySelector(".page")!.appendChild(box);
  });
}
const CHOSEN = { mainButton: "#5b21b6", otherButtons: "#0f766e", success: "#0b6e2e", warning: "#8a4b00", info: "#1d4ed8", problem: "#9b1c1c" };

test("the colours of buttons and states reach the app, in light and dark; “Back to the default” restores", async ({ page, browser }) => {
  test.setTimeout(90_000);
  /** The colours of real buttons and of the state boxes, each with the token it must follow. */
  const measure = async (p: Page) => {
    await p.goto("/#/processes");
    const main = p.getByRole("button", { name: "New process", exact: true });
    const other = p.getByRole("button", { name: "Create from text with AI" });
    await expect(main).toBeVisible();
    await stateBoxes(p);
    const style = (l: ReturnType<Page["locator"]>, prop: string) => l.evaluate((e, prop) => getComputedStyle(e).getPropertyValue(prop), prop);
    return {
      main: [await style(main, "background-color"), await tokenColour(p, "background-color", "--action-fill")],
      otherText: [await style(other, "color"), await tokenColour(p, "color", "--action-other")],
      otherLine: [await style(other, "border-top-color"), await tokenColour(p, "color", "--action-other-line")],
      success: [await style(p.locator("#probe-states .status.good"), "color"), await tokenColour(p, "color", "--good")],
      warning: [await style(p.locator("#probe-states .status.warn"), "color"), await tokenColour(p, "color", "--warn")],
      problem: [await style(p.locator("#probe-states .status.bad"), "color"), await tokenColour(p, "color", "--bad")],
      info: [await style(p.locator("#probe-states .status.info"), "color"), await tokenColour(p, "color", "--info")],
      successAlert: [await style(p.locator("#probe-states .alert-success"), "background-color"), await tokenColour(p, "background-color", "--alert-success-bg")],
      warningAlert: [await style(p.locator("#probe-states .alert-warning"), "background-color"), await tokenColour(p, "background-color", "--alert-warn-bg")],
      problemAlert: [await style(p.locator("#probe-states .alert-problem"), "background-color"), await tokenColour(p, "background-color", "--alert-bad-bg")],
      infoAlert: [await style(p.locator("#probe-states .alert-info"), "background-color"), await tokenColour(p, "background-color", "--alert-info-bg")],
      successIcon: [await style(p.locator("#probe-states .alert-success .alert-icon"), "color"), await tokenColour(p, "color", "--alert-success-icon")],
      warningIcon: [await style(p.locator("#probe-states .alert-warning .alert-icon"), "color"), await tokenColour(p, "color", "--alert-warn-icon")],
      problemIcon: [await style(p.locator("#probe-states .alert-problem .alert-icon"), "color"), await tokenColour(p, "color", "--alert-bad-icon")],
      infoIcon: [await style(p.locator("#probe-states .alert-info .alert-icon"), "color"), await tokenColour(p, "color", "--alert-info-icon")],
    };
  };
  const looks: Record<string, Record<string, string[]>> = {};
  for (const mode of ["light", "dark"] as const) {
    const v = await visitor(browser, ALEX, { own: mode });
    looks[`default-${mode}`] = await measure(v.page);
    await v.close();
  }
  await putLook(page.request, CHOSEN);
  for (const mode of ["light", "dark"] as const) {
    const v = await visitor(browser, ALEX, { own: mode });
    await v.page.goto("/#/processes");
    await expect(v.page.locator("html")).toHaveAttribute("data-theme", mode);
    const now = await measure(v.page);
    for (const [part, [element, token]] of Object.entries(now)) {
      expect(element, `${part} follows its token (${mode})`).toBe(token);
      // an alert's ground keeps the designer's lightness in the chosen colour's hue: the chosen red of problems has the
      // hue of the designer's pink, so in the light look its ground stays that pink (its icon changes)
      if (part === "problemAlert" && mode === "light") expect(element, "a red of the same hue keeps the designer's pink").toBe("rgb(255, 235, 235)");
      else expect(element, `${part} changed from the default (${mode})`).not.toBe(looks[`default-${mode}`][part][0]);
    }
    // in the light look the chosen colours are used as they are where they are readable
    if (mode === "light") {
      expect(rgbOf(now.main[0])).toEqual(hexToRgb(CHOSEN.mainButton));
      expect(rgbOf(now.otherText[0])).toEqual(hexToRgb(CHOSEN.otherButtons));
    }
    await v.close();
  }

  // Back to the default, colour by colour, on the Theming page
  await openTheming(page);
  for (const label of ["Main buttons", "Other buttons", "Success", "Warning", "Information", "Problem"]) {
    await section(page).getByRole("button", { name: `${label}: back to the default` }).click();
    await expect(section(page).getByRole("button", { name: `${label}: back to the default` })).toHaveCount(0);
  }
  await expect(section(page).getByRole("group", { name: /^Main buttons / })).toContainText("Follows the brand");
  await expect(section(page).getByRole("group", { name: /^Other buttons / })).toContainText("Neutral");
  await saveForEveryone(page);
  expect((await stored(page.request)).look).toEqual({});
  const v = await visitor(browser, ALEX, { own: "light" });
  const back: Record<string, string[]> = await measure(v.page);
  for (const part of Object.keys(back)) expect(back[part][0], part).toBe(looks["default-light"][part][0]);
  await v.close();
});

test("warnings: main buttons like success; a careless look counts its warnings and asks once on Save", async ({ page }) => {
  await openTheming(page);
  const field = (label: string) => section(page).getByRole("group", { name: new RegExp(`^${label} `) });
  const code = (label: string) => field(label).getByRole("textbox", { name: /as a code/ });
  await code("Success").fill("#1a7f37");
  await code("Main buttons").fill("#1a7f37");
  await expect(section(page).locator(".color-note.warn", { hasText: "Main buttons will look like good news: “Publish…” and “Nothing to fix” will have nearly the same colour." })).toBeVisible();
  // the preview's editing bar follows the unsaved colour of main buttons
  const publish = page.getByRole("group", { name: "Preview, light" }).locator(".pv-edit-bar .eb-publish");
  await expect.poll(async () => publish.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await tokenColour(page, "background-color", "--action-fill-on-dark", ".theme-preview .pv-edit-bar"));
  const fillNow = await publish.evaluate((e) => getComputedStyle(e).backgroundColor);
  await code("Main buttons").fill("#a15c07");
  await expect.poll(async () => publish.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(fillNow);

  // a careless look: warnings counted in the save bar, the link goes to the first
  await code("Warning").fill("#a15c07");
  await expect(section(page).locator(".color-note.warn", { hasText: "Main buttons will look like warnings: “Publish…” and “Review due” will have nearly the same colour." })).toBeVisible();
  await code("Problem").fill("#b91c1c");
  const count = saveBar(page).locator(".theme-warnings");
  await expect(count).toHaveText(/^\d+ warnings?$/);
  const n = Number((await count.innerText()).match(/\d+/)![0]);
  expect(n).toBe(await section(page).locator(".color-note.warn").count());
  await count.click();
  await expect(section(page).locator(".color-note.warn").first()).toBeFocused();
  // Save asks once: "Look at them first" stores nothing
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
  const ask = page.getByRole("dialog", { name: `Save with ${n} ${n === 1 ? "warning" : "warnings"}?` });
  await expect(ask).toContainText("Some colours of this look will be mistaken for others");
  await ask.getByRole("button", { name: "Look at them first" }).click();
  await expect(ask).toHaveCount(0);
  expect((await stored(page.request)).look).toEqual({});
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
  await ask.getByRole("button", { name: "Save anyway" }).click();
  await expect(saveBar(page)).toHaveCount(0);
  expect((await stored(page.request)).look).toMatchObject({ success: "#1a7f37", mainButton: "#a15c07", warning: "#a15c07", problem: "#b91c1c" });

  // a look without warnings saves in one click
  for (const label of ["Main buttons", "Warning", "Problem", "Success"]) await section(page).getByRole("button", { name: `${label}: back to the default` }).click();
  await saveForEveryone(page);
  await expect(page.getByRole("dialog", { name: /^Save with/ })).toHaveCount(0);
  expect((await stored(page.request)).look).toEqual({});
});

test("the font: Roboto by default, served by the portal itself; Inter is fetched only once chosen, and the whole app follows", async ({ page, browser }) => {
  // the default look: Roboto, from the portal, and no Inter
  const plain = await visitor(browser, SAM);
  const fonts: string[] = [];
  plain.page.on("request", (r) => { if (r.resourceType() === "font" || /\.woff2?(\?|$)/.test(r.url())) fonts.push(r.url()); });
  await plain.page.goto("/#/processes");
  await expect(plain.page.locator(".card").first()).toBeVisible();
  await plain.page.evaluate(() => document.fonts.ready);
  expect(await plain.page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Roboto/);
  await expect.poll(() => fonts.filter((u) => /roboto/i.test(u)).length).toBeGreaterThan(0);
  expect(fonts.every((u) => u.startsWith(BASE)), fonts.join(" ")).toBe(true); // shipped with the portal
  expect(fonts.filter((u) => /inter/i.test(u))).toEqual([]);
  await plain.close();

  await openTheming(page);
  const font = section(page).getByRole("radiogroup", { name: "Font" });
  await expect(font.getByRole("radio")).toHaveText(["Default (Roboto)", "Inter"]);
  await expect(font.getByRole("radio", { name: "Default (Roboto)" })).toHaveAttribute("aria-checked", "true");
  await font.getByRole("radio", { name: "Inter" }).click();
  await saveForEveryone(page);
  expect((await stored(page.request)).look.font).toBe("inter");

  const sam = await visitor(browser, SAM);
  const got: string[] = [];
  sam.page.on("request", (r) => { if (/inter/i.test(r.url()) && (r.resourceType() === "font" || /\.woff2?(\?|$)/.test(r.url()))) got.push(r.url()); });
  await sam.page.goto("/#/processes");
  await expect(sam.page.locator(".card").first()).toBeVisible();
  await expect.poll(() => sam.page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Inter/);
  for (const sel of ["h1", ".card .card-title", "button.btn.primary"]) {
    expect(await sam.page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontFamily), sel).toMatch(/^"?Inter/);
  }
  await expect.poll(() => got.length).toBeGreaterThan(0);
  expect(got.every((u) => u.startsWith(BASE))).toBe(true); // shipped with the portal
  await sam.close();

  await section(page).locator(".theme-font-default").click();
  await expect(font.getByRole("radio", { name: "Default (Roboto)" })).toHaveAttribute("aria-checked", "true");
  await saveForEveryone(page);
  expect((await stored(page.request)).look).toEqual({});
});

// ---------- the designer's look (the default): type, palette, tints, the map, contrast

/** Mixes `hex` over `ground` as a tint of `pct` percent, as the look works out its tints. */
const tintOf = (hex: string, ground: string, pct: number) => hexToRgb(hex).map((c, i) => Math.round(c * pct / 100 + hexToRgb(ground)[i] * (1 - pct / 100)));
const near = (got: number[], want: number[], what: string) => { for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i]), `${what}: ${got} is ${want}`).toBeLessThanOrEqual(1); };
const SNOW = "#ffffff", MIDNIGHT = "#0e0d26", OCEAN = "#1971ed", SKY = "#66c5ff";

/** The pages a sample of the look is taken on: home, a list, a process, a standard, the editing screen, the search, Admin. */
const LOOK_PAGES = ["/", "/processes", "/p/request-gcp-project/flow", "/s/secure-logging", "/p/request-gcp-project/edit", "/search?q=gcp", "/admin/access", "/admin/lists"];
async function eachLookPage(page: Page, each: (hash: string) => Promise<void>) {
  for (const hash of LOOK_PAGES) {
    await page.goto("about:blank");
    await open(page, hash);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await each(hash);
  }
}

test("with no look stored, the text is Roboto, served by the portal, in three sizes and three weights; headings in their own scale", async ({ page }) => {
  test.setTimeout(90_000);
  const hosts = new Set<string>();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  await signIn(page, DANA);
  await page.setViewportSize({ width: 1366, height: 900 });
  const BODY = new Set(["12px/16px", "14px/20px", "16px/24px"]);
  const HEADING = new Set(["18px/24px", "20px/28px", "24px/32px", "32px/40px", "40px/48px"]);
  await eachLookPage(page, async (hash) => {
    const seen = await page.evaluate(() => [...document.querySelectorAll("body *")].flatMap((e) => {
      if (!(e instanceof HTMLElement) || !e.checkVisibility()) return [];
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) return [];
      // a drop-down's own line height is Chromium's, whatever the stylesheet says
      if (e.closest("select, svg")) return [];
      const s = getComputedStyle(e);
      return [{ what: `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} “${e.textContent!.trim().slice(0, 24)}”`, heading: /^H[1-6]$/.test(e.tagName), size: `${s.fontSize}/${s.lineHeight}`, weight: Number(s.fontWeight), family: s.fontFamily, mono: /mono/i.test(s.fontFamily) }];
    }));
    expect(seen.length, hash).toBeGreaterThan(20);
    for (const t of seen) {
      const at = `${hash}: ${t.what} ${t.size} ${t.weight}`;
      if (!t.mono) expect(t.family, at).toMatch(/^"Roboto Variable", Roboto, Helvetica, Arial, sans-serif$/);
      if (BODY.has(t.size)) expect([400, 500, 700], at).toContain(t.weight);
      else {
        expect(HEADING.has(t.size), `${at}: neither a body size nor the headings' scale`).toBe(true);
        expect([500, 700], at).toContain(t.weight);
      }
      if (t.heading) expect(t.weight, `${at}: a heading is never regular`).toBeGreaterThanOrEqual(500);
    }
    // the page's own heading and its body
    expect(await page.locator("h1").first().evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^"Roboto Variable"/);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize + "/" + getComputedStyle(document.body).lineHeight)).toBe("14px/20px");
  });
  expect([...hosts].filter((h) => h !== "127.0.0.1:8090"), "nothing from another host").toEqual([]);
});

test("the default look is the designer's: Ocean, Sky, Midnight, the kinds, the states, the highlight and the quiet surface; Theming names them", async ({ page, browser }) => {
  const want: Record<"light" | "dark", Record<string, string>> = {
    light: {
      "--action-fill": OCEAN, "--accent-fill": OCEAN, "--ocean-100": OCEAN, "--sky-100": SKY, "--bg": "#f0f9ff", "--surface": SNOW, "--text": MIDNIGHT,
      "--good-fill": "#00b35f", "--warn-fill": "#ff6720", "--kind-standard-fill": "#913199", "--kind-process-fill": "#0a8276", "--bad": "#be123c",
      "--highlight": "#f3ea5d", "--search-mark": "#f3ea5d", "--quiet": "#f6eee1", "--quiet-line": "#ecdabe",
    },
    dark: {
      "--action-fill": OCEAN, "--accent-fill": OCEAN, "--ocean-100": OCEAN, "--sky-100": SKY, "--bg": MIDNIGHT,
      "--good-fill": "#00b35f", "--warn-fill": "#ff6720", "--kind-standard-fill": "#913199", "--kind-process-fill": "#0a8276", "--bad-fill": "#be123c", "--highlight": "#f3ea5d",
    },
  };
  for (const mode of ["light", "dark"] as const) {
    const v = await visitor(browser, SAM, { own: mode });
    await v.page.goto("/#/processes");
    await expect(v.page.locator(".card").first()).toBeVisible();
    for (const [token, hex] of Object.entries(want[mode])) expect(rgbOf(await tokenColour(v.page, "background-color", token)), `${token} (${mode})`).toEqual(hexToRgb(hex));
    // the main button is Ocean with Snow ink
    const main = v.page.getByRole("button", { name: "Ask for a process or standard" }).or(v.page.locator(".btn.primary")).first();
    if (await main.count()) expect(rgbOf(await main.evaluate((e) => getComputedStyle(e).backgroundColor)), mode).toEqual(hexToRgb(OCEAN));
    await v.close();
  }
  // Theming shows the designer's palette by name
  await openTheming(page);
  const palette = section(page).getByRole("list", { name: "The designer's palette" }).getByRole("listitem");
  await expect(palette).toHaveText([/^Ocean\s*#1971ed/, /^Sky\s*#66c5ff/, /^Snow\s*#ffffff/, /^Midnight\s*#0e0d26/, /^Land\s*#00b35f/, /^Earth\s*#ff6720/, /^Berry\s*#913199/, /^Sun\s*#f3ea5d/, /^Grain\s*#e6cda8/]);
  for (const [label, name] of [["Brand colour", "Ocean"], ["Second colour", "Sky"], ["Ink", "Midnight"], ["Highlight", "Sun"], ["Quiet surface", "Grain"], ["Standards", "Berry"], ["Success", "Land"], ["Warning", "Earth"]]) {
    await expect(section(page).getByRole("group", { name: new RegExp(`^${label} `) }), label).toContainText(`Default: ${name}`);
  }
});

test("the tints are 10, 35, 75 and 100 % of Ocean and Sky, over Snow in light and Midnight in dark, and follow a changed brand and second colour", async ({ page, browser }) => {
  const check = async (brand: string, second: string) => {
    for (const [mode, ground] of [["light", SNOW], ["dark", MIDNIGHT]] as const) {
      const v = await visitor(browser, SAM, { own: mode });
      await v.page.goto("/#/processes");
      await expect(v.page.locator(".card").first()).toBeVisible();
      for (const pct of [10, 35, 75, 100]) {
        near(rgbOf(await tokenColour(v.page, "background-color", `--ocean-${pct}`)), tintOf(brand, ground, pct), `--ocean-${pct} (${mode})`);
        near(rgbOf(await tokenColour(v.page, "background-color", `--sky-${pct}`)), tintOf(second, ground, pct), `--sky-${pct} (${mode})`);
      }
      // the page ground of the light look is the second colour's 10 %, a table head Ocean's 10 %
      if (mode === "light") near(rgbOf(await v.page.evaluate(() => getComputedStyle(document.body).backgroundColor)), tintOf(second, ground, 10), "the page ground");
      await v.close();
    }
  };
  await check(OCEAN, SKY);
  await putLook(page.request, { brand: "#0f766e", secondary: "#a78bfa" });
  await check("#0f766e", "#a78bfa");
  // Theming shows the steps of each, for the brand and the second colour
  await openTheming(page);
  for (const label of ["Brand colour", "Second colour"]) {
    await expect(section(page).getByRole("group", { name: new RegExp(`^${label} `) }).locator(".color-tint")).toHaveText(["10 %", "35 %", "75 %", "100 %"]);
  }
});

test("Theming changes the second colour, the ink, the highlight and the quiet surface: warned, saved, seen by another person, put back", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await openTheming(page);
  const field = (label: string) => section(page).getByRole("group", { name: new RegExp(`^${label} `) });
  const code = (label: string) => field(label).getByRole("textbox", { name: /as a code/ });
  // the warnings for the new parts
  await code("Second colour").fill("#f3ea5d");
  await expect(section(page).locator(".color-note.warn", { hasText: "The second colour looks like the highlight: the page ground and what is selected will look like words found by a search." })).toBeVisible();
  await code("Second colour").fill(SKY);
  await code("Highlight").fill("#ff6a1a");
  await expect(section(page).locator(".color-note.warn", { hasText: "Highlights will look like warnings: a word found by the search and “Review due” will have nearly the same colour." })).toBeVisible();

  const chosen = { secondary: "#8fd3c8", ink: "#1f2a44", highlight: "#ffe066", quiet: "#eadbc6" };
  await code("Second colour").fill(chosen.secondary);
  await code("Ink").fill(chosen.ink);
  await code("Highlight").fill(chosen.highlight);
  await code("Quiet surface").fill(chosen.quiet);
  const warned = (await section(page).locator(".color-note.warn").count()) > 0;
  await saveForEveryone(page, warned);
  expect((await stored(page.request)).look).toMatchObject(chosen);

  // somebody else, in a browser of their own: the ground, the text, the highlight and the quiet surface follow
  const sam = await visitor(browser, SAM, { own: "light" });
  await sam.page.goto("/#/search?q=gcp");
  await expect(sam.page.locator(".card").first()).toBeVisible();
  near(rgbOf(await tokenColour(sam.page, "background-color", "--sky-100")), hexToRgb(chosen.secondary), "the second colour");
  near(rgbOf(await sam.page.evaluate(() => getComputedStyle(document.body).backgroundColor)), tintOf(chosen.secondary, SNOW, 10), "the page ground");
  near(rgbOf(await tokenColour(sam.page, "color", "--text")), hexToRgb(chosen.ink), "the ink is the text");
  near(rgbOf(await tokenColour(sam.page, "background-color", "--highlight")), hexToRgb(chosen.highlight), "the highlight");
  near(rgbOf(await sam.page.locator("mark.search-mark, .search-mark").first().evaluate((e) => getComputedStyle(e).backgroundColor)), rgbOf(await tokenColour(sam.page, "background-color", "--search-mark")), "a word found is marked with it");
  expect(rgbOf(await tokenColour(sam.page, "background-color", "--quiet")), "the quiet surface changed").not.toEqual(hexToRgb("#f6eee1"));
  // the text still reads on what it stands on
  expect(contrast(rgbOf(await tokenColour(sam.page, "color", "--text")), rgbOf(await tokenColour(sam.page, "background-color", "--quiet")))).toBeGreaterThanOrEqual(4.5);
  await sam.close();

  // each back to the default, and the look is empty again
  for (const label of ["Second colour", "Ink", "Highlight", "Quiet surface"]) {
    await section(page).getByRole("button", { name: `${label}: back to the default` }).click();
    await expect(section(page).getByRole("button", { name: `${label}: back to the default` })).toHaveCount(0);
  }
  await saveForEveryone(page);
  expect((await stored(page.request)).look).toEqual({});
});

test("the map's steps and lanes follow a changed brand", async ({ page, browser }) => {
  const read = async () => {
    const v = await visitor(browser, SAM, { own: "light" });
    await v.page.goto("/#/p/request-gcp-project/flow");
    await expect(v.page.locator(".block").first()).toBeVisible();
    const accent = rgbOf(await tokenColour(v.page, "color", "--accent"));
    const lane = rgbOf(await v.page.locator(".lane-label").first().evaluate((e) => getComputedStyle(e).getPropertyValue("--lane").trim()).then((c) => (c.startsWith("#") ? `rgb(${hexToRgb(c).join(",")})` : c)));
    const work = v.page.locator('.block[style*="--step-work"]').first();
    await expect(work).toBeVisible();
    const step = rgbOf(await work.locator(".type-icon").evaluate((e) => getComputedStyle(e).color));
    await v.close();
    return { accent, lane, step };
  };
  const before = await read();
  expect(before.lane, "the first lane is the brand").toEqual(before.accent);
  expect(before.step, "a step of work is the brand").toEqual(before.accent);
  await putLook(page.request, { brand: "#0f766e" });
  const after = await read();
  expect(after.accent).not.toEqual(before.accent);
  expect(after.lane).toEqual(after.accent);
  expect(after.step).toEqual(after.accent);
});

/** Every text with an ink of its own, against the ground it stands on (see-through grounds composited), as [what, ratio]. */
function textOnGround() {
  const rgba = (c: string) => { const m = c.match(/[\d.]+/g); if (!m) return null; const k = c.startsWith("color(srgb") ? 255 : 1; const [r, g, b, a = 1] = m.map(Number); return { r: r * k, g: g * k, b: b * k, a }; };
  type C = { r: number; g: number; b: number; a: number };
  const lum = ({ r, g, b }: C) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x: C, y: C) => { const [a, b] = [lum(x), lum(y)].sort((m, n) => n - m); return (a + 0.05) / (b + 0.05); };
  const over = (top: C, under: C): C => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const groundOf = (e: Element): C | null => {
    const layers: C[] = [];
    for (let p: Element | null = e; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      // a picture, a see-through part or a blend under it: not judged here
      if (cs.backgroundImage !== "none" || Number(cs.opacity) < 1 || cs.mixBlendMode !== "normal" || cs.filter !== "none") return null;
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let g: C = { r: 255, g: 255, b: 255, a: 1 };
    for (const l of layers.reverse()) g = over(l, g);
    return g;
  };
  const texts: [string, number][] = [];
  const outlines: [string, number][] = [];
  for (const e of document.querySelectorAll("body *")) {
    if (!(e instanceof HTMLElement) || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    // disabled controls are exempt; read-out-only text and the Theming preview are not on the screen as such
    if (e.closest(".sr-only, [disabled], [aria-disabled='true'], .theme-preview, svg, [inert]")) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (e.matches("input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]), select, textarea")) {
      const g = e.parentElement && groundOf(e.parentElement);
      const line = rgba(getComputedStyle(e).borderTopColor);
      if (g && line && getComputedStyle(e).borderTopStyle !== "none") outlines.push([`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`, Math.round(ratio(over(line, g), g) * 100) / 100]);
    }
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
    const g = groundOf(e);
    const ink = rgba(getComputedStyle(e).color);
    if (!g || !ink) continue;
    texts.push([`${e.tagName.toLowerCase()}.${[...e.classList].join(".")} “${e.textContent!.trim().slice(0, 30)}”`, Math.round(ratio(over(ink, g), g) * 100) / 100]);
  }
  return { texts, outlines };
}

for (const mode of ["light", "dark"] as const) {
  test(`text reads at 4.5:1 or more on its ground, and inputs have a 3:1 outline, in ${mode}`, async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, DANA);
    await page.addInitScript((m) => { try { localStorage.setItem("pm:theme", m); } catch { /* ignore */ } }, mode); // after signIn's "light"
    await page.setViewportSize({ width: 1366, height: 900 });
    let inputs = 0;
    await eachLookPage(page, async (hash) => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      const { texts, outlines } = await page.evaluate(textOnGround);
      expect(texts.length, hash).toBeGreaterThan(20);
      expect(texts.filter(([, x]) => x < 4.5), `${hash}: text under 4.5:1 (${mode})`).toEqual([]);
      expect(outlines.filter(([, x]) => x < 3), `${hash}: input outlines under 3:1 (${mode})`).toEqual([]);
      inputs += outlines.length;
    });
    expect(inputs, "inputs were measured").toBeGreaterThan(5);
  });
}

test("the lists' tabs in their three groups: each group one row, nothing scrolled away at 1366, in Admin › Lists and in Teams & tools", async ({ page }) => {
  await signIn(page, DANA);
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const hash of ["/admin/lists", "/catalog"]) {
    await open(page, hash);
    const groups = page.locator(".cat-kinds-group");
    await expect(groups.locator(".cat-kinds-name")).toHaveText(["Who", "What", "Where it applies"]);
    await expect(page.getByRole("tab")).toHaveCount(10);
    for (const [name, count] of [["Who", 3], ["What", 3], ["Where it applies", 4]] as const) {
      const list = page.getByRole("tablist", { name });
      await expect(list.getByRole("tab")).toHaveCount(count);
      const tops = await list.getByRole("tab").evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, `${hash} ${name}: one row`).toBe(1);
      expect(await list.evaluate((e) => e.scrollWidth - e.clientWidth), `${hash} ${name}: nothing scrolled away`).toBeLessThanOrEqual(0);
      await expect(list.getByRole("tab").last()).toBeInViewport({ ratio: 1 });
    }
  }
});

/** Every block of a map or chart: its title ends above its meta line, and the meta line is whole or ends in "…". */
async function blocksHold(scope: Locator, what: string) {
  const blocks = await scope.locator(".block").evaluateAll((es) => es.map((b) => {
    const t = b.querySelector(".block-title")?.getBoundingClientRect();
    const meta = b.querySelector(".block-meta");
    const m = meta?.getBoundingClientRect();
    const cut = [...(meta?.querySelectorAll(":scope > span") ?? [])].filter((s) => s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).textOverflow !== "ellipsis").map((s) => s.textContent);
    return { title: b.querySelector(".block-title")?.textContent ?? "", overlap: t && m && meta!.textContent!.trim() ? t.bottom - m.top : 0, cut };
  }));
  expect(blocks.length, what).toBeGreaterThan(0);
  for (const b of blocks) {
    expect(b.overlap, `${what}: “${b.title}” runs into the line under it`).toBeLessThanOrEqual(0.5);
    expect(b.cut, `${what}: “${b.title}” has a cut meta line without “…”`).toEqual([]);
  }
}

test("a map block's title never runs into its meta line: the Guide's charts and the sample maps", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, SAM);
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, "/guide");
  await expect(page.locator(".guide-fig .block").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await blocksHold(page.locator("main"), "the Guide");
  for (const id of ["request-gcp-project", "onboard-site-to-akamai", "raise-servicenow-request", "onboard-api-to-apigee"]) {
    await open(page, `/p/${id}/flow`);
    await expect(page.locator(".block").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await blocksHold(page.locator("main"), id);
  }
});
