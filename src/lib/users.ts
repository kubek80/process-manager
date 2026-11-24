import type { Role } from "../types";
import { groupKindOf, looksLikeEmail, type GroupKind } from "./members";
import { formatDateTime } from "./dates";
import { opensChange } from "./rights";

// Admin > Access: the people with roles, one entry per person, and the dialog that sets all of a
// person's roles at once. The server has the last word; what can be told before sending is told
// here, in plain words.

/** The roles, what they allow in plain words, and for the five that are limited to a group: which list it is picked from. */
export const ROLES: Record<Role, { label: string; can: string; scope: "none" | "required"; scopeLabel?: string; always?: string }> = {
  admin: { label: "Admin", can: "Everything, including who has access", scope: "none" },
  "catalog-manager": { label: "Lists manager", can: "Teams, practices, platforms, categories, tools, tiers, environments, languages", scope: "none" },
  "process-editor": { label: "Process editor", can: "Create and change every process; close its feedback", scope: "none" },
  "standards-editor": { label: "Standards editor", can: "Create and change every standard; close its feedback", scope: "none" },
  "platform-owner": { label: "Platform owner", can: "Create, change and publish the processes and standards that belong to a platform; confirm their reviews, close their feedback and add its members", scope: "required", scopeLabel: "For the platform", always: "Always for one platform" },
  "practice-owner": { label: "Practice owner", can: "Create, change and publish the processes and standards that belong to a practice; confirm their reviews, close their feedback and add its members", scope: "required", scopeLabel: "For the practice", always: "Always for one practice" },
  "platform-member": { label: "Platform member", can: "Create drafts of processes and standards on a platform and suggest changes to what belongs to it; an owner publishes them", scope: "required", scopeLabel: "For the platform", always: "Always for one platform" },
  "practice-member": { label: "Practice member", can: "Create drafts of processes and standards in a practice and suggest changes to what belongs to it; an owner publishes them", scope: "required", scopeLabel: "For the practice", always: "Always for one practice" },
  owner: { label: "Owner", can: "Confirm reviews and close feedback on what a team maintains; see its drafts", scope: "required", scopeLabel: "For the team", always: "Always for one team" },
};
/** The order roles are shown in: the widest first. */
export const ROLE_ORDER: Role[] = ["admin", "catalog-manager", "process-editor", "standards-editor", "platform-owner", "practice-owner", "platform-member", "practice-member", "owner"];

export interface UserRole { role: Role; scope: string }
/** One person in Admin > Access, as `GET /api/admin/users` sends it. */
export interface AdminUser {
  email: string;
  name?: string;
  roles: (UserRole & { grantedBy?: string; grantedAt?: string })[];
  /** An admin named in the server settings: stays admin whatever is set here. */
  bootstrap: boolean;
}

/** The teams, platforms and practices a role can be limited to, by kind. */
export type Groups = Record<GroupKind, { id: string; name: string }[]>;

/** Where the admins named in the server settings are set, for the sentences below. */
export const BOOTSTRAP_PLACE = "the settings where the portal is installed";
/** The same, for the people who run the portal: the name of the setting. */
export const BOOTSTRAP_SETTING = "PM_ADMINS";

const nameIn = (groups: Groups, kind: GroupKind, id: string) => groups[kind].find((g) => g.id === id)?.name ?? id;

/** One role as a readable line: "Admin", "Platform owner for Google Cloud". */
export function roleLine(r: UserRole, groups: Groups): string {
  const kind = groupKindOf(r.role);
  const label = ROLES[r.role]?.label ?? r.role;
  return kind && r.scope ? `${label} for ${nameIn(groups, kind, r.scope)}` : label;
}

/** The roles in the order they are shown, each once; a role that is limited without a team, platform or practice is left out. */
export function normalRoles(roles: UserRole[]): UserRole[] {
  const seen = new Set<string>();
  const out: UserRole[] = [];
  for (const r of roles) {
    const scope = groupKindOf(r.role) ? r.scope.trim() : "";
    if (groupKindOf(r.role) && !scope) continue;
    const key = `${r.role}\u0000${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: r.role, scope });
  }
  const rank = (r: Role) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };
  return out.sort((a, b) => rank(a.role) - rank(b.role) || a.scope.localeCompare(b.scope));
}

/** What the dialog holds: for each role whether it is switched on and, for a limited role, the teams, platforms or practices picked (an empty pick is ""). */
export type RoleChoices = Record<Role, { on: boolean; scopes: string[] }>;

export function choicesOf(roles: UserRole[]): RoleChoices {
  const out = Object.fromEntries(ROLE_ORDER.map((r) => [r, { on: false, scopes: [] as string[] }])) as RoleChoices;
  for (const r of roles) {
    if (!out[r.role]) continue;
    out[r.role].on = true;
    if (groupKindOf(r.role) && r.scope) out[r.role].scopes.push(r.scope);
  }
  for (const r of ROLE_ORDER) if (groupKindOf(r) && out[r].on && out[r].scopes.length === 0) out[r].scopes.push("");
  return out;
}

/** The complete set of roles the dialog sends (`PUT /api/admin/users/{email}`). */
export function rolesOf(c: RoleChoices): UserRole[] {
  const out: UserRole[] = [];
  for (const role of ROLE_ORDER) {
    const v = c[role];
    if (!v?.on) continue;
    if (groupKindOf(role)) for (const s of v.scopes) out.push({ role, scope: s });
    else out.push({ role, scope: "" });
  }
  return normalRoles(out);
}

/** What changes: the roles given and the roles taken away. */
export function rolesDiff(before: UserRole[], after: UserRole[]): { added: UserRole[]; removed: UserRole[] } {
  const key = (r: UserRole) => `${r.role}\u0000${r.scope}`;
  const b = normalRoles(before), a = normalRoles(after);
  const bk = new Set(b.map(key)), ak = new Set(a.map(key));
  return { added: a.filter((r) => !bk.has(key(r))), removed: b.filter((r) => !ak.has(key(r))) };
}

/** The admins other than `email`: stored ones and those named in the server settings. */
const otherAdmins = (users: AdminUser[], email: string) =>
  users.filter((u) => u.email.toLowerCase() !== email.toLowerCase() && (u.bootstrap || u.roles.some((r) => r.role === "admin"))).length;

/** Whether `user` is the only admin: taking their admin role away would leave nobody to manage access. */
export function isLastAdmin(user: AdminUser, users: AdminUser[]): boolean {
  return !user.bootstrap && user.roles.some((r) => r.role === "admin") && otherAdmins(users, user.email) === 0;
}

export interface RolesCheck {
  /** The address typed in "Add person"; the person's own when editing. */
  email: string;
  choices: RoleChoices;
  /** The person as stored; undefined when adding somebody new. */
  user?: AdminUser;
  users: AdminUser[];
  groups: Groups;
  /** The signed-in admin. */
  me: string;
}

/** What stops the dialog's Save, in plain words; empty when it can be sent. */
export function roleProblems(c: RolesCheck): string[] {
  const out: string[] = [];
  const email = c.email.trim().toLowerCase();
  if (!c.user) {
    if (!looksLikeEmail(email)) out.push("Type the person's email address, such as name@company.com.");
    else if (c.users.some((u) => u.email.toLowerCase() === email)) out.push(`${email} already has roles. Close this and use Edit on their entry.`);
  }
  for (const role of ROLE_ORDER) {
    const v = c.choices[role];
    const kind = groupKindOf(role);
    if (!v?.on || !kind) continue;
    const label = ROLES[role].label;
    if (v.scopes.length === 0 || v.scopes.some((s) => !s)) out.push(`Choose the ${kind} for ${label}, or remove that line.`);
    const seen = new Set<string>();
    for (const s of v.scopes.filter(Boolean)) {
      if (seen.has(s)) { out.push(`${label} for ${nameIn(c.groups, kind, s)} is chosen twice.`); continue; }
      seen.add(s);
      if (!c.groups[kind].some((g) => g.id === s)) out.push(`The ${kind} “${s}” is no longer in the lists. Choose another one for ${label}, or remove that line.`);
    }
  }
  const after = rolesOf(c.choices);
  // only when nothing is ticked at all: a ticked role without its team, platform or practice is said above
  if (!c.user && after.length === 0 && !ROLE_ORDER.some((r) => c.choices[r]?.on)) out.push("Give at least one role. Everyone who can sign in can already read.");
  if (c.user && !c.user.bootstrap && c.user.roles.some((r) => r.role === "admin") && !after.some((r) => r.role === "admin")) {
    if (isLastAdmin(c.user, c.users)) out.push(`${c.user.email} is the only admin. Make someone else an admin first, or nobody could manage access any more.`);
    else if (c.user.email.toLowerCase() === c.me.toLowerCase()) out.push("You cannot take away your own admin role: you would lose access to this page. Ask another admin to do it.");
  }
  return out;
}

/** Why a person cannot be deleted here, in plain words; "" when they can. */
export function deleteBlocked(user: AdminUser, users: AdminUser[], me: string): string {
  if (user.email.toLowerCase() === me.toLowerCase()) return "You cannot delete yourself. Ask another admin to do it.";
  if (user.bootstrap) return `${user.email} is an admin named in ${BOOTSTRAP_PLACE}. They cannot be removed here.`;
  if (isLastAdmin(user, users)) return `${user.email} is the only admin. Make someone else an admin first.`;
  return "";
}

/** The roles shown for a person, including the admin role that comes from the server settings. */
export function shownRoles(user: AdminUser): UserRole[] {
  const roles = normalRoles(user.roles);
  return user.bootstrap && !roles.some((r) => r.role === "admin") ? [{ role: "admin", scope: "" }, ...roles] : roles;
}

/** Whether a person matches the search box: name, email or any of their roles. */
export function userMatches(user: AdminUser, q: string, groups: Groups): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [user.name ?? "", user.email, ...shownRoles(user).map((r) => roleLine(r, groups))].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

// Viewing the portal as somebody else: who may start it is decided in ./rights (`mayViewAs`);
// these are its words and where "Stop viewing" goes.

/** The button on a person's entry, and its full name for screen readers. */
export const VIEW_AS_BUTTON = "View as";
export const viewAsName = (label: string) => `View the portal as ${label}`;
/** What the button explains on hover. */
export const viewAsHint = (label: string) => `See the portal exactly as ${label} sees it: what they can read, their responsibilities and their buttons. You cannot change anything while you do; it ends after an hour.`;

/** Where "Stop viewing" goes when the place viewing started from is not known: Admin › Access. */
export const VIEW_AS_HOME = "#/admin/access";

/** The place to go back to after viewing: the one remembered when it started (a place of the portal, never the editing screen), else Admin › Access. */
export function returnPlace(saved: string | null | undefined): string {
  return saved && /^#\/[^\s<>"]*$/.test(saved) && !opensChange(saved) ? saved : VIEW_AS_HOME;
}

/** "15:42": when viewing ends by itself, in the reader's own time; "" when not known. */
export function viewingEnds(until?: string): string {
  return formatDateTime(until).split(" ")[1] ?? "";
}
