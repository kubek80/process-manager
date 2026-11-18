import type { Process, Step, StepType } from "../types";

/** The guide's flow charts are ordinary processes, drawn by the same map as everything else. */
const s = (id: string, title: string, actor: string, type: StepType, next: (string | [string, string])[], duration?: string): Step => ({
  id, title, actor, type, ...(duration ? { duration } : {}),
  next: next.map((n) => (typeof n === "string" ? { to: n } : { to: n[0], label: n[1] })),
});
const flow = (id: string, title: string, summary: string, others: [string, string][], steps: Step[], me = "You"): Process => ({
  schemaVersion: "1.0", id, title, summary, prerequisites: [],
  actors: [{ id: "me", name: me }, ...others.map(([aid, name]) => ({ id: aid, name }))],
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

export const reviewFlow = flow("guide-review", "Periodic review", "How the owner keeps a process correct over time.",
  [["app", "Process Manager"]],
  [
    s("due", "Flag the review as due", "app", "automation", ["read"], "every 3-24 months"),
    s("read", "Read the process end to end", "me", "review", ["correct"], "and its open feedback"),
    s("correct", "Still correct?", "me", "decision", [["confirm", "Yes"], ["update", "No"]]),
    s("update", "Correct what changed", "me", "document", ["confirm"], "on the map or with AI"),
    s("confirm", "Mark as reviewed", "me", "task", ["restart"], "one click"),
    s("restart", "Restart the interval", "app", "automation", []),
  ], "Process owner");

export const automationFlow = flow("guide-automation", "Planned: an agent follows the process", "Where this is heading: the same description drives an AI agent.",
  [["agent", "AI agent"], ["app", "Process Manager"], ["others", "Other teams"]],
  [
    s("ask", "Ask for what you need", "me", "communication", ["lookup"], "“I need a GCP project”"),
    s("lookup", "Look up the process", "agent", "task", ["serve"], "over MCP"),
    s("serve", "Return steps, tools and skills", "app", "automation", ["act"]),
    s("act", "Do your steps with the skills", "agent", "code", ["approve"], "form, pull request"),
    s("approve", "Approve what was prepared", "me", "approval", ["their-part"]),
    s("their-part", "Do their part", "others", "wait", ["report"], "approve, review"),
    s("report", "Track and report back", "agent", "verify", []),
  ]);

export const signInFlow = flow("guide-sign-in", "Signing in", "How you get into the app and how your rights are decided.",
  [["app", "Process Manager"], ["idp", "Entra ID or Google"]],
  [
    s("open", "Open Process Manager", "me", "task", ["redirect"]),
    s("redirect", "Send you to the company sign-in", "app", "automation", ["sign-in"]),
    s("sign-in", "Sign in as usual", "me", "form", ["confirm"], "password, MFA"),
    s("confirm", "Confirm who you are", "idp", "verify", ["rights"], "name and email"),
    s("rights", "Look up your rights", "app", "automation", ["use"], "roles, teams, platforms"),
    s("use", "Use the app", "me", "task", [], "signed in for 12 hours"),
  ]);

export const standardFlow = flow("guide-standard", "From a standard to a reviewed pull request", "How a rule written once reaches the code.",
  [["app", "Process Manager"], ["dev", "Developer and AI assistant"]],
  [
    s("write", "Write or change the standard", "me", "document", ["generate"], "requirements"),
    s("generate", "Generate skill and review agent", "app", "automation", ["install"], "a new version each save"),
    s("install", "Put both files in the repository", "dev", "code", ["code"], "download or export"),
    s("code", "Write code with the skill", "dev", "task", ["check"], "the assistant follows it"),
    s("check", "Review agent checks the change", "dev", "review", ["found"], "cites requirement ids"),
    s("found", "Violations?", "dev", "decision", [["fix", "Yes"], ["merge", "No"]]),
    s("fix", "Fix, or ask for an exception", "dev", "code", ["check"]),
    s("merge", "Merge", "dev", "verify", []),
  ], "Standard editor");

export const versionFlow = flow("guide-versions", "Two people edit the same process", "How a save becomes a version and what happens when somebody else saved first.",
  [["colleague", "A colleague"], ["app", "Process Manager"]],
  [
    s("edit", "Edit the process", "me", "task", ["colleague-saves"], "a draft, with Undo"),
    s("colleague-saves", "Saves a change first", "colleague", "task", ["save"]),
    s("save", "Press Save changes", "me", "task", ["newest"], "with a note"),
    s("newest", "Started from the newest version?", "app", "decision", [["stored", "Yes"], ["compare", "No"]]),
    s("compare", "Show what they changed", "app", "automation", ["choose"]),
    s("choose", "Whose version?", "me", "decision", [["continue", "Theirs"], ["stored", "Mine"]]),
    s("continue", "Continue from theirs", "me", "task", ["save"], "yours: one Undo away"),
    s("stored", "Keep it as a new version", "app", "automation", []),
  ]);


export const rightsFlow = flow("guide-rights", "Who may change a process or standard", "How the app decides what you may do with one process or standard.",
  [["app", "Process Manager"]],
  [
    s("open", "Open a process or standard", "me", "task", ["editor"]),
    s("editor", "Admin, process or standards editor?", "app", "decision", [["change", "Yes"], ["owns", "No"]]),
    s("owns", "Owner of its platform or practice?", "app", "decision", [["change", "Yes"], ["team", "No"]]),
    s("team", "Member of its owning team?", "app", "decision", [["manage", "Yes"], ["read", "No"]]),
    s("change", "Change, create or delete it", "me", "document", [], "also reviews, feedback"),
    s("manage", "Confirm reviews, answer feedback", "me", "review", [], "and see drafts"),
    s("read", "Read it and give feedback", "me", "task", []),
  ]);

export const requestFlow = flow("guide-request", "Ask for a missing process or standard", "How a request for something missing becomes a process or standard, or is declined with a reason.",
  [["others", "Colleagues"], ["maker", "Whoever could create it"]],
  [
    s("ask", "Ask for what is missing", "me", "form", ["vote"], "name, what and why"),
    s("vote", "Vote for it", "others", "task", ["decide"], "one vote each"),
    s("decide", "Will it be made?", "maker", "decision", [["plan", "Yes"], ["decline", "No"]]),
    s("plan", "Mark as planned", "maker", "task", ["make"], "with a note"),
    s("decline", "Decline request, with the reason", "maker", "communication", []),
    s("make", "Publish it, then mark as done", "maker", "document", ["open"], "linked to the request"),
    s("open", "Open what answers it", "me", "task", []),
  ]);
