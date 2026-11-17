import type { Membership, Role } from "../types";

/**
 * The groups people belong to: teams, platforms and practices. A person can be in several at
 * the same time. Being in one is a role that is limited to it:
 * - a team's members are its Owners: what the team maintains is theirs to review, and its
 *   feedback theirs to answer;
 * - a platform's or a practice's members are its owners: they may also change the processes
 *   and standards that belong to it.
 */
export type GroupKind = "team" | "platform" | "practice";
export type MemberRole = Membership["role"];

/** The role that makes somebody a member of each kind of group. */
export const MEMBER_ROLE: Record<GroupKind, MemberRole> = { team: "owner", platform: "platform-owner", practice: "practice-owner" };
/** The kind of group a role makes somebody a member of, for the three roles that do. */
export const groupKindOf = (role: Role): GroupKind | undefined =>
  (Object.keys(MEMBER_ROLE) as GroupKind[]).find((k) => MEMBER_ROLE[k] === role);

/** How each kind of group is called in a sentence, and what its members may do. */
export const GROUP: Record<GroupKind, { noun: string; member: string; may: string }> = {
  team: { noun: "team", member: "Owner", may: "confirm the reviews of what the team maintains and answer its feedback" },
  platform: { noun: "platform", member: "Platform owner", may: "change the processes and standards that belong to the platform, confirm their reviews and answer their feedback" },
  practice: { noun: "practice", member: "Practice owner", may: "change the processes and standards that belong to the practice, confirm their reviews and answer their feedback" },
};

/**
 * The members of one team, platform or practice: everyone with the role for it, once each and
 * sorted by email. Works on what the admin sees (with who gave the role and when) and on what
 * everyone may read.
 */
export function membersOf<T extends { email: string; role: string; scope: string }>(list: T[], kind: GroupKind, id: string): T[] {
  if (!id) return []; // a role that is not limited to a group covers everything: that is not membership
  const out = new Map<string, T>();
  for (const a of list) if (a.role === MEMBER_ROLE[kind] && a.scope === id && !out.has(a.email)) out.set(a.email, a);
  return [...out.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Whether a text looks like an email address; the server has the last word. */
export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
