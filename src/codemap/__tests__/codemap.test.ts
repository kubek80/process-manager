import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS, CATEGORIES } from "../index";

// The code map must stay true to the code: what it names exists, what it points at is there,
// and no source file is left out. A new file fails "every source file…" until it is put into a
// category (src/codemap/categories).

const root = path.resolve(__dirname, "../../..");
const text = (p: string) => readFileSync(path.join(root, p), "utf8");
const isFile = (p: string) => existsSync(path.join(root, p)) && statSync(path.join(root, p)).isFile();

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(path.join(root, dir))) return out;
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

describe("the code map", () => {
  it("has categories with an id of their own, in a known area", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) {
      expect(c.id, c.id).toMatch(/^[a-z0-9-]+$/);
      expect(AREAS.map((a) => a.id), c.id).toContain(c.area);
    }
  });

  it("every category says what it is, what it must do, how it works and where it lives", () => {
    const thin = CATEGORIES.flatMap((c) => [
      c.title.trim() ? "" : `${c.id}: no title`,
      c.summary.trim().length >= 40 ? "" : `${c.id}: no summary`,
      c.requirements.length >= 3 ? "" : `${c.id}: fewer than 3 requirements`,
      c.charts.length >= 1 ? "" : `${c.id}: no flow chart`,
      c.files.length >= 1 ? "" : `${c.id}: no files`,
      !c.start || c.files.some((f) => f.path === c.start) ? "" : `${c.id}: start is not one of its files`,
      ...c.files.flatMap((f) => [f.role.trim() ? "" : `${c.id}: ${f.path} has no role`]),
    ]).filter(Boolean);
    expect(thin).toEqual([]);
  });

  it("names only paths that exist", () => {
    const missing = CATEGORIES.flatMap((c) => [
      ...c.files.flatMap((f) => [f.path, ...(f.tests ?? [])]),
      ...(c.tables ?? []).flatMap((t) => [t.createdIn, ...t.writtenBy, ...(t.readBy ?? [])]),
      ...(c.examples ?? []).flatMap((e) => e.stages.flatMap((s) => (s.where ? [s.where] : []))),
    ].filter((p) => !isFile(p)).map((p) => `${c.id}: ${p}`));
    expect(missing).toEqual([]);
  });

  it("anchors every placed comment to text that is in its file", () => {
    const lost = CATEGORIES.flatMap((c) => c.files.flatMap((f) => {
      if (!isFile(f.path)) return [];
      const lines = text(f.path).split("\n");
      return f.requirements.filter((r) => r.at !== undefined && (!r.at.trim() || r.at.includes("\n") || !lines.some((l) => l.includes(r.at!))))
        .map((r) => `${c.id}: ${f.path}: “${r.at}”`);
    }));
    expect(lost).toEqual([]);
  });

  it("draws charts that hold together", () => {
    const ids = CATEGORIES.flatMap((c) => c.charts.map((ch) => ch.process.id));
    expect(new Set(ids).size, "chart ids").toBe(ids.length);
    const broken = CATEGORIES.flatMap((c) => c.charts.flatMap((ch) => {
      const p = ch.process;
      const steps = new Set(p.steps.map((s) => s.id));
      const lanes = new Set(p.actors.map((a) => a.id));
      return [
        p.id.startsWith("code-") ? "" : `${p.id}: the id does not start with code-`,
        ch.caption.trim() ? "" : `${p.id}: no caption`,
        steps.size === p.steps.length ? "" : `${p.id}: a step id is used twice`,
        ...p.steps.flatMap((s) => [
          lanes.has(s.actor) ? "" : `${p.id}: step ${s.id} is in a lane that does not exist`,
          ...(s.next ?? []).map((n) => (steps.has(n.to) ? "" : `${p.id}: step ${s.id} leads to ${n.to}, which does not exist`)),
        ]),
      ].filter(Boolean);
    }));
    expect(broken).toEqual([]);
  });

  it("describes tables with columns, where they are created and who writes them", () => {
    const thin = CATEGORIES.flatMap((c) => (c.tables ?? []).flatMap((t) => [
      t.purpose.trim() ? "" : `${c.id}: ${t.name} has no purpose`,
      t.columns.length ? "" : `${c.id}: ${t.name} has no columns`,
      t.writtenBy.length ? "" : `${c.id}: ${t.name} has nobody who writes it`,
    ])).filter(Boolean);
    expect(thin).toEqual([]);
  });

  it("every source file is in at least one category", () => {
    const listed = new Set(CATEGORIES.flatMap((c) => c.files.map((f) => f.path)));
    const source = [
      ...walk("server", (p) => (p.endsWith(".go") && !p.endsWith("_test.go")) || p.endsWith(".sql")),
      ...walk("src", (p) => /\.(ts|tsx|css)$/.test(p) && !p.includes("/__tests__/") && !p.includes("validators.generated") && !p.startsWith("src/codemap/categories/")),
      ...walk("scripts", () => true),
      ...walk("schema", (p) => p.endsWith(".schema.json")),
      ...walk("e2e", (p) => p.endsWith(".ts")),
      ...walk("deploy", () => true),
      ...walk(".github/workflows", () => true),
      ...["Dockerfile", "docker-compose.yml", "playwright.config.ts", "vite.config.ts", "index.html", "package.json"].filter(isFile),
    ];
    expect(source.filter((p) => !listed.has(p))).toEqual([]);
  });
});
