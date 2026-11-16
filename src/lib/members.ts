import type { Assignment, Role } from "../types";

/**
 * The people of a team or unit: everyone who holds a role that is limited to it. Being Owner
 * for a team is what makes somebody a member - its processes and standards are then theirs to
 * review and its feedback theirs to close. A unit also has the people who edit its standards.
 */
export interface Member {
  email: string;
  /** The roles this person holds for the team, Owner first. */
  roles: Assignment[];
}

const ORDER: Role[] = ["owner", "standards-editor"];

export function membersOf(assignments: Assignment[], team: string): Member[] {
  if (!team) return []; // a role that is not limited to a team covers everything: that is not membership
  const byEmail = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (a.scope !== team || !ORDER.includes(a.role)) continue;
    byEmail.set(a.email, [...(byEmail.get(a.email) ?? []), a]);
  }
  return [...byEmail.entries()]
    .map(([email, roles]) => ({ email, roles: roles.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role)) }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Whether a text looks like an email address; the server has the last word. */
export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
