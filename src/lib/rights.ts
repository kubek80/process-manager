import type { Perms, TargetKind } from "../types";

/**
 * What the signed-in person may do with a process or a standard, worked out in the browser from
 * the rights the server sent. The server decides; these only show or hide controls, and follow
 * the same rules:
 *
 * - May edit (save, create, delete, restore): an admin; a process editor for every process; a
 *   standards editor for every standard; an owner of the platform or of the practice the
 *   document belongs to.
 * - May manage (confirm reviews, answer feedback, see drafts): whoever may edit, and an Owner
 *   of the team that maintains it.
 */

/** What a process or standard belongs to, as far as rights go. */
export interface Belongs { owner?: string; platform?: string; practice?: string }

/** No rights at all: what somebody has before the server said otherwise. */
export const NO_PERMS: Perms = { admin: false, catalog: false, processes: false, standards: false, owns: [], platforms: [], practices: [] };

/** Rights as the server sent them, with every list present (an older server may leave one out). */
export const completePerms = (p?: Partial<Perms> | null): Perms => ({
  admin: !!p?.admin, catalog: !!p?.catalog, processes: !!p?.processes, standards: !!p?.standards,
  owns: p?.owns ?? [], platforms: p?.platforms ?? [], practices: p?.practices ?? [],
});

/** Whether somebody may change every process (or every standard), whatever it belongs to. */
export const editsAll = (p: Perms, kind: TargetKind) => p.admin || (kind === "process" ? p.processes : p.standards);

/** Whether this document belongs to one of the person's platforms or practices. */
export const ownsPlatformOrPractice = (p: Perms, doc?: Belongs) =>
  (!!doc?.platform && (p.platforms ?? []).includes(doc.platform)) || (!!doc?.practice && (p.practices ?? []).includes(doc.practice));

/** May change, delete or restore this process or standard. */
export const canEdit = (p: Perms, kind: TargetKind, doc?: Belongs) => editsAll(p, kind) || ownsPlatformOrPractice(p, doc);

/** May confirm its review, answer its feedback and see it while it is a draft. */
export const canManage = (p: Perms, kind: TargetKind, doc?: Belongs) =>
  canEdit(p, kind, doc) || (!!doc?.owner && (p.owns ?? []).includes(doc.owner));

/** May create a new process (or standard): a general editor, or somebody who owns a platform or a practice. */
export const canCreate = (p: Perms, kind: TargetKind) => editsAll(p, kind) || (p.platforms ?? []).length > 0 || (p.practices ?? []).length > 0;

/**
 * Whether a change would take a document away from somebody who may change it only through
 * their platforms and practices: they may edit what is saved, but not what it would become. The
 * server refuses such a save, so a document cannot be moved into something they do not own.
 */
export const wouldLoseEdit = (p: Perms, kind: TargetKind, saved?: Belongs, now?: Belongs) => canEdit(p, kind, saved) && !canEdit(p, kind, now);

export type BelongsField = "platform" | "practice";
const ownsValue = (p: Perms, field: BelongsField, id: string) => ((field === "platform" ? p.platforms : p.practices) ?? []).includes(id);

/**
 * How somebody may set the platform (or the practice) of a document whose saved value is
 * `saved` (undefined: none, or a new document). A general editor may pick any. Somebody who
 * edits only through their platforms and practices may set or change it only when they own both
 * the saved value (if any) and the new one (if any): "own" means None or one of theirs, "locked"
 * means the saved value is somebody else's and stays as it is. The server applies the same rule.
 */
export function belongsChoice(p: Perms, kind: TargetKind, field: BelongsField, saved?: string): "any" | "own" | "locked" {
  if (editsAll(p, kind)) return "any";
  return saved && !ownsValue(p, field, saved) ? "locked" : "own";
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
    return (!!was && !ownsValue(p, field, was)) || (!!is && !ownsValue(p, field, is));
  });
}

/** The Admin panel has something for admins and for people who manage the lists. */
export const canOpenAdmin = (p: Perms) => p.admin || p.catalog;

/** What somebody is, in a few words, for the account menu. */
export function roleLabel(p: Perms): string {
  if (p.admin) return "Admin";
  const parts: string[] = [];
  if (p.processes) parts.push("Process editor");
  if (p.standards) parts.push("Standards editor");
  if ((p.platforms ?? []).length) parts.push("Platform owner");
  if ((p.practices ?? []).length) parts.push("Practice owner");
  if (p.catalog) parts.push("Manages the lists");
  if ((p.owns ?? []).length) parts.push("Owner");
  return parts.join(" · ") || "Reader";
}
