import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Pencil, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import type { Role } from "../types";
import { useCatalog } from "../lib/catalog";
import { groupKindOf } from "../lib/members";
import { useMe } from "../lib/session";
import { deleteUser, loadUsers, saveUserRoles } from "../lib/store";
import {
  BOOTSTRAP_PLACE, choicesOf, deleteBlocked, normalRoles, ROLE_ORDER, ROLES, roleLine, roleProblems, rolesDiff, rolesOf, shownRoles, userMatches,
  type AdminUser, type Groups, type RoleChoices,
} from "../lib/users";
import { confirmDialog, Field, LoadError, Loading, Modal, notify } from "./ui";
import "../users.css";

const initial = (u: AdminUser) => (u.name || u.email).slice(0, 1).toUpperCase();

/**
 * Admin > Access: everyone with a role, one entry per person, with all their roles as readable
 * lines. "Add person" and "Edit" open the same dialog, which sets all of a person's roles at
 * once; "Delete" takes every role away (the person can still sign in and read).
 */
export function UsersSection() {
  const { catalog } = useCatalog();
  const me = useMe().user?.email ?? "";
  const groups = useMemo<Groups>(() => ({ team: catalog.teams, platform: catalog.platforms ?? [], practice: catalog.practices ?? [] }), [catalog]);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ user?: AdminUser } | null>(null);
  const load = useCallback(() => { setError(""); loadUsers().then(setUsers, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const sorted = useMemo(() => [...(users ?? [])].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)), [users]);
  const shown = sorted.filter((u) => userMatches(u, q, groups));

  const remove = async (u: AdminUser) => {
    const lines = shownRoles(u).map((r) => roleLine(r, groups));
    const yes = await confirmDialog({
      title: `Delete ${u.name || u.email}?`,
      body: (
        <>
          <p>All of their roles are removed: {lines.join(", ")}.</p>
          <p>{u.name || u.email} can still sign in and read, tick steps and give feedback, like every colleague. You can give them roles again at any time.</p>
        </>
      ),
      confirmLabel: "Delete", danger: true,
    });
    if (!yes) return;
    deleteUser(u.email).then(() => { notify.info(`${u.email} no longer has any role.`); load(); }, (e) => notify.error(`The roles of ${u.email} could not be removed.`, e));
  };

  return (
    <div className="admin-section">
      <p className="lead small">People sign in with their company account. Everyone who can sign in can read, tick steps and give feedback; what else they may do is decided here. The members of one team, platform or practice can also be managed on it, under <a href="#/admin/lists">Lists</a>.</p>
      {error && <LoadError what="The people with roles could not be loaded." error={error} onRetry={load} />}

      <section className="admin-card users-card">
        <div className="users-bar">
          <h2>People with roles {users && <span>{users.length}</span>}</h2>
          <div className="search"><Search size={15} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or role" aria-label="Search people" /></div>
          <button className="btn primary" onClick={() => setEditing({})}><UserPlus size={16} aria-hidden="true" />Add person</button>
        </div>
        {!users && !error && <Loading />}
        {users && (
          <ul className="people users-list">
            {shown.map((u) => {
              const blocked = deleteBlocked(u, users, me);
              return (
                <li key={u.email} className="user-row">
                  <span className="avatar" aria-hidden="true">{initial(u)}</span>
                  <span className="person">
                    <strong>{u.name || u.email}{u.email.toLowerCase() === me.toLowerCase() && <i className="user-you">you</i>}</strong>
                    {u.name && <em>{u.email}</em>}
                  </span>
                  <ul className="user-roles" aria-label={`Roles of ${u.name || u.email}`}>
                    {shownRoles(u).map((r) => (
                      <li key={r.role + r.scope}>{roleLine(r, groups)}{u.bootstrap && r.role === "admin" && <span className="user-fixed" title={`Named in ${BOOTSTRAP_PLACE}`}><Lock size={11} aria-hidden="true" />server settings</span>}</li>
                    ))}
                  </ul>
                  <span className="user-actions">
                    <button className="btn small" onClick={() => setEditing({ user: u })} aria-label={`Edit ${u.name || u.email}`}><Pencil size={14} aria-hidden="true" />Edit</button>
                    <button className="btn small ghost danger" disabled={!!blocked} title={blocked || undefined} aria-label={`Delete ${u.name || u.email}`} onClick={() => remove(u)}><Trash2 size={14} aria-hidden="true" />Delete</button>
                  </span>
                  {blocked && <span className="user-note muted small">{blocked}</span>}
                </li>
              );
            })}
            {users.length === 0 && <li className="muted">Nobody has a role yet.</li>}
            {users.length > 0 && shown.length === 0 && <li className="muted">Nobody matches your search.</li>}
          </ul>
        )}
      </section>

      <section className="admin-card">
        <h2>What each role can do</h2>
        <table className="guide-table"><tbody>
          {ROLE_ORDER.map((r) => <tr key={r}><td><b>{ROLES[r].label}</b></td><td>{ROLES[r].can}{ROLES[r].always && `. ${ROLES[r].always}`}</td></tr>)}
        </tbody></table>
      </section>

      {editing && users && (
        <RolesDialog user={editing.user} users={users} groups={groups} me={me} onClose={() => setEditing(null)}
          onSaved={(email) => { setEditing(null); notify.info(`The roles of ${email} were saved.`); load(); }} />
      )}
    </div>
  );
}

/** "Add person" (no `user`) and "Edit": every role as a line that can be switched on, with its teams, platforms or practices. */
function RolesDialog({ user, users, groups, me, onClose, onSaved }: {
  user?: AdminUser; users: AdminUser[]; groups: Groups; me: string; onClose: () => void; onSaved: (email: string) => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [choices, setChoices] = useState<RoleChoices>(() => choicesOf(user?.roles ?? []));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const said = useRef<HTMLDivElement>(null); // the problems or the refusal: brought into view, the body scrolls
  const problems = roleProblems({ email, choices, user, users, groups, me });
  const before = normalRoles(user?.roles ?? []);
  const after = rolesOf(choices);
  const diff = rolesDiff(before, after);
  // an unfinished line counts as a change: pressing Save then says what is missing
  const changed = !user || diff.added.length + diff.removed.length > 0 || problems.length > 0;
  const who = user ? user.name || user.email : "";

  const set = (role: Role, next: Partial<RoleChoices[Role]>) => { setRefused(""); setChoices((c) => ({ ...c, [role]: { ...c[role], ...next } })); };
  const toggle = (role: Role, on: boolean) => set(role, { on, scopes: on && groupKindOf(role) && choices[role].scopes.length === 0 ? [""] : choices[role].scopes });
  const [asked, setAsked] = useState(0);
  useEffect(() => { if (asked) said.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [asked, refused]);
  const save = () => {
    setTried(true); setAsked((n) => n + 1);
    if (problems.length || busy || !changed) return;
    const address = user?.email ?? email.trim().toLowerCase();
    setBusy(true); setRefused("");
    saveUserRoles(address, after).then(() => onSaved(address), (e) => setRefused(e.message)).finally(() => setBusy(false));
  };

  return (
    <Modal wide title={user ? `Roles of ${who}` : "Add person"}
      subtitle={user ? (user.name ? user.email : undefined) : "Give a colleague roles. They sign in with their company account; everyone can already read."}
      onClose={onClose}
      footer={<>
        <span className="muted small roles-summary" role="status">{user && !changed ? "Nothing changed yet." : summary(diff, groups)}</span>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || (tried && problems.length > 0) || !changed} onClick={save}>{busy ? "Saving…" : user ? "Save" : "Add person"}</button>
      </>}>
      <div className="roles-dialog">
        {!user && (
          <Field label="Email">
            <input type="email" autoFocus value={email} placeholder="e.g. name@company.com" aria-invalid={tried && problems.some((p) => p.includes("email") || p.includes("already"))}
              onChange={(e) => { setEmail(e.target.value); setRefused(""); }} />
          </Field>
        )}
        <fieldset className="roles-list">
          <legend>Roles</legend>
          {ROLE_ORDER.map((role) => {
            const spec = ROLES[role];
            const kind = groupKindOf(role);
            const v = choices[role];
            const fixed = role === "admin" && !!user?.bootstrap;
            const options = kind ? groups[kind] : [];
            return (
              <div key={role} className={`role-row ${v.on || fixed ? "on" : ""}`}>
                <label className="role-switch">
                  <input type="checkbox" role="switch" checked={v.on || fixed} disabled={fixed} onChange={(e) => toggle(role, e.target.checked)} aria-describedby={`role-can-${role}`} />
                  <span className="role-name"><strong>{spec.label}</strong><em id={`role-can-${role}`}>{fixed ? `Named in ${BOOTSTRAP_PLACE}. It cannot be taken away here.` : spec.can}</em></span>
                </label>
                {kind && v.on && (
                  <div className="role-scopes">
                    {v.scopes.map((s, i) => (
                      <div key={i} className="role-scope">
                        <select value={s} aria-label={`${spec.label}: ${kind} ${i + 1}`} aria-invalid={tried && (!s || v.scopes.indexOf(s) !== i)}
                          onChange={(e) => set(role, { scopes: v.scopes.map((x, j) => (j === i ? e.target.value : x)) })}>
                          <option value="">Choose the {kind}…</option>
                          {s && !options.some((o) => o.id === s) && <option value={s}>{s} (no longer in the lists)</option>}
                          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <button type="button" className="icon-btn" aria-label={`Remove ${spec.label} line ${i + 1}`} title="Remove this line"
                          onClick={() => { const scopes = v.scopes.filter((_, j) => j !== i); set(role, { scopes, on: scopes.length > 0 }); }}><X size={15} /></button>
                      </div>
                    ))}
                    <button type="button" className="btn small ghost role-more" onClick={() => set(role, { scopes: [...v.scopes, ""] })}><Plus size={14} aria-hidden="true" />Another {kind}</button>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        {user && !user.bootstrap && after.length === 0 && problems.length === 0 && <p className="muted small">With no roles, {who} can still sign in and read like every colleague.</p>}
        <div ref={said}>
          {tried && problems.length > 0 && (
            <div className="check bad roles-problems" role="alert">
              <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {refused && <LoadError what="The roles were not saved." error={refused} />}
        </div>
      </div>
    </Modal>
  );
}

/** "Gives: … · Takes away: …" in the dialog's footer. */
function summary(diff: ReturnType<typeof rolesDiff>, groups: Groups): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`Gives: ${diff.added.map((r) => roleLine(r, groups)).join(", ")}`);
  if (diff.removed.length) parts.push(`Takes away: ${diff.removed.map((r) => roleLine(r, groups)).join(", ")}`);
  return parts.join(" · ");
}
