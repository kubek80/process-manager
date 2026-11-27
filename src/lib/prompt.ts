import schema from "../../schema/process.schema.json";
import example from "../../schema/example.process.json";
import { STEP_META, STEP_TYPES } from "./stepMeta";
import standardSchema from "../../schema/standard.schema.json";
import standardExample from "../../schema/example.standard.json";
import type { Catalog, Issue, Process, Standard } from "../types";
// "updatedAt" is the person's own day, as the editing screen stamps it
import { today } from "./dates";

export interface KnownProcess { id: string; title: string }


/**
 * The instruction block. It is model-agnostic on purpose: it works when pasted into
 * Gemini, ChatGPT, Copilot or Claude in a browser, with no tools or file access.
 */
export function basePrompt(known: KnownProcess[] = [], catalog?: Catalog, standards: KnownProcess[] = []): string {
  const list = (rows: { id: string; name: string }[] = []) => (rows.length ? rows.map((r) => `- "${r.id}" - ${r.name}`).join("\n") : "- (none yet)");
  const types = STEP_TYPES.map((t) => `- "${t}" (${STEP_META[t].label}): ${[STEP_META[t].when, STEP_META[t].rule].filter(Boolean).join(" ")}`).join("\n");
  const knownList = known.length
    ? known.map((k) => `- "${k.id}" - ${k.title}`).join("\n")
    : "- (none yet)";
  return `# ROLE
You are a business analyst who converts descriptions of company processes into a strict JSON format used by the "Pattern Catalog" tool. The JSON is rendered as a swim-lane diagram and as a step-by-step checklist, so it must be precise and complete.

# OUTPUT RULES (very important)
1. Answer with ONE JSON object inside ONE \`\`\`json code block. No text before or after it.
2. The JSON must be valid against the JSON SCHEMA below. Do not add fields that are not in the schema. No comments, no trailing commas.
3. Never invent facts. If the text does not give a link, a duration, a tool or a name, leave that optional field out.
4. If something essential is unclear (for example who performs a step), make the most reasonable assumption and continue. Do not ask questions.
5. Write all texts in the same language as the source text. Ids are always English-style kebab-case (lowercase letters, digits, dashes).

# HOW TO MODEL A PROCESS
Think in this order:

A. ACTORS (the swim lanes)
- The FIRST actor is ALWAYS { "id": "me", "name": "You" }: the person who reads the process and wants something done (the requester).
- Add one actor per other person, team or system that does work, e.g. "Line manager", "Cloud Platform team", "Deployment pipeline".
- Every step belongs to exactly one actor. Whenever the text says "you", "the requester", "the developer", "the applicant", use "me".

- When an actor is one of the TEAMS listed below, set its "teamId" to that team's id and use the team's name as "name".

B. OWNER, WHAT IT BELONGS TO, AND WHERE IT APPLIES
- "owner": the id of the team that maintains the process, ONLY from the TEAMS list below. If unknown or not on the list, leave it out.
- "category": the id of the category it is grouped under, ONLY from the CATEGORIES list below. Pick the closest one; leave it out if none fits.
- "platform": the id of the platform the process is about (the system or service it gives access to or changes), ONLY from the PLATFORMS list below. Leave it out if it is not about one platform.
- "practice": the id of the practice whose way of working it describes, ONLY from the PRACTICES list below. Leave it out if no practice is named or obvious.
- "rigour": how binding the process is. "mandatory" when the text says this is the only allowed way (must, required, only way). "recommended" when it is the expected way but another way is allowed with a good reason (should, recommended). "optional" when it is a help that may be used (may, can, optional). Leave it out when the text does not say.
- "paths": the ids of the paths the process is meant for, ONLY from the PATHS list below: for example greenfield when it is about building something new, brownfield when it changes or moves something that already exists, the paved path (also called the golden path) when it is the ready-made, supported way. Name paths ONLY when the process is meant only for that kind of work; a process that everyone follows names none. If the text does not say, leave "paths" out (that means: whatever the path).
- "patterns": the ids of the architecture patterns the process is about, ONLY from the ARCHITECTURE PATTERNS list below, for example event-driven when it is about systems that react to events. It is a tag for readers who build systems that way, not a limit. Name one ONLY when the process is truly about systems built that way; most processes name none. Leave "patterns" out when the text does not say.
- "tiers": the ids of the application tiers the process applies to, ONLY from the TIERS list below. If the text does not restrict the process to certain tiers, leave "tiers" out (that means: all tiers).

- "environments": the ids of the environments the process applies to, ONLY from the ENVIRONMENTS list below. If the text does not restrict it, leave "environments" out (that means: all environments).
- "standards": the ids of the standards this process helps to meet, ONLY from the EXISTING STANDARDS list below. Leave out if none.
- "languages": the ids of the programming languages the process is specific to, ONLY from the LANGUAGES list below. If the process does not depend on the language, leave "languages" out.
- "status": use "draft" for a new process, so that an editor reviews it before consumers see it. Add "review": { "intervalMonths": 6 } unless the text names another review rhythm. Never invent "lastReviewedAt".
- "resources": links named in the text that help to do or automate the work. Use kind "skill" for instructions an AI assistant can run in self-service, "repository", "template", "documentation" or "other". Put a link on the step it belongs to (step "resources") when it helps with one step only.

C. PREREQUISITES
- Everything that must exist BEFORE the first step: accounts, approvals, budgets, documents, access rights, other finished processes.
- If a prerequisite is produced by one of the EXISTING PROCESSES listed below, set "processId" to its id.

D. STEPS
- One step = one action by one actor. Split "fill in the form and wait for approval" into a "form" step (me) and an "approval" step (approver).
- "title": short imperative phrase, max 70 characters, e.g. "Fill in the ServiceNow request".
- "type": choose the best fitting block type:
${types}
- "instructions": for steps done by "me", list the exact actions, one per item, with concrete field names, values and commands from the text. This is what the reader will follow, so be specific.
- "description": only for context that is not an action (why, what happens).
- "tool": the id of the system used, ONLY from the TOOLS list below. If the tool in the text is not on the list, leave "tool" out and name the tool in "description".
- "outcome": what exists after the step (ticket number, pull request, access).
- "subProcessId": when a step is fully explained by one of the EXISTING PROCESSES, use type "subprocess" and set "subProcessId" to its id instead of repeating its steps.
- "service": when a step asks another team for one of the SERVICES listed below (for example a DNS record change), use type "service" for a step of "me", set "service" to its id and do not repeat its front-door form in "url". Only a "service" step has "service".

E. FLOW ("next")
- "next" lists the steps that follow. The first step in "steps" is the start. A step with "next": [] ends the process. At least one step must end the process.
- A "decision" step is a question (title ends with "?") and has two or more "next" entries, each with a "label" such as "Approved" / "Rejected" or "Yes" / "No".
- After a rejection, model the correction loop: a step for "me" to fix things, whose "next" points back to the approval or review step.
- Work that happens in parallel: put several entries in "next" without labels.
- Every "next.to" and every "actor" must reference an id that exists. Ids must be unique.

# SELF-CHECK BEFORE ANSWERING
- schemaVersion is "1.0"; "updatedAt" is "${today()}".
- actors[0].id is "me".
- Every step has id, title, actor, type and next.
- Every step id used in "next.to" exists; every "actor" exists in "actors".
- Every decision has 2+ labelled paths. Every "subprocess" step has "subProcessId". Every "service" step has "service".
- "owner", "teamId", "category", "platform", "practice", "tool", "service", "paths", "patterns", "tiers", "environments", "languages" and "standards" only use ids from the lists below. "rigour" is "mandatory", "recommended" or "optional", or left out.
- All ids are kebab-case. No field outside the schema.

# EXISTING PROCESSES (usable in "subProcessId" and prerequisite "processId")
${knownList}

# TEAMS (usable in "owner" and actor "teamId")
${list(catalog?.teams)}

# CATEGORIES (usable in "category")
${list(catalog?.categories)}

# PLATFORMS (usable in "platform")
${list(catalog?.platforms)}

# PRACTICES (usable in "practice")
${list(catalog?.practices)}

# TOOLS (usable in step "tool")
${list(catalog?.tools)}

# SERVICES (usable in step "service", with type "service")
${list((catalog?.services ?? []).map((s) => ({ id: s.id, name: s.summary ? `${s.name}: ${s.summary}` : s.name })))}

# PATHS (usable in "paths")
${list(catalog?.paths)}

# ARCHITECTURE PATTERNS (usable in "patterns")
${list(catalog?.patterns)}

# TIERS (usable in "tiers")
${list(catalog?.tiers)}

# ENVIRONMENTS (usable in "environments")
${list(catalog?.environments)}

# LANGUAGES (usable in "languages")
${list(catalog?.languages)}

# EXISTING STANDARDS (usable in "standards")
${standards.length ? standards.map((k) => `- "${k.id}" - ${k.title}`).join("\n") : "- (none yet)"}

# JSON SCHEMA
\`\`\`json
${JSON.stringify(schema)}
\`\`\`

# EXAMPLE OF A CORRECT ANSWER
(The ids in the example are illustrative. For "owner", "teamId", "category", "platform", "practice", "tool", "paths", "patterns", "tiers" and "languages" use only the lists above.)
\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`
`;
}

export function createPrompt(text: string, known: KnownProcess[], catalog?: Catalog, standards: KnownProcess[] = []): string {
  return `${basePrompt(known, catalog, standards)}
# YOUR TASK
Convert the following process description into the JSON format. Follow all rules above.

--- PROCESS DESCRIPTION START ---
${text.trim() || "(paste the process description here)"}
--- PROCESS DESCRIPTION END ---
`;
}

export function modifyPrompt(process: Process, request: string, known: KnownProcess[], catalog?: Catalog, standards: KnownProcess[] = []): string {
  return `${basePrompt(known.filter((k) => k.id !== process.id), catalog, standards)}
# YOUR TASK
Below is an existing process in the JSON format, followed by a change request. Apply the change and return the COMPLETE updated JSON (not a diff). Keep the "id", "status" and "review" of the process and keep the ids of steps that are not affected. Change nothing that the request does not ask for.

--- CURRENT PROCESS JSON START ---
${JSON.stringify(process, null, 2)}
--- CURRENT PROCESS JSON END ---

--- CHANGE REQUEST START ---
${request.trim() || "(describe the change here)"}
--- CHANGE REQUEST END ---
`;
}

/** The value at a checker path ("steps[2].next[0].to") in a document, or undefined. */
export function valueAt(doc: unknown, path: string): unknown {
  let at: unknown = doc;
  for (const m of path.matchAll(/([A-Za-z$]+)|\[(\d+)\]/g)) {
    if (at === null || typeof at !== "object") return undefined;
    at = m[1] !== undefined ? (at as Record<string, unknown>)[m[1]] : (at as unknown[])[Number(m[2])];
  }
  return at;
}

/** A value for the fix request: short, as JSON. */
const shown = (v: unknown) => {
  const t = JSON.stringify(v);
  return t === undefined ? "missing" : t.length > 120 ? `${t.slice(0, 117)}…` : t;
};

/**
 * Follow-up message for the same chat when the checker found problems: each with where it is, the
 * value that is wrong there (from `answer`, the JSON the chat returned) and what is wrong.
 */
export function fixPrompt(issues: Issue[], parseError?: string, answer?: unknown): string {
  const list = parseError
    ? `- ${parseError}`
    : issues.map((i) => {
      const value = answer !== undefined && i.path && i.path !== "(root)" && !/^is missing the required field/.test(i.message) ? ` (value now: ${shown(valueAt(answer, i.path))})` : "";
      return `- [${i.level}] ${i.path}${value}: ${i.message}`;
    }).join("\n");
  return `The JSON you returned did not pass the Pattern Catalog checker. Fix every problem below and return the COMPLETE corrected JSON again, as one \`\`\`json code block and nothing else. Do not change anything that is not needed for the fix.

Problems found:
${list}
`;
}

// ---------- standards

/** The instruction block for turning a policy or guideline text into a standard. */
export function standardBasePrompt(catalog?: Catalog, processes: KnownProcess[] = []): string {
  const list = (rows: { id: string; name: string }[] = []) => (rows.length ? rows.map((r) => `- "${r.id}" - ${r.name}`).join("\n") : "- (none yet)");
  return `# ROLE
You convert policies, guidelines and engineering rules into a strict JSON format used by the "Pattern Catalog" tool. Each standard becomes a readable document for engineers, a skill for AI coding assistants, and a checklist for an AI pull request reviewer, so every requirement must be precise and testable.

# OUTPUT RULES (very important)
1. Answer with ONE JSON object inside ONE \`\`\`json code block. No text before or after it.
2. The JSON must be valid against the JSON SCHEMA below. Do not add fields that are not in the schema. No comments, no trailing commas.
3. Never invent rules, numbers or deadlines that are not in the text. If the text is vague, keep the requirement at "should" and say in "statement" exactly what the text says.
4. Do not ask questions. Make the most reasonable assumption and continue.
5. Write all texts in the same language as the source text.

# HOW TO MODEL A STANDARD
A. THE STANDARD
- "title": short name of the topic, e.g. "Secure logging".
- "summary": what it protects or achieves, in one or two sentences.
- "owner": the id of the team that issues and maintains it, ONLY from the TEAMS list below. If the text does not say, pick the team that is closest to the subject.
- "category": the id of the category it is grouped under, ONLY from the CATEGORIES list below. Leave it out if none fits.
- "practice": the id of the practice that sets the rule (for example cyber security or engineering), ONLY from the PRACTICES list below. Leave it out if no practice is named or obvious.
- "platform": the id of the platform the standard is about, ONLY from the PLATFORMS list below. Leave it out when it applies whatever the platform.
- "scope": what it covers and what is out of scope, if the text says so.
- "paths": the ids of the paths the standard is meant for, ONLY from the PATHS list below (greenfield: building something new; brownfield: changing or moving something that exists; paved path, also called the golden path: the ready-made, supported way). Name paths ONLY when the standard is meant only for that kind of work; a rule that everyone follows names none. Leave it out when it applies whatever the path, which is the usual case. A requirement has no paths.
- "patterns": the ids of the architecture patterns the standard is about, ONLY from the ARCHITECTURE PATTERNS list below, for example microservices for rules about how services talk to each other. It is a tag for readers who build systems that way, not a limit. Name one ONLY when the standard is truly about systems built that way; a rule for everyone names none. A requirement has no patterns.
- "tiers", "languages", "environments": only when the WHOLE standard is limited to some; otherwise leave them out. Use ids from the lists below.
- "status": always "draft", so that the owner team reviews it before it is published. Add "review": { "intervalMonths": 12 } unless the text names another rhythm.
- "exceptionProcessId": the id of the process for asking for an exception, ONLY from the EXISTING PROCESSES list.

B. REQUIREMENTS (the core)
- One requirement = one rule that can be checked on its own. Split "encrypt data and rotate keys yearly" into two.
- "id": upper case, a short prefix for the standard plus a running number, e.g. "LOG-01", "LOG-02". Unique. Keep existing ids when changing a standard.
- "level": "must" for mandatory wording (must, shall, required, never, always), "should" for expected (should, recommended), "may" for optional. A standard has no "rigour" field: how binding it is follows from the levels of its requirements.
- "statement": the rule itself, testable, one or two sentences. No reasons here.
- "rationale": why the rule exists, if the text says.
- "guidance": how to comply, one concrete action per item.
- "examples": short "good" and "bad" examples, only if the text gives them or they are obvious and uncontroversial.
- "verification.method": "automated" if a tool or pipeline checks it, "review" if it is checked when code is reviewed, "manual" otherwise.
- "review": add it whenever a violation can be SEEN in a code or configuration change. "lookFor" lists concrete signs of a violation, phrased so a reviewer can spot them in a diff. "paths" are file patterns where it matters. Leave "review" out for rules that cannot be seen in a pull request (for example, deadlines or organisational duties).
- "tiers", "languages", "environments" on a requirement: only to NARROW it compared with the standard, e.g. a rule that applies in production only.
- "processId": a process from the EXISTING PROCESSES list that helps to meet the requirement.

# SELF-CHECK BEFORE ANSWERING
- schemaVersion is "1.0"; "status" is "draft"; "updatedAt" is "${today()}".
- Every requirement has id, title, level, statement and verification.
- Requirement ids are unique and upper case with dashes.
- "owner", "category", "practice", "platform", "paths", "patterns", "tiers", "languages", "environments", "processId" and "exceptionProcessId" only use ids from the lists below.
- No field outside the schema.

# TEAMS (usable in "owner")
${list(catalog?.teams)}

# CATEGORIES (usable in "category")
${list(catalog?.categories)}

# PRACTICES (usable in "practice")
${list(catalog?.practices)}

# PLATFORMS (usable in "platform")
${list(catalog?.platforms)}

# PATHS (usable in "paths")
${list(catalog?.paths)}

# ARCHITECTURE PATTERNS (usable in "patterns")
${list(catalog?.patterns)}

# TIERS
${list(catalog?.tiers)}

# ENVIRONMENTS
${list(catalog?.environments)}

# LANGUAGES
${list(catalog?.languages)}

# EXISTING PROCESSES (usable in "processId" and "exceptionProcessId")
${processes.length ? processes.map((k) => `- "${k.id}" - ${k.title}`).join("\n") : "- (none yet)"}

# JSON SCHEMA
\`\`\`json
${JSON.stringify(standardSchema)}
\`\`\`

# EXAMPLE OF A CORRECT ANSWER
(The ids in the example are illustrative. Use only the lists above.)
\`\`\`json
${JSON.stringify(standardExample, null, 2)}
\`\`\`
`;
}

export function createStandardPrompt(text: string, catalog?: Catalog, processes: KnownProcess[] = []): string {
  return `${standardBasePrompt(catalog, processes)}
# YOUR TASK
Convert the following text into a standard in the JSON format. Follow all rules above.

--- TEXT START ---
${text.trim() || "(paste the policy or guideline here)"}
--- TEXT END ---
`;
}

export function modifyStandardPrompt(standard: Standard, request: string, catalog?: Catalog, processes: KnownProcess[] = []): string {
  return `${standardBasePrompt(catalog, processes)}
# YOUR TASK
Below is an existing standard in the JSON format, followed by a change request. Apply the change and return the COMPLETE updated JSON (not a diff). Keep the "id", "status" and "review" of the standard and the ids of requirements that are not affected. Change nothing that the request does not ask for.

--- CURRENT STANDARD JSON START ---
${JSON.stringify(standard, null, 2)}
--- CURRENT STANDARD JSON END ---

--- CHANGE REQUEST START ---
${request.trim() || "(describe the change here)"}
--- CHANGE REQUEST END ---
`;
}
