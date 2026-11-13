import type { Process, Step } from "../types";

export const slugify = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const root = base || "item";
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

export const today = () => new Date().toISOString().slice(0, 10);

const strip = <T extends object>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && k !== "title" && k !== "name" && k !== "summary" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
};

/** Remove empty optional fields so that what we save is clean, minimal JSON. */
export function tidy(p: Process): Process {
  const out = strip({
    ...p,
    tags: p.tags?.filter(Boolean).length ? p.tags.filter(Boolean) : undefined,
    prerequisites: p.prerequisites.map(strip),
    actors: p.actors.map(strip),
    steps: p.steps.map((s) => {
      const instructions = s.instructions?.map((i) => i.trim()).filter(Boolean);
      return strip({ ...s, instructions: instructions?.length ? instructions : undefined, next: s.next.map(strip) });
    }),
  });
  return out;
}

export function updateStep(p: Process, id: string, patch: Partial<Step>): Process {
  return { ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function addStepAfter(p: Process, afterId: string | null): { process: Process; id: string } {
  const id = uniqueId("new-step", p.steps.map((s) => s.id));
  const after = p.steps.find((s) => s.id === afterId) ?? p.steps[p.steps.length - 1];
  const step: Step = { id, title: "New step", actor: after?.actor ?? "me", type: "task", next: [] };
  if (!after) return { process: { ...p, steps: [step] }, id };
  // a decision keeps its branches; the new step is added as an extra branch target instead
  if (after.type === "decision") {
    const steps = p.steps.flatMap((s) => (s.id === after.id ? [{ ...s, next: [...s.next, { to: id, label: "Other" }] }, step] : [s]));
    return { process: { ...p, steps }, id };
  }
  step.next = after.next;
  const steps = p.steps.flatMap((s) => (s.id === after.id ? [{ ...s, next: [{ to: id }] }, step] : [s]));
  return { process: { ...p, steps }, id };
}

export function deleteStep(p: Process, id: string): Process {
  const gone = p.steps.find((s) => s.id === id);
  if (!gone || p.steps.length === 1) return p;
  const steps = p.steps.filter((s) => s.id !== id).map((s) => {
    if (!s.next.some((n) => n.to === id)) return s;
    const seen = new Set<string>();
    const next = s.next
      .flatMap((n) => (n.to === id ? gone.next.map((g) => ({ ...g, label: n.label ?? g.label })) : [n]))
      .filter((n) => n.to !== s.id && n.to !== id && !seen.has(n.to) && seen.add(n.to));
    return { ...s, next };
  });
  return { ...p, steps };
}

export function moveStep(p: Process, id: string, dir: -1 | 1): Process {
  const i = p.steps.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.steps.length) return p;
  const steps = [...p.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return { ...p, steps };
}

export function renameStepId(p: Process, oldId: string, wanted: string): { process: Process; id: string } {
  const id = uniqueId(wanted, p.steps.filter((s) => s.id !== oldId).map((s) => s.id));
  if (id === oldId) return { process: p, id };
  const steps = p.steps.map((s) => ({
    ...s,
    id: s.id === oldId ? id : s.id,
    next: s.next.map((n) => (n.to === oldId ? { ...n, to: id } : n)),
  }));
  return { process: { ...p, steps }, id };
}

export function blankProcess(existingIds: string[]): Process {
  return {
    $schema: "../schema/process.schema.json",
    schemaVersion: "1.0",
    id: uniqueId("new-process", existingIds),
    title: "New process",
    summary: "Describe in one or two sentences what the reader gets at the end.",
    category: "General",
    updatedAt: today(),
    prerequisites: [],
    actors: [{ id: "me", name: "You" }],
    steps: [{ id: "first-step", title: "First step", actor: "me", type: "task", instructions: ["Describe exactly what to do."], next: [] }],
  };
}
