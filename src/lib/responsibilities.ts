import type { Feedback, FeedbackByTarget, Perms, Process, Standard, TargetKind } from "../types";
import { reviewOf, statusOf, type Dates, type ReviewInfo } from "./lifecycle";
import type { GroupKind } from "./members";
import { roleLine, type Groups, type UserRole } from "./users";

/** A team, platform or practice somebody belongs to. */
export interface Group { kind: GroupKind; id: string }
/** A name for a group that is unique across the three kinds (a team and a practice may share an id). */
export const groupKey = (g: Group) => `${g.kind}:${g.id}`;

/**
 * What somebody answers for: what the teams they are Owner of maintain, and what belongs to the
 * platforms and practices they own. From these the "My responsibilities" page shows what needs
 * doing now and how everything else stands.
 */
export interface Owned {
  kind: TargetKind;
  doc: Process | Standard;
  /** The groups of the person through which this is theirs, teams first. */
  groups: Group[];
  status: "draft" | "active" | "deprecated";
  review: ReviewInfo;
  /** Feedback that nobody marked as fixed yet, oldest first. */
  open: Feedback[];
}

export type TaskKind = "review-overdue" | "review-soon" | "feedback" | "draft" | "no-rhythm";
/** One thing to do, about one process or standard. */
export interface Task {
  kind: TaskKind;
  item: Owned;
  /** For feedback: the item itself. */
  feedback?: Feedback;
}

const KIND_ORDER: GroupKind[] = ["team", "platform", "practice"];
const sorted = (ids: string[] | undefined) => [...new Set(ids ?? [])].sort();

/** The teams, platforms and practices somebody belongs to: teams first, then platforms, then practices. */
export function myGroups(perms: Perms): Group[] {
  return [
    ...sorted(perms.owns).map((id) => ({ kind: "team" as const, id })),
    ...sorted(perms.platforms).map((id) => ({ kind: "platform" as const, id })),
    ...sorted(perms.practices).map((id) => ({ kind: "practice" as const, id })),
  ];
}

/**
 * Through which of the person's groups a process or standard is theirs: its team (when they are
 * Owner of it), its platform and its practice (when they own them). Empty: it is not theirs.
 */
export function groupsOf(perms: Perms, doc: { owner?: string; platform?: string; practice?: string }): Group[] {
  const out: Group[] = [];
  if (doc.owner && (perms.owns ?? []).includes(doc.owner)) out.push({ kind: "team", id: doc.owner });
  if (doc.platform && (perms.platforms ?? []).includes(doc.platform)) out.push({ kind: "platform", id: doc.platform });
  if (doc.practice && (perms.practices ?? []).includes(doc.practice)) out.push({ kind: "practice", id: doc.practice });
  return out;
}

const ORDER: TaskKind[] = ["review-overdue", "feedback", "review-soon", "draft", "no-rhythm"];

/** When each was first published, by kind and id (`meta[id]` from the lists): where a first review is counted from. */
export type FirstSaved = Partial<Record<TargetKind, Record<string, Dates | undefined>>>;

/**
 * `only` narrows it to one of the person's groups (its `groupKey`); null: all of them. `since`
 * says when each was first published, so that one never reviewed is due by the same rule as a
 * reviewed one (see `reviewInfo`); without it, never reviewed counts as overdue.
 */
export function responsibilities(perms: Perms, only: string | null, processes: Process[], standards: Standard[], feedback: FeedbackByTarget, today?: string, since?: FirstSaved): { owned: Owned[]; tasks: Task[] } {
  const item = (kind: TargetKind, doc: Process | Standard): Owned | null => {
    const groups = groupsOf(perms, doc);
    if (!groups.length || (only !== null && !groups.some((g) => groupKey(g) === only))) return null;
    return {
      kind, doc, groups, status: statusOf(doc), review: reviewOf(doc, since?.[kind]?.[doc.id], today),
      open: (feedback[kind][doc.id] ?? []).filter((f) => !f.resolved).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  };
  const first = (o: Owned) => `${KIND_ORDER.indexOf(o.groups[0].kind)}:${o.groups[0].id}`;
  const owned = [
    ...processes.map((p) => item("process", p)),
    ...standards.map((s) => item("standard", s)),
  ].filter((o): o is Owned => o !== null)
    .sort((a, b) => first(a).localeCompare(first(b)) || a.doc.title.localeCompare(b.doc.title));

  const tasks: Task[] = [];
  for (const o of owned) {
    if (o.review.state === "overdue") tasks.push({ kind: "review-overdue", item: o });
    if (o.review.state === "soon") tasks.push({ kind: "review-soon", item: o });
    for (const f of o.open) tasks.push({ kind: "feedback", item: o, feedback: f });
    if (o.status === "draft") tasks.push({ kind: "draft", item: o });
    if (o.status === "active" && !o.doc.review) tasks.push({ kind: "no-rhythm", item: o });
  }
  // Most urgent first. Within reviews: the one that is due longest, and something that was
  // never reviewed before all of them. Within feedback: the one that waits longest, whatever
  // it is about.
  const due = (t: Task) => t.item.review.days ?? -Infinity;
  tasks.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
    || (a.kind === "feedback" ? (a.feedback?.createdAt ?? "").localeCompare(b.feedback?.createdAt ?? "") : due(a) - due(b))
    || a.item.doc.title.localeCompare(b.item.doc.title));
  return { owned, tasks };
}

/** How many things need doing now: what the badge in the top bar shows. Reviews that are only due soon do not count. */
export const urgent = (tasks: Task[]) => tasks.filter((t) => t.kind === "review-overdue" || t.kind === "feedback").length;

/**
 * Who made the last change, in words: the person's name where the page knows it (from `names`,
 * by email, e.g. the people who gave feedback and the signed-in person), else their email; and a
 * plain word for a change no person made.
 */
export function changedBy(email: string | undefined, names: Record<string, string> = {}): string {
  if (!email) return "";
  if (email === "import") return "Imported";
  if (email === "system") return "Updated by the portal";
  return names[email.toLowerCase()] || email;
}

/**
 * The person's roles for the account menu, in the words of Admin > Access and saying of what:
 * "Platform owner for Google Cloud", "Owner for Cloud Platform team". "Reader" when there are none.
 */
export function accountRoles(p: Perms, groups: Groups): string[] {
  const roles: UserRole[] = [
    ...(p.admin ? [{ role: "admin" as const, scope: "" }] : []),
    ...(p.catalog && !p.admin ? [{ role: "catalog-manager" as const, scope: "" }] : []),
    ...(p.processes && !p.admin ? [{ role: "process-editor" as const, scope: "" }] : []),
    ...(p.standards && !p.admin ? [{ role: "standards-editor" as const, scope: "" }] : []),
    ...(p.platforms ?? []).map((scope) => ({ role: "platform-owner" as const, scope })),
    ...(p.practices ?? []).map((scope) => ({ role: "practice-owner" as const, scope })),
    ...(p.owns ?? []).map((scope) => ({ role: "owner" as const, scope })),
  ];
  return roles.length ? roles.map((r) => roleLine(r, groups)) : ["Reader"];
}

/**
 * The count of reviews to do for a tile: the number in the colour of its worst case (overdue a
 * problem, due a warning), and the split in words when there is something to split.
 */
export function reviewsDue(overdue: number, due: number): { count: number; tone: "bad" | "warn" | "good"; label: string; split: string } {
  const count = overdue + due;
  return {
    count,
    tone: overdue ? "bad" : due ? "warn" : "good",
    label: count === 1 ? "review due" : "reviews due",
    split: overdue && due ? `${overdue} overdue · ${due} due` : overdue ? `${overdue === 1 ? "it is" : "all"} overdue` : "",
  };
}
