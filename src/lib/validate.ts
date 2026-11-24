import type { ErrorObject } from "ajv";
import schema from "../../schema/process.schema.json";
import standardSchema from "../../schema/standard.schema.json";
import type { Catalog, Issue, Process, Standard } from "../types";
import { isDate } from "./lifecycle";
// The checks for the three formats are generated from schema/*.schema.json by `npm run validators`.
// They are not built in the browser: that needs eval, which the app's security policy forbids.
import { validateCatalogDoc as validateCatalogSchema, validateProcessDoc as validateSchema, validateStandardDoc as validateStandardSchema } from "./validators.generated.js";

/** The kinds of step somebody does by hand: they say exactly what to do. */
export const NEEDS_ACTIONS = new Set<string>(["form", "code", "approval", "review", "communication", "meeting", "document", "verify", "task"]);

export interface CheckContext { processIds?: Iterable<string>; standardIds?: Iterable<string>; catalog?: Catalog }

export { schema as processSchema, standardSchema };

/** The value an error is about, by its JSON pointer ("/steps/0/title"). */
function at(data: unknown, pointer: string): unknown {
  let v: unknown = data;
  for (const part of pointer.split("/").slice(1)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return v;
}

/** A schema error in words; a text that is too short but has nothing in it yet "is empty". */
function message(e: ErrorObject, data: unknown): string {
  if (e.keyword === "minLength") { const v = at(data, e.instancePath); if (typeof v === "string" && !v.trim()) return "is empty"; }
  return describe(e);
}

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
          : String(e.params.pattern).includes("@")
          ? "must be an email address"
          : `must match the pattern ${e.params.pattern}`;
    case "type": return `must be of type ${e.params.type}`;
    case "minLength": return e.params.limit === 1 ? "is empty" : `is too short (minimum ${e.params.limit} characters)`;
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
    if (id && !known(list).includes(id)) err(field, `“${id}” is not one of the ${plural}${known(list).length ? "" : " (the list is empty)"}. Choose one of the list under “What it belongs to”.`);
  };
  one("category", cat.categories, "category", "categories");
  one("practice", cat.practices, "practice", "practices");
  one("platform", cat.platforms, "platform", "platforms");
}

/**
 * The paths a process or standard is for must be in the list of paths, like a tier. The server
 * refuses a save that names one that is not.
 */
function checkPaths(doc: { paths?: string[] }, cat: Catalog, err: (path: string, message: string) => void) {
  (doc.paths ?? []).forEach((id, i) => {
    if (!(cat.paths ?? []).some((x) => x.id === id)) err(`paths[${i}]`, `“${id}” is not one of the paths. Remove it under “Which path it is for”.`);
  });
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
      const issue: Issue = { level: "error", path: prettyPath(e.instancePath), message: message(e, data) };
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

  if (cat) {
    if (p.owner && !cat.teams.some((t) => t.id === p.owner))
      warn("owner", `The owning team “${p.owner}” is not in the list of teams. Choose one of the list.`);
    checkBelongs(p, cat, err);
    checkPaths(p, cat, err);
    (p.tiers ?? []).forEach((tier, i) => {
      if (!cat.tiers.some((t) => t.id === tier)) err(`tiers[${i}]`, `“${tier}” is not one of the application tiers. Remove it under “Where it applies”.`);
    });
    (p.languages ?? []).forEach((lang, i) => {
      if (!cat.languages.some((l) => l.id === lang)) err(`languages[${i}]`, `“${lang}” is not one of the languages. Remove it under “Where it applies”.`);
    });
    (p.environments ?? []).forEach((env, i) => {
      if (!cat.environments.some((x) => x.id === env)) err(`environments[${i}]`, `“${env}” is not one of the environments. Remove it under “Where it applies”.`);
    });
    p.actors.forEach((a, i) => {
      if (a.teamId && !cat.teams.some((t) => t.id === a.teamId)) warn(`actors[${i}].teamId`, `${a.name?.trim() || "A participant"} stands for a team that is no longer in the list of teams.`);
    });
  }

  if (p.replacedBy) {
    if (p.replacedBy === p.id) err("replacedBy", "A process cannot replace itself: choose another one under “Use instead”.");
    else if (known && !known.has(p.replacedBy)) warn("replacedBy", "The process under “Use instead” does not exist (yet).");
    if (p.status !== "deprecated") warn("replacedBy", "“Use instead” only counts for a retired process.");
  }
  if ((p.status ?? "active") === "active" && !p.review) warn("review", "No review rhythm is set, so the owning team is never asked to confirm the process is still right.");
  if (p.review?.lastReviewedAt && !isDate(p.review.lastReviewedAt)) err("review.lastReviewedAt", `The date of the last review, “${p.review.lastReviewedAt}”, is not a date.`);
  if ((p.status ?? "active") === "active" && !p.owner) warn("owner", "Choose the owning team: it reviews the process and answers feedback.");

  const knownStandards = ctx.standardIds ? new Set(ctx.standardIds) : null;
  (p.standards ?? []).forEach((sid, i) => {
    if (knownStandards && !knownStandards.has(sid)) warn(`standards[${i}]`, `A standard it helps to meet (“${sid}”) does not exist (yet).`);
  });

  const actorIds = new Set<string>();
  p.actors.forEach((a, i) => {
    if (actorIds.has(a.id)) err(`actors[${i}].id`, `Two participants have the same id “${a.id}”: repair it in the JSON (More › JSON).`);
    actorIds.add(a.id);
  });

  const stepIds = new Set<string>();
  p.steps.forEach((s, i) => {
    if (stepIds.has(s.id)) err(`steps[${i}].id`, `Two steps have the same id “${s.id}”: repair it in the JSON (More › JSON).`);
    stepIds.add(s.id);
  });

  const usedActors = new Set<string>();
  p.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!actorIds.has(s.actor)) err(`${at}.actor`, "Who does it is not one of the participants: choose who does it.");
    usedActors.add(s.actor);
    const targets = new Set<string>();
    s.next.forEach((n, j) => {
      if (!stepIds.has(n.to)) err(`${at}.next[${j}].to`, "This way on leads to a step that does not exist: choose where it goes.");
      if (n.to === s.id) err(`${at}.next[${j}].to`, "A step cannot lead to itself: choose another step.");
      if (targets.has(n.to)) err(`${at}.next[${j}].to`, "Another answer already leads to this step: let each lead somewhere else.");
      targets.add(n.to);
    });
    if (s.type === "decision") {
      if (s.next.length < 2) err(`${at}.next`, "This decision needs at least two answers that lead somewhere.");
      if (s.next.some((n) => !n.label)) err(`${at}.next`, "Every answer of a decision needs a name, such as Approved or Rejected.");
    }
    if (cat && s.tool && !cat.tools.some((t) => t.id === s.tool))
      warn(`${at}.tool`, `The tool “${s.tool}” is not in the list of tools: choose one of the list.`);
    if (s.type === "subprocess" && !s.subProcessId) err(`${at}.subProcessId`, "A sub-process step needs the process it stands for: choose it under “Explained by sub-process”.");
    if (s.subProcessId) {
      if (s.subProcessId === p.id) err(`${at}.subProcessId`, "A process cannot be its own sub-process.");
      else if (known && !known.has(s.subProcessId)) warn(`${at}.subProcessId`, "The sub-process does not exist (yet).");
    }
    // one rule for every step: a step the reader does by hand says exactly what to do; a decision,
    // a wait, an automated step and a sub-process need no actions, and what other participants do
    // is theirs to know (their steps say what happens, not how)
    if (s.actor === "me" && NEEDS_ACTIONS.has(s.type) && !s.instructions?.length && !s.subProcessId)
      warn(`${at}.instructions`, "Say exactly what the reader does in this step.");
  });

  p.prerequisites.forEach((q, i) => {
    if (q.processId === p.id) err(`prerequisites[${i}].processId`, "A process cannot be needed before itself: choose another process that provides it.");
    else if (q.processId && known && !known.has(q.processId)) warn(`prerequisites[${i}].processId`, "The process that provides it does not exist (yet).");
  });

  p.actors.forEach((a, i) => {
    if (!usedActors.has(a.id) && a.id !== "me") warn(`actors[${i}]`, `${a.name?.trim() || `Participant ${i + 1}`} takes part but has no steps.`);
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
    if (!reached.has(s.id)) warn(`steps[${i}]`, `${s.title?.trim() ? `“${s.title.trim()}”` : `Step ${i + 1}`} cannot be reached from the first step: let an earlier step lead to it.`);
  });
  if (!p.steps.some((s) => s.next.length === 0)) warn("steps", "The process never ends: let at least one step have nothing after it.");

  return issues;
}

/** The lists in the order the lists document has them, each with what one entry and several are called. */
export const LIST_WORDS = {
  tiers: { one: "tier", many: "tiers" }, paths: { one: "path", many: "paths" }, environments: { one: "environment", many: "environments" }, languages: { one: "language", many: "languages" },
  teams: { one: "team", many: "teams" }, practices: { one: "practice", many: "practices" }, platforms: { one: "platform", many: "platforms" },
  categories: { one: "category", many: "categories" }, tools: { one: "tool", many: "tools" },
} as const;

/**
 * Full check of the lists: the schema, then ids that must be unique within one list. Schema
 * problems keep the checker's path and message (`issueText` with "lists" words them, naming the
 * entry); the rest are whole sentences already.
 */
export function validateCatalog(data: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!validateCatalogSchema(data)) {
    const seen = new Set<string>();
    for (const e of validateCatalogSchema.errors ?? []) {
      const issue: Issue = { level: "error", path: prettyPath(e.instancePath), message: message(e, data) };
      const key = issue.path + issue.message;
      if (!seen.has(key)) { seen.add(key); issues.push(issue); }
    }
    return issues;
  }
  const c = data as unknown as Catalog;
  // ids are unique within one list; a team, a practice and a platform may share one
  (Object.keys(LIST_WORDS) as (keyof typeof LIST_WORDS)[]).forEach((key) => {
    const first = new Map<string, string>();
    (c[key] ?? []).forEach((x, i) => {
      if (first.has(x.id)) issues.push({ level: "error", path: `${key}[${i}].id`, message: duplicateSentence(key, x.id, first.get(x.id)!, x.name) });
      else first.set(x.id, x.name);
    });
  });
  return issues;
}

/**
 * Two entries of one list with the same id, as the server says it too (`docs.Check`): "Two tools
 * have the id “terraform” (“Terraform” and “Terraform Cloud”): remove one of them." (", both called
 * “Terraform”" when their names are the same too). An id is made
 * once from the name and never changes, so removing one is what can be done on the page.
 */
export function duplicateSentence(key: keyof typeof LIST_WORDS, id: string, a: string, b: string): string {
  const names = [a, b].map((n) => (typeof n === "string" ? n.trim() : ""));
  const both = !names.every(Boolean) ? "" : names[0] === names[1] ? `, both called “${names[0]}”` : ` (“${names[0]}” and “${names[1]}”)`;
  return `Two ${LIST_WORDS[key].many} have the id “${id}”${both}: remove one of them.`;
}

/**
 * The problems of a save the server refused, as the app's own checker would have found them, so
 * that `issueText` words them alike: the format's ("does not match the format: /teams/3/name:
 * minLength: got 0, want 1; …") and the checker's ("teams[2].id: …"), each by its place. `more`:
 * how many the server left out ("(and 2 more)"). Null when the refusal is not a list of problems
 * (it is shown as it is).
 */
export function refusalIssues(error: string): { issues: Issue[]; more: number } | null {
  let text = (typeof error === "string" ? error : "").trim();
  const format = text.startsWith("does not match the format: ");
  if (format) text = text.slice("does not match the format: ".length);
  let more = 0;
  const tail = text.match(/ \(and (\d+) more\)$/);
  if (tail) { more = Number(tail[1]); text = text.slice(0, -tail[0].length); }
  const parts = text.split("; ").map((part) => {
    const m = part.match(/^(\/[^:\s]*|[A-Za-z$]+(?:\[\d+\])?(?:\.[A-Za-z$]+(?:\[\d+\])?)*): (.+)$/s);
    if (m) return { level: "error" as const, path: m[1].startsWith("/") ? prettyPath(m[1] === "/" ? "" : m[1]) : m[1], message: serverMessage(m[2]) };
    // a whole sentence of the server's checker ("The group email of the team “X” is not an email address.")
    return /^[A-Z“]/.test(part) ? { level: "error" as const, path: "", message: part } : null;
  });
  if (!text || parts.some((p) => p === null)) return null;
  return { issues: parts as Issue[], more };
}

/** A message of the server's format check in the words of the app's own (`describe`). */
function serverMessage(m: string): string {
  let x: RegExpMatchArray | null;
  if ((x = m.match(/^minLength: got (\d+), want (\d+)/))) return x[1] === "0" ? "is empty" : `is too short (minimum ${x[2]} characters)`;
  if ((x = m.match(/^maxLength: got \d+, want (\d+)/))) return `is too long (maximum ${x[1]} characters)`;
  if ((x = m.match(/^missing propert(?:y|ies) '([^']+)'/))) return `is missing the required field "${x[1]}"`;
  if ((x = m.match(/^additional properties '([^']+)'/))) return `has a field "${x[1]}" that the schema does not allow - remove or rename it`;
  if ((x = m.match(/does not match pattern '(.*)'$/s))) return describe({ keyword: "pattern", params: { pattern: x[1].replace(/\\\\/g, "\\") } } as unknown as ErrorObject);
  if ((x = m.match(/^got (\w+), want (.+)$/))) return `must be of type ${x[2]}`;
  return m;
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
      const issue: Issue = { level: "error", path: prettyPath(e.instancePath), message: message(e, data) };
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
  const active = (s.status ?? "active") === "active";

  // dims checks one of tiers / languages / environments, on the standard or on a requirement
  const dims = (at: string, holder: { tiers?: string[]; languages?: string[]; environments?: string[] }, parent?: Standard) => {
    (["tiers", "languages", "environments"] as const).forEach((key) => {
      (holder[key] ?? []).forEach((id, i) => {
        if (cat && !cat[key].some((x) => x.id === id)) err(`${at}${key}[${i}]`, `“${id}” is not one of the ${key === "tiers" ? "application tiers" : key}. Remove it under “Where it applies”.`);
        else if (parent?.[key]?.length && !parent[key]!.includes(id)) warn(`${at}${key}[${i}]`, `“${cat?.[key].find((x) => x.id === id)?.name ?? id}” is outside where the standard itself applies, so this requirement would never apply there.`);
      });
    });
  };
  dims("", s);

  if (cat) {
    if (!cat.teams.some((t) => t.id === s.owner)) warn("owner", `The team that issues it (“${s.owner}”) is not in the list of teams. Choose one of the list.`);
    checkBelongs(s, cat, err);
    checkPaths(s, cat, err);
  }
  if (s.replacedBy) {
    if (s.replacedBy === s.id) err("replacedBy", "A standard cannot replace itself: choose another one under “Use instead”.");
    else if (standards && !standards.has(s.replacedBy)) warn("replacedBy", "The standard under “Use instead” does not exist (yet).");
    if (s.status !== "deprecated") warn("replacedBy", "“Use instead” only counts for a retired standard.");
  }
  if (active && !s.review) warn("review", "No review rhythm is set, so the team that issues it is never asked to confirm the standard is still right.");
  if (s.review?.lastReviewedAt && !isDate(s.review.lastReviewedAt)) err("review.lastReviewedAt", `The date of the last review, “${s.review.lastReviewedAt}”, is not a date.`);
  if (s.exceptionProcessId && processes && !processes.has(s.exceptionProcessId)) warn("exceptionProcessId", "The process for asking for an exception does not exist (yet).");

  const seen = new Set<string>();
  s.requirements.forEach((r, i) => {
    const at = `requirements[${i}]`;
    if (seen.has(r.id)) err(`${at}.id`, `Two requirements have the id ${r.id}: give this one another id.`);
    seen.add(r.id);
    dims(`${at}.`, r, s);
    if (r.processId && processes && !processes.has(r.processId)) warn(`${at}.processId`, "The process that helps to comply does not exist (yet).");
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
  if (!strings(data.paths) || !strings(data.tiers) || !strings(data.languages) || !strings(data.environments) || !strings(data.standards) || !strings(data.tags)) return false;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) =>
    isObj(s) && isStr(s.id) && isStr(s.title) && isStr(s.actor) && isStr(s.type) && STEP_KINDS.has(s.type) && strings(s.instructions) &&
    Array.isArray(s.next) && s.next.every((n) => isObj(n) && isStr(n.to)) &&
    (s.resources === undefined || (Array.isArray(s.resources) && s.resources.every((r) => isObj(r) && isStr(r.title) && isStr(r.url)))));
}

/** The same for a standard and its requirements. */
export function isDrawableStandard(data: unknown): boolean {
  if (!isObj(data) || !isStr(data.id) || !isStr(data.title) || !isStr(data.summary) || !isStr(data.owner)) return false;
  if (!strings(data.paths) || !strings(data.tiers) || !strings(data.languages) || !strings(data.environments) || !strings(data.tags)) return false;
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
