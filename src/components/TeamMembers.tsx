import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import type { Membership } from "../types";
import { GROUP, looksLikeEmail, MEMBER_ROLE, membersOf, type GroupKind } from "../lib/members";
import { usePerms } from "../lib/session";
import { grantAccess, loadAccess, revokeAccess, type Access } from "../lib/store";
import { confirmDialog, LoadError, Loading, notify } from "./ui";

/** What the members of a team, platform or practice do, in one sentence. */
const MEMBERS_DO: Record<GroupKind, string> = {
  team: "Members confirm the reviews of what this team maintains and answer its feedback",
  platform: "Members change the processes and standards that belong to this platform, confirm their reviews and answer their feedback",
  practice: "Members change the processes and standards that belong to this practice, confirm their reviews and answer their feedback",
};
export const memberText = (kind: GroupKind) => `${MEMBERS_DO[kind]}. They find this under “My responsibilities”.`;

/** The people of a group, read-only: what everyone may see. `members` is null while they load. */
function MemberList({ kind, id, members, error, manage }: { kind: GroupKind; id: string; members: Membership[] | null; error?: string; manage?: boolean }) {
  const list = members ? membersOf(members, kind, id) : [];
  return (
    <div className="cat-members">
      <h3>Members {members && <span>{list.length}</span>}</h3>
      <p className="muted small">{memberText(kind)}{manage && " An admin adds and removes them."}</p>
      {error && <p className="muted">The members could not be loaded: {error}</p>}
      {!members && !error && <Loading />}
      {members && list.length === 0 && <p className="muted">Nobody yet.</p>}
      {list.length > 0 && (
        <ul className="people">
          {list.map((m) => (
            <li key={m.email}>
              <span className="avatar">{m.email.slice(0, 1).toUpperCase()}</span>
              <span className="person"><a href={`mailto:${m.email}`}><strong>{m.email}</strong></a><em>{GROUP[kind].member}</em></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Who belongs to a team, a platform or a practice. A team's members are its Owners; a
 * platform's and a practice's members are their owners, who may also change what belongs to
 * them. An admin adds and removes members where the lists are managed: it is the same as giving
 * or taking the role under Access, seen from the group's side. Everyone else sees who they are.
 *
 * `saved` is false for an entry that was added but not saved yet: it has to exist before anybody
 * can belong to it.
 */
export function GroupMembers({ kind, id, name, saved, manage, members, membersError, onChanged }: {
  kind: GroupKind; id: string; name: string; saved: boolean;
  /** Where the lists are managed: an admin can add and remove members here. */
  manage: boolean;
  /** What everyone may read about members; null while it loads. */
  members: Membership[] | null; membersError?: string;
  /** Called after an admin added or removed somebody here. */
  onChanged?: () => void;
}) {
  const perms = usePerms();
  const admin = manage && perms.admin;
  const role = MEMBER_ROLE[kind];
  const noun = GROUP[kind].noun;
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setError(""); loadAccess().then(setAccess, (e) => setError(e.message)); }, []);
  useEffect(() => { if (admin) load(); }, [admin, load]);
  useEffect(() => { setEmail(""); }, [kind, id]);

  if (!admin) {
    if (!saved) return null; // nobody can belong to something that does not exist yet
    return <MemberList kind={kind} id={id} members={members} error={membersError} manage={manage} />;
  }

  const list = access ? membersOf(access.assignments, kind, id) : [];
  const add = async () => {
    const who = email.trim().toLowerCase();
    if (!looksLikeEmail(who) || busy) return;
    setBusy(true);
    try { setAccess(await grantAccess({ email: who, role, scope: id })); setEmail(""); onChanged?.(); }
    catch (e) { notify.error(`${who} could not be added.`, e); /* what was typed stays in the field */ }
    finally { setBusy(false); }
  };
  const remove = async (who: string) => {
    const ok = await confirmDialog({
      title: "Remove this member?",
      body: <>{who} is no longer {GROUP[kind].member} of “{name}”. {kind === "team"
        ? "What the team maintains disappears from their responsibilities."
        : `They can no longer change what belongs to this ${noun}, unless another role lets them.`} This takes effect at once.</>,
      confirmLabel: "Remove", danger: true,
    });
    if (!ok) return;
    try { setAccess(await revokeAccess({ email: who, role, scope: id })); onChanged?.(); }
    catch (e) { notify.error(`${who} could not be removed.`, e); }
  };

  return (
    <div className="cat-members">
      <h3>Members {access && <span>{list.length}</span>}</h3>
      <p className="muted small">{memberText(kind)}</p>
      {!saved && <p className="muted">Save the lists first: the {noun} has to exist before somebody can belong to it.</p>}
      {saved && error && <LoadError what="The members could not be loaded." error={error} onRetry={load} />}
      {saved && !access && !error && <Loading />}
      {saved && access && (
        <>
          {list.length === 0 && <p className="muted">{kind === "team"
            ? "Nobody yet. Until somebody is added, nobody is asked to review what this team maintains."
            : `Nobody yet. Until somebody is added, only the editors can change what belongs to this ${noun}.`}</p>}
          <ul className="people">
            {list.map((m) => (
              <li key={m.email}>
                <span className="avatar">{m.email.slice(0, 1).toUpperCase()}</span>
                <span className="person"><strong>{m.email}</strong><em>since {m.grantedAt.slice(0, 10)}, added by {m.grantedBy}</em></span>
                <span className="role-chips">
                  <span className="role-chip">
                    {GROUP[kind].member}
                    <button aria-label={`Remove ${m.email} as ${GROUP[kind].member}`} onClick={() => remove(m.email)}><Trash2 size={12} /></button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <form className="member-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <UserPlus size={15} aria-hidden="true" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. name@company.com" aria-label="Email of the new member" />
            <button className="btn small primary" disabled={!looksLikeEmail(email) || busy}><Plus size={14} />Add member</button>
          </form>
        </>
      )}
    </div>
  );
}
