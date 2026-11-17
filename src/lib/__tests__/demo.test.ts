import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { reviewInfo } from "../lifecycle";
import { validateCatalog, validateProcess, validateStandard } from "../validate";
import { catalog as baseCatalog, processes as baseProcesses, readJson, root, standards as baseStandards } from "./fixtures";

// The demo set (demo/, loaded with `npm run db:demo`) is loaded over the sample content: its
// documents may name the sample's, and its lists replace the stored ones, so they must hold
// every sample entry too.

const files = (dir: string) => fs.readdirSync(path.join(root, "demo", dir)).filter((f) => f.endsWith(".json")).sort();
const processFiles = files("processes"), standardFiles = files("standards");
const processes = processFiles.map((f) => readJson<Process>(`demo/processes/${f}`));
const standards = standardFiles.map((f) => readJson<Standard>(`demo/standards/${f}`));
const catalog = readJson<Catalog>("demo/catalog/catalog.json");
const all = [...processes, ...standards];
const LISTS = ["tiers", "environments", "languages", "teams", "practices", "platforms", "categories", "tools"] as const;

const ctx = {
  processIds: [...baseProcesses, ...processes].map((p) => p.id),
  standardIds: [...baseStandards, ...standards].map((s) => s.id),
  catalog,
};

describe("demo set", () => {
  it("has a valid catalog", () => expect(validateCatalog(catalog)).toEqual([]));

  it("passes the checker: no errors, and no warning but the one intended", () => {
    const warnings: string[] = [];
    for (const [i, p] of processes.entries()) {
      expect(p.id + ".json").toBe(processFiles[i]);
      const issues = validateProcess(p, ctx);
      expect(issues.filter((x) => x.level === "error")).toEqual([]);
      warnings.push(...issues.map((x) => `${p.id} ${x.path}`));
    }
    for (const [i, s] of standards.entries()) {
      expect(s.id + ".json").toBe(standardFiles[i]);
      const issues = validateStandard(s, ctx);
      expect(issues.filter((x) => x.level === "error")).toEqual([]);
      warnings.push(...issues.map((x) => `${s.id} ${x.path}`));
    }
    // an active process without a review rhythm, so that "My responsibilities" shows one
    expect(warnings).toEqual(["write-architecture-decision-record review"]);
  });

  it("does not reuse an id of the sample", () => {
    const base = new Set([...baseProcesses, ...baseStandards].map((d) => d.id));
    expect(all.filter((d) => base.has(d.id)).map((d) => d.id)).toEqual([]);
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
  });

  it("keeps every entry of the sample lists unchanged and in the same order", () => {
    for (const key of LISTS) {
      const demo = catalog[key] ?? [];
      const kept = demo.filter((e) => (baseCatalog[key] ?? []).some((b) => b.id === e.id));
      expect(kept, key).toEqual(baseCatalog[key] ?? []);
    }
  });

  it("uses every entry it adds to the lists", () => {
    const used = new Set<string>();
    const mark = (list: string, ids?: string | string[]) => [ids ?? []].flat().forEach((id) => used.add(`${list}:${id}`));
    for (const d of all) {
      mark("teams", d.owner); mark("categories", d.category); mark("practices", d.practice); mark("platforms", d.platform);
      mark("tiers", d.tiers); mark("environments", d.environments); mark("languages", d.languages);
    }
    for (const p of processes) {
      for (const a of p.actors) mark("teams", a.teamId);
      for (const s of p.steps) mark("tools", s.tool);
    }
    for (const s of standards) for (const r of s.requirements) { mark("tiers", r.tiers); mark("environments", r.environments); mark("languages", r.languages); }
    const unused = LISTS.flatMap((key) => (catalog[key] ?? [])
      .filter((e) => !(baseCatalog[key] ?? []).some((b) => b.id === e.id) && !used.has(`${key}:${e.id}`))
      .map((e) => `${key}:${e.id}`));
    expect(unused).toEqual([]);
  });

  it("gives every filter and life-cycle state something to show", () => {
    expect(new Set(processes.map((p) => p.rigour))).toEqual(new Set(["mandatory", "recommended", "optional", undefined]));
    const levels = new Set(standards.flatMap((s) => s.requirements.map((r) => r.level)));
    expect(levels).toEqual(new Set(["must", "should", "may"]));
    expect(standards.some((s) => s.requirements.every((r) => r.level !== "must"))).toBe(true);
    for (const kind of [processes, standards] as const) expect(kind.some((d) => d.status === "draft")).toBe(true);
    expect(processes.some((p) => p.status === "deprecated" && p.replacedBy)).toBe(true);
    expect(standards.some((s) => s.exceptionProcessId)).toBe(true);
    expect(processes.some((p) => p.steps.some((s) => s.type === "subprocess"))).toBe(true);
    expect(all.some((d) => !d.category)).toBe(true);
    expect(all.some((d) => !d.platform && !d.practice)).toBe(true);
    expect(all.some((d) => d.platform && d.practice)).toBe(true);
    const lengths = processes.map((p) => p.steps.length);
    expect(Math.min(...lengths)).toBeLessThanOrEqual(4);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(12);
    // each new platform and practice has documents of its own
    const added = (key: "platforms" | "practices") => (catalog[key] ?? []).filter((e) => !(baseCatalog[key] ?? []).some((b) => b.id === e.id));
    for (const p of added("platforms")) expect(all.some((d) => d.platform === p.id), p.id).toBe(true);
    for (const p of added("practices")) expect(all.some((d) => d.practice === p.id), p.id).toBe(true);
    expect(added("platforms").length).toBeGreaterThanOrEqual(5);
    expect(added("practices").length).toBeGreaterThanOrEqual(3);
  });

  it("has reviews in every state on the day it was written", () => {
    const count = (state: string) => all.filter((d) => reviewInfo(d, "2026-11-17").state === state).length;
    expect(count("overdue")).toBeGreaterThanOrEqual(2);
    expect(count("soon")).toBeGreaterThanOrEqual(2);
    expect(count("ok")).toBeGreaterThan(count("overdue") + count("soon"));
    expect(all.filter((d) => (d.status ?? "active") === "active" && !d.review).map((d) => d.id)).toEqual(["write-architecture-decision-record"]);
  });

  it("has something for the development users", () => {
    expect(all.some((d) => d.platform === "google-cloud")).toBe(true); // Jordan
    expect(all.some((d) => d.practice === "engineering")).toBe(true); // Jordan
    expect(all.some((d) => d.practice === "security")).toBe(true); // Riley
    expect(all.some((d) => d.owner === "security")).toBe(true); // Riley
    expect(all.some((d) => d.owner === "cloud-platform-team")).toBe(true); // Casey
  });
});
