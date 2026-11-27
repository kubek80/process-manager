import type { StepType } from "../types";

/** Single source of truth for the building blocks: used by the UI, the legend and the LLM prompt. */
/**
 * `when` is shown to people and sent to chat assistants. `rule` adds what the format needs (prompt only);
 * `hint` says the same in plain words (app only).
 */
/**
 * `color` and `tile` are tokens (styles.css), worked out from the look in theme.ts: the kinds of steps
 * share four colours of the palette, the icon and the words tell them apart. Work people do
 * (`--step-work`, the brand), what people judge or agree (`--step-check`, the colour of standards),
 * what runs or leads elsewhere (`--step-system`, the colour of processes) and the plain rest
 * (`--step-plain`, the ink). None is the colour of a state.
 */
export const STEP_META: Record<StepType, { label: string; color: string; tile: string; when: string; rule?: string; hint?: string }> = {
  form: { label: "Fill in a form", color: "var(--step-work)", tile: "var(--step-work-bg)", when: "Someone submits a request or ticket in a system (ServiceNow request, access form, portal order)." },
  code: { label: "Change code", color: "var(--step-work)", tile: "var(--step-work-bg)", when: "Someone edits code or configuration and opens a pull request (Terraform, YAML, pipeline, API proxy)." },
  approval: { label: "Approve", color: "var(--step-check)", tile: "var(--step-check-bg)", when: "A named person or group formally approves or rejects (manager, budget owner, CAB)." },
  review: { label: "Review", color: "var(--step-check)", tile: "var(--step-check-bg)", when: "Someone inspects work and gives feedback (PR review, security or architecture review)." },
  wait: { label: "Wait", color: "var(--step-plain)", tile: "var(--step-plain-bg)", when: "Nothing to do but wait for a period, an SLA or another party." },
  communication: { label: "Send a message", color: "var(--step-work)", tile: "var(--step-work-bg)", when: "Someone sends an email or chat message, or notifies a group." },
  meeting: { label: "Meeting", color: "var(--step-check)", tile: "var(--step-check-bg)", when: "People must talk: kickoff, workshop, design session." },
  automation: { label: "Automated", color: "var(--step-system)", tile: "var(--step-system-bg)", when: "A system or pipeline does the work without a human (provisioning, CI/CD run)." },
  document: { label: "Write a document", color: "var(--step-work)", tile: "var(--step-work-bg)", when: "Someone writes or updates a document (design, risk assessment, runbook)." },
  verify: { label: "Check the result", color: "var(--step-system)", tile: "var(--step-system-bg)", when: "Someone tests or confirms that the result works (log in, smoke test)." },
  decision: { label: "Decision", color: "var(--step-check)", tile: "var(--step-check-bg)", when: "The flow splits depending on an answer.", rule: "Needs two or more labelled `next` entries.", hint: "Give it two or more named paths." },
  subprocess: { label: "Sub-process", color: "var(--step-system)", tile: "var(--step-system-bg)", when: "The step is a whole other process described elsewhere.", rule: "Needs `subProcessId`.", hint: "Choose that process under “Explained by sub-process”." },
  service: { label: "Service", color: "var(--step-system)", tile: "var(--step-system-bg)", when: "The step requests a service another team performs (a DNS record change, a firewall rule) through its front-door form.", rule: "Needs `service`: the id of a service from the SERVICES list.", hint: "Choose the service under “Service”." },
  task: { label: "Task", color: "var(--step-plain)", tile: "var(--step-plain-bg)", when: "Any other manual work that fits none of the above." },
};

export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

/** When to use a kind of step, in plain words: for tooltips. */
export const stepHelp = (t: StepType) => [STEP_META[t].when, STEP_META[t].hint].filter(Boolean).join(" ");

/**
 * The colour of each lane, and its tile, as tokens (set as `--lane` and `--lane-bg`). The first
 * lane, "You", is the brand; the others are marks of the palette that are no state (never the
 * colour of problems, warnings or success), in an order where neighbours differ also for people
 * who cannot tell red from green. They follow a look set in Admin › Theming.
 */
export const LANE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--lane-${n})`);
export const LANE_TILES = [1, 2, 3, 4, 5, 6].map((n) => `var(--lane-${n}-bg)`);
