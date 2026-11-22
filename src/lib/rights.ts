import type { Perms, TargetKind } from "../types";
import type { GroupKind, GroupRank } from "./members";

/**
 * What the signed-in person may do with a process or a standard, worked out in the browser from
 * the rights the server sent. The server decides; these only show or hide controls, and follow
 * the same rules:
 *
 * - May publish (save what readers see, create, retire, unpublish, bring back, delete): an admin;
 *   a process editor for every process; a standards editor for every standard; an owner of the
 *   platform or of the practice the document belongs to (`canEdit`, also `canPublish`).
 * - May draft (open the editing screen, create a draft, save and discard a working draft): whoever
 *   may publish, and a member of the platform or of the practice it belongs to (`canDraft`).
 * - May manage (confirm reviews, answer feedback): whoever may publish, and an Owner of the team
 *   that maintains it. A member of a platform or practice does not.
 * - May see its drafts: whoever may manage or draft it (`seesDrafts`).
 */

/** What a process or standard belongs to, as far as rights go. */
export interface Belongs { owner?: string; platform?: string; practice?: string }

/** No rights at all: what somebody has before the server said otherwise. */
export const NO_PERMS: Perms = { admin: false, catalog: false, processes: false, standards: false, owns: [], platforms: [], practices: [], memberPlatforms: [], memberPractices: [] };

/** Rights as the server sent them, with every list present (an older server may leave one out). */
export const completePerms = (p?: Partial<Perms> | null): Perms => ({
  admin: !!p?.admin, catalog: !!p?.catalog, processes: !!p?.processes, standards: !!p?.standards,
  owns: p?.owns ?? [], platforms: p?.platforms ?? [], practices: p?.practices ?? [],
  memberPlatforms: p?.memberPlatforms ?? [], memberPractices: p?.memberPractices ?? [],
});

/** Whether somebody may change every process (or every standard), whatever it belongs to. */
export const editsAll = (p: Perms, kind: TargetKind) => p.admin || (kind === "process" ? p.processes : p.standards);

/** Whether this document belongs to one of the person's platforms or practices as an owner. */
export const ownsPlatformOrPractice = (p: Perms, doc?: Belongs) =>
  (!!doc?.platform && (p.platforms ?? []).includes(doc.platform)) || (!!doc?.practice && (p.practices ?? []).includes(doc.practice));

/** Whether this document belongs to a platform or a practice the person is a member of. */
export const memberOfPlatformOrPractice = (p: Perms, doc?: Belongs) =>
  (!!doc?.platform && (p.memberPlatforms ?? []).includes(doc.platform)) || (!!doc?.practice && (p.memberPractices ?? []).includes(doc.practice));

/** May publish this process or standard: save what readers see, retire, unpublish, bring back, delete. */
export const canEdit = (p: Perms, kind: TargetKind, doc?: Belongs) => editsAll(p, kind) || ownsPlatformOrPractice(p, doc);
/** The same as `canEdit`, by the name the editing screen uses for it. */
export const canPublish = canEdit;

/** May open the editing screen and save a draft of it (both kinds of draft), not necessarily publish. */
export const canDraft = (p: Perms, kind: TargetKind, doc?: Belongs) => canEdit(p, kind, doc) || memberOfPlatformOrPractice(p, doc);

/** May confirm its review and answer its feedback. */
export const canManage = (p: Perms, kind: TargetKind, doc?: Belongs) =>
  canEdit(p, kind, doc) || (!!doc?.owner && (p.owns ?? []).includes(doc.owner));

/** May see it while it is a draft, and its unpublished changes. */
export const seesDrafts = (p: Perms, kind: TargetKind, doc?: Belongs) => canManage(p, kind, doc) || canDraft(p, kind, doc);

/** Whether somebody is a member (not an owner) of some platform or practice. */
export const isMember = (p: Perms) => (p.memberPlatforms ?? []).length > 0 || (p.memberPractices ?? []).length > 0;

/**
 * May create a new process (or standard): a general editor, or somebody who owns or is a member
 * of a platform or a practice. What they create starts as a draft placed on one of theirs.
 */
export const canCreate = (p: Perms, kind: TargetKind) =>
  editsAll(p, kind) || (p.platforms ?? []).length > 0 || (p.practices ?? []).length > 0 || isMember(p);

/**
 * Whether a change would take a document out of reach of somebody who may change it only through
 * their platforms and practices: they may draft what is saved, but not what it would become. The
 * server refuses such a save, so a document cannot be moved into something that is not theirs.
 */
export const wouldLoseEdit = (p: Perms, kind: TargetKind, saved?: Belongs, now?: Belongs) => canDraft(p, kind, saved) && !canDraft(p, kind, now);

/**
 * Whether a change would leave somebody able to draft a document but no longer to publish it: an
 * owner who moves it to a platform or practice where they are only a member. Allowed, but they
 * should know.
 */
export const wouldLosePublish = (p: Perms, kind: TargetKind, saved?: Belongs, now?: Belongs) =>
  canPublish(p, kind, saved) && !canPublish(p, kind, now) && canDraft(p, kind, now);

export type BelongsField = "platform" | "practice";

/** The platforms (or practices) somebody may place a draft on: where they are an owner or a member, sorted, once each. */
export const placesOf = (p: Perms, field: BelongsField): string[] =>
  [...new Set(field === "platform" ? [...(p.platforms ?? []), ...(p.memberPlatforms ?? [])] : [...(p.practices ?? []), ...(p.memberPractices ?? [])])].sort();
const placesValue = (p: Perms, field: BelongsField, id: string) => placesOf(p, field).includes(id);

/**
 * How somebody may set the platform (or the practice) of a document whose saved value is
 * `saved` (undefined: none, or a new document). A general editor may pick any. Somebody who
 * works only through their platforms and practices (as an owner or a member) may set or change
 * it only from one of theirs (or none) to one of theirs (or none): "own" means None or one of
 * theirs, "locked" means the saved value is somebody else's and stays as it is. The server
 * applies the same rule.
 */
export function belongsChoice(p: Perms, kind: TargetKind, field: BelongsField, saved?: string): "any" | "own" | "locked" {
  if (editsAll(p, kind)) return "any";
  return saved && !placesValue(p, field, saved) ? "locked" : "own";
}

/**
 * Which of platform and practice a save from `saved` (undefined: a new document) to `now` would
 * change in a way the person may not, by the rule of `belongsChoice`. Empty: allowed.
 */
export function belongsRefused(p: Perms, kind: TargetKind, saved: Belongs | undefined, now: Belongs): BelongsField[] {
  if (editsAll(p, kind)) return [];
  return (["platform", "practice"] as const).filter((field) => {
    const was = saved?.[field] || undefined, is = now[field] || undefined;
    if (was === is) return false;
    return (!!was && !placesValue(p, field, was)) || (!!is && !placesValue(p, field, is));
  });
}

/**
 * Where somebody who may not place a new document anywhere chooses to put it: their platforms
 * and practices, owned first, then those they are a member of. Empty for a general editor, who
 * may put it anywhere. `publishes` says whether they could publish it there.
 */
export function newDocPlaces(p: Perms, kind: TargetKind): { kind: BelongsField; id: string; publishes: boolean }[] {
  if (editsAll(p, kind)) return [];
  const out: { kind: BelongsField; id: string; publishes: boolean }[] = [];
  const add = (k: BelongsField, ids: string[] | undefined, publishes: boolean) => {
    for (const id of [...(ids ?? [])].sort()) if (!out.some((x) => x.kind === k && x.id === id)) out.push({ kind: k, id, publishes });
  };
  add("platform", p.platforms, true);
  add("practice", p.practices, true);
  add("platform", p.memberPlatforms, false);
  add("practice", p.memberPractices, false);
  return out;
}

/** The Admin panel has something for admins and for people who manage the lists. */
export const canOpenAdmin = (p: Perms) => p.admin || p.catalog;

/** What somebody is in one team, platform or practice: an owner, a member, or nothing (undefined). The stronger wins. */
export function groupRank(p: Perms, kind: GroupKind, id: string): GroupRank | undefined {
  if (!id) return undefined;
  if (kind === "team") return (p.owns ?? []).includes(id) ? "owner" : undefined;
  const [owners, members] = kind === "platform" ? [p.platforms, p.memberPlatforms] : [p.practices, p.memberPractices];
  if ((owners ?? []).includes(id)) return "owner";
  return (members ?? []).includes(id) ? "member" : undefined;
}

/** May add and remove the members of this platform or practice: an admin, or one of its owners. Nobody for a team, which has no members. */
export const canManageMembers = (p: Perms, kind: GroupKind, id: string) =>
  kind !== "team" && !!id && (p.admin || groupRank(p, kind, id) === "owner");

/** May change the description and the contact details of this team, platform or practice: an admin, a lists manager, or one of its owners (a team's Owner for a team). */
export const canChangeDetails = (p: Perms, kind: GroupKind, id: string) =>
  p.admin || p.catalog || (!!id && groupRank(p, kind, id) === "owner");

/** What somebody is, in a few words, for the account menu. */
export function roleLabel(p: Perms): string {
  if (p.admin) return "Admin";
  const parts: string[] = [];
  if (p.processes) parts.push("Process editor");
  if (p.standards) parts.push("Standards editor");
  if ((p.platforms ?? []).length) parts.push("Platform owner");
  if ((p.practices ?? []).length) parts.push("Practice owner");
  if ((p.memberPlatforms ?? []).length) parts.push("Platform member");
  if ((p.memberPractices ?? []).length) parts.push("Practice member");
  if (p.catalog) parts.push("Manages the lists");
  if ((p.owns ?? []).length) parts.push("Owner");
  return parts.join(" · ") || "Reader";
}
