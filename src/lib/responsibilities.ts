import type { Feedback, FeedbackByTarget, Perms, Process, Standard, TargetKind } from "../types";
import { reviewOf, statusOf, type Dates, type ReviewInfo } from "./lifecycle";
import { canPublish } from "./rights";
import { personLabel, type GroupKind } from "./members";
import { roleLine, type Groups, type UserRole } from "./users";

/** A team, platform or practice somebody belongs to; `member`: only as a member (of a platform or practice), not as an owner. */
export interface Group { kind: GroupKind; id: string; member?: boolean }
/** A name for a group that is unique across the three kinds (a team and a practice may share an id). */
export const groupKey = (g: Group) => `${g.kind}:${g.id}`;

/**
 * What somebody answers for: what the teams they are Owner of maintain, and what belongs to the
 * platforms and practices they own or are a member of. From these the "My responsibilities" page
 * shows what needs doing now and how everything else stands. What is theirs only as a member
 * asks nothing of them but its drafts: reviews and feedback are the owners' job.
 */
export interface Owned {
  kind: TargetKind;
  doc: Process | Standard;
  /** The groups of the person through which this is theirs, teams first. */
  groups: Group[];
  /** Theirs only as a member of its platform or practice: they draft, an owner publishes and reviews. */
  member: boolean;
  status: "draft" | "active" | "deprecated";
  review: ReviewInfo;
  /** Feedback that nobody marked as fixed yet, oldest first. */
  open: Feedback[];
}

export type TaskKind = "review-overdue" | "review-soon" | "feedback" | "publish" | "draft" | "no-rhythm";
/** Who saved something last, and when. */
export interface SavedBy { email: string; name?: string; at?: string }
/** One thing to do, about one process or standard. */
export interface Task {
  kind: TaskKind;
  item: Owned;
  /** For feedback: the item itself. */
  feedback?: Feedback;
  /** For "publish": who saved what waits (somebody else) and when; `changes`: unpublished changes of a published one, not a draft never published. */
  by?: SavedBy;
  changes?: boolean;
}

const KIND_ORDER: GroupKind[] = ["team", "platform", "practice"];
const sorted = (ids: string[] | undefined) => [...new Set(ids ?? [])].sort();

const only = (ids: string[] | undefined, but: string[] | undefined) => sorted(ids).filter((id) => !(but ?? []).includes(id));

/**
 * The teams, platforms and practices somebody belongs to: teams first, then platforms, then
 * practices; those they own before those they are only a member of (owning one wins).
 */
export function myGroups(perms: Perms): Group[] {
  return [
    ...sorted(perms.owns).map((id) => ({ kind: "team" as const, id })),
    ...sorted(perms.platforms).map((id) => ({ kind: "platform" as const, id })),
    ...sorted(perms.practices).map((id) => ({ kind: "practice" as const, id })),
    ...only(perms.memberPlatforms, perms.platforms).map((id) => ({ kind: "platform" as const, id, member: true })),
    ...only(perms.memberPractices, perms.practices).map((id) => ({ kind: "practice" as const, id, member: true })),
  ];
}

/**
 * Through which of the person's groups a process or standard is theirs: its team (when they are
 * Owner of it), its platform and its practice (when they own them or are a member: `member`).
 * Owned groups first. Empty: it is not theirs.
 */
export function groupsOf(perms: Perms, doc: { owner?: string; platform?: string; practice?: string }): Group[] {
  const out: Group[] = [];
  if (doc.owner && (perms.owns ?? []).includes(doc.owner)) out.push({ kind: "team", id: doc.owner });
  if (doc.platform && (perms.platforms ?? []).includes(doc.platform)) out.push({ kind: "platform", id: doc.platform });
  if (doc.practice && (perms.practices ?? []).includes(doc.practice)) out.push({ kind: "practice", id: doc.practice });
  if (doc.platform && !out.some((g) => g.kind === "platform") && (perms.memberPlatforms ?? []).includes(doc.platform)) out.push({ kind: "platform", id: doc.platform, member: true });
  if (doc.practice && !out.some((g) => g.kind === "practice") && (perms.memberPractices ?? []).includes(doc.practice)) out.push({ kind: "practice", id: doc.practice, member: true });
  return out;
}

const ORDER: TaskKind[] = ["review-overdue", "feedback", "publish", "review-soon", "draft", "no-rhythm"];

/** When each was first published, by kind and id (`meta[id]` from the lists): where a first review is counted from. */
export type FirstSaved = Partial<Record<TargetKind, Record<string, (Dates & SavedMeta) | undefined>>>;
/** What `meta[id]` says about who saved last: the stored version, and the unpublished changes (`draft`). */
export interface SavedMeta {
  updatedAt?: string; updatedBy?: string; updatedByName?: string;
  draft?: { updatedAt: string; updatedBy: string; updatedByName?: string };
}

/** Saves the portal made itself (an import, an upgrade): nobody's work to hand over. */
const PORTAL = new Set(["import", "system"]);

/**
 * What of a document waits to be published, by whom it was last saved: the unpublished changes
 * (`meta.draft`), or a draft that was never published as it is stored. Undefined: nothing waits,
 * or the portal saved it.
 */
export function waiting(status: Owned["status"], meta?: SavedMeta): (SavedBy & { changes: boolean }) | undefined {
  if (meta?.draft?.updatedBy) return PORTAL.has(meta.draft.updatedBy) ? undefined : { email: meta.draft.updatedBy, name: meta.draft.updatedByName, at: meta.draft.updatedAt, changes: status !== "draft" };
  if (status === "draft" && meta?.updatedBy && !PORTAL.has(meta.updatedBy)) return { email: meta.updatedBy, name: meta.updatedByName, at: meta.updatedAt, changes: false };
  return undefined;
}
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * `only` narrows it to one of the person's groups (its `groupKey`); null: all of them. `since`
 * says when each was first published, so that one never reviewed is due by the same rule as a
 * reviewed one (see `reviewInfo`); without it, never reviewed counts as overdue. With it and `me`
 * (the signed-in address), what somebody else saved last and the person may publish waits for
 * them ("publish"); a draft is the person's own unfinished work ("draft") only when they saved it
 * last.
 */
export function responsibilities(perms: Perms, only: string | null, processes: Process[], standards: Standard[], feedback: FeedbackByTarget, today?: string, since?: FirstSaved, me?: string): { owned: Owned[]; tasks: Task[] } {
  const item = (kind: TargetKind, doc: Process | Standard): Owned | null => {
    const groups = groupsOf(perms, doc);
    if (!groups.length || (only !== null && !groups.some((g) => groupKey(g) === only))) return null;
    return {
      kind, doc, groups, member: groups.every((g) => g.member), status: statusOf(doc), review: reviewOf(doc, since?.[kind]?.[doc.id], today),
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
    // only a member: what waits for an owner is theirs to follow, nothing else asks for them
    if (o.member) { if (o.status === "draft") tasks.push({ kind: "draft", item: o }); continue; }
    if (o.review.state === "overdue") tasks.push({ kind: "review-overdue", item: o });
    if (o.review.state === "soon") tasks.push({ kind: "review-soon", item: o });
    for (const f of o.open) tasks.push({ kind: "feedback", item: o, feedback: f });
    const meta = since?.[o.kind]?.[o.doc.id];
    const w = me ? waiting(o.status, meta) : undefined;
    const publishes = o.status === "draft" ? canPublish(perms, o.kind, o.doc, o.doc, false) : canPublish(perms, o.kind, o.doc);
    if (w && !same(w.email, me) && publishes) {
      const { changes, ...by } = w;
      tasks.push({ kind: "publish", item: o, by, changes });
    } else if (o.status === "draft" && (!w || same(w.email, me) || !me)) tasks.push({ kind: "draft", item: o });
    if (o.status === "active" && !o.doc.review) tasks.push({ kind: "no-rhythm", item: o });
  }
  // Most urgent first. Within reviews: the one that is due longest, and something that was
  // never reviewed before all of them. Within feedback: the one that waits longest, whatever
  // it is about.
  const due = (t: Task) => t.item.review.days ?? -Infinity;
  tasks.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
    || (a.kind === "feedback" ? (a.feedback?.createdAt ?? "").localeCompare(b.feedback?.createdAt ?? "")
      : a.kind === "publish" ? (a.by?.at ?? "").localeCompare(b.by?.at ?? "") : due(a) - due(b))
    || a.item.doc.title.localeCompare(b.item.doc.title));
  return { owned, tasks };
}

/** How many things need doing now: what the badge in the top bar shows. Reviews that are only due soon do not count. */
export const urgent = (tasks: Task[]) => tasks.filter((t) => t.kind === "review-overdue" || t.kind === "feedback" || t.kind === "publish").length;

/** "1 overdue review, 2 feedback and 1 to publish": what the number in the top bar counts. */
export function urgentWords(tasks: Task[]): string {
  const n = (k: TaskKind) => tasks.filter((t) => t.kind === k).length;
  const parts = [
    n("review-overdue") && `${n("review-overdue")} overdue review${n("review-overdue") === 1 ? "" : "s"}`,
    n("feedback") && `${n("feedback")} feedback`,
    n("publish") && `${n("publish")} to publish`,
  ].filter((x): x is string => !!x);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The tooltip of "My responsibilities" in the top bar: what the place holds for this person, and
 * what its number counts. Somebody who is only a member is asked for nothing but drafts.
 */
export function mineTitle(groups: Group[], tasks: Task[]): string {
  if (groups.length && groups.every((g) => g.member)) return "Your drafts, and what waits for an owner to publish it";
  const what = "What you answer for: drafts to publish, reviews to do, feedback to handle";
  const count = urgentWords(tasks);
  return count ? `${what}. Waiting now: ${count}` : what;
}

/**
 * Who made the last change, in words: the person's name where the page knows it (from `names`,
 * by email, e.g. the people who gave feedback and the signed-in person), else their email; and a
 * plain word for a change no person made.
 */
export function changedBy(email: string | undefined, names: Record<string, string> = {}): string {
  if (!email) return "";
  if (email === "import") return "Imported";
  if (email === "system") return "Updated by the portal";
  return personLabel({ email, name: names[email.toLowerCase()] });
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
    ...(p.memberPlatforms ?? []).map((scope) => ({ role: "platform-member" as const, scope })),
    ...(p.memberPractices ?? []).map((scope) => ({ role: "practice-member" as const, scope })),
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

/**
 * "My responsibilities" in the top bar: whether it is shown, its number (`urgent`) and its tooltip
 * (`mineTitle`). Never throws: the top bar is on every page.
 */
export function minePlace(perms: Perms, processes: Process[], standards: Standard[], feedback: FeedbackByTarget, since: FirstSaved, me?: string): { shown: boolean; count: number; title: string } {
  const groups = myGroups(perms);
  if (!groups.length) return { shown: false, count: 0, title: "" };
  try {
    const { tasks } = responsibilities(perms, null, processes, standards, feedback, undefined, since, me);
    return { shown: true, count: urgent(tasks), title: mineTitle(groups, tasks) };
  } catch { return { shown: true, count: 0, title: mineTitle(groups, []) }; }
}
