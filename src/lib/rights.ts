import type { Perms, TargetKind } from "../types";
import type { GroupKind, GroupRank } from "./members";
import { href, parseRoute, type Route } from "./store";

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
 * - May publish it as it is now (`canPublish` with its placement): who may publish what is
 *   stored, owning every platform and practice the publication depends on (`publishPlaces`).
 * - Sees a never-published document: whoever may manage or draft it (`seesDrafts`). Sees the
 *   unpublished changes of a published one (`meta[id].draft`, the working draft): whoever may
 *   draft it (`canDraft`); a team's Owner does not.
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

/** May publish this process or standard as stored: save what readers see, retire, unpublish, bring back, delete. */
export const canEdit = (p: Perms, kind: TargetKind, doc?: Belongs) => editsAll(p, kind) || ownsPlatformOrPractice(p, doc);

/** A platform or practice, by its id. */
export interface Place { kind: BelongsField; id: string }
const placesIn = (b: Belongs | undefined): Place[] =>
  (["platform", "practice"] as const).filter((k) => !!b?.[k]).map((k) => ({ kind: k, id: b![k]! }));

/**
 * Whose ownership publishing depends on, besides an editor of the kind (who may always), as the
 * server decides it. `saved`: where the document is stored; `now`: where the changes put it;
 * `published`: readers see a version of it already.
 * - `all` false: an owner of any one of `places` (a published document whose platform and
 *   practice stay as they are: its stored places).
 * - `all` true: somebody who owns every one of `places`: a never-published document needs its
 *   whole placement, as a new one; a platform or practice changed needs an owner of where it
 *   was and of where it goes (and of what it is stored on, and what it will be on).
 * Empty `places`: only an editor.
 */
export function publishPlaces(saved: Belongs | undefined, now: Belongs, published: boolean): { all: boolean; places: Place[] } {
  const was = saved ?? now;
  const moved = (["platform", "practice"] as const).filter((k) => (was[k] || undefined) !== (now[k] || undefined));
  if (published && !moved.length) return { all: false, places: placesIn(was) };
  const out: Place[] = [];
  const add = (x: Place[]) => { for (const pl of x) if (!out.some((o) => o.kind === pl.kind && o.id === pl.id)) out.push(pl); };
  if (!published) add(placesIn(now));
  for (const k of moved) add(placesIn({ [k]: was[k] }));
  for (const k of moved) add(placesIn({ [k]: now[k] }));
  // what it is stored on, and what it will be on, must be somebody's at all
  if (moved.length && !moved.some((k) => was[k])) add(placesIn(was));
  if (moved.length && !moved.some((k) => now[k])) add(placesIn(now));
  const order = (x: Place) => (x.kind === "platform" ? 0 : 1);
  return { all: true, places: out.sort((a, b) => order(a) - order(b)) };
}

const ownsPlace = (p: Perms, x: Place) => ((x.kind === "platform" ? p.platforms : p.practices) ?? []).includes(x.id);

/**
 * May publish this document. Without a new placement (`now`): as it is stored (`canEdit`). With
 * one: also the platform and practice the changes give it, by `publishPlaces` - Publish… is
 * offered exactly when the server accepts it.
 */
export function canPublish(p: Perms, kind: TargetKind, saved?: Belongs, now?: Belongs, published = true): boolean {
  if (editsAll(p, kind)) return true;
  if (!now) return canEdit(p, kind, saved);
  const need = publishPlaces(saved, now, published);
  if (!need.places.length) return false;
  return need.all ? need.places.every((x) => ownsPlace(p, x)) : need.places.some((x) => ownsPlace(p, x));
}

/** May open the editing screen and save a draft of it (both kinds of draft), not necessarily publish. */
export const canDraft = (p: Perms, kind: TargetKind, doc?: Belongs) => canEdit(p, kind, doc) || memberOfPlatformOrPractice(p, doc);

/** May confirm its review and answer its feedback. */
export const canManage = (p: Perms, kind: TargetKind, doc?: Belongs) =>
  canEdit(p, kind, doc) || (!!doc?.owner && (p.owns ?? []).includes(doc.owner));

/**
 * May see it while it was never published (a draft the server sends them): whoever may manage
 * it (a team's Owner too) or draft it. Its unpublished changes (`meta[id].draft`, the working
 * draft) are only for whoever may draft it: `canDraft`.
 */
export const seesDrafts = (p: Perms, kind: TargetKind, doc?: Belongs) => canManage(p, kind, doc) || canDraft(p, kind, doc);

/**
 * Who sees a draft (`seesDrafts`), in words for a sentence such as "Until it is published, only
 * {draftAudience} see it.": the editors of its kind, the owners and members of its platform or
 * practice, and the Owners of its team. One wording for every place that says it.
 */
export const draftAudience = (kind: TargetKind) =>
  `the ${kind === "process" ? "process" : "standards"} editors, the owners and members of its platform or practice, and the Owners of its team`;

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
export const wouldLosePublish = (p: Perms, kind: TargetKind, saved?: Belongs, now?: Belongs, published = true) =>
  canPublish(p, kind, saved) && !canPublish(p, kind, saved, now ?? {}, published) && canDraft(p, kind, now);

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

/**
 * Viewing the portal as somebody else (an admin, from Admin › Access): the person signed in sees
 * what `viewedAs` sees, and nothing can be changed. The server answers every change with
 * {@link viewingRefusal}; the app says the same where a control would change something.
 */
export interface ViewingState { user?: { email: string; name: string }; perms?: Perms; viewedBy?: { email: string; name: string; until?: string } }

/** Whether an admin is viewing the portal as somebody else (`viewedBy` from `GET /api/me`). */
export const isViewingAs = (me: ViewingState) => !!me.viewedBy;

/** The one sentence that says why nothing can be changed, the same as the server's: `label` names the person whose view it is (`personLabel`). */
export const viewingRefusal = (label: string) => `You are viewing the portal as ${label}, so nothing can be changed. Stop viewing first.`;

/** Why a change is not available right now, in that sentence; "" when it is. */
export const changeBlocked = (me: ViewingState) =>
  me.viewedBy && me.user ? viewingRefusal(me.user.name || me.user.email) : "";

/** Whether a route is the editing screen (of a process or a standard, its JSON view included). */
const isEditing = (r: Route): r is Extract<Route, { page: "edit-process" | "edit-standard" }> => r.page === "edit-process" || r.page === "edit-standard";

/**
 * Whether an address opens a screen whose purpose is to change something (the editing screen):
 * unavailable while viewing as somebody else. Decided by the router itself (`parseRoute`), so
 * that every address it opens the editing screen for counts, now and later.
 */
export const opensChange = (hash: string) => isEditing(parseRoute(hash));

/** The reader's page of what an address of the editing screen opens; the address itself for anything else. */
export const readerOf = (hash: string): string => {
  const r = parseRoute(hash);
  return isEditing(r) ? href(r.page === "edit-process" ? { page: "process", id: r.id, tab: "flow" } : { page: "standard", id: r.id, tab: "doc" }) : hash;
};

/**
 * The page shown for a route: while viewing the portal as somebody else, the editing screen is
 * never shown (its reader's page is), whatever address asked for it. The one guard where the
 * route becomes a page (`App.tsx`).
 */
export const pageWhileViewing = (r: Route, me: ViewingState): Route => {
  if (!me.viewedBy || !isEditing(r)) return r;
  return r.page === "edit-process" ? { page: "process", id: r.id, tab: "flow" } : { page: "standard", id: r.id, tab: "doc" };
};

/**
 * Whether the person signed in may start viewing the portal as `email`: an admin, by their own
 * roles (not while viewing as somebody already: stop first), never as themselves. Any address
 * can be viewed: one with no roles is seen exactly as a reader with no roles.
 */
export const mayViewAs = (me: ViewingState, email: string) =>
  !!me.perms?.admin && !me.viewedBy && !!me.user && !!email && email.trim().toLowerCase() !== me.user.email.toLowerCase();
