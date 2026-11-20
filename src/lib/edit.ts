import type { NextLink, Process, Requirement, Resource, Standard, Step, StepType } from "../types";

/** A kebab-case id of at most 60 characters. Cut first, then trim, so a cut in the middle of "a - b" leaves no dash at the end. */
export const slugify = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const root = base || "item";
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

export const today = () => new Date().toISOString().slice(0, 10);

// The helpers below also get documents that are not (yet) well-formed - an old revision, something
// repaired by hand - so they pass through what they do not understand instead of failing on it.
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const each = <T>(v: T[], fn: (x: T) => T): T[] => (Array.isArray(v) ? v.map(fn) : v);

const strip = <T>(o: T): T => {
  if (!isObj(o)) return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && k !== "title" && k !== "name" && k !== "summary" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
};

const cleanResources = (r?: Resource[]) => {
  if (r !== undefined && !Array.isArray(r)) return r;
  const list = r?.filter((x) => !isObj(x) || text(x.title).trim() || text(x.url).trim()).map(strip);
  return list?.length ? list : undefined;
};

/** Remove empty optional fields so that what we save is clean, minimal JSON. */
export function tidy(p: Process): Process {
  const out = strip({
    ...p,
    tags: Array.isArray(p.tags) ? (p.tags.filter(Boolean).length ? p.tags.filter(Boolean) : undefined) : p.tags,
    tiers: p.tiers?.length ? p.tiers : undefined,
    languages: p.languages?.length ? p.languages : undefined,
    environments: p.environments?.length ? p.environments : undefined,
    standards: p.standards?.length ? p.standards : undefined,
    replacedBy: p.status === "deprecated" ? p.replacedBy : undefined,
    resources: cleanResources(p.resources),
    prerequisites: each(p.prerequisites, strip),
    actors: each(p.actors, strip),
    steps: each(p.steps, (s) => {
      if (!isObj(s)) return s;
      const instructions = Array.isArray(s.instructions) ? s.instructions.map((i) => (typeof i === "string" ? i.trim() : i)).filter(Boolean) : s.instructions;
      return strip({ ...s, instructions: Array.isArray(instructions) && !instructions.length ? undefined : instructions, resources: cleanResources(s.resources), next: each(s.next, strip) });
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
  const step: Step = { id, title: EXAMPLE.newStep, actor: after?.actor ?? "me", type: "task", next: [] };
  if (!after) return { process: { ...p, steps: [step] }, id };
  // a decision keeps its branches; the new step is added as an extra branch target instead
  if (after.type === "decision") {
    const steps = p.steps.flatMap((s) => (s.id === after.id ? [{ ...s, next: [...s.next, { to: id, label: freeLabel("Other", s.next) }] }, step] : [s]));
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
    patched = { ...after, next: [...after.next, { to: id, label: freeLabel("Other", after.next) }] };
  } else {
    step.next = after.next;
    patched = { ...after, next: [{ to: id }] };
  }
  if (spec.type === "decision") step.next = decisionPaths(step.next, after.id);
  // keep the list order close to the flow order: right after the source step
  const steps = p.steps.flatMap((s) => (s.id === after.id ? [patched, step] : [s]));
  return { process: { ...p, steps }, id };
}

/** A label that no other path of the step uses yet: "Other", then "Other 2", "Other 3"… */
function freeLabel(base: string, paths: NextLink[]): string {
  const taken = new Set(paths.map((n) => n.label));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * A new decision should not start life as a problem: give it two named paths where the flow
 * offers them. What followed becomes "Yes" (or keeps its names); "No" goes back to the step before.
 */
function decisionPaths(next: NextLink[], backTo: string): NextLink[] {
  if (next.length === 0) return next; // at the end of the flow there is nothing to point at yet
  const paths = next.some((n) => n.to === backTo) || next.length > 1 ? next : [...next, { to: backTo }];
  const spare = ["Yes", "No"];
  return paths.reduce<NextLink[]>((out, n, i) => {
    const wanted = n.label ?? spare.find((l) => !paths.some((x) => x.label === l) && !out.some((x) => x.label === l)) ?? `Option ${i + 1}`;
    return [...out, { ...n, label: freeLabel(wanted, out) }];
  }, []);
}

/**
 * Removes a step and connects the steps before it to what came after it. The names of paths
 * belong to decisions: an ordinary step that takes over several paths gets them without names,
 * and a decision never ends up with two paths of the same name.
 */
export function deleteStep(p: Process, id: string): Process {
  const gone = p.steps.find((s) => s.id === id);
  if (!gone || p.steps.length === 1) return p;
  const single = gone.next.length === 1;
  const steps = p.steps.filter((s) => s.id !== id).map((s) => {
    if (!s.next.some((n) => n.to === id)) return s;
    const decides = s.type === "decision";
    // one path in, one path out: the way in keeps its name. Several out: a decision names each by
    // what the removed step called it; an ordinary step has no use for the names.
    const label = (n: NextLink, g: NextLink) => (single ? n.label ?? (decides ? g.label : undefined) : decides ? g.label ?? n.label : undefined);
    const seen = new Set<string>();
    // An answer of a decision that led to a step with one way on keeps its name and now leads
    // there, even when another answer already does: the answers stay, and the checker asks to tell
    // them apart, instead of one answer silently disappearing.
    const keeps = (n: NextLink) => decides && single && !!n.label;
    const next = s.next
      .flatMap((n): (NextLink & { inherited?: boolean })[] => (n.to === id ? gone.next.map((g) => { const l = label(n, g); return l ? { to: g.to, label: l, inherited: true } : { to: g.to, inherited: true }; }) : [n]))
      .filter((n) => n.to !== s.id && n.to !== id && ((!seen.has(n.to) && !!seen.add(n.to)) || keeps(n)))
      .map(({ inherited: _, ...n }) => n) // eslint-disable-line @typescript-eslint/no-unused-vars
      .reduce<NextLink[]>((out, n) => [...out, decides && n.label && out.some((x) => x.label === n.label) ? { ...n, label: freeLabel(n.label, out) } : n], []);
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

/** Why a step cannot be moved to another place in the flow, or "" when it can. */
export function flowMoveBlocked(p: Process, id: string): string {
  return p.steps.some((x) => x.id === id) ? "" : "This step no longer exists.";
}

/**
 * The answer of a step with several paths that carries the flow on: the first that leads to a
 * later step in the list (not back), else the first. Moving or cutting the step out joins the
 * steps before it to where this answer leads; its other answers stay as they are.
 */
function throughPath(p: Process, s: Step): NextLink | undefined {
  const at = p.steps.indexOf(s);
  return s.next.find((n) => p.steps.findIndex((x) => x.id === n.to) > at) ?? s.next[0];
}
/** Puts `step` right after `afterId` in the flow (as insertStep does): it takes over what followed, or becomes a new branch of a decision. */
function placeAfter(steps: Step[], afterId: string, step: Step): Step[] {
  const after = steps.find((s) => s.id === afterId);
  if (!after) return [...steps, step];
  let patched: Step, placed: Step;
  if (after.type === "decision" && after.next.length) {
    patched = { ...after, next: [...after.next, { to: step.id, label: freeLabel("Other", after.next) }] };
    placed = { ...step, next: [] };
  } else {
    patched = { ...after, next: [{ to: step.id }] };
    placed = { ...step, next: after.next.filter((n) => n.to !== step.id) };
  }
  return steps.flatMap((s) => (s.id === afterId ? [patched, placed] : [s]));
}

/**
 * Moves a step to another place in the flow - not only in the numbering: the steps around it are
 * joined (as when it is deleted), then it goes on every arrow into `beforeId` and leads to it.
 * `null` moves it to the end: after the last step in the list. The list order follows, so the
 * numbers on the map read in the new order.
 *
 * A decision moves with its answers. The answer that carried the flow on (see throughPath) is the
 * one that is reconnected: the steps before the decision now lead where it led, and it leads to
 * `beforeId`; every other answer keeps its target. `answerChanges` says what moved.
 */
export function moveStepInFlow(p: Process, id: string, beforeId: string | null): Process {
  const moving = p.steps.find((s) => s.id === id);
  if (!moving || flowMoveBlocked(p, id) || beforeId === id) return p;
  if (beforeId !== null && !p.steps.some((s) => s.id === beforeId)) return p;
  const through = moving.next.length > 1 ? throughPath(p, moving) : moving.next[0];
  // cut out as if it had only the path that carries the flow on
  const cutFrom = moving.next.length > 1 ? { ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, next: [through!] } : s)) } : p;
  const rest = deleteStep(cutFrom, id).steps;
  if (rest.length === p.steps.length) return p;
  if (beforeId === null) {
    const last = rest[rest.length - 1];
    const placed = placeAfter(rest, last.id, { ...moving, next: [] });
    // a decision keeps its answers; an ordinary step takes over what followed the last step
    return { ...p, steps: moving.next.length > 1 ? placed.map((s) => (s.id === id ? { ...moving } : s)) : placed };
  }
  // the arrows that went into the target now go into the moved step, with their names
  const redirected = rest.map((s) => (s.next.some((n) => n.to === beforeId) ? { ...s, next: s.next.map((n) => (n.to === beforeId ? { ...n, to: id } : n)) } : s));
  const at = redirected.findIndex((s) => s.id === beforeId);
  const moved: Step = moving.next.length > 1
    ? { ...moving, next: moving.next.map((n) => (n === through ? { ...n, to: beforeId } : n)) }
    : { ...moving, next: [{ ...(through?.label ? { label: through.label } : {}), to: beforeId }] };
  return { ...p, steps: [...redirected.slice(0, at), moved, ...redirected.slice(at)] };
}

/**
 * What a change did to the answers of decisions, in words: "“No” of “Release healthy?” now leads
 * to “Roll out to 10%”". Only named paths are reported; a path that is new, or that leads to
 * another step than before, is a change. Said right away after a move or a delete, with Undo.
 */
export function answerChanges(before: Process, after: Process): string[] {
  const title = (q: Process, id: string) => q.steps.find((s) => s.id === id)?.title || id;
  return changedAnswers(before, after).map(({ step: s, answer: n }) => {
    const also = s.next.filter((x) => x !== n && x.to === n.to).map((x) => `“${x.label}”`);
    return `“${n.label}” of “${s.title}” now leads to “${title(after, n.to)}”${also.length ? `, as ${also.join(" and ")} does` : ""}`;
  });
}

/** The named answers of decisions that are new or lead to another step than before. */
function changedAnswers(before: Process, after: Process): { step: Step; answer: Step["next"][number] }[] {
  const out: { step: Step; answer: Step["next"][number] }[] = [];
  for (const s of after.steps) {
    const was = before.steps.find((x) => x.id === s.id);
    if (!was || s.type !== "decision") continue;
    for (const n of s.next) {
      if (!n.label) continue;
      const old = was.next.find((x) => x.label === n.label);
      if (!old || old.to !== n.to) out.push({ step: s, answer: n });
    }
  }
  return out;
}

/** A name in a short message: cut to `max` characters, with an ellipsis. */
export const shortName = (t: string, max = 36) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/**
 * The message after a delete or a move, at most two short lines: what was done, and one line about
 * the answers of decisions that now lead elsewhere (where exactly each leads is in the fields of
 * the decision). A move that changed one answer says where it now leads. Null: nothing to say.
 */
export function restructureNotice(before: Process, after: Process, done?: string): { title: string; detail?: string } | null {
  const all = changedAnswers(before, after);
  const changed = all.map((c) => ({ decision: c.step.id, answer: c.answer.label ?? "" }));
  if (!done && !changed.length) return null;
  // a move that changed one answer says where it now leads, in one sentence
  if (!done && all.length === 1) {
    const { step, answer } = all[0];
    const to = after.steps.find((x) => x.id === answer.to)?.title ?? answer.to;
    return { title: `“${shortName(answer.label ?? "", 16)}” of “${shortName(step.title, 40)}” now leads to “${shortName(to, 40)}”.` };
  }
  const titleOf = (id: string) => after.steps.find((x) => x.id === id)?.title ?? id;
  const decisions = [...new Set(changed.map((c) => c.decision))];
  const answers = changed.map((c) => `“${shortName(c.answer, 16)}”`);
  const line = !changed.length ? undefined
    : decisions.length > 1 ? `Answers of ${decisions.length} decisions now lead elsewhere.`
    : `${answers.length === 1 ? answers[0] : answers.length === 2 ? answers.join(" and ") : `${answers.length} answers`} of “${shortName(titleOf(decisions[0]), 28)}” now ${answers.length === 1 ? "leads" : "lead"} elsewhere.`;
  if (done) return { title: done, ...(line ? { detail: line } : {}) };
  return { title: line! };
}

/** Moves a step one place up (-1) or down (1) in the flow, as moveStepInFlow does: before the step listed before it, or after the one listed after it. */
export function nudgeStep(p: Process, id: string, dir: -1 | 1): Process {
  const i = p.steps.findIndex((s) => s.id === id);
  if (i < 0) return p;
  if (dir === -1) return i === 0 ? p : moveStepInFlow(p, id, p.steps[i - 1].id);
  if (i >= p.steps.length - 1) return p;
  return moveStepInFlow(p, id, i + 2 < p.steps.length ? p.steps[i + 2].id : null);
}

/**
 * Adds a named step at the end of the list, after the last step (a new branch when that is a
 * decision). Done by whoever did the last step. No example text: the name is the one typed.
 */
export function appendStep(p: Process, title: string): { process: Process; id: string } {
  const last = p.steps[p.steps.length - 1];
  const name = title.trim();
  // a blank process: the first name typed replaces the example step it starts with
  if (p.steps.length === 1 && last.title === EXAMPLE.firstStep && (last.instructions ?? []).every((i) => i === EXAMPLE.instruction)) {
    const r = renameStepId({ ...p, steps: [{ ...last, title: name, instructions: undefined }] }, last.id, slugify(name) || last.id);
    return r;
  }
  if (!last) {
    const id = uniqueId(slugify(name) || "new-step", []);
    return { process: { ...p, steps: [{ id, title: name, actor: p.actors[0]?.id ?? "me", type: "task", next: [] }] }, id };
  }
  return insertStep(p, { afterId: last.id }, { title: name, type: "task", actor: last.actor });
}

/**
 * Changes the kind of a step. A step that becomes a decision gets two named paths where the flow
 * offers them, as a new decision does: what followed becomes "Yes", "No" goes back to the step
 * before it (a loop back to correct something), so it does not start life as a problem.
 */
export function setStepType(p: Process, id: string, type: StepType): Process {
  const s = p.steps.find((x) => x.id === id);
  if (!s || s.type === type) return p;
  if (type !== "decision" || s.next.length > 1) return updateStep(p, id, { type });
  const before = p.steps.find((x) => x.next.some((n) => n.to === id));
  const next = before ? decisionPaths(s.next, before.id) : s.next;
  return updateStep(p, id, { type, next });
}

/** A participant added by name from a step: a team of the lists when the name is one, else a role of its own. */
export function addActor(p: Process, name: string, teams: { id: string; name: string; contact?: string }[]): { process: Process; id: string } {
  const clean = name.trim();
  const team = teams.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  const taken = p.actors.map((a) => a.id);
  const id = uniqueId(team ? team.id : slugify(clean) || "participant", taken);
  const actor = team ? { id, name: team.name, ...(team.contact ? { description: team.contact } : {}), teamId: team.id } : { id, name: clean };
  return { process: { ...p, actors: [...p.actors, actor] }, id };
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

/** The platform or practice a new process or standard belongs to, when its maker chose one. */
export type BelongsTo = { platform?: string; practice?: string };

/**
 * The example texts a new process, standard, step or requirement starts with. They tell the
 * editor what to write; the checker on the editing screen does not let them be published.
 */
export const EXAMPLE = {
  processSummary: "Describe in one or two sentences what the reader gets at the end.",
  standardSummary: "Describe in one or two sentences what this standard protects or achieves.",
  firstStep: "First step",
  newStep: "New step",
  instruction: "Describe exactly what to do.",
  firstRequirement: "First requirement",
  newRequirement: "New requirement",
  statement: "Say in one testable sentence what must be true.",
  rationale: "Say which risk this removes.",
} as const;

/** A new process. Its id is made from the name it is given and never changes afterwards. */
export function blankProcess(existingIds: string[], title = "", belongs: BelongsTo = {}): Process {
  return {
    $schema: "../schema/process.schema.json",
    schemaVersion: "1.0",
    id: uniqueId(slugify(title) || "new-process", existingIds),
    title: title.trim() || "New process",
    summary: EXAMPLE.processSummary,
    ...belongs,
    updatedAt: today(),
    status: "draft",
    review: { intervalMonths: 6 },
    prerequisites: [],
    actors: [{ id: "me", name: "You" }],
    steps: [{ id: "first-step", title: EXAMPLE.firstStep, actor: "me", type: "task", instructions: [EXAMPLE.instruction], next: [] }],
  };
}

// ---------- standards

const list = (items?: string[]) => {
  if (items !== undefined && !Array.isArray(items)) return items;
  const out = items?.map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean);
  return out?.length ? out : undefined;
};
const codeList = (items?: string[]) => {
  if (items !== undefined && !Array.isArray(items)) return items;
  const out = items?.map((x) => (typeof x === "string" ? x.replace(/\s+$/, "") : x)).filter((x) => typeof x !== "string" || x.trim());
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
    requirements: each(s.requirements, (r) => {
      if (!isObj(r)) return r;
      const examples = isObj(r.examples) ? r.examples : undefined, review = isObj(r.review) ? r.review : undefined;
      const good = codeList(examples?.good), bad = codeList(examples?.bad);
      const lookFor = list(review?.lookFor);
      return strip({
        ...r,
        guidance: list(r.guidance),
        examples: good || bad ? strip({ good, bad }) : undefined,
        verification: strip(r.verification),
        // without anything to look for there is nothing for a reviewer: drop the block
        review: lookFor ? strip({ ...review, lookFor, paths: list(review?.paths) }) : undefined,
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
  const fresh: Requirement = { id, title: EXAMPLE.newRequirement, level: "should", statement: EXAMPLE.statement, verification: { method: "review" } };
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

/** Moves a requirement before another one, or (`null`) to the end. Its id stays. */
export function moveRequirementTo(s: Standard, id: string, beforeId: string | null): Standard {
  const r = s.requirements.find((x) => x.id === id);
  if (!r || beforeId === id || (beforeId !== null && !s.requirements.some((x) => x.id === beforeId))) return s;
  const rest = s.requirements.filter((x) => x.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((x) => x.id === beforeId);
  return { ...s, requirements: [...rest.slice(0, at), r, ...rest.slice(at)] };
}

/**
 * Adds a requirement with the name typed, at the end. Its rule and reason are still the example
 * texts (they say what to write), to be replaced before publishing.
 */
export function appendRequirement(s: Standard, title: string): { standard: Standard; id: string } {
  const r = addRequirement(s);
  return { standard: updateRequirement(r.standard, r.id, { title: title.trim() || EXAMPLE.newRequirement }), id: r.id };
}

/** A new standard. Its id is made from the name it is given and never changes afterwards. */
export function blankStandard(existingIds: string[], owner: string, title = "", belongs: BelongsTo = {}): Standard {
  return {
    $schema: "../schema/standard.schema.json",
    schemaVersion: "1.0",
    id: uniqueId(slugify(title) || "new-standard", existingIds),
    title: title.trim() || "New standard",
    summary: EXAMPLE.standardSummary,
    owner,
    ...belongs,
    updatedAt: today(),
    status: "draft",
    review: { intervalMonths: 12 },
    requirements: [{ id: "REQ-01", title: EXAMPLE.firstRequirement, level: "must", statement: EXAMPLE.statement, rationale: EXAMPLE.rationale, verification: { method: "review" } }],
  };
}

/**
 * Names under which the "I have this" ticks of the prerequisites are remembered, one per prerequisite.
 * They come from the title, not the position, so a tick stays with its prerequisite when the list is reordered.
 */
export function prerequisiteKeys(list: { title: string }[]): string[] {
  const taken: string[] = [];
  return (Array.isArray(list) ? list : []).map((q) => {
    const key = uniqueId(slugify(text(q?.title)) || "item", taken);
    taken.push(key);
    return `prereq:${key}`;
  });
}

/** Does something limited to these tiers / languages / environments apply to this application? */
export interface Profile { tier?: string; language?: string; environment?: string }
export function appliesTo(holder: { tiers?: string[]; languages?: string[]; environments?: string[] }, p: Profile): boolean {
  const ok = (ids: string[] | undefined, want?: string) => !want || !ids?.length || ids.includes(want);
  return ok(holder.tiers, p.tier) && ok(holder.languages, p.language) && ok(holder.environments, p.environment);
}
