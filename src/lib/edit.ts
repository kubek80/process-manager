import type { Process, Requirement, Resource, Standard, Step, StepType } from "../types";

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

const cleanResources = (r?: Resource[]) => {
  const list = r?.filter((x) => x.title.trim() || x.url.trim()).map(strip);
  return list?.length ? list : undefined;
};

/** Remove empty optional fields so that what we save is clean, minimal JSON. */
export function tidy(p: Process): Process {
  const out = strip({
    ...p,
    tags: p.tags?.filter(Boolean).length ? p.tags.filter(Boolean) : undefined,
    tiers: p.tiers?.length ? p.tiers : undefined,
    languages: p.languages?.length ? p.languages : undefined,
    environments: p.environments?.length ? p.environments : undefined,
    standards: p.standards?.length ? p.standards : undefined,
    replacedBy: p.status === "deprecated" ? p.replacedBy : undefined,
    resources: cleanResources(p.resources),
    prerequisites: p.prerequisites.map(strip),
    actors: p.actors.map(strip),
    steps: p.steps.map((s) => {
      const instructions = s.instructions?.map((i) => i.trim()).filter(Boolean);
      return strip({ ...s, instructions: instructions?.length ? instructions : undefined, resources: cleanResources(s.resources), next: s.next.map(strip) });
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

/**
 * Insert a ready-made step at an exact place in the flow: on the arrow from `afterId` to
 * `beforeId`, or (without `beforeId`) directly after `afterId`.
 */
export function insertStep(p: Process, at: { afterId: string; beforeId?: string }, spec: { title: string; type: StepType; actor: string }): { process: Process; id: string } {
  const id = uniqueId(slugify(spec.title) || "new-step", p.steps.map((s) => s.id));
  const after = p.steps.find((s) => s.id === at.afterId);
  if (!after) return { process: p, id };
  const step: Step = { id, title: spec.title, actor: spec.actor, type: spec.type, next: [] };
  let patched: Step;
  if (at.beforeId) {
    step.next = [{ to: at.beforeId }];
    patched = { ...after, next: after.next.map((n) => (n.to === at.beforeId ? { ...n, to: id } : n)) };
  } else if (after.type === "decision") {
    patched = { ...after, next: [...after.next, { to: id, label: "Other" }] };
  } else {
    step.next = after.next;
    patched = { ...after, next: [{ to: id }] };
  }
  // keep the list order close to the flow order: right after the source step
  const steps = p.steps.flatMap((s) => (s.id === after.id ? [patched, step] : [s]));
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
    status: "draft",
    review: { intervalMonths: 6 },
    prerequisites: [],
    actors: [{ id: "me", name: "You" }],
    steps: [{ id: "first-step", title: "First step", actor: "me", type: "task", instructions: ["Describe exactly what to do."], next: [] }],
  };
}

// ---------- standards

const list = (items?: string[]) => {
  const out = items?.map((x) => x.trim()).filter(Boolean);
  return out?.length ? out : undefined;
};
const codeList = (items?: string[]) => {
  const out = items?.map((x) => x.replace(/\s+$/, "")).filter((x) => x.trim());
  return out?.length ? out : undefined;
};
const ids = (items?: string[]) => (items?.length ? items : undefined);

/** Remove empty optional fields of a standard so that what we save is clean, minimal JSON. */
export function tidyStandard(s: Standard): Standard {
  return strip({
    ...s,
    tags: list(s.tags),
    tiers: ids(s.tiers), languages: ids(s.languages), environments: ids(s.environments),
    replacedBy: s.status === "deprecated" ? s.replacedBy : undefined,
    resources: cleanResources(s.resources),
    requirements: s.requirements.map((r) => {
      const good = codeList(r.examples?.good), bad = codeList(r.examples?.bad);
      const lookFor = list(r.review?.lookFor);
      return strip({
        ...r,
        guidance: list(r.guidance),
        examples: good || bad ? strip({ good, bad }) : undefined,
        verification: strip(r.verification),
        // without anything to look for there is nothing for a reviewer: drop the block
        review: lookFor ? strip({ ...r.review, lookFor, paths: list(r.review?.paths) }) : undefined,
        tiers: ids(r.tiers), languages: ids(r.languages), environments: ids(r.environments),
      });
    }),
  });
}

/** The next free requirement id with the prefix the standard already uses, e.g. SEC-LOG-06. */
export function nextRequirementId(s: Standard): string {
  const taken = new Set(s.requirements.map((r) => r.id));
  const last = s.requirements[s.requirements.length - 1]?.id ?? "REQ-00";
  const m = last.match(/^(.*-)(\d+)$/);
  const prefix = m ? m[1] : `${last}-`;
  const width = m ? m[2].length : 2;
  for (let n = (m ? Number(m[2]) : 0) + 1; ; n++) {
    const id = `${prefix}${String(n).padStart(width, "0")}`;
    if (!taken.has(id)) return id;
  }
}

export function addRequirement(s: Standard, afterId?: string): { standard: Standard; id: string } {
  const id = nextRequirementId(s);
  const fresh: Requirement = { id, title: "New requirement", level: "should", statement: "Say in one testable sentence what must be true.", verification: { method: "review" } };
  const at = s.requirements.findIndex((r) => r.id === afterId);
  const requirements = at < 0 ? [...s.requirements, fresh] : [...s.requirements.slice(0, at + 1), fresh, ...s.requirements.slice(at + 1)];
  return { standard: { ...s, requirements }, id };
}

export const updateRequirement = (s: Standard, id: string, patch: Partial<Requirement>): Standard =>
  ({ ...s, requirements: s.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

export const deleteRequirement = (s: Standard, id: string): Standard =>
  (s.requirements.length <= 1 ? s : { ...s, requirements: s.requirements.filter((r) => r.id !== id) });

export function moveRequirement(s: Standard, id: string, dir: -1 | 1): Standard {
  const i = s.requirements.findIndex((r) => r.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= s.requirements.length) return s;
  const requirements = [...s.requirements];
  [requirements[i], requirements[j]] = [requirements[j], requirements[i]];
  return { ...s, requirements };
}

export function blankStandard(existingIds: string[], owner: string): Standard {
  return {
    $schema: "../schema/standard.schema.json",
    schemaVersion: "1.0",
    id: uniqueId("new-standard", existingIds),
    title: "New standard",
    summary: "Describe in one or two sentences what this standard protects or achieves.",
    owner,
    updatedAt: today(),
    status: "draft",
    review: { intervalMonths: 12 },
    requirements: [{ id: "REQ-01", title: "First requirement", level: "must", statement: "Say in one testable sentence what must be true.", rationale: "Say which risk this removes.", verification: { method: "review" } }],
  };
}

/** Does something limited to these tiers / languages / environments apply to this application? */
export interface Profile { tier?: string; language?: string; environment?: string }
export function appliesTo(holder: { tiers?: string[]; languages?: string[]; environments?: string[] }, p: Profile): boolean {
  const ok = (ids: string[] | undefined, want?: string) => !want || !ids?.length || ids.includes(want);
  return ok(holder.tiers, p.tier) && ok(holder.languages, p.language) && ok(holder.environments, p.environment);
}
