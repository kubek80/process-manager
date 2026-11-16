import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import type { Role, Team } from "../types";
import { looksLikeEmail, membersOf } from "../lib/members";
import { usePerms } from "../lib/session";
import { grantAccess, loadAccess, revokeAccess, type Access } from "../lib/store";
import { confirmDialog, LoadError, Loading, notify } from "./ui";

const LABEL: Partial<Record<Role, string>> = { owner: "Owner", "standards-editor": "Standards editor" };

/**
 * Who belongs to a team or unit. A member is somebody with the Owner role for it: what the team
 * owns is theirs to review, and its feedback theirs to close. A unit can also have people who
 * edit its standards. Members are added and removed here by an admin; it is the same thing as
 * giving or taking the role under Access, seen from the team's side.
 *
 * `saved` is false for a team that was added but not saved yet: it has to exist before anybody
 * can belong to it.
 */
export function TeamMembers({ team, saved }: { team: Team; saved: boolean }) {
  const perms = usePerms();
  const unit = !!team.kind && team.kind !== "team";
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("owner");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setError(""); loadAccess().then(setAccess, (e) => setError(e.message)); }, []);
  useEffect(() => { if (perms.admin) load(); }, [perms.admin, load]);
  useEffect(() => { setEmail(""); setRole("owner"); }, [team.id]);

  // who has which role is for admins; everyone else who manages the lists is told where to ask
  if (!perms.admin) {
    return (
      <div className="cat-members">
        <h3>Members</h3>
        <p className="muted small">The people who are Owner for this {unit ? "unit" : "team"} see what it owns under “My responsibilities”. An admin adds and removes them.</p>
      </div>
    );
  }

  const members = access ? membersOf(access.assignments, team.id) : [];
  const add = async () => {
    const who = email.trim().toLowerCase();
    if (!looksLikeEmail(who) || busy) return;
    setBusy(true);
    try { setAccess(await grantAccess({ email: who, role, scope: team.id })); setEmail(""); }
    catch (e) { notify.error(`${who} could not be added.`, e); /* what was typed stays in the field */ }
    finally { setBusy(false); }
  };
  const remove = async (who: string, r: Role) => {
    const ok = await confirmDialog({
      title: "Remove this member?",
      body: <>{who} is no longer {LABEL[r]} for “{team.name}”. {r === "owner" ? "What the team owns disappears from their responsibilities." : "They can no longer edit its standards."} This takes effect at once.</>,
      confirmLabel: "Remove", danger: true,
    });
    if (!ok) return;
    try { setAccess(await revokeAccess({ email: who, role: r, scope: team.id })); }
    catch (e) { notify.error(`${who} could not be removed.`, e); }
  };

  return (
    <div className="cat-members">
      <h3>Members {access && <span>{members.length}</span>}</h3>
      <p className="muted small">A member is Owner for this {unit ? "unit" : "team"}: what it owns is theirs to review and its feedback theirs to close, under “My responsibilities”.{unit && " A unit can also have people who edit its standards."}</p>
      {!saved && <p className="muted">Save the lists first: the {unit ? "unit" : "team"} has to exist before somebody can belong to it.</p>}
      {saved && error && <LoadError what="The members could not be loaded." error={error} onRetry={load} />}
      {saved && !access && !error && <Loading />}
      {saved && access && (
        <>
          {members.length === 0 && <p className="muted">Nobody yet. Until somebody is added, nobody is asked to review what this {unit ? "unit" : "team"} owns.</p>}
          <ul className="people">
            {members.map((m) => (
              <li key={m.email}>
                <span className="avatar">{m.email.slice(0, 1).toUpperCase()}</span>
                <span className="person"><strong>{m.email}</strong><em>since {m.roles[0].grantedAt.slice(0, 10)}, added by {m.roles[0].grantedBy}</em></span>
                <span className="role-chips">
                  {m.roles.map((r) => (
                    <span key={r.role} className="role-chip">
                      {LABEL[r.role]}
                      <button aria-label={`Remove ${m.email} as ${LABEL[r.role]}`} onClick={() => remove(m.email, r.role)}><Trash2 size={12} /></button>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <form className="member-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <UserPlus size={15} aria-hidden="true" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-label="Email of the new member" />
            {unit && (
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="As">
                <option value="owner">as Owner</option>
                <option value="standards-editor">as Standards editor</option>
              </select>
            )}
            <button className="btn small primary" disabled={!looksLikeEmail(email) || busy}><Plus size={14} />Add member</button>
          </form>
        </>
      )}
    </div>
  );
}
