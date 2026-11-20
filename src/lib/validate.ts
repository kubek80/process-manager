import type { ErrorObject } from "ajv";
import schema from "../../schema/process.schema.json";
import standardSchema from "../../schema/standard.schema.json";
import type { Catalog, Issue, Process, Standard } from "../types";
import { isDate } from "./lifecycle";
// The checks for the three formats are generated from schema/*.schema.json by `npm run validators`.
// They are not built in the browser: that needs eval, which the app's security policy forbids.
import { validateCatalogDoc as validateCatalogSchema, validateProcessDoc as validateSchema, validateStandardDoc as validateStandardSchema } from "./validators.generated.js";

export interface CheckContext { processIds?: Iterable<string>; standardIds?: Iterable<string>; catalog?: Catalog }

export { schema as processSchema, standardSchema };

function prettyPath(p: string): string {
  if (!p) return "(root)";
  return p.slice(1).split("/").map((s, i) => (/^\d+$/.test(s) ? `[${s}]` : (i ? "." : "") + s)).join("");
}

function describe(e: ErrorObject): string {
  switch (e.keyword) {
    case "required": return `is missing the required field "${e.params.missingProperty}"`;
    case "additionalProperties": return `has a field "${e.params.additionalProperty}" that the schema does not allow - remove or rename it`;
    case "enum": return `must be one of: ${(e.params.allowedValues as string[]).join(", ")}`;
    case "const": return `must be exactly ${JSON.stringify(e.params.allowedValue)}`;
    case "pattern":
      return String(e.params.pattern).startsWith("^[a-z0-9]+")
        ? "must be kebab-case: lowercase letters, digits and single dashes (e.g. \"raise-request\")"
        : String(e.params.pattern).startsWith("^[A-Z]")
        ? "must be upper case with dashes, e.g. \"SEC-LOG-01\""
      : String(e.params.pattern).startsWith("^https?")
          ? "must be a full link starting with http:// or https://"
          : `must match the pattern ${e.params.pattern}`;
    case "type": return `must be of type ${e.params.type}`;
    case "minLength": return `is too short (minimum ${e.params.limit} characters)`;
    case "maxLength": return `is too long (maximum ${e.params.limit} characters)`;
    case "minItems": return `needs at least ${e.params.limit} item(s)`;
    case "maxItems": return `has too many items (maximum ${e.params.limit})`;
    default: return e.message ?? "is invalid";
  }
}

/**
 * The lists a process or standard belongs to: its category, practice and platform must be in
 * their lists, like a tier. The server refuses a save that names one that is not.
 */
function checkBelongs(doc: { category?: string; practice?: string; platform?: string }, cat: Catalog, err: (path: string, message: string) => void) {
  const known = (list: { id: string }[] | undefined) => (list ?? []).map((x) => x.id);
  const one = (field: "category" | "practice" | "platform", list: { id: string }[] | undefined, noun: string, plural: string) => {
    const id = doc[field];
    if (id && !known(list).includes(id)) err(field, `"${id}" is not a known ${noun}. Known ${plural}: ${known(list).join(", ") || "(none)"}`);
  };
  one("category", cat.categories, "category", "categories");
  one("practice", cat.practices, "practice", "practices");
  one("platform", cat.platforms, "platform", "platforms");
}

/**
 * Full check of a process: JSON schema first, then the rules a schema cannot express
 * (references, uniqueness, reachability). The context enables checks against other processes
 * and against the catalog (tiers, teams, tools).
 */
export function validateProcess(data: unknown, ctx: CheckContext = {}): Issue[] {
  const issues: Issue[] = [];
  if (!validateSchema(data)) {
    const seen = new Set<string>();
    for (const e of validateSchema.errors ?? []) {
      const issue: Issue = { level: "error", path: prettyPath(e.instancePath), message: describe(e) };
      const key = issue.path + issue.message;
      if (!seen.has(key)) { seen.add(key); issues.push(issue); }
    }
    return issues; // semantic checks assume a schema-valid shape
  }

  const p = data as unknown as Process;
  const err = (path: string, message: string) => issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });
  const known = ctx.processIds ? new Set(ctx.processIds) : null;
  const cat = ctx.catalog;
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  if (cat) {
    if (p.owner && !cat.teams.some((t) => t.id === p.owner))
      warn("owner", `"${p.owner}" is not in the teams list. Known teams: ${ids(cat.teams).join(", ") || "(none)"}`);
    checkBelongs(p, cat, err);
    (p.tiers ?? []).forEach((tier, i) => {
      if (!cat.tiers.some((t) => t.id === tier)) err(`tiers[${i}]`, `"${tier}" is not a known tier. Known tiers: ${ids(cat.tiers).join(", ") || "(none)"}`);
    });
    (p.languages ?? []).forEach((lang, i) => {
      if (!cat.languages.some((l) => l.id === lang)) err(`languages[${i}]`, `"${lang}" is not a known language. Known languages: ${ids(cat.languages).join(", ") || "(none)"}`);
    });
    (p.environments ?? []).forEach((env, i) => {
      if (!cat.environments.some((x) => x.id === env)) err(`environments[${i}]`, `"${env}" is not a known environment. Known environments: ${ids(cat.environments).join(", ") || "(none)"}`);
    });
    p.actors.forEach((a, i) => {
      if (a.teamId && !cat.teams.some((t) => t.id === a.teamId)) warn(`actors[${i}].teamId`, `"${a.teamId}" is not in the teams list`);
    });
  }

  if (p.replacedBy) {
    if (p.replacedBy === p.id) err("replacedBy", "a process cannot replace itself");
    else if (known && !known.has(p.replacedBy)) warn("replacedBy", `no process with id "${p.replacedBy}" exists yet`);
    if (p.status !== "deprecated") warn("replacedBy", "replacedBy only makes sense when status is \"deprecated\"");
  }
  if ((p.status ?? "active") === "active" && !p.review) warn("review", "no review interval is set - the owner will never be asked to confirm this process is still correct");
  if (p.review?.lastReviewedAt && !isDate(p.review.lastReviewedAt)) err("review.lastReviewedAt", `"${p.review.lastReviewedAt}" is not a date`);
  if ((p.status ?? "active") === "active" && !p.owner) warn("owner", "an active process should have an owner team");

  const knownStandards = ctx.standardIds ? new Set(ctx.standardIds) : null;
  (p.standards ?? []).forEach((sid, i) => {
    if (knownStandards && !knownStandards.has(sid)) warn(`standards[${i}]`, `no standard with id "${sid}" exists yet`);
  });

  const actorIds = new Set<string>();
  p.actors.forEach((a, i) => {
    if (actorIds.has(a.id)) err(`actors[${i}].id`, `duplicate actor id "${a.id}"`);
    actorIds.add(a.id);
  });

  const stepIds = new Set<string>();
  p.steps.forEach((s, i) => {
    if (stepIds.has(s.id)) err(`steps[${i}].id`, `duplicate step id "${s.id}"`);
    stepIds.add(s.id);
  });

  const usedActors = new Set<string>();
  p.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!actorIds.has(s.actor)) err(`${at}.actor`, `"${s.actor}" is not an actor id. Known actors: ${[...actorIds].join(", ")}`);
    usedActors.add(s.actor);
    const targets = new Set<string>();
    s.next.forEach((n, j) => {
      if (!stepIds.has(n.to)) err(`${at}.next[${j}].to`, `"${n.to}" is not a step id in this process`);
      if (n.to === s.id) err(`${at}.next[${j}].to`, "a step cannot point to itself");
      if (targets.has(n.to)) err(`${at}.next[${j}].to`, "Another answer already leads to this step: let each lead somewhere else.");
      targets.add(n.to);
    });
    if (s.type === "decision") {
      if (s.next.length < 2) err(`${at}.next`, "This decision needs at least two answers that lead somewhere.");
      if (s.next.some((n) => !n.label)) err(`${at}.next`, "Every answer of a decision needs a name, such as Approved or Rejected.");
    }
    if (cat && s.tool && !cat.tools.some((t) => t.id === s.tool))
      warn(`${at}.tool`, `"${s.tool}" is not in the tools list. Known tools: ${ids(cat.tools).join(", ") || "(none)"}`);
    if (s.type === "subprocess" && !s.subProcessId) err(`${at}.subProcessId`, "a subprocess step must name the process in subProcessId");
    if (s.subProcessId) {
      if (s.subProcessId === p.id) err(`${at}.subProcessId`, "a process cannot use itself as a sub-process");
      else if (known && !known.has(s.subProcessId)) warn(`${at}.subProcessId`, `no process with id "${s.subProcessId}" exists yet`);
    }
    if (s.actor === "me" && s.type !== "wait" && !s.instructions?.length && !s.subProcessId)
      warn(`${at}.instructions`, "Say exactly what the reader does in this step.");
  });

  p.prerequisites.forEach((q, i) => {
    if (q.processId === p.id) err(`prerequisites[${i}].processId`, "a process cannot be its own prerequisite");
    else if (q.processId && known && !known.has(q.processId)) warn(`prerequisites[${i}].processId`, `no process with id "${q.processId}" exists yet`);
  });

  p.actors.forEach((a, i) => {
    if (!usedActors.has(a.id) && a.id !== "me") warn(`actors[${i}]`, `actor "${a.name}" has no steps`);
  });

  // reachability from the first step
  const byId = new Map(p.steps.map((s) => [s.id, s]));
  const reached = new Set<string>();
  const stack = [p.steps[0].id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const n of byId.get(id)?.next ?? []) if (byId.has(n.to)) stack.push(n.to);
  }
  p.steps.forEach((s, i) => {
    if (!reached.has(s.id)) warn(`steps[${i}]`, `"${s.title}" cannot be reached from the first step`);
  });
  if (!p.steps.some((s) => s.next.length === 0)) warn("steps", "the process never ends - at least one step should have an empty next list");

  return issues;
}

export function validateCatalog(data: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!validateCatalogSchema(data)) {
    for (const e of validateCatalogSchema.errors ?? []) issues.push({ level: "error", path: prettyPath(e.instancePath), message: describe(e) });
    return issues;
  }
  const c = data as unknown as Catalog;
  // ids are unique within one list; a team, a practice and a platform may share one
  (["tiers", "environments", "languages", "teams", "practices", "platforms", "categories", "tools"] as const).forEach((key) => {
    const seen = new Set<string>();
    (c[key] ?? []).forEach((x, i) => {
      if (seen.has(x.id)) issues.push({ level: "error", path: `${key}[${i}].id`, message: `duplicate id "${x.id}"` });
      seen.add(x.id);
    });
  });
  return issues;
}

/**
 * Full check of a standard: JSON schema first, then references, uniqueness and the rules that
 * make it usable by people and by review agents.
 */
export function validateStandard(data: unknown, ctx: CheckContext = {}): Issue[] {
  const issues: Issue[] = [];
  if (!validateStandardSchema(data)) {
    const seen = new Set<string>();
    for (const e of validateStandardSchema.errors ?? []) {
      const issue: Issue = { level: "error", path: prettyPath(e.instancePath), message: describe(e) };
      const key = issue.path + issue.message;
      if (!seen.has(key)) { seen.add(key); issues.push(issue); }
    }
    return issues;
  }
  const s = data as unknown as Standard;
  const err = (path: string, message: string) => issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });
  const cat = ctx.catalog;
  const processes = ctx.processIds ? new Set(ctx.processIds) : null;
  const standards = ctx.standardIds ? new Set(ctx.standardIds) : null;
  const ids = (list: { id: string }[]) => list.map((x) => x.id);
  const active = (s.status ?? "active") === "active";

  // dims checks one of tiers / languages / environments, on the standard or on a requirement
  const dims = (at: string, holder: { tiers?: string[]; languages?: string[]; environments?: string[] }, parent?: Standard) => {
    (["tiers", "languages", "environments"] as const).forEach((key) => {
      (holder[key] ?? []).forEach((id, i) => {
        if (cat && !cat[key].some((x) => x.id === id)) err(`${at}${key}[${i}]`, `"${id}" is not known. Known ${key}: ${ids(cat[key]).join(", ") || "(none)"}`);
        else if (parent?.[key]?.length && !parent[key]!.includes(id)) warn(`${at}${key}[${i}]`, `"${id}" is outside what the standard itself applies to, so this requirement would never apply there`);
      });
    });
  };
  dims("", s);

  if (cat) {
    if (!cat.teams.some((t) => t.id === s.owner)) warn("owner", `"${s.owner}" is not in the teams list. Known teams: ${ids(cat.teams).join(", ") || "(none)"}`);
    checkBelongs(s, cat, err);
  }
  if (s.replacedBy) {
    if (s.replacedBy === s.id) err("replacedBy", "a standard cannot replace itself");
    else if (standards && !standards.has(s.replacedBy)) warn("replacedBy", `no standard with id "${s.replacedBy}" exists yet`);
    if (s.status !== "deprecated") warn("replacedBy", "replacedBy only makes sense when status is \"deprecated\"");
  }
  if (active && !s.review) warn("review", "no review interval is set - the owner team will never be asked to confirm this standard is still correct");
  if (s.review?.lastReviewedAt && !isDate(s.review.lastReviewedAt)) err("review.lastReviewedAt", `"${s.review.lastReviewedAt}" is not a date`);
  if (s.exceptionProcessId && processes && !processes.has(s.exceptionProcessId)) warn("exceptionProcessId", `no process with id "${s.exceptionProcessId}" exists yet`);

  const seen = new Set<string>();
  s.requirements.forEach((r, i) => {
    const at = `requirements[${i}]`;
    if (seen.has(r.id)) err(`${at}.id`, `duplicate requirement id "${r.id}"`);
    seen.add(r.id);
    dims(`${at}.`, r, s);
    if (r.processId && processes && !processes.has(r.processId)) warn(`${at}.processId`, `no process with id "${r.processId}" exists yet`);
    if (r.verification.method === "review" && !r.review?.lookFor.length)
      warn(`${at}.review`, "Say what a reviewer should look for, or it cannot be checked in pull requests.");
    if (r.level === "must" && !r.rationale && !r.guidance?.length)
      warn(`${at}.guidance`, "Say why this rule matters, or how to comply with it.");
  });
  return issues;
}

// ---------- can it be drawn?

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(isStr));
const STEP_KINDS = new Set<string>((schema as any).$defs.step.properties.type.enum);

/**
 * True when the data has enough shape for the map and the checklist to draw it. This is much
 * weaker than "valid": a name that is too short or an unknown actor is a problem to fix in the
 * normal editor, not a reason to fall back to the JSON tab.
 */
export function isDrawableProcess(data: unknown): boolean {
  if (!isObj(data) || !isStr(data.id) || !isStr(data.title) || !isStr(data.summary)) return false;
  const { actors, steps, prerequisites } = data;
  if (!Array.isArray(actors) || !actors.length || !actors.every((a) => isObj(a) && isStr(a.id) && isStr(a.name))) return false;
  if (!Array.isArray(prerequisites) || !prerequisites.every((q) => isObj(q) && isStr(q.title))) return false;
  if (!strings(data.tiers) || !strings(data.languages) || !strings(data.environments) || !strings(data.standards) || !strings(data.tags)) return false;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) =>
    isObj(s) && isStr(s.id) && isStr(s.title) && isStr(s.actor) && isStr(s.type) && STEP_KINDS.has(s.type) && strings(s.instructions) &&
    Array.isArray(s.next) && s.next.every((n) => isObj(n) && isStr(n.to)) &&
    (s.resources === undefined || (Array.isArray(s.resources) && s.resources.every((r) => isObj(r) && isStr(r.title) && isStr(r.url)))));
}

/** The same for a standard and its requirements. */
export function isDrawableStandard(data: unknown): boolean {
  if (!isObj(data) || !isStr(data.id) || !isStr(data.title) || !isStr(data.summary) || !isStr(data.owner)) return false;
  if (!strings(data.tiers) || !strings(data.languages) || !strings(data.environments) || !strings(data.tags)) return false;
  const reqs = data.requirements;
  return Array.isArray(reqs) && reqs.length > 0 && reqs.every((r) =>
    isObj(r) && isStr(r.id) && isStr(r.title) && isStr(r.statement) && ["must", "should", "may"].includes(r.level as string) &&
    isObj(r.verification) && ["automated", "review", "manual"].includes(r.verification.method as string) &&
    strings(r.guidance) && strings(r.tiers) && strings(r.languages) && strings(r.environments) &&
    (r.examples === undefined || (isObj(r.examples) && strings(r.examples.good) && strings(r.examples.bad))) &&
    (r.review === undefined || (isObj(r.review) && Array.isArray(r.review.lookFor) && r.review.lookFor.every(isStr) && strings(r.review.paths))));
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");

/** Pull a JSON object out of an LLM answer (tolerates ```json fences and chatter around it). */
export function extractJson(text: string): { value?: unknown; error?: string } {
  let t = text.trim();
  if (!t) return { error: "Nothing pasted yet." };
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last <= first) return { error: "No JSON object found. The answer must contain one { ... } block." };
  try {
    return { value: JSON.parse(t.slice(first, last + 1)) };
  } catch (e) {
    return { error: `This is not valid JSON: ${(e as Error).message}` };
  }
}
