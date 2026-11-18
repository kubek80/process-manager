import { expect, test, type Page, type Route } from "@playwright/test";
import { ALEX, CASEY, CSRF, DANA, JORDAN, RILEY, SAM, open, putDoc, readProcess, signIn, watchErrors } from "./helpers";

// Search by meaning: the switch Words / Meaning / Both on the search page. The browser tests'
// server runs with the built-in embedder (it compares words and parts of words, nothing leaves
// the server), so `me.search.meaning` is true and `me.search.outside` false.
//
// One person may search by meaning 60 times a minute. The tests here spread their searches over
// several people, and the test that reaches the limit on purpose comes last, with a person no
// later test searches by meaning as.

const results = (page: Page) => page.locator(".search-page ol.cards > li.card");
const card = (page: Page, id: string) => page.locator(`.search-page li.card[data-id="${id}"]`);
const count = (page: Page) => page.locator("p.list-count");
const modes = (page: Page) => page.getByRole("radiogroup", { name: "Search by" });
const choice = (page: Page, name: "Words" | "Meaning" | "Both") => modes(page).getByRole("radio", { name, exact: true });
const box = (page: Page) => page.getByRole("searchbox", { name: "Search processes and standards" });
const state = (page: Page) => page.locator(".search-state");
const settled = (page: Page) => expect(page.locator("section.list-results")).not.toHaveAttribute("aria-busy", "true");

/** The queries the page sends to the server, in order. */
function asked(page: Page) {
  const qs: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/search") qs.push(u.searchParams.get("q") ?? "");
  });
  return qs;
}

/** A new page load: the answers the page keeps for a while are gone. */
async function load(page: Page, hash: string) {
  await page.goto("about:blank");
  await open(page, hash);
}

/** Search with the server's answer replaced. */
async function answerSearch(page: Page, status: number, body: unknown) {
  await page.route(/\/api\/search\?/, (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}

/** `/api/me` as the server sends it, with `search` replaced. */
async function meWith(page: Page, search: { meaning: boolean; outside: boolean }) {
  await page.route(/\/api\/me$/, async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, json: { ...(await res.json()), search } });
  });
}

/** A process copied from the sample, made through the API as Alex. */
async function makeProcess(page: Page, id: string, patch: Record<string, unknown>) {
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  const src = await readProcess(page, "request-github-repository");
  const res = await putDoc(page, "process", id, { ...src, id, ...patch });
  expect(res.ok(), `save ${id}: ${await res.text()}`).toBeTruthy();
}
async function removeProcess(page: Page, id: string) {
  await page.request.post("/auth/dev/login", { data: { email: ALEX }, headers: CSRF });
  await page.request.delete(`/api/processes/${id}`, { headers: CSRF });
}
/** What the server finds by meaning for one person, as kind:id. */
async function meaningIds(page: Page, q: string): Promise<string[]> {
  const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()).results as { kind: string; id: string }[]).map((r) => `${r.kind}:${r.id}`);
}

// ---------- A. the switch

test("the switch is on the search page only: three choices, each explained, nothing sent outside", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, SAM);
  for (const hash of ["/", "/processes", "/standards"]) {
    await open(page, hash);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(modes(page), hash).toHaveCount(0);
  }
  await open(page, "/search?q=gcp");
  await expect(modes(page)).toBeVisible();
  await expect(modes(page).getByRole("radio")).toHaveText(["Words", "Meaning", "Both"]);
  await expect(choice(page, "Words")).toHaveAttribute("aria-checked", "true");
  await expect(choice(page, "Meaning")).toHaveAttribute("aria-checked", "false");
  await expect(choice(page, "Both")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".search-mode-name")).toHaveText("Search by");
  await expect(page.locator("#search-mode-help li")).toHaveText([
    "Words finds what contains every word you type.",
    "Meaning puts first what comes closest to what you type, even when not every word is in it.",
    "Both shows what either finds, the best of each first.",
  ]);
  await expect(modes(page)).toHaveAccessibleDescription(/^Words finds what contains every word you type\./);
  // the built-in embedder: what is typed stays in the company, so nothing says otherwise
  await expect(page.locator(".search-mode-outside")).toHaveCount(0);
  await expect(page.locator(".search-mode")).not.toContainText("Google Cloud");
  // Words is today's search: the count names the query, nothing waits for the server
  await expect(count(page)).toHaveText("3 results for “gcp”");
  await expect(state(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test("with an outside service the page says that what is typed is sent to Google Cloud", async ({ page }) => {
  await signIn(page, SAM);
  await meWith(page, { meaning: true, outside: true });
  await open(page, "/search?q=gcp");
  await expect(page.locator(".search-mode-outside")).toHaveText("With Meaning and Both, what you type is sent to Google Cloud to be compared.");
  await expect(modes(page)).toHaveAccessibleDescription(/sent to Google Cloud/);
});

test("the switch works with the keyboard: arrows move the choice, Home and End go to the ends", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=gcp");
  await choice(page, "Words").focus();
  const step = async (key: string, to: "Words" | "Meaning" | "Both") => {
    await page.keyboard.press(key);
    await expect(choice(page, to), `${key} gives ${to}`).toHaveAttribute("aria-checked", "true");
    await expect(choice(page, to)).toBeFocused();
    await expect(choice(page, to)).toHaveClass(/\bon\b/);
    // only the chosen one is reached with Tab
    for (const other of (["Words", "Meaning", "Both"] as const).filter((m) => m !== to)) {
      await expect(choice(page, other)).toHaveAttribute("aria-checked", "false");
      await expect(choice(page, other)).toHaveAttribute("tabindex", "-1");
    }
    await expect(choice(page, to)).toHaveAttribute("tabindex", "0");
  };
  await step("ArrowRight", "Meaning");
  await expect(page).toHaveURL(/#\/search\?q=gcp&mode=meaning$/);
  await step("ArrowDown", "Both");
  await expect(page).toHaveURL(/#\/search\?q=gcp&mode=both$/);
  await step("ArrowRight", "Words"); // round again
  await expect(page).toHaveURL(/#\/search\?q=gcp$/);
  await step("ArrowLeft", "Both");
  await step("ArrowUp", "Meaning");
  await step("Home", "Words");
  await step("End", "Both");
  // Tab leaves the group, Shift+Tab comes back to the chosen one
  await page.keyboard.press("Tab");
  await expect(modes(page).getByRole("radio").filter({ has: page.locator(":focus") })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(choice(page, "Both")).toBeFocused();
});

test("the choice is in the address, survives a reload and Back, and is each person's own for the next search", async ({ page }) => {
  await signIn(page, SAM);
  await open(page, "/search?q=gcp");
  await choice(page, "Meaning").click();
  await expect(page).toHaveURL(/#\/search\?q=gcp&mode=meaning$/);
  await choice(page, "Both").click();
  await expect(page).toHaveURL(/#\/search\?q=gcp&mode=both$/);
  await choice(page, "Words").click();
  await expect(page).toHaveURL(/#\/search\?q=gcp$/); // Words is not written
  await choice(page, "Meaning").click();
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");

  await page.reload();
  await expect(choice(page, "Meaning")).toHaveAttribute("aria-checked", "true");
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");

  // to a result and Back again: the same search, the same way
  await results(page).first().locator("h2.card-title a").click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/search\?q=gcp&mode=meaning$/);
  await expect(choice(page, "Meaning")).toHaveAttribute("aria-checked", "true");
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await page.goForward();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project/);
  await page.goBack();
  await expect(choice(page, "Meaning")).toHaveAttribute("aria-checked", "true");

  // the next search from Home is by meaning again
  await open(page, "/");
  await page.locator(".home-page").getByRole("searchbox").fill("akamai");
  await page.locator(".home-page").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/search\?q=akamai&mode=meaning$/);
  await expect(choice(page, "Meaning")).toHaveAttribute("aria-checked", "true");
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");

  // somebody else in the same browser starts with their own choice
  await signIn(page, CASEY);
  await open(page, "/");
  await page.locator(".home-page").getByRole("searchbox").fill("akamai");
  await page.locator(".home-page").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/search\?q=akamai$/);
  await expect(choice(page, "Words")).toHaveAttribute("aria-checked", "true");
  // and Sam's is still Sam's
  await signIn(page, SAM);
  await open(page, "/");
  await page.locator(".home-page").getByRole("searchbox").fill("akamai");
  await page.locator(".home-page").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/search\?q=akamai&mode=meaning$/);
});

// ---------- B. Meaning with the real server

test("Meaning puts first what is closest and opens the step or requirement that matched", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, CASEY);
  await open(page, "/search?q=google%20cloud%20project&mode=meaning");
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await expect(count(page)).toHaveText(/^\d+ results? for “google cloud project”$/);
  // Words would find nothing: not every word is in one place
  const gcp = card(page, "request-gcp-project");
  await expect(gcp.locator("p.card-found-by")).toHaveCount(0); // said only in Both
  const step = gcp.locator("ul.card-hits a").filter({ has: page.locator(".card-hit-where", { hasText: /^Step$/ }) }).first();
  await expect(step).toBeVisible();
  const title = (await step.locator(".card-hit-label").innerText()).trim();
  await step.click();
  await expect(page).toHaveURL(/#\/p\/request-gcp-project\/flow\/[\w-]+$/);
  await expect(page.locator(".drawer h3")).toHaveText(title);

  await open(page, "/search?q=personal%20data%20in%20logs&mode=meaning");
  const logging = card(page, "secure-logging");
  await expect(results(page).first()).toHaveAttribute("data-id", "secure-logging");
  const requirement = logging.locator("ul.card-hits a", { hasText: "SEC-LOG-02" });
  await expect(requirement.locator(".card-hit-where")).toHaveText("Requirement SEC-LOG-02");
  await requirement.click();
  await expect(page).toHaveURL(/#\/s\/secure-logging\/doc\/SEC-LOG-02$/);
  await expect(page.locator("#req-SEC-LOG-02")).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test("by meaning the filters and their counts work on what was found", async ({ page }) => {
  await signIn(page, CASEY);
  await open(page, "/search?q=cloud&mode=meaning");
  await settled(page);
  const all = await results(page).count();
  expect(all).toBeGreaterThan(2);
  await expect(count(page)).toHaveText(`${all} results for “cloud”`);
  for (const key of ["type", "platform", "practice", "owner"]) {
    const g = page.locator(`.filter-dd[data-filter="${key}"]`);
    await g.locator("button.filter-dd-button").click();
    const options = g.locator("label.filter-option:not(.off)");
    const n = await options.count();
    expect(n, `options of ${key}`).toBeGreaterThan(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const option = options.nth(i);
      const expected = Number((await option.locator(".filter-option-count").innerText()).match(/\d+/)![0]);
      sum += expected;
      await option.getByRole("checkbox").check();
      await expect(results(page), `${key}: ${await option.innerText()}`).toHaveCount(expected);
      await expect(count(page)).toHaveText(`${expected} ${expected === 1 ? "result" : "results"} for “cloud” with 1 filter`);
      await option.getByRole("checkbox").uncheck();
      await expect(results(page)).toHaveCount(all);
    }
    if (key === "type") expect(sum, "processes and standards add up").toBe(all);
    await g.locator("button.filter-dd-button").click();
  }
  // the order stays the server's when a filter is chosen
  await page.locator('.filter-dd[data-filter="type"] button.filter-dd-button').click();
  await page.getByRole("checkbox", { name: /^Processes, \d+ results?$/ }).check();
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await expect(page).toHaveURL(/#\/search\?q=cloud&type=process&mode=meaning$/);
});

test("by meaning “My application” hides what does not apply", async ({ page }) => {
  await signIn(page, CASEY);
  await open(page, "/search?q=onboard%20a%20site%20or%20an%20api&mode=meaning");
  await expect(card(page, "onboard-site-to-akamai")).toBeVisible();
  await expect(card(page, "onboard-api-to-apigee")).toBeVisible();
  const before = await results(page).count();
  // both apply to tiers 0 to 2 only
  await page.locator(".profile-filter").getByLabel("Tier").selectOption({ label: "Tier 3" });
  await expect(card(page, "onboard-site-to-akamai")).toHaveCount(0);
  await expect(card(page, "onboard-api-to-apigee")).toHaveCount(0);
  await expect(results(page)).toHaveCount(before - 2);
  await expect(count(page)).toHaveText(`${before - 2} ${before - 2 === 1 ? "result" : "results"} for “onboard a site or an api” with 1 filter`);
  await page.locator(".profile-filter").getByLabel("Tier").selectOption({ label: "any tier" });
  await expect(results(page)).toHaveCount(before);
});

test("typing does not search by meaning; Enter, the Search button and a new choice do, once per query", async ({ page }) => {
  await signIn(page, JORDAN);
  const qs = asked(page);
  await open(page, "/search?q=gcp&mode=meaning");
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  expect(qs).toEqual(["gcp"]);

  await box(page).fill("akamai site");
  await expect(page.locator("p.search-earlier")).toHaveText("These results are for the earlier search “gcp”. Press Enter or Search to search for “akamai site”.");
  await expect(count(page)).toHaveText(/ for “gcp”$/);
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await expect(page).toHaveURL(/q=akamai(%20|\+)site/); // the address follows the box
  await page.waitForTimeout(600);
  expect(qs, "typing alone asks nothing").toEqual(["gcp"]);

  await box(page).press("Enter");
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  await expect(count(page)).toHaveText(/ for “akamai site”$/);
  await expect(page.locator("p.search-earlier")).toHaveCount(0);
  expect(qs).toEqual(["gcp", "akamai site"]);

  await box(page).fill("repository");
  await page.locator(".search-page form[role=search]").getByRole("button", { name: "Search" }).click();
  await expect(results(page).first()).toHaveAttribute("data-id", "request-github-repository");
  expect(qs).toEqual(["gcp", "akamai site", "repository"]);

  // a new choice searches for what is in the box
  await box(page).fill("budget");
  await expect(page.locator("p.search-earlier")).toBeVisible();
  await choice(page, "Both").click();
  await expect(page).toHaveURL(/#\/search\?q=budget&mode=both$/);
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await expect(count(page)).toHaveText(/ for “budget”$/);
  expect(qs).toEqual(["gcp", "akamai site", "repository", "budget"]);

  // asked again a little later: the page has the answer still
  await box(page).fill("akamai site");
  await box(page).press("Enter");
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  await choice(page, "Meaning").click();
  await expect(count(page)).toHaveText(/ for “akamai site”$/);
  await page.waitForTimeout(400);
  expect(qs, "the same query is asked once").toEqual(["gcp", "akamai site", "repository", "budget"]);

  // emptied box: everything, by words, without the server
  await box(page).fill("");
  await box(page).press("Enter");
  await expect(count(page)).toHaveText(/^\d+ results$/);
  expect(qs).toHaveLength(4);
});

// ---------- C. Both

test("Both shows what either way finds, says how each was found, and a place found both ways once", async ({ page }) => {
  await signIn(page, JORDAN);
  // "terraform" is in the words of several processes, but by meaning only the standard comes close
  await open(page, "/search?q=terraform&mode=both");
  await settled(page);
  const iac = card(page, "infrastructure-as-code");
  await expect(iac.locator("p.card-found-by")).toHaveText("Found by words and by meaning");
  await expect(iac.locator("p.card-found-by")).toHaveClass(/\bboth\b/);
  await expect(results(page).first()).toHaveAttribute("data-id", "infrastructure-as-code");
  const wordsOnly = results(page).filter({ has: page.locator("p.card-found-by.words") });
  expect(await wordsOnly.count()).toBeGreaterThan(0);
  await expect(wordsOnly.first().locator("p.card-found-by")).toHaveText("Found by words");
  // a place found both ways is named once
  const places = await iac.locator("ul.card-hits li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(places.length).toBeGreaterThan(0);
  expect(new Set(places).size, places.join(" ")).toBe(places.length);

  // "logging": only the standard has the word; by meaning a ServiceNow step comes close too
  await box(page).fill("logging");
  await box(page).press("Enter");
  await expect(card(page, "secure-logging").locator("p.card-found-by")).toHaveText("Found by words and by meaning");
  const meaningOnly = results(page).filter({ has: page.locator("p.card-found-by.meaning") });
  expect(await meaningOnly.count()).toBeGreaterThan(0);
  await expect(meaningOnly.first().locator("p.card-found-by")).toHaveText("Found by meaning");
  const logging = await card(page, "secure-logging").locator("ul.card-hits li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(new Set(logging).size, logging.join(" ")).toBe(logging.length);

  // what Words and Meaning each find on their own, Both has all of it
  const ids = async () => results(page).evaluateAll((li) => li.map((l) => `${l.getAttribute("data-kind")}:${l.getAttribute("data-id")}`));
  const both = await ids();
  await choice(page, "Words").click();
  await expect(page.locator("p.card-found-by")).toHaveCount(0);
  const byWords = await ids();
  await choice(page, "Meaning").click();
  await settled(page);
  await expect(count(page)).toHaveText(/ for “logging”$/);
  const byMeaning = await ids();
  expect(new Set(both)).toEqual(new Set([...byWords, ...byMeaning]));
});

// ---------- D. the index follows what is saved

test("what is published is found by meaning at once, and follows changes, drafts and deletion", async ({ page }) => {
  const id = "meaning-follow-demo";
  await makeProcess(page, id, { title: "Island wildlife survey", summary: "Count the quokkas living on Rottnest island every spring.", status: "active" });
  try {
    await signIn(page, SAM);
    // through the API: the index has it straight away
    await expect.poll(() => meaningIds(page, "quokkas rottnest")).toContain(`process:${id}`);
    await load(page, "/search?q=quokkas%20rottnest&mode=meaning");
    await expect(results(page).first()).toHaveAttribute("data-id", id);

    // a new summary: found by its new words, no longer by the old ones
    await makeProcess(page, id, { title: "Island wildlife survey", summary: "Measure the wombat burrows in the national park.", status: "active" });
    await signIn(page, SAM);
    await expect.poll(() => meaningIds(page, "wombat burrows")).toContain(`process:${id}`);
    expect(await meaningIds(page, "quokkas rottnest")).not.toContain(`process:${id}`);
    await load(page, "/search?q=wombat%20burrows&mode=meaning");
    await expect(results(page).first()).toHaveAttribute("data-id", id);
    await load(page, "/search?q=quokkas%20rottnest&mode=meaning");
    await settled(page);
    await expect(card(page, id)).toHaveCount(0);

    // back to a draft: gone for readers at once
    await makeProcess(page, id, { title: "Island wildlife survey", summary: "Measure the wombat burrows in the national park.", status: "draft" });
    await signIn(page, SAM);
    expect(await meaningIds(page, "wombat burrows")).not.toContain(`process:${id}`);
    expect(await meaningIds(page, "Island wildlife survey")).not.toContain(`process:${id}`);
    await load(page, "/search?q=wombat%20burrows&mode=meaning");
    await settled(page);
    await expect(card(page, id)).toHaveCount(0);

    // the editor who may change it finds the draft by words, not by meaning: drafts are not compared
    await signIn(page, ALEX, { editor: true });
    expect(await meaningIds(page, "wombat burrows")).not.toContain(`process:${id}`);
    await open(page, "/search?q=wombat%20burrows");
    await expect(card(page, id)).toBeVisible();
    await expect(card(page, id).locator(".card-mark.draft")).toHaveText("Draft");
    await choice(page, "Meaning").click();
    await settled(page);
    await expect(card(page, id)).toHaveCount(0);
    // what the page says then must not claim that nothing like it exists: the draft is there, by words
    await expect(page.locator(".search-page"), "Meaning in editor mode hides drafts without saying so").toContainText(/draft/i);
    await choice(page, "Both").click();
    await settled(page);
    await expect(card(page, id).locator("p.card-found-by")).toHaveText("Found by words");

    // published again, then deleted: gone
    await makeProcess(page, id, { title: "Island wildlife survey", summary: "Measure the wombat burrows in the national park.", status: "active" });
    await signIn(page, SAM);
    await expect.poll(() => meaningIds(page, "wombat burrows")).toContain(`process:${id}`);
    await removeProcess(page, id);
    await signIn(page, SAM);
    expect(await meaningIds(page, "wombat burrows")).not.toContain(`process:${id}`);
    await load(page, "/search?q=wombat%20burrows&mode=meaning");
    await settled(page);
    await expect(card(page, id)).toHaveCount(0);
  } finally {
    await removeProcess(page, id);
  }
});

test("a change made in the editor is found by meaning", async ({ page }) => {
  await signIn(page, JORDAN, { editor: true });
  // the Google Cloud platform owner renames a step of the GCP process through the app
  await open(page, "/p/request-gcp-project/flow");
  const before = (await readProcess(page, "request-gcp-project"))!;
  const first = before.steps[0];
  try {
    const res = await putDoc(page, "process", "request-gcp-project", { ...before, steps: [{ ...first, title: "Agree the platypus naming rules" }, ...before.steps.slice(1)] });
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect.poll(() => meaningIds(page, "platypus naming")).toContain("process:request-gcp-project");
    await load(page, "/search?q=platypus%20naming&mode=meaning");
    const hit = card(page, "request-gcp-project").locator("ul.card-hits a", { hasText: "Agree the platypus naming rules" });
    await expect(hit).toHaveAttribute("href", `#/p/request-gcp-project/flow/${first.id}`);
  } finally {
    const now = (await readProcess(page, "request-gcp-project"))!;
    expect((await putDoc(page, "process", "request-gcp-project", { ...now, steps: [first, ...now.steps.slice(1)] })).ok()).toBeTruthy();
  }
});

// ---------- E. when the server cannot answer

test("searching too often: the server's sentence, and in Both the word results meanwhile", async ({ page }) => {
  const sentence = "You have searched very often in the last minute. Wait a moment, then try again.";
  await signIn(page, SAM);
  await answerSearch(page, 429, { error: sentence });
  await open(page, "/search?q=gcp&mode=meaning");
  const problem = page.locator(".search-problem.busy");
  await expect(problem).toHaveText(new RegExp(`^${sentence.replace(/\./g, "\\.")}`));
  await expect(results(page)).toHaveCount(0);
  await expect(page.locator(".search-empty")).toHaveCount(0); // not "Nothing found": nothing was searched
  await problem.getByRole("button", { name: "Search by words instead" }).click();
  await expect(page).toHaveURL(/#\/search\?q=gcp$/);
  await expect(count(page)).toHaveText("3 results for “gcp”");

  await choice(page, "Both").click();
  await expect(page.locator(".search-problem.busy")).toContainText(`${sentence} Until then, these results are found by words only.`);
  await expect(results(page)).toHaveCount(3);
});

test("search by meaning unavailable: said plainly, Words offered, in Both the word results shown", async ({ page }) => {
  await signIn(page, SAM);
  await answerSearch(page, 502, { error: "Search by meaning is not available right now. Try again in a moment, or search by words." });
  await open(page, "/search?q=gcp&mode=meaning");
  const problem = page.locator(".search-problem.unavailable");
  await expect(problem.locator("p")).toHaveText("Search by meaning is not available right now.");
  await expect(results(page)).toHaveCount(0);
  await expect(page.locator(".search-empty")).toHaveCount(0);

  await choice(page, "Both").click();
  await expect(problem.locator("p")).toHaveText("Search by meaning is not available right now, so these results are found by words only.");
  await expect(results(page)).toHaveCount(3);
  await expect(page.locator("p.card-found-by")).toHaveCount(0);
  await problem.getByRole("button", { name: "Search by words" }).click();
  await expect(page).toHaveURL(/#\/search\?q=gcp$/);
  await expect(page.locator(".search-problem")).toHaveCount(0);
  await expect(choice(page, "Words")).toHaveAttribute("aria-checked", "true");

  // no answer at all is the same
  await page.unroute(/\/api\/search\?/);
  await page.route(/\/api\/search\?/, (route) => route.abort());
  await load(page, "/search?q=gcp&mode=meaning");
  await expect(page.locator(".search-problem.unavailable p")).toHaveText("Search by meaning is not available right now.");
  await page.locator(".search-problem").getByRole("button", { name: "Search by words instead" }).click();
  await expect(count(page)).toHaveText("3 results for “gcp”");
});

test("search by meaning not ready yet: the server's sentence, Words offered", async ({ page }) => {
  const sentence = "Search by meaning is not ready yet. Try again in a moment, or search by words.";
  await signIn(page, SAM);
  await answerSearch(page, 503, { error: sentence });
  await open(page, "/search?q=gcp&mode=meaning");
  const problem = page.locator(".search-problem");
  await expect(problem.locator("p")).toHaveText(sentence);
  await expect(results(page)).toHaveCount(0);
  await expect(page.locator(".search-empty")).toHaveCount(0);
  await choice(page, "Both").click();
  await expect(problem.locator("p")).toHaveText(`${sentence} Until then, these results are found by words only.`);
  await expect(results(page)).toHaveCount(3);
  // ready now: asking again works
  await page.unroute(/\/api\/search\?/);
  await choice(page, "Meaning").click();
  await box(page).press("Enter");
  await expect(results(page).first()).toHaveAttribute("data-id", "request-gcp-project");
  await expect(page.locator(".search-problem")).toHaveCount(0);
  await choice(page, "Words").click();
  await page.locator(".search-page").getByRole("button", { name: "Search by words" }).count();
});

test("search by meaning switched off on the server since the page was loaded: the switch goes, Words stays", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, SAM);
  await answerSearch(page, 404, { error: "Search by meaning is not switched on." });
  await open(page, "/search?q=gcp&mode=meaning");
  await expect(modes(page)).toHaveCount(0);
  await expect(count(page)).toHaveText("3 results for “gcp”");
  await expect(page.locator(".search-problem")).toHaveCount(0);
  await expect(state(page)).toHaveCount(0);
  // typing searches at once again
  await box(page).fill("akamai");
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  expect(errors).toEqual([]);
});

test("a late answer for an earlier search never replaces the newer results", async ({ page }) => {
  await signIn(page, SAM);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let lateDone!: () => void;
  const late = new Promise<void>((r) => { lateDone = r; });
  await page.route(/\/api\/search\?/, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    const res = await route.fetch();
    if (q === "gcp") { await held; await route.fulfill({ response: res }); lateDone(); return; }
    await route.fulfill({ response: res });
  });
  await open(page, "/search?q=gcp&mode=meaning");
  await expect(page.locator("p.search-busy")).toHaveText("Searching for “gcp”…");
  await expect(page.locator("section.list-results")).toHaveAttribute("aria-busy", "true");
  await box(page).fill("akamai site");
  await box(page).press("Enter");
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  await expect(count(page)).toHaveText(/ for “akamai site”$/);
  release();
  await late;
  await page.waitForTimeout(300);
  await expect(results(page).first()).toHaveAttribute("data-id", "onboard-site-to-akamai");
  await expect(count(page)).toHaveText(/ for “akamai site”$/);
  await expect(page.locator("p.search-busy")).toHaveCount(0);
});

// ---------- F. switched off

test("with search by meaning off there is no switch and the page searches as it always did", async ({ page }) => {
  await signIn(page, SAM);
  await meWith(page, { meaning: false, outside: false });
  const qs = asked(page);
  await open(page, "/search?q=gcp&mode=meaning"); // an old link with a mode
  await expect(count(page)).toHaveText("3 results for “gcp”");
  await expect(modes(page)).toHaveCount(0);
  await expect(page.locator(".search-mode, .search-state, p.card-found-by")).toHaveCount(0);
  await box(page).fill("logging");
  await expect(page).toHaveURL(/#\/search\?q=logging/);
  await expect(results(page).first()).toHaveAttribute("data-id", "secure-logging");
  // nothing found: no offer to search another way
  await box(page).fill("zzqx");
  await expect(page.locator(".search-empty")).toContainText("Check the spelling");
  await expect(page.locator(".search-try-other")).toHaveCount(0);
  // Home does not add a mode either
  await open(page, "/");
  await page.locator(".home-page").getByRole("searchbox").fill("gcp");
  await page.locator(".home-page").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/search\?q=gcp$/);
  expect(qs).toEqual([]);
});

// ---------- G. rights, through the API

test("search by meaning needs a signed-in person, never gives a draft, and refuses odd requests plainly", async ({ page, playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const res = await anonymous.get("/api/search?q=gcp");
  expect(res.status()).toBe(401);
  await anonymous.dispose();

  const id = "meaning-draft-demo";
  await makeProcess(page, id, { title: "Narwhal tusk inventory", summary: "Count every narwhal tusk in the archive.", status: "draft" });
  try {
    for (const who of [DANA, ALEX, SAM]) {
      await page.request.post("/auth/dev/login", { data: { email: who }, headers: CSRF });
      expect(await meaningIds(page, "Narwhal tusk inventory"), who).not.toContain(`process:${id}`);
      const body = await (await page.request.get(`/api/search?q=${encodeURIComponent("Narwhal tusk inventory")}`)).text();
      expect(body, who).not.toContain("Narwhal");
    }
  } finally {
    await removeProcess(page, id);
  }

  await page.request.post("/auth/dev/login", { data: { email: DANA }, headers: CSRF });
  for (const limit of ["0", "1000", "-1", "ten"]) {
    const r = await page.request.get(`/api/search?q=gcp&limit=${limit}`);
    expect(r.status(), `limit=${limit}`).toBe(400);
    expect((await r.json()).error).toBe("limit must be a number from 1 to 100.");
  }
  const long = await page.request.get(`/api/search?q=${"a".repeat(1001)}`);
  expect(long.status()).toBe(400);
  expect((await long.json()).error).toBe("The question is too long: use at most 1000 characters.");
  // an empty question is no search
  const empty = await page.request.get("/api/search?q=%20");
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toEqual({ results: [] });
  // one result asked for, one given, with the places inside
  const one = await (await page.request.get("/api/search?q=google%20cloud%20project&limit=1")).json();
  expect(one.results).toHaveLength(1);
  expect(one.results[0]).toMatchObject({ kind: "process", id: "request-gcp-project" });
  expect(one.results[0].hits.length).toBeGreaterThan(0);
  expect(one.results[0].hits.length).toBeLessThanOrEqual(3);
});

// ---------- the limit per person: last in this file, with a person no later test searches by meaning as

test("one person searching unusually often is asked to wait, in the API and on the page", async ({ page }) => {
  await signIn(page, RILEY);
  let ok = 0;
  let refused: Awaited<ReturnType<typeof page.request.get>> | undefined;
  for (let i = 0; i < 61 && !refused; i++) {
    const r = await page.request.get(`/api/search?q=limit${i}`);
    if (r.status() === 429) refused = r;
    else { expect(r.status()).toBe(200); ok++; }
  }
  expect(refused, "the 61st search in a minute is refused").toBeTruthy();
  expect(ok).toBeLessThanOrEqual(60);
  expect(refused!.headers()["retry-after"]).toBe("60");
  const sentence = (await refused!.json()).error;
  expect(sentence).toBe("You have searched very often in the last minute. Wait a moment, then try again.");
  // the page shows the server's sentence; Words still works
  await open(page, "/search?q=gcp&mode=meaning");
  await expect(page.locator(".search-problem.busy")).toContainText(sentence);
  await page.locator(".search-problem").getByRole("button", { name: "Search by words instead" }).click();
  await expect(count(page)).toHaveText("3 results for “gcp”");
  // somebody else is not held up
  await signIn(page, CASEY);
  expect((await page.request.get("/api/search?q=gcp")).status()).toBe(200);
});
