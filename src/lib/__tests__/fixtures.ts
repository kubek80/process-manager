import fs from "node:fs";
import path from "node:path";
import type { Catalog, Process, Standard } from "../../types";

export const root = path.resolve(__dirname, "../../..");
export const readJson = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
export const catalog = readJson<Catalog>("catalog/catalog.json");
export const processFiles = fs.readdirSync(path.join(root, "processes")).filter((f) => f.endsWith(".json")).sort();
export const processes = processFiles.map((f) => readJson<Process>(`processes/${f}`));
export const example = readJson<Process>("schema/example.process.json");
export const standardFiles = fs.readdirSync(path.join(root, "standards")).filter((f) => f.endsWith(".json")).sort();
export const standards = standardFiles.map((f) => readJson<Standard>(`standards/${f}`));
export const standardExample = readJson<Standard>("schema/example.standard.json");

/** A small valid standard to bend in tests. */
export const baseStandard = (): Standard => ({
  schemaVersion: "1.0", id: "demo-standard", title: "Demo standard", summary: "A standard used in tests only.",
  owner: "security", status: "active", review: { intervalMonths: 12, lastReviewedAt: "2026-06-01" },
  requirements: [
    { id: "DEMO-01", title: "First rule", level: "must", statement: "Something must always be true.", rationale: "Because otherwise it breaks.",
      verification: { method: "review" }, review: { lookFor: ["A sign of trouble"] } },
    { id: "DEMO-02", title: "Second rule", level: "should", statement: "Something should usually be true.", verification: { method: "automated", description: "A scanner" } },
  ],
});

/** A small valid process to bend in tests. */
export const base = (): Process => ({
  schemaVersion: "1.0", id: "demo", title: "Demo process", summary: "A process used in tests only.",
  status: "active", owner: "cloud-platform-team", review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" },
  prerequisites: [],
  actors: [{ id: "me", name: "You" }, { id: "boss", name: "Line manager" }],
  steps: [
    { id: "ask", title: "Ask for it", actor: "me", type: "form", instructions: ["Fill in the form."], next: [{ to: "approve" }] },
    { id: "approve", title: "Approve it", actor: "boss", type: "approval", next: [{ to: "ok" }] },
    { id: "ok", title: "Approved?", actor: "boss", type: "decision", next: [{ to: "done", label: "Yes" }, { to: "fix", label: "No" }] },
    { id: "fix", title: "Fix the request", actor: "me", type: "task", instructions: ["Read the comment."], next: [{ to: "approve" }] },
    { id: "done", title: "Check the result", actor: "me", type: "verify", instructions: ["Log in."], next: [] },
  ],
});
