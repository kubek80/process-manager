import type { Membership, Role } from "../types";

/**
 * The groups people belong to: teams, platforms and practices. A person can be in several at
 * the same time. Belonging to one is a role that is limited to it, of one of two ranks:
 * - its owners: a team's Owners review what the team maintains and answer its feedback; a
 *   platform's or a practice's owners may also change and publish what belongs to it, and add
 *   and remove its members;
 * - its members (platforms and practices only): they may create drafts there and save
 *   unpublished changes, which an owner publishes.
 */
export type GroupKind = "team" | "platform" | "practice";
export type MemberRole = Membership["role"];
/** Owner or member of a group. A team has only owners. */
export type GroupRank = "owner" | "member";

/** The role that makes somebody an owner of each kind of group. */
export const OWNER_ROLE: Record<GroupKind, MemberRole> = { team: "owner", platform: "platform-owner", practice: "practice-owner" };
/** The role that makes somebody a member of a platform or a practice. A team has no members. */
export const MEMBER_ROLE: Record<Exclude<GroupKind, "team">, MemberRole> = { platform: "platform-member", practice: "practice-member" };

/** The role for one rank of one kind of group; undefined for a team's members, which do not exist. */
export const roleFor = (kind: GroupKind, rank: GroupRank): MemberRole | undefined =>
  rank === "owner" ? OWNER_ROLE[kind] : kind === "team" ? undefined : MEMBER_ROLE[kind];

/** Whether a kind of group has members besides its owners. */
export const hasMembers = (kind: GroupKind): kind is "platform" | "practice" => kind !== "team";

/** The kind of group a role makes somebody an owner or a member of, for the five roles that do. */
export const groupKindOf = (role: Role): GroupKind | undefined =>
  (Object.keys(OWNER_ROLE) as GroupKind[]).find((k) => OWNER_ROLE[k] === role || roleFor(k, "member") === role);

/** Whether a role makes somebody an owner or a member of a group; undefined for the other roles. */
export const rankOf = (role: Role): GroupRank | undefined => {
  const kind = groupKindOf(role);
  return !kind ? undefined : OWNER_ROLE[kind] === role ? "owner" : "member";
};

/** How each kind of group is called in a sentence, and what its owners and members may do. */
export const GROUP: Record<GroupKind, { noun: string; owner: string; ownersMay: string; member?: string; membersMay?: string }> = {
  team: { noun: "team", owner: "Owner", ownersMay: "confirm the reviews of what the team maintains and answer its feedback" },
  platform: {
    noun: "platform",
    owner: "Platform owner", ownersMay: "change and publish the processes and standards that belong to the platform, confirm their reviews, answer their feedback and add its members",
    member: "Platform member", membersMay: "create drafts of processes and standards on the platform and suggest changes to what belongs to it, which an owner publishes",
  },
  practice: {
    noun: "practice",
    owner: "Practice owner", ownersMay: "change and publish the processes and standards that belong to the practice, confirm their reviews, answer their feedback and add its members",
    member: "Practice member", membersMay: "create drafts of processes and standards in the practice and suggest changes to what belongs to it, which an owner publishes",
  },
};

/** The name of one rank of one kind of group, e.g. "Platform member". */
export const rankLabel = (kind: GroupKind, rank: GroupRank) => (rank === "owner" ? GROUP[kind].owner : GROUP[kind].member ?? GROUP[kind].owner);

/**
 * The owners (or the members) of one team, platform or practice: everyone with that role for it,
 * once each and sorted by email. Works on what the admin sees (with who gave the role and when)
 * and on what everyone may read. Without `rank`, the owners, as before members existed.
 */
export function membersOf<T extends { email: string; role: string; scope: string }>(list: T[], kind: GroupKind, id: string, rank: GroupRank = "owner"): T[] {
  if (!id) return []; // a role that is not limited to a group covers everything: that is not membership
  const role = roleFor(kind, rank);
  if (!role) return [];
  const out = new Map<string, T>();
  for (const a of list) if (a.role === role && a.scope === id && !out.has(a.email)) out.set(a.email, a);
  return [...out.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** A person as the portal knows them: the address, and the name where the portal knows it. */
export interface PersonRef { email: string; name?: string }

/**
 * How a person is shown in the app: by name where it is known, else by address. The one place
 * that decides it; where a person is drawn as an element, the address is its tooltip (and its
 * mail link).
 */
export const personLabel = (p: PersonRef) => p.name?.trim() || p.email;

/**
 * The names the portal knows, by lower-case address, from lists of people such as
 * `GET /api/members` or the admin's users. An earlier list wins; an entry without a name adds nothing.
 */
export function knownNames(...lists: (readonly PersonRef[] | null | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const list of lists) for (const p of list ?? []) {
    const key = p.email.toLowerCase(), name = p.name?.trim();
    if (name && !out[key]) out[key] = name;
  }
  return out;
}

/** Whether a text looks like an email address; the server has the last word. */
export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
