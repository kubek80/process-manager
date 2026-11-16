import type { Feedback, FeedbackByTarget, Perms, Process, Standard, TargetKind } from "../types";
import { reviewInfo, statusOf, type ReviewInfo } from "./lifecycle";

/**
 * What somebody answers for: the processes and standards of the teams and units they own (the
 * Owner role) or edit standards for. From these the "My responsibilities" page shows what
 * needs doing now and how everything else stands.
 */
export interface Owned {
  kind: TargetKind;
  doc: Process | Standard;
  /** The team or unit through which this is theirs. */
  team: string;
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

/** The teams and units somebody answers for. */
export function myTeams(perms: Perms): string[] {
  return [...new Set([...perms.owns, ...perms.standardUnits])].sort();
}

/**
 * Whether somebody answers for a process or a standard of this team or unit. Being Owner for it
 * covers both. Editing a unit's standards covers its standards only - the same rule the server
 * applies when a review is confirmed or feedback is closed.
 */
export const answersFor = (perms: Perms, kind: TargetKind, owner?: string) =>
  !!owner && (perms.owns.includes(owner) || (kind === "standard" && perms.standardUnits.includes(owner)));

const ORDER: TaskKind[] = ["review-overdue", "feedback", "review-soon", "draft", "no-rhythm"];

/** `only` narrows it to one of the person's teams or units; null: all of them. */
export function responsibilities(perms: Perms, only: string | null, processes: Process[], standards: Standard[], feedback: FeedbackByTarget, today?: string): { owned: Owned[]; tasks: Task[] } {
  const mine = (kind: TargetKind, owner?: string) => answersFor(perms, kind, owner) && (only === null || owner === only);
  const item = (kind: TargetKind, doc: Process | Standard): Owned => ({
    kind, doc, team: doc.owner!, status: statusOf(doc), review: reviewInfo(doc, today),
    open: (feedback[kind][doc.id] ?? []).filter((f) => !f.resolved).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  const owned = [
    ...processes.filter((p) => mine("process", p.owner)).map((p) => item("process", p)),
    ...standards.filter((s) => mine("standard", s.owner)).map((s) => item("standard", s)),
  ].sort((a, b) => a.team.localeCompare(b.team) || a.doc.title.localeCompare(b.doc.title));

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
