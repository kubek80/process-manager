import { deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, open, openEditor, signIn } from "./helpers";

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
async function saveForEveryone(page: Page) {
  await saveBar(page).getByRole("button", { name: "Save for everyone" }).click();
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

  // nothing is stored before "Save for everyone"
  expect((await stored(page.request)).look).toEqual({});
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
  await expect(brand.locator(".color-note.warn")).toContainText("Buttons that save or approve will look like buttons that delete, and links like error messages.");
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
