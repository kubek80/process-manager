import type { Feedback, FeedbackByTarget, Perms, Process, Standard, TargetKind } from "../types";
import { reviewInfo, statusOf, type ReviewInfo } from "./lifecycle";
import type { GroupKind } from "./members";

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

/** `only` narrows it to one of the person's groups (its `groupKey`); null: all of them. */
export function responsibilities(perms: Perms, only: string | null, processes: Process[], standards: Standard[], feedback: FeedbackByTarget, today?: string): { owned: Owned[]; tasks: Task[] } {
  const item = (kind: TargetKind, doc: Process | Standard): Owned | null => {
    const groups = groupsOf(perms, doc);
    if (!groups.length || (only !== null && !groups.some((g) => groupKey(g) === only))) return null;
    return {
      kind, doc, groups, status: statusOf(doc), review: reviewInfo(doc, today),
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
