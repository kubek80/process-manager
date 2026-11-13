import type { StepType } from "../types";

/** Single source of truth for the building blocks: used by the UI, the legend and the LLM prompt. */
export const STEP_META: Record<StepType, { label: string; color: string; when: string }> = {
  form: { label: "Fill in a form", color: "#4f46e5", when: "Someone submits a request or ticket in a system (ServiceNow request, access form, portal order)." },
  code: { label: "Change code", color: "#0d9488", when: "Someone edits code or configuration and opens a pull request (Terraform, YAML, pipeline, API proxy)." },
  approval: { label: "Approve", color: "#d97706", when: "A named person or group formally approves or rejects (manager, budget owner, CAB)." },
  review: { label: "Review", color: "#7c3aed", when: "Someone inspects work and gives feedback (PR review, security or architecture review)." },
  wait: { label: "Wait", color: "#64748b", when: "Nothing to do but wait for a period, an SLA or another party." },
  communication: { label: "Send a message", color: "#0284c7", when: "Someone sends an email or chat message, or notifies a group." },
  meeting: { label: "Meeting", color: "#db2777", when: "People must talk: kickoff, workshop, design session." },
  automation: { label: "Automated", color: "#059669", when: "A system or pipeline does the work without a human (provisioning, CI/CD run)." },
  document: { label: "Write a document", color: "#b45309", when: "Someone writes or updates a document (design, risk assessment, runbook)." },
  verify: { label: "Check the result", color: "#16a34a", when: "Someone tests or confirms that the result works (log in, smoke test)." },
  decision: { label: "Decision", color: "#e11d48", when: "The flow splits depending on an answer. Needs two or more labelled `next` entries." },
  subprocess: { label: "Sub-process", color: "#2563eb", when: "The step is a whole other process described elsewhere. Needs `subProcessId`." },
  task: { label: "Task", color: "#475569", when: "Any other manual work that fits none of the above." },
};

export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

export const LANE_COLORS = ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#0284c7", "#7c3aed", "#059669", "#b45309"];
