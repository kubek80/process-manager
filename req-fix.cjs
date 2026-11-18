const { chromium, request: pwRequest } = require("playwright");
const assert = require("node:assert/strict");
const BASE = "http://127.0.0.1:8095", CSRF = { "X-Requested-With": "process-manager" };
const SHOTS = "/tmp/claude-0/-home-user-process-manager/6937071f-1168-55b9-a1f9-02a74234a2d3/scratchpad/requests/";
const log = (...a) => console.log(...a);
async function api(email) { const r = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: CSRF }); assert.ok((await r.post("/auth/dev/login", { data: { email } })).ok()); return r; }
async function as(browser, email, { theme = "light", width = 1440, editor = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("PAGE ERROR", e.message));
  await page.request.post(BASE + "/auth/dev/login", { data: { email }, headers: CSRF });
  await page.addInitScript(([t, m]) => { localStorage.setItem("pm:theme", t); localStorage.setItem("pm:mode", m); }, [theme, editor ? "editor" : "consumer"]);
  return page;
}
const go = async (page, hash) => { await page.goto(BASE + "/#" + hash); await page.locator("h1").first().waitFor(); };
(async () => {
  const dana = await api("dana@example.com"), alex = await api("alex@example.com"), sam = await api("sam@example.com");
  const mk = async (who, body) => { const r = await who.post("/api/requests", { data: body }); assert.equal(r.status(), 201, await r.text()); return r.json(); };
  const apigee = await mk(alex, { kind: "process", title: "Onboard an API gateway", description: "We need a way to put APIs behind the gateway." });
  const kafka = await mk(sam, { kind: "process", title: "Request a Kafka topic", description: "Teams need topics for event streams." });
  const r1 = await dana.put(`/api/requests/${apigee.id}/state`, { data: { state: "done", linkedId: "onboard-api-to-apigee" } });
  assert.ok(r1.ok(), await r1.text());
  // delete the answering process
  const { meta } = await (await dana.get("/api/processes")).json();
  const del = await dana.delete(`/api/processes/onboard-api-to-apigee?base=${meta["onboard-api-to-apigee"].version}`);
  log("delete process", del.status());
  log("server view", JSON.stringify((await (await sam.get("/api/requests")).json()).requests.find((r) => r.id === apigee.id)));

  const browser = await chromium.launch();
  // ---- the deleted answer: no link
  let page = await as(browser, "sam@example.com", { editor: false });
  await go(page, "/requests?state=done");
  const item = page.locator(".req-item", { hasText: apigee.title });
  await item.waitFor();
  log("done (real server):", await item.locator(".req-outcome").innerText(), "links:", await item.locator("a.req-answer").count());
  // the new server field
  await page.route("**/api/requests", async (r) => { const res = await r.fetch(); const j = await res.json(); j.requests = j.requests.map((q) => (q.id === apigee.id ? { ...q, linkedId: "", linkedGone: true } : q)); await r.fulfill({ response: res, json: j }); });
  await page.reload(); await item.waitFor();
  log("done (linkedGone):", await item.locator(".req-outcome").innerText(), "links:", await item.locator("a.req-answer").count());
  await page.screenshot({ path: SHOTS + "fix-done-gone.png" });
  await page.close();

  // ---- consumer vs editor
  for (const [mode, editor] of [["consumer", false], ["editor", true]]) {
    page = await as(browser, "dana@example.com", { editor });
    await go(page, "/requests");
    const k = page.locator(".req-item", { hasText: kafka.title });
    await k.waitFor();
    log(`dana ${mode}:`, JSON.stringify(await k.locator(".req-actions button").allInnerTexts()), "vote works:", await k.locator(".req-vote").isEnabled());
    if (editor) {
      await k.getByRole("button", { name: "Mark as planned" }).click();
      log("dialog title", await page.getByRole("dialog").locator("h2").innerText());
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await k.getByRole("button", { name: "Mark as done" }).click();
      const opts = await page.getByRole("dialog").getByLabel("The process that answers it").locator("option").allInnerTexts();
      log("answer options", opts.length, opts.includes("Onboard an API to Apigee") ? "HAS DELETED" : "ok");
      // a refusal from the server
      await page.route("**/api/requests/*/state", (r) => r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Only a published process can answer a request. Publish it first."}' }));
      await page.getByRole("dialog").getByLabel("The process that answers it").selectOption("request-gcp-project");
      await page.getByRole("dialog").getByRole("button", { name: "Mark as done" }).click();
      await page.getByRole("dialog").getByRole("alert").waitFor();
      log("refusal:", await page.getByRole("dialog").getByRole("alert").innerText());
      await page.screenshot({ path: SHOTS + "fix-done-refused.png" });
      await page.unroute("**/api/requests/*/state");
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await page.screenshot({ path: SHOTS + "fix-editor-actions.png" });
      // remove as admin
      await k.getByRole("button", { name: "Remove", exact: true }).click();
      const c = page.getByRole("dialog", { name: "Remove this request?" });
      log("confirm:", await c.locator(".confirm-body").innerText());
      await c.getByRole("button", { name: "Remove request" }).click();
      await k.waitFor({ state: "detached" });
      log("removed; server has", (await (await sam.get("/api/requests")).json()).requests.length);
      await go(page, "/admin/activity");
      await page.locator(".activity li").first().waitFor();
      log("activity:", (await page.locator(".activity li").allInnerTexts()).slice(0, 4));
    }
    await page.close();
  }
  // a reader in consumer mode keeps Withdraw on their own request
  const own = await mk(sam, { kind: "standard", title: "Retention of log data", description: "How long must we keep logs?" });
  page = await as(browser, "sam@example.com", { editor: false });
  await go(page, "/requests");
  log("sam own:", JSON.stringify(await page.locator(".req-item", { hasText: own.title }).locator(".req-actions button").allInnerTexts()));
  await page.close();

  // ---- statistics in the new shape (intercepted)
  page = await as(browser, "dana@example.com");
  await page.route("**/api/admin/statistics?*", async (r) => {
    const res = await r.fetch(); const j = await res.json();
    j.totals.views = 20; j.totals.deletedViews = 4; j.totals.deletedDownloads = 1;
    j.trend = j.trend.map((w, i, a) => ({ ...w, views: 3 + i * 2, days: i === 0 ? 2 : i === a.length - 1 ? 3 : 7 }));
    for (const k of ["platform", "practice", "team"]) j.groups[k] = [...(j.groups[k] ?? []), { id: "", name: "None", documents: 2, views: 9, people: 3, downloads: 0, upvotes: 0, feedbackHandled: 0 }];
    await r.fulfill({ response: res, json: j });
  });
  await go(page, "/admin/statistics");
  await page.locator(".stat-trend svg").waitFor();
  log("about:", await page.locator(".stat-about").innerText());
  log("deleted:", await page.locator(".stat-deleted").innerText());
  log("partial bars:", await page.locator(".stat-bar.partial").count(), "note:", await page.locator(".stat-partial-note").innerText());
  log("sr table:", await page.locator(".stat-sr-only tbody tr td:first-child").allTextContents());
  log("groups last:", (await page.locator(".stat-table").nth(1).locator("tbody tr").allInnerTexts()).slice(-1));
  await page.getByRole("button", { name: "By owning team" }).click();
  log("team last:", (await page.locator(".stat-table").nth(1).locator("tbody tr").allInnerTexts()).slice(-1));
  await page.screenshot({ path: SHOTS + "fix-statistics-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(200);
  log("390 sideways", await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await page.screenshot({ path: SHOTS + "fix-statistics-390.png", fullPage: true });
  await page.close();
  page = await as(browser, "dana@example.com", { theme: "dark", width: 1024 });
  await page.route("**/api/admin/statistics?*", async (r) => { const res = await r.fetch(); const j = await res.json(); j.trend = j.trend.map((w, i, a) => ({ ...w, views: 5 + i, days: i === 0 ? 2 : i === a.length - 1 ? 3 : 7 })); await r.fulfill({ response: res, json: j }); });
  await go(page, "/admin/statistics");
  await page.locator(".stat-trend svg").waitFor();
  await page.locator(".stat-trend").screenshot({ path: SHOTS + "fix-trend-dark.png" });
  await browser.close();
  log("ALL DONE");
})().catch((e) => { console.error(e); process.exit(1); });
