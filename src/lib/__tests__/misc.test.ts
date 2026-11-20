import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { categoryName, completeCatalog, docCount, removeHint, environmentLabel, groupName, languageLabel, platformName, practiceName, teamName, tierLabel, toolName } from "../catalog";
import { reviewInfo, statusOf } from "../lifecycle";
import { locate } from "../jsonLocate";
import { basePrompt, createPrompt, createStandardPrompt, fixPrompt, modifyPrompt, modifyStandardPrompt } from "../prompt";
import standardSchema from "../../../schema/standard.schema.json";
import { STEP_META, STEP_TYPES } from "../stepMeta";
import { openCount } from "../../components/Feedback";
import type { Feedback } from "../../types";
import schema from "../../../schema/process.schema.json";
import { base, baseStandard, catalog } from "./fixtures";

describe("review life-cycle", () => {
  const today = "2026-11-15";
  const reviewed = (lastReviewedAt?: string, intervalMonths = 6) => ({ ...base(), review: { intervalMonths, lastReviewedAt } });

  it("is fine while the next review is far away", () => expect(reviewInfo(reviewed("2026-09-01"), today)).toMatchObject({ state: "ok", dueAt: "2027-03-01" }));
  it("is due soon within 30 days", () => {
    expect(reviewInfo(reviewed("2026-06-01"), today)).toMatchObject({ state: "soon", dueAt: "2026-12-01", days: 16 });
    expect(reviewInfo(reviewed("2026-05-15"), today)).toMatchObject({ state: "soon", days: 0 });
    expect(reviewInfo(reviewed("2026-06-16"), today).state).toBe("ok"); // 31 days away
  });
  it("is overdue after the date, and when never reviewed", () => {
    expect(reviewInfo(reviewed("2026-05-14"), today)).toMatchObject({ state: "overdue", days: -1 });
    expect(reviewInfo(reviewed(undefined), today)).toMatchObject({ state: "overdue", label: "Never reviewed" });
  });
  it("respects the interval", () => expect(reviewInfo(reviewed("2026-01-01", 12), today).dueAt).toBe("2027-01-01"));
  it("plans no review for drafts, retired processes and processes without an interval", () => {
    expect(reviewInfo({ ...reviewed("2020-01-01"), status: "draft" }, today).state).toBe("none");
    expect(reviewInfo({ ...reviewed("2020-01-01"), status: "deprecated" }, today).state).toBe("none");
    expect(reviewInfo({ ...base(), review: undefined }, today).state).toBe("none");
  });
  it("treats a missing status as active", () => expect(statusOf({ ...base(), status: undefined })).toBe("active"));
});

describe("catalog names", () => {
  it("resolves ids to names and falls back to the id", () => {
    expect(toolName(catalog, "servicenow")).toBe("ServiceNow");
    expect(toolName(catalog, "abacus")).toBe("abacus");
    expect(toolName(catalog)).toBe("");
    expect(teamName(catalog, "cloud-platform-team")).toBe("Cloud Platform team");
  });
  it("describes tiers and languages", () => {
    expect(tierLabel(catalog)).toBe("All tiers");
    expect(tierLabel(catalog, [])).toBe("All tiers");
    expect(tierLabel(catalog, ["tier-0", "tier-1"])).toBe("Tier 0, Tier 1");
    expect(languageLabel(catalog)).toBe("Any language");
    expect(languageLabel(catalog, ["go", "javascript"])).toBe("Go, JavaScript / TypeScript");
    expect(environmentLabel(catalog)).toBe("All environments");
    expect(environmentLabel(catalog, ["staging", "production"])).toBe("Staging, Production");
  });
  it("names practices, platforms and categories, and each kind of group from its own list", () => {
    expect(practiceName(catalog, "engineering")).toBe("Engineering");
    expect(platformName(catalog, "google-cloud")).toBe("Google Cloud");
    expect(categoryName(catalog, "source-control")).toBe("Source control");
    expect(platformName(catalog, "ghost")).toBe("ghost");
    expect(categoryName(catalog)).toBe("");
    // a team and a practice may share an id: the kind says which list
    expect(groupName(catalog, "team", "security")).toBe("Cyber Security");
    expect(groupName(catalog, "practice", "security")).toBe("Cyber security");
    expect(groupName(catalog, "platform", "azure")).toBe("Azure");
  });
  it("always has every list, also when lists are missing", () => {
    const c = completeCatalog({ teams: [{ id: "a", name: "A" }] });
    expect(c.teams).toHaveLength(1);
    for (const key of ["practices", "platforms", "categories", "tiers", "environments", "languages", "tools"] as const) expect(c[key]).toEqual([]);
    expect(completeCatalog(null).practices).toEqual([]);
    expect(platformName({ ...catalog, platforms: undefined } as never, "azure")).toBe("azure"); // stored without the list: no crash
  });
});

describe("the prompt for chat assistants", () => {
  const known = [{ id: "raise-servicenow-request", title: "Raise a ServiceNow request" }];

  it("carries the rules, the schema, the lists and an example", () => {
    const p = createPrompt("To get VPN access you fill in a form.", known, catalog, [{ id: "secure-logging", title: "Secure logging" }]);
    expect(p).toContain('"production" - Production');
    expect(p).toContain('"secure-logging" - Secure logging');
    expect(p).toContain(JSON.stringify(schema));
    expect(p).toContain('"raise-servicenow-request" - Raise a ServiceNow request');
    expect(p).toContain('"cloud-platform-team" - Cloud Platform team');
    expect(p).toContain('"servicenow" - ServiceNow');
    expect(p).toContain('"tier-0" - Tier 0');
    expect(p).toContain('"go" - Go');
    expect(p).toContain('"id": "request-vpn-access"');
    expect(p).toContain("To get VPN access you fill in a form.");
    // what it belongs to and how binding it is
    expect(p).toContain("# CATEGORIES (usable in \"category\")");
    expect(p).toContain('"cloud" - Cloud');
    expect(p).toContain("# PLATFORMS (usable in \"platform\")");
    expect(p).toContain('"google-cloud" - Google Cloud');
    expect(p).toContain("# PRACTICES (usable in \"practice\")");
    expect(p).toContain('"engineering" - Engineering');
    expect(p).toContain('"rigour": how binding the process is');
    for (const t of STEP_TYPES) expect(p).toContain(`"${t}" (${STEP_META[t].label})`);
    expect(p).toMatch(/"updatedAt" is "\d{4}-\d{2}-\d{2}"/);
  });
  it("says so when nothing exists yet and leaves a placeholder for missing text", () => {
    expect(basePrompt()).toContain("- (none yet)");
    expect(createPrompt("  ", [])).toContain("(paste the process description here)");
  });
  it("includes the current process when changing one, and not itself as a sub-process", () => {
    const p = modifyPrompt({ ...base(), id: "raise-servicenow-request" }, "Add a security review.", known, catalog);
    expect(p).toContain("CURRENT PROCESS JSON START");
    expect(p).toContain("Add a security review.");
    expect(p).not.toContain('"raise-servicenow-request" - Raise a ServiceNow request');
    expect(modifyPrompt(base(), "", known)).toContain("(describe the change here)");
  });
  it("turns checker findings into a follow-up message", () => {
    const p = fixPrompt([{ level: "error", path: "steps[0].actor", message: '"x" is not an actor id' }, { level: "warning", path: "owner", message: "missing" }]);
    expect(p).toContain('- [error] steps[0].actor: "x" is not an actor id');
    expect(p).toContain("- [warning] owner: missing");
    expect(fixPrompt([], "This is not valid JSON: boom")).toContain("- This is not valid JSON: boom");
  });
});

describe("finding a checker path in the JSON text", () => {
  const text = JSON.stringify(base(), null, 2);
  const state = EditorState.create({ doc: text, extensions: [json()] });
  ensureSyntaxTree(state, text.length, 5000);
  const at = (path: string) => { const r = locate(state, path); return r && text.slice(r.from, r.to); };

  it("selects a value", () => {
    expect(at("steps[1].actor")).toBe('"boss"');
    expect(at("title")).toBe('"Demo process"');
    expect(at("steps[2].next[1].label")).toBe('"No"');
    expect(at("review.intervalMonths")).toBe("6");
  });
  it("selects the key for a whole object or list", () => {
    expect(at("steps")).toBe('"steps"');
    expect(at("review")).toBe('"review"');
  });
  it("marks the opening bracket of a list item and of the root", () => {
    expect(at("steps[0]")).toBe("{");
    expect(at("(root)")).toBe("{");
  });
  it("stops at the nearest thing that exists", () => {
    expect(at("steps[0].colour")).toBe("{");
    expect(at("steps[99].actor")).toBe('"steps"');
    expect(at("nope.deeper")).toBe("{");
  });
  it("copes with text that is not JSON", () => {
    for (const doc of ["", "not json at all", '{"title": ']) {
      const broken = EditorState.create({ doc, extensions: [json()] });
      const r = locate(broken, "title");
      if (r) { expect(r.from).toBeGreaterThanOrEqual(0); expect(r.to).toBeLessThanOrEqual(Math.max(1, doc.length)); }
    }
  });
});

describe("open feedback count", () => {
  const item = (itemId: string | undefined, resolved: boolean) => ({ itemId, resolved }) as unknown as Feedback;
  const list = [item("a", false), item("a", true), item("b", false), item(undefined, false)];
  it("counts open items, optionally for one step", () => {
    expect(openCount(list)).toBe(3);
    expect(openCount(list, "a")).toBe(1);
    expect(openCount(list, "c")).toBe(0);
    expect(openCount()).toBe(0);
  });
});

describe("the prompt for standards", () => {
  const known = [{ id: "raise-servicenow-request", title: "Raise a ServiceNow request" }];
  it("carries the rules, the schema, the lists and an example", () => {
    const p = createStandardPrompt("Passwords must never be logged.", catalog, known);
    expect(p).toContain(JSON.stringify(standardSchema));
    expect(p).toContain('"security" - Cyber Security'); // any team can issue a standard
    expect(p).toContain('"dns-team" - DNS team');
    expect(p).toContain("# PRACTICES");
    expect(p).toContain('"security" - Cyber security');
    expect(p).toContain('"google-cloud" - Google Cloud');
    expect(p).toContain('"code-quality" - Code quality');
    expect(p).toContain('A standard has no "rigour" field');
    expect(p).toContain('"production" - Production');
    expect(p).toContain('"raise-servicenow-request" - Raise a ServiceNow request');
    expect(p).toContain('"id": "dependency-updates"');
    expect(p).toContain('"status": always "draft"');
    expect(p).toContain("Passwords must never be logged.");
    expect(createStandardPrompt(" ")).toContain("(paste the policy or guideline here)");
  });
  it("includes the current standard when changing one", () => {
    const p = modifyStandardPrompt(baseStandard(), "Add a rule about audit logs.", catalog, known);
    expect(p).toContain("CURRENT STANDARD JSON START");
    expect(p).toContain('"id": "DEMO-01"');
    expect(p).toContain("Add a rule about audit logs.");
    expect(modifyStandardPrompt(baseStandard(), "")).toContain("(describe the change here)");
  });
});

describe("the title of the browser tab", () => {
  it("names the page first and the product last", async () => {
    const { pageTitle } = await import("../store");
    expect(pageTitle({ page: "library" })).toBe("Processes · Process Manager");
    expect(pageTitle({ page: "standards" })).toBe("Standards · Process Manager");
    expect(pageTitle({ page: "catalog" })).toBe("Teams & tools · Process Manager");
    expect(pageTitle({ page: "guide" })).toBe("Guide · Process Manager");
    expect(pageTitle({ page: "admin", section: "access" })).toBe("Access · Admin · Process Manager");
    expect(pageTitle({ page: "process", id: "request-gcp-project", tab: "flow" }, { process: "Request a GCP project" })).toBe("Request a GCP project · Process Manager");
    expect(pageTitle({ page: "standard", id: "secure-logging", tab: "doc" }, { standard: "Secure logging" })).toBe("Secure logging · Process Manager");
  });
  it("says so when the process or standard does not exist, but not while it is still loading", async () => {
    const { pageTitle } = await import("../store");
    expect(pageTitle({ page: "process", id: "nope", tab: "flow" })).toBe("Process not found · Process Manager");
    expect(pageTitle({ page: "standard", id: "nope", tab: "doc" })).toBe("Standard not found · Process Manager");
    expect(pageTitle({ page: "process", id: "nope", tab: "flow" }, { loading: true })).toBe("Process Manager");
  });
});


describe("review dates and names", () => {
  it("tells a real day from something that only looks like one", async () => {
    const { isDate, reviewInfo } = await import("../lifecycle");
    expect(isDate("2026-11-16")).toBe(true);
    expect(isDate("2024-02-29")).toBe(true);
    for (const bad of ["2026-13-45", "2026-02-30", "2026-1-1", "yesterday", "", undefined, 20261116]) expect(isDate(bad)).toBe(false);
    expect(reviewInfo({ status: "active", review: { intervalMonths: 6, lastReviewedAt: "2026-13-45" } }, "2026-11-16")).toEqual({ state: "overdue", label: "Review date cannot be read" });
  });
  it("keeps a reviewer's name within what the format allows", async () => {
    const { reviewer } = await import("../lifecycle");
    expect(reviewer("  Casey Owner ")).toBe("Casey Owner");
    expect(reviewer(undefined)).toBe("");
    const long = reviewer("Maximilian-Alexander ".repeat(5));
    expect([...long]).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("what uses an entry of the lists", () => {
  it("is counted in plain words for processes, standards and both", () => {
    expect(docCount(1, 0)).toBe("1 process");
    expect(docCount(2, 1)).toBe("2 processes and 1 standard");
    expect(docCount(0, 3)).toBe("3 standards");
    expect(docCount(0, 0)).toBe("");
  });
  it("and its members keep it from being removed", () => {
    expect(removeHint("", 0, "platform")).toBe("Nothing uses it, so it is safe to remove.");
    expect(removeHint("1 process", 0, "team")).toBe("Still used by 1 process. Change those first, then it can be removed.");
    expect(removeHint("", 2, "platform")).toBe("2 people are still members of this platform. Remove them from the members first, then it can be removed.");
    expect(removeHint("1 standard", 1, "practice")).toBe("Still used by 1 standard, and 1 person is still a member of this practice. Change those first and remove the members, then it can be removed.");
  });
});

describe("the fix request for the AI chat", () => {
  it("says which value is wrong where", () => {
    const answer = { steps: [{ id: "a", actor: "nobody" }] };
    const text = fixPrompt([{ level: "error", path: "steps[0].actor", message: "Who does it is not one of the participants" }], undefined, answer);
    expect(text).toContain('- [error] steps[0].actor (value now: "nobody"): Who does it is not one of the participants');
    // a missing field has no value to show
    expect(fixPrompt([{ level: "error", path: "steps[0]", message: 'is missing the required field "title"' }], undefined, answer)).not.toContain("value now");
  });
});
