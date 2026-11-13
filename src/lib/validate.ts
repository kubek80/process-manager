import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "../../schema/process.schema.json";
import type { Issue, Process } from "../types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

export { schema as processSchema };

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
 * Full check of a process: JSON schema first, then the rules a schema cannot express
 * (references, uniqueness, reachability). `knownIds` enables sub-process reference checks.
 */
export function validateProcess(data: unknown, knownIds?: Iterable<string>): Issue[] {
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
  const known = knownIds ? new Set(knownIds) : null;

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
      if (targets.has(n.to)) err(`${at}.next[${j}].to`, `"${n.to}" is listed twice`);
      targets.add(n.to);
    });
    if (s.type === "decision") {
      if (s.next.length < 2) err(`${at}.next`, "a decision needs at least two outgoing paths");
      if (s.next.some((n) => !n.label)) err(`${at}.next`, "every path out of a decision needs a label (e.g. \"Approved\" / \"Rejected\")");
    }
    if (s.type === "subprocess" && !s.subProcessId) err(`${at}.subProcessId`, "a subprocess step must name the process in subProcessId");
    if (s.subProcessId) {
      if (s.subProcessId === p.id) err(`${at}.subProcessId`, "a process cannot use itself as a sub-process");
      else if (known && !known.has(s.subProcessId)) warn(`${at}.subProcessId`, `no process with id "${s.subProcessId}" exists yet`);
    }
    if (s.actor === "me" && s.type !== "wait" && !s.instructions?.length && !s.subProcessId)
      warn(`${at}.instructions`, `"${s.title}" is done by the reader but has no instructions - say exactly what to do`);
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
