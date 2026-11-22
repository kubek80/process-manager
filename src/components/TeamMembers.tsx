import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import type { Membership } from "../types";
import { GROUP, looksLikeEmail, membersOf, OWNER_ROLE, type GroupKind, type GroupRank } from "../lib/members";
import { canManageMembers } from "../lib/rights";
import { useMe, usePerms } from "../lib/session";
import { addGroupMember, grantAccess, loadAccess, loadUsers, removeGroupMember, revokeAccess, type Access } from "../lib/store";
import { confirmDialog, LoadError, Loading, notify } from "./ui";
import { formatDate } from "../lib/dates";

/** What the owners of a team, platform or practice do, in one sentence. */
const OWNERS_DO: Record<GroupKind, string> = {
  team: "Owners confirm the reviews of what this team maintains and answer its feedback",
  platform: "Owners change and publish what belongs to this platform, confirm its reviews, answer its feedback and add its members",
  practice: "Owners change and publish what belongs to this practice, confirm its reviews, answer its feedback and add its members",
};
/** What the owners of a group do, and where they find it. */
export const ownerText = (kind: GroupKind) => `${OWNERS_DO[kind]}. They find this under “My responsibilities”.`;
/** What the members of a platform or practice may do. */
export const MEMBERS_TEXT = "Members can create and change drafts here. An owner publishes them.";

/**
 * The names of people, by address, where they can be known: an admin reads everybody's; everyone
 * knows their own. Anybody else is shown by address.
 */
function useNames(admin: boolean): (email: string) => string | undefined {
  const me = useMe();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!admin) return;
    loadUsers().then((users) => setNames(Object.fromEntries(users.filter((u) => u.name).map((u) => [u.email.toLowerCase(), u.name!]))), () => { /* the addresses are shown instead */ });
  }, [admin]);
  const mine = me.user?.email?.toLowerCase();
  return (email: string) => names[email.toLowerCase()] ?? (email.toLowerCase() === mine ? me.user?.name : undefined);
}

/** One person of a group: by name where it is known, the address as its tooltip; "you" for the person signed in. */
function Person({ email, name, you, sub, action }: { email: string; name?: string; you?: boolean; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li>
      <span className="avatar" aria-hidden="true">{(name || email).slice(0, 1).toUpperCase()}</span>
      <span className="person">
        <a href={`mailto:${email}`} title={email}><strong>{name || email}</strong></a>
        {(you || sub) && <em>{you && "You"}{you && sub && " · "}{sub}</em>}
      </span>
      {action}
    </li>
  );
}

/**
 * Who is behind a team, a platform or a practice, for one rank: its owners, or (platforms and
 * practices only) its members.
 * - Owners are given and taken by admins only: an admin changes them where `manage` is set
 *   (Admin › Lists, the group's page), as giving or taking the role under Access, seen from the
 *   group's side. Everyone else sees who they are.
 * - Members are added and removed by an admin or an owner of that platform or practice, where
 *   `manage` is set.
 *
 * `saved` is false for an entry that was added but not saved yet: it has to exist before anybody
 * can belong to it.
 */
export function GroupMembers({ kind, id, name, rank = "owner", saved, manage, members, membersError, onChanged, heading = "h3" }: {
  kind: GroupKind; id: string; name: string; saved: boolean;
  /** Owners (default) or members. */
  rank?: GroupRank;
  /** Whether the people may be changed here, by whoever is allowed to. */
  manage: boolean;
  /** What everyone may read about the people of groups; null while it loads. */
  members: Membership[] | null; membersError?: string;
  /** Called after somebody was added or removed here. */
  onChanged?: () => void;
  heading?: "h2" | "h3";
}) {
  const perms = usePerms();
  const me = useMe();
  const H = heading;
  const ownersByAdmin = rank === "owner" && manage && perms.admin;
  const membersByManager = rank === "member" && manage && kind !== "team" && canManageMembers(perms, kind, id);
  const nameOf = useNames(perms.admin);
  const you = (email: string) => email.toLowerCase() === me.user?.email?.toLowerCase();
  const noun = GROUP[kind].noun;
  const roleName = rank === "owner" ? GROUP[kind].owner : GROUP[kind].member ?? GROUP[kind].owner;
  const title = rank === "owner" ? "Owners" : "Members";
  const what = rank === "owner" ? ownerText(kind) : MEMBERS_TEXT;
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    loadAccess().then(setAccess, (e) => setError(e.message));
  }, []);
  useEffect(() => { if (ownersByAdmin) load(); }, [ownersByAdmin, load]);
  useEffect(() => { setEmail(""); }, [kind, id]);

  if (!ownersByAdmin && !membersByManager) {
    if (!saved) return null; // nobody can belong to something that does not exist yet
    const list = members ? membersOf(members, kind, id, rank) : [];
    return (
      <div className="cat-members" data-rank={rank}>
        <H>{title} {members && <span>{list.length}</span>}</H>
        <p className="muted small">{what}{rank === "owner" && manage && " An admin gives and takes this role."}</p>
        {membersError && <p className="muted">The {title.toLowerCase()} could not be loaded: {membersError}</p>}
        {!members && !membersError && <Loading />}
        {members && list.length === 0 && <p className="muted">Nobody yet.</p>}
        {list.length > 0 && <ul className="people">{list.map((m) => <Person key={m.email} email={m.email} name={nameOf(m.email)} you={you(m.email)} />)}</ul>}
      </div>
    );
  }

  // members, changed by an admin or an owner of the platform or practice
  if (membersByManager) {
    const list = members ? membersOf(members, kind, id, "member") : [];
    const add = async () => {
      const who = email.trim().toLowerCase();
      if (!looksLikeEmail(who) || busy) return;
      setBusy(true);
      try {
        const r = await addGroupMember(kind, id, who);
        setEmail("");
        if (r?.note) notify.info(r.note);
        onChanged?.();
      } catch (e) { notify.error(`${who} could not be added.`, e); /* what was typed stays in the field */ } finally { setBusy(false); }
    };
    const remove = async (who: string) => {
      const ok = await confirmDialog({
        title: "Remove this member?",
        body: <>{nameOf(who) || who} is no longer a {roleName.toLowerCase()} of “{name}”. They can no longer create or change drafts of what belongs to this {noun}, unless another role lets them. Their drafts stay. This takes effect at once.</>,
        confirmLabel: "Remove", danger: true,
      });
      if (!ok) return;
      try { await removeGroupMember(kind, id, who); onChanged?.(); } catch (e) { notify.error(`${who} could not be removed.`, e); }
    };
    return (
      <div className="cat-members" data-rank="member">
        <H>Members {members && <span>{list.length}</span>}</H>
        <p className="muted small">{MEMBERS_TEXT}</p>
        {membersError && <p className="muted">The members could not be loaded: {membersError}</p>}
        {!members && !membersError && <Loading />}
        {members && list.length === 0 && <p className="muted">Nobody yet. Add the people who write drafts for this {noun}.</p>}
        {list.length > 0 && (
          <ul className="people">
            {list.map((m) => (
              <Person key={m.email} email={m.email} name={nameOf(m.email)} you={you(m.email)}
                action={<button className="icon-btn member-remove" aria-label={`Remove ${m.email} as ${roleName}`} title={`Remove from this ${noun}`} onClick={() => remove(m.email)}><Trash2 size={15} aria-hidden="true" /></button>} />
            ))}
          </ul>
        )}
        <form className="member-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <UserPlus size={15} aria-hidden="true" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. name@company.com" aria-label="Email of the new member" />
          <button className="btn small" disabled={!looksLikeEmail(email) || busy}><Plus size={14} />Add member</button>
        </form>
      </div>
    );
  }

  // owners, changed by an admin: the same as giving or taking the role under Access
  const role = OWNER_ROLE[kind];
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
      title: "Remove this owner?",
      body: <>{nameOf(who) || who} is no longer {kind === "team" ? "an Owner" : `a ${roleName.toLowerCase()}`} of “{name}”. {kind === "team"
        ? "What the team maintains disappears from their responsibilities."
        : `They can no longer change or publish what belongs to this ${noun}, unless another role lets them.`} This takes effect at once.</>,
      confirmLabel: "Remove", danger: true,
    });
    if (!ok) return;
    try { setAccess(await revokeAccess({ email: who, role, scope: id })); onChanged?.(); }
    catch (e) { notify.error(`${who} could not be removed.`, e); }
  };

  return (
    <div className="cat-members" data-rank="owner">
      <H>Owners {access && <span>{list.length}</span>}</H>
      <p className="muted small">{ownerText(kind)}</p>
      {!saved && <p className="muted">Save the lists first: the {noun} has to exist before somebody can belong to it.</p>}
      {saved && error && <LoadError what="The owners could not be loaded." error={error} onRetry={load} />}
      {saved && !access && !error && <Loading />}
      {saved && access && (
        <>
          {list.length === 0 && <p className="muted">{kind === "team"
            ? "Nobody yet. Until somebody is added, nobody is asked to review what this team maintains."
            : `Nobody yet. Until somebody is added, only the editors can publish what belongs to this ${noun}.`}</p>}
          <ul className="people">
            {list.map((m) => (
              <Person key={m.email} email={m.email} name={nameOf(m.email)} you={you(m.email)}
                sub={<>since {formatDate(m.grantedAt)}, added by <span title={m.grantedBy.includes("@") ? m.grantedBy : undefined}>{nameOf(m.grantedBy) || m.grantedBy}</span></>}
                action={<button className="icon-btn member-remove" aria-label={`Remove ${m.email} as ${roleName}`} title={`Remove from this ${noun}`} onClick={() => remove(m.email)}><Trash2 size={15} aria-hidden="true" /></button>} />
            ))}
          </ul>
          <form className="member-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <UserPlus size={15} aria-hidden="true" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. name@company.com" aria-label="Email of the new owner" />
            <button className="btn small" disabled={!looksLikeEmail(email) || busy}><Plus size={14} />Add owner</button>
          </form>
        </>
      )}
    </div>
  );
}
