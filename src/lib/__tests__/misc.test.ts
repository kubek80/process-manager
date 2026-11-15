import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { languageLabel, teamName, tierLabel, toolName } from "../catalog";
import { reviewInfo, statusOf } from "../lifecycle";
import { locate } from "../jsonLocate";
import { basePrompt, createPrompt, fixPrompt, modifyPrompt } from "../prompt";
import { STEP_META, STEP_TYPES } from "../stepMeta";
import { openCount } from "../../components/Feedback";
import type { Feedback } from "../../types";
import schema from "../../../schema/process.schema.json";
import { base, catalog } from "./fixtures";

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
  });
});

describe("the prompt for chat assistants", () => {
  const known = [{ id: "raise-servicenow-request", title: "Raise a ServiceNow request" }];

  it("carries the rules, the schema, the lists and an example", () => {
    const p = createPrompt("To get VPN access you fill in a form.", known, catalog);
    expect(p).toContain(JSON.stringify(schema));
    expect(p).toContain('"raise-servicenow-request" - Raise a ServiceNow request');
    expect(p).toContain('"cloud-platform-team" - Cloud Platform team');
    expect(p).toContain('"servicenow" - ServiceNow');
    expect(p).toContain('"tier-0" - Tier 0');
    expect(p).toContain('"go" - Go');
    expect(p).toContain('"id": "request-vpn-access"');
    expect(p).toContain("To get VPN access you fill in a form.");
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
  const item = (stepId: string | undefined, resolved: boolean) => ({ stepId, resolved }) as Feedback;
  const list = [item("a", false), item("a", true), item("b", false), item(undefined, false)];
  it("counts open items, optionally for one step", () => {
    expect(openCount(list)).toBe(3);
    expect(openCount(list, "a")).toBe(1);
    expect(openCount(list, "c")).toBe(0);
    expect(openCount()).toBe(0);
  });
});
