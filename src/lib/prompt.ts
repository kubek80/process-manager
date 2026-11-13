import schema from "../../schema/process.schema.json";
import example from "../../schema/example.process.json";
import { STEP_META, STEP_TYPES } from "./stepMeta";
import type { Catalog, Issue, Process } from "../types";

export interface KnownProcess { id: string; title: string }

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The instruction block. It is model-agnostic on purpose: it works when pasted into
 * Gemini, ChatGPT, Copilot or Claude in a browser, with no tools or file access.
 */
export function basePrompt(known: KnownProcess[] = [], catalog?: Catalog): string {
  const list = (rows: { id: string; name: string }[] = []) => (rows.length ? rows.map((r) => `- "${r.id}" - ${r.name}`).join("\n") : "- (none yet)");
  const types = STEP_TYPES.map((t) => `- "${t}" (${STEP_META[t].label}): ${STEP_META[t].when}`).join("\n");
  const knownList = known.length
    ? known.map((k) => `- "${k.id}" - ${k.title}`).join("\n")
    : "- (none yet)";
  return `# ROLE
You are a business analyst who converts descriptions of company processes into a strict JSON format used by the "Process Manager" tool. The JSON is rendered as a swim-lane diagram and as a step-by-step checklist, so it must be precise and complete.

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

B. OWNER AND TIERS
- "owner": the id of the team that owns the process, ONLY from the TEAMS list below. If unknown or not on the list, leave it out.
- "tiers": the ids of the application tiers the process applies to, ONLY from the TIERS list below. If the text does not restrict the process to certain tiers, leave "tiers" out (that means: all tiers).

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
- Every decision has 2+ labelled paths. Every "subprocess" step has "subProcessId".
- "owner", "teamId", "tool" and "tiers" only use ids from the lists below.
- All ids are kebab-case. No field outside the schema.

# EXISTING PROCESSES (usable in "subProcessId" and prerequisite "processId")
${knownList}

# TEAMS (usable in "owner" and actor "teamId")
${list(catalog?.teams)}

# TOOLS (usable in step "tool")
${list(catalog?.tools)}

# TIERS (usable in "tiers")
${list(catalog?.tiers)}

# JSON SCHEMA
\`\`\`json
${JSON.stringify(schema)}
\`\`\`

# EXAMPLE OF A CORRECT ANSWER
(The ids in the example are illustrative. For "owner", "teamId", "tool" and "tiers" use only the lists above.)
\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`
`;
}

export function createPrompt(text: string, known: KnownProcess[], catalog?: Catalog): string {
  return `${basePrompt(known, catalog)}
# YOUR TASK
Convert the following process description into the JSON format. Follow all rules above.

--- PROCESS DESCRIPTION START ---
${text.trim() || "(paste the process description here)"}
--- PROCESS DESCRIPTION END ---
`;
}

export function modifyPrompt(process: Process, request: string, known: KnownProcess[], catalog?: Catalog): string {
  return `${basePrompt(known.filter((k) => k.id !== process.id), catalog)}
# YOUR TASK
Below is an existing process in the JSON format, followed by a change request. Apply the change and return the COMPLETE updated JSON (not a diff). Keep the "id" of the process and keep the ids of steps that are not affected. Change nothing that the request does not ask for.

--- CURRENT PROCESS JSON START ---
${JSON.stringify(process, null, 2)}
--- CURRENT PROCESS JSON END ---

--- CHANGE REQUEST START ---
${request.trim() || "(describe the change here)"}
--- CHANGE REQUEST END ---
`;
}

/** Follow-up message for the same chat when the checker found problems. */
export function fixPrompt(issues: Issue[], parseError?: string): string {
  const list = parseError
    ? `- ${parseError}`
    : issues.map((i) => `- [${i.level}] ${i.path}: ${i.message}`).join("\n");
  return `The JSON you returned did not pass the Process Manager checker. Fix every problem below and return the COMPLETE corrected JSON again, as one \`\`\`json code block and nothing else. Do not change anything that is not needed for the fix.

Problems found:
${list}
`;
}
