import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ALEX, CSRF, DANA, SAM, open, readCatalog, save, signIn } from "./helpers";

// Icons of tools and languages: uploaded in Admin > Lists by whoever may edit the lists, square,
// small, and served so that nothing in them can run. Few uploads here: the server allows 60 per
// person per hour.

const TOOL = "artifact-registry"; // no icon in the sample; a step of "Publish an internal library" uses it
const TOOL2 = "akamai-control-center";

/** A square PNG of `w` x `h` pixels, made here: one colour, no metadata. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([20, 140, 120, 255], y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="#7c3aed"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`;
const SVG_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><rect width="24" height="24"/></svg>`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** What the server says about these bytes, straight from the API (for comparing with what the page shows). */
async function serverSays(request: APIRequestContext, body: Buffer | string, type: string) {
  const res = await request.post("/api/icons", { data: Buffer.from(body), headers: { ...CSRF, "Content-Type": type } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** Puts the lists back as they were: no icon on the two tools. */
async function restore(request: APIRequestContext) {
  await request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  const got = await request.get("/api/catalog");
  const lists = await got.json();
  if (!lists.tools.some((t: { id: string; icon?: string }) => [TOOL, TOOL2].includes(t.id) && t.icon)) return;
  const tools = lists.tools.map((t: { id: string; icon?: string }) => ([TOOL, TOOL2].includes(t.id) ? { ...t, icon: undefined } : t));
  const res = await request.put(`/api/catalog?base=${got.headers()["x-document-version"]}`, { data: { ...lists, tools }, headers: CSRF });
  expect(res.ok(), await res.text()).toBeTruthy();
}
test.afterAll(async ({ request }) => { await restore(request); });

const openTool = async (page: Page, name: string) => {
  await open(page, "/admin/lists");
  await page.getByRole("tab", { name: /Tools/ }).click();
  await page.locator(".cat-item", { hasText: name }).first().click();
  return page.locator(".cat-detail .icon-field");
};

test("a lists manager uploads a PNG and an SVG made here; readers see them on the lists page, the map, the step and a card", async ({ page, browser }) => {
  await signIn(page, ALEX); // lists manager, not an admin
  const field = await openTool(page, "Artifact registry");
  await expect(field.locator(".icon-field-none")).toHaveText("No icon");
  await expect(field.locator(".icon-field-rules")).toHaveText("PNG, JPEG, WebP or SVG. Square, at most 64 KB.");
  const image = png(32, 32);
  await field.getByLabel("Icon for Artifact registry").setInputFiles({ name: "registry.png", mimeType: "image/png", buffer: image });
  const preview = field.locator("img.entry-icon");
  await expect(preview).toHaveAttribute("src", `/api/icons/${sha(image)}`);
  await expect.poll(() => preview.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(32);
  await expect(preview).toHaveAttribute("alt", ""); // decoration: the name is next to it
  // the entry in the list shows it in place of the letter
  await expect(page.locator(".cat-item", { hasText: "Artifact registry" }).locator("img.entry-icon")).toBeVisible();

  const field2 = await (async () => { await page.locator(".cat-item", { hasText: "Akamai Control Center" }).click(); return page.locator(".cat-detail .icon-field"); })();
  await field2.getByLabel("Icon for Akamai Control Center").setInputFiles({ name: "akamai.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await expect(field2.locator("img.entry-icon")).toHaveAttribute("src", `/api/icons/${sha(SVG)}`);
  await save(page);
  const tools = (await readCatalog(page)).tools;
  expect(tools.find((t: { id: string }) => t.id === TOOL).icon).toBe(sha(image));
  expect(tools.find((t: { id: string }) => t.id === TOOL2).icon).toBe(sha(SVG));

  // a reader
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:8090" });
  const r = await ctx.newPage();
  await signIn(r, SAM);
  await open(r, "/catalog");
  await r.getByRole("tab", { name: /Tools/ }).click();
  await expect(r.locator(".cat-item", { hasText: "Artifact registry" }).locator(`img.entry-icon[src="/api/icons/${sha(image)}"]`)).toBeVisible();
  await expect(r.locator(".cat-item", { hasText: "Akamai Control Center" }).locator(`img.entry-icon[src="/api/icons/${sha(SVG)}"]`)).toBeVisible();
  // on the map, the tool line of the step that uses it, and in the step's panel
  await open(r, "/p/publish-internal-library/flow");
  const block = r.locator(".block", { hasText: "Create the namespace" });
  await expect(block.locator(`img.entry-icon[src="/api/icons/${sha(image)}"]`)).toBeVisible();
  // and next to the step's Tool field on the editing screen
  await open(page, "/p/publish-internal-library/edit/create-namespace");
  await expect(page.locator(".edit-fields .with-icon").locator(`img.entry-icon[src="/api/icons/${sha(image)}"]`)).toBeVisible();
  // a language icon on a card
  await open(r, "/processes");
  await expect(r.locator('li.card[data-id="publish-internal-library"] .card-entry img.entry-icon').first()).toBeVisible();
  await ctx.close();
});

test("refusals are shown as the server says them, and “Remove icon” takes it away", async ({ page }) => {
  await restore(page.request); // starts from a tool without an icon
  await signIn(page, DANA);
  const field = await openTool(page, "Artifact registry");
  const input = field.getByLabel("Icon for Artifact registry");
  const alert = field.getByRole("alert");

  // not square: the server's sentence, word for word
  const wide = png(32, 16);
  const said = await serverSays(page.request, wide, "image/png");
  expect(said.status).toBe(400);
  await input.setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: wide });
  await expect(alert).toHaveText(said.body.error);
  await expect(alert).toContainText("square");

  // an SVG with a script
  const script = await serverSays(page.request, SVG_SCRIPT, "image/svg+xml");
  expect(script.status).toBe(400);
  await input.setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG_SCRIPT) });
  await expect(alert).toHaveText(script.body.error);

  // a text file renamed .png
  const text = Buffer.from("This is not a picture at all, only words in a file.\n");
  const notImage = await serverSays(page.request, text, "image/png");
  expect(notImage.status).toBe(400);
  await input.setInputFiles({ name: "words.png", mimeType: "image/png", buffer: text });
  await expect(alert).toHaveText(notImage.body.error);

  // too large: said before anything is sent, and the server refuses it too
  const big = Buffer.concat([png(16, 16), Buffer.alloc(70 * 1024, 1)]);
  await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
  await expect(alert).toContainText("An icon can be at most 64 KB");
  expect((await serverSays(page.request, big, "image/png")).status).toBe(400);
  // none of it changed the entry
  await expect(field.locator(".icon-field-none")).toHaveText("No icon");

  // a good one, then Remove icon
  await input.setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: png(24, 24) });
  await expect(alert).toHaveCount(0);
  await expect(field.locator("img.entry-icon")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible(); // an unsaved change of the lists
  await field.getByRole("button", { name: "Remove icon" }).click();
  await expect(field.locator(".icon-field-none")).toHaveText("No icon");
  await expect(page.locator(".saved")).toBeVisible(); // back to what is saved: nothing to save
  expect((await readCatalog(page)).tools.find((t: { id: string }) => t.id === TOOL).icon).toBeUndefined();
});

test("an icon is served with the safe headers; a reader cannot upload; the sample icons are there", async ({ page }) => {
  await signIn(page, SAM);
  const lists = await readCatalog(page);
  const withIcons = [...lists.tools, ...lists.languages].filter((t: { icon?: string }) => t.icon);
  expect(withIcons.length).toBeGreaterThanOrEqual(9); // five tools and four languages in the sample
  for (const t of withIcons) expect((await page.request.get(`/api/icons/${t.icon}`)).status(), t.name).toBe(200);
  const res = await page.request.get(`/api/icons/${withIcons[0].icon}`);
  const h = res.headers();
  expect(h["content-type"]).toMatch(/^image\/(svg\+xml|png|jpeg|webp)/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(h["cache-control"]).toBe("private, max-age=31536000, immutable");
  expect((await page.request.get(`/api/icons/${"0".repeat(64)}`)).status()).toBe(404);
  // a reader may not add icons
  const refused = await page.request.post("/api/icons", { data: png(16, 16), headers: { ...CSRF, "Content-Type": "image/png" } });
  expect(refused.status()).toBe(403);
  // nor anybody signed out
  const ctx = await page.context().browser()!.newContext({ baseURL: "http://127.0.0.1:8090" });
  expect((await ctx.request.get(`/api/icons/${withIcons[0].icon}`)).status()).toBe(401);
  await ctx.close();
});
