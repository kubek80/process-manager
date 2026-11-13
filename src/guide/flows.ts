import type { Process, Step, StepType } from "../types";

/** The guide's flow charts are ordinary processes, drawn by the same map as everything else. */
const s = (id: string, title: string, actor: string, type: StepType, next: (string | [string, string])[], duration?: string): Step => ({
  id, title, actor, type, ...(duration ? { duration } : {}),
  next: next.map((n) => (typeof n === "string" ? { to: n } : { to: n[0], label: n[1] })),
});
const flow = (id: string, title: string, summary: string, others: [string, string][], steps: Step[]): Process => ({
  schemaVersion: "1.0", id, title, summary, prerequisites: [],
  actors: [{ id: "me", name: "You" }, ...others.map(([aid, name]) => ({ id: aid, name }))],
  steps,
});

export const followFlow = flow("guide-follow", "Follow a process", "How a consumer gets something done with Process Manager.",
  [["app", "Process Manager"], ["others", "Other teams"]],
  [
    s("find", "Find the process", "me", "task", ["show"], "search or filter"),
    s("show", "Show map and checklist", "app", "automation", ["ready"]),
    s("ready", "Prerequisites in place?", "me", "decision", [["do-step", "Yes"], ["get-prerequisite", "No"]]),
    s("get-prerequisite", "Run the linked process first", "me", "task", ["ready"]),
    s("do-step", "Do your step and tick it", "me", "task", ["their-part"], "exact actions listed"),
    s("their-part", "Do their part", "others", "wait", ["worked"], "approve, review"),
    s("worked", "Worked as described?", "me", "decision", [["finished", "Yes"], ["flag", "No"]]),
    s("flag", "Flag the step that failed", "me", "communication", [], "one sentence"),
    s("finished", "Result delivered", "me", "verify", []),
  ]);

export const aiFlow = flow("guide-ai", "Describe a process with AI", "How an editor turns free text into a checked process with any chat assistant.",
  [["llm", "Chat assistant"], ["app", "Process Manager"]],
  [
    s("describe", "Paste the description", "me", "document", ["build-prompt"], "email, wiki, notes"),
    s("build-prompt", "Build the prompt", "app", "automation", ["ask"], "rules and schema"),
    s("ask", "Send the prompt to your chat", "me", "communication", ["write-json"], "copy and paste"),
    s("write-json", "Write the process as JSON", "llm", "automation", ["check"]),
    s("check", "Check the pasted answer", "app", "verify", ["valid"], "schema, references"),
    s("valid", "Valid?", "app", "decision", [["save", "Yes"], ["fix", "No"]]),
    s("fix", "Send the fix request", "me", "communication", ["write-json"], "same chat"),
    s("save", "Save and draw the map", "app", "automation", []),
  ]);

export const feedbackFlow = flow("guide-feedback", "Feedback loop", "How a problem reported by a consumer reaches the owner and gets fixed.",
  [["app", "Process Manager"], ["owner", "Process owner"]],
  [
    s("flag", "Flag a step that failed", "me", "form", ["show-flag"], "one sentence"),
    s("show-flag", "Show a red flag on the step", "app", "automation", ["read"], "map and checklist"),
    s("read", "Read the open feedback", "owner", "review", ["needs-change"]),
    s("needs-change", "Description wrong?", "owner", "decision", [["correct", "Yes"], ["mark-fixed", "No"]]),
    s("correct", "Correct the step", "owner", "document", ["mark-fixed"], "on the map"),
    s("mark-fixed", "Mark as fixed", "owner", "task", ["cleared"]),
    s("cleared", "Remove the flag", "app", "automation", []),
  ]);
