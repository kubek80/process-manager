import type { NextLink, Process, Requirement, Resource, Standard, Step, StepType } from "../types";
import { today } from "./dates";

/** A kebab-case id of at most 60 characters. Cut first, then trim, so a cut in the middle of "a - b" leaves no dash at the end. */
export const slugify = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const root = base || "item";
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

/** The day a save is stamped with (`updatedAt`): the person's own day, not the UTC day. */
export { today };

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
    paths: Array.isArray(p.paths) && !p.paths.length ? undefined : p.paths,
    patterns: Array.isArray(p.patterns) && !p.patterns.length ? undefined : p.patterns,
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
 * Removes a step and connects the steps before it to what came after it. The names of answers
 * belong to decisions and are never changed by deleting something else:
 * - a named answer of a decision keeps its name and now leads where the deleted step led; when
 *   that step had several ways on, to the one that carried the flow on (see throughPath). When it
 *   led nowhere (the end of the flow), the answer is removed - restructureNotice says so;
 * - an unnamed way in from a decision takes over the deleted step's paths with their names (a
 *   name another answer already has gets a number: "Yes 2");
 * - an ordinary step takes over every path without names; one way in and one way out keeps the
 *   name of the way in.
 * A decision may end up with two answers to the same step: the checker asks to tell them apart,
 * instead of one answer silently disappearing.
 */
export function deleteStep(p: Process, id: string): Process {
  const gone = p.steps.find((s) => s.id === id);
  if (!gone || p.steps.length === 1) return p;
  const single = gone.next.length === 1;
  const targets = new Set(gone.next.map((g) => g.to));
  const onward = targets.size === 1 ? gone.next[0] : throughPath(p, gone);
  type Path = NextLink & { inherited?: boolean };
  const steps = p.steps.filter((s) => s.id !== id).map((s) => {
    if (!s.next.some((n) => n.to === id)) return s;
    const decides = s.type === "decision";
    const replace = (n: NextLink): Path[] => {
      if (decides && n.label) return onward ? [{ to: onward.to, label: n.label }] : [];
      return gone.next.map((g) => {
        const l = decides ? g.label : single ? n.label : undefined;
        return l ? { to: g.to, label: l, inherited: true } : { to: g.to, inherited: true };
      });
    };
    // a path taken over is left out where the step already leads; a named answer always stays
    const own = new Set(s.next.filter((n) => n.to !== id).map((n) => n.to));
    const seen = new Set<string>();
    const kept = s.next
      .flatMap((n): Path[] => (n.to === id ? replace(n) : [n]))
      .filter((n) => {
        if (n.to === s.id || n.to === id || (n.inherited && own.has(n.to))) return false;
        const first = !seen.has(n.to);
        seen.add(n.to);
        return first || (decides && !!n.label && !n.inherited);
      });
    // a name taken over from the deleted step never takes the name of an answer that was there
    const names = kept.filter((n) => !n.inherited && n.label).map((n) => ({ to: n.to, label: n.label }));
    const next = kept.reduce<NextLink[]>((out, { inherited, ...n }) => {
      if (!inherited || !decides || !n.label) return [...out, n];
      return [...out, { ...n, label: freeLabel(n.label, [...names, ...out]) }];
    }, []);
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

/** A step as the map numbers it, for a sentence: `step 9 “Start the production deployment”`. */
const numbered = (p: Process, id: string, max = 40) => {
  const i = p.steps.findIndex((s) => s.id === id);
  return i < 0 ? `“${shortName(id, max)}”` : `step ${i + 1} ${shortName(p.steps[i].title, max) ? `“${shortName(p.steps[i].title, max)}”` : "(no name yet)"}`;
};
/** An answer of a decision in a sentence: `“No” of “Is it a tier 0 service?”`. */
const answerOf = (label: string | undefined, decision: Step, max = 40) =>
  `${label?.trim() ? `“${shortName(label, 20)}”` : "An answer"} of “${shortName(decision.title, max) || "(no name yet)"}”`;

/**
 * What a change did to the answers of decisions, in words, each answer with where it goes now:
 * "“No” of “Release healthy?” now goes to 6. Roll out to 10%". Only named paths are reported; a
 * path that is new, or that leads to another step than before, is a change.
 */
export function answerChanges(before: Process, after: Process): string[] {
  return changedAnswers(before, after).map(({ step: s, answer: n, isNew }) => {
    const also = s.next.filter((x) => x !== n && x.to === n.to && x.label).map((x) => `“${x.label}”`);
    return `${answerOf(n.label, s)} ${isNew ? "is new: it goes" : "now goes"} to ${numbered(after, n.to)}${also.length ? `, as ${also.join(" and ")} does` : ""}`;
  });
}

/** The named answers of decisions that are new or lead to another step than before. */
function changedAnswers(before: Process, after: Process): { step: Step; answer: Step["next"][number]; isNew: boolean }[] {
  const out: { step: Step; answer: Step["next"][number]; isNew: boolean }[] = [];
  for (const s of after.steps) {
    const was = before.steps.find((x) => x.id === s.id);
    if (!was || s.type !== "decision") continue;
    for (const n of s.next) {
      if (!n.label) continue;
      const old = was.next.find((x) => x.label === n.label);
      if (!old || old.to !== n.to) out.push({ step: s, answer: n, isNew: !old });
    }
  }
  return out;
}

/** The named answers of decisions that are gone, each with where it led: “Yes” of “Release healthy?” is removed… */
function removedAnswers(before: Process, after: Process): string[] {
  const out: string[] = [];
  for (const was of before.steps) {
    const s = after.steps.find((x) => x.id === was.id);
    if (!s || was.type !== "decision" || s.type !== "decision") continue;
    for (const n of was.next) {
      if (!n.label || s.next.some((x) => x.label === n.label)) continue;
      const to = after.steps.find((x) => x.id === n.to);
      const why = !to ? "it led to the deleted step, which ended the flow"
        : to.id === s.id ? "it would lead back to the decision itself"
        : `it led to “${shortName(to.title, 40) || "(no name yet)"}”, which was moved`;
      out.push(`${answerOf(n.label, s)} is removed: ${why}`);
    }
  }
  return out;
}

const targetsOf = (s: Step) => [...new Set(s.next.map((n) => n.to))];

/**
 * The plain arrows (of steps that are not decisions) that lead elsewhere now: "“Close the change
 * record” now leads to 14. Change approved?", "“Roll out” now ends the flow". `subject`: the step
 * that was moved or deleted, whose own place the message's first line already says.
 */
function changedArrows(before: Process, after: Process, subject?: string): string[] {
  const out: string[] = [];
  for (const s of after.steps) {
    const was = before.steps.find((x) => x.id === s.id);
    if (!was || s.id === subject || s.type === "decision" || was.type === "decision") continue;
    const now = targetsOf(s), then = targetsOf(was);
    if (now.length === then.length && now.every((t) => then.includes(t))) continue;
    const name = `“${shortName(s.title, 40) || "(no name yet)"}”`;
    out.push(now.length ? `${name} now leads to ${now.map((t) => numbered(after, t)).join(" and to ")}` : `${name} now ends the flow`);
  }
  return out;
}

/** Steps that something led to before and nothing leads to now (the first step needs nothing to lead to it). */
function unreached(before: Process, after: Process): string[] {
  const into = (p: Process) => new Set(p.steps.flatMap((s) => s.next.filter((n) => n.to !== s.id).map((n) => n.to)));
  const was = into(before), now = into(after);
  return after.steps.filter((s, i) => i > 0 && was.has(s.id) && !now.has(s.id)).map((s) => `Nothing leads to ${numbered(after, s.id)} any more`);
}

/** A name in a short message: cut to `max` characters, with an ellipsis. Nothing stays "". */
export const shortName = (t: string | undefined, max = 36): string => {
  const text = typeof t === "string" ? t.trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** How many lines a message says under its first line; more are counted ("And 2 more…"). */
export const NOTICE_LINES = 3;

/**
 * The first line of the message after a move: where the step is now, by its number and its
 * neighbour in the list. "Step “Change approved?” is now step 14, the last."
 */
export function movedHead(after: Process, id: string): string {
  const at = after.steps.findIndex((x) => x.id === id);
  if (at < 0) return "";
  const name = `Step “${shortName(after.steps[at].title, 40) || "(no name yet)"}”`;
  if (at === after.steps.length - 1) return `${name} is now step ${at + 1}, the last.`;
  if (at === 0) return `${name} is now step 1, the first.`;
  return `${name} is now step ${at + 1}, before “${shortName(after.steps[at + 1].title, 40) || "(no name yet)"}”.`;
}

/**
 * Everything a delete or a move did to the flow besides the step itself, a sentence each: answers
 * of decisions that were removed, answers that lead elsewhere (or are new), steps nothing leads to
 * any more, plain arrows that were reconnected. `subject`: the step moved or deleted.
 */
export function structureChanges(before: Process, after: Process, subject?: string): string[] {
  const end = (l: string) => (/[.?!…]$/.test(l) ? l : `${l}.`);
  return [...removedAnswers(before, after), ...answerChanges(before, after), ...unreached(before, after), ...changedArrows(before, after, subject)].map(end);
}

/**
 * The message after a delete or a move: what was done (`done`), then every other change to the
 * flow (structureChanges): at most three lines, the third "And N more…" when there are more.
 * `all` holds every line. Null: nothing was done and nothing changed.
 */
export function restructureNotice(before: Process, after: Process, done?: string, subject?: string): { title: string; detail?: string; all?: string[] } | null {
  const lines = structureChanges(before, after, subject);
  if (!done && !lines.length) return null;
  const head = done ?? lines[0];
  const rest = done ? lines : lines.slice(1);
  const shown = rest.length > NOTICE_LINES ? rest.slice(0, NOTICE_LINES - 1) : rest;
  const more = rest.length - shown.length;
  const detail = [...shown, ...(more ? [`And ${more} more: see “What comes next” of the steps on the map.`] : [])].join("\n");
  return { title: head, ...(detail ? { detail } : {}), ...(lines.length > 1 ? { all: lines } : {}) };
}

/**
 * What the screen says when a step becomes a decision (or a new decision is added) and its second
 * answer was made to go back to the step before: that it did, and where to change it. Null when
 * no answer of it goes back.
 */
export function newDecisionNotice(before: Process, after: Process, id: string): string | null {
  const s = after.steps.find((x) => x.id === id);
  if (!s || s.type !== "decision") return null;
  const was = before.steps.find((x) => x.id === id);
  const at = after.steps.indexOf(s);
  const back = s.next.find((n) => {
    const i = after.steps.findIndex((x) => x.id === n.to);
    return i >= 0 && i < at && !was?.next.some((o) => o.to === n.to && o.label === n.label && was.type === "decision");
  });
  if (!back) return null;
  const to = after.steps.find((x) => x.id === back.to)!;
  return `${back.label ? `“${shortName(back.label, 20)}”` : "One answer"} goes back to “${shortName(to.title, 40) || "(no name yet)"}”. Change it under “What comes next”.`;
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
  // only a service step requests a service: another kind leaves it
  if (s.type === "service" && s.service) p = updateStep(p, id, { service: undefined });
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
    paths: Array.isArray(s.paths) && !s.paths.length ? undefined : s.paths,
    patterns: Array.isArray(s.patterns) && !s.patterns.length ? undefined : s.patterns,
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
  // a blank standard: the first name typed replaces the example requirement it starts with
  const only = s.requirements.length === 1 ? s.requirements[0] : undefined;
  if (only && only.title === EXAMPLE.firstRequirement && only.statement === EXAMPLE.statement && title.trim()) {
    return { standard: updateRequirement(s, only.id, { title: title.trim() }), id: only.id };
  }
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

/** Does something limited to these tiers / paths / languages / environments apply to this application? */
export interface Profile { tier?: string; path?: string; language?: string; environment?: string }
export function appliesTo(holder: { tiers?: string[]; paths?: string[]; languages?: string[]; environments?: string[] }, p: Profile): boolean {
  const ok = (ids: string[] | undefined, want?: string) => !want || !ids?.length || ids.includes(want);
  return ok(holder.tiers, p.tier) && ok(holder.paths, p.path) && ok(holder.languages, p.language) && ok(holder.environments, p.environment);
}
