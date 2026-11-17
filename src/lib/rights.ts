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

/** Anyone who can change some process or standard gets the Consumer / Editor switch. */
export const canEditSomething = (p: Perms) => canCreate(p, "process") || canCreate(p, "standard");

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
  return parts.join(" · ") || "Consumer";
}
