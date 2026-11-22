import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Plus, Trash2, UserPlus } from "lucide-react";
import type { Membership } from "../types";
import { GROUP, knownNames, looksLikeEmail, membersOf, OWNER_ROLE, personLabel, type GroupKind, type GroupRank } from "../lib/members";
import { addedNote, nameFromMembers } from "../lib/groups";
import { PersonLink } from "./PersonLink";
import { canManageMembers, groupRank } from "../lib/rights";
import { useMe, usePerms } from "../lib/session";
import { addGroupMember, grantAccess, loadAccess, loadMembers, loadUsers, removeGroupMember, revokeAccess, type Access } from "../lib/store";
import { confirmDialog, LoadError, Loading, notify } from "./ui";
import { formatDate } from "../lib/dates";

/** What the owners of a team, platform or practice do, in one sentence: for whoever can act on it. */
const OWNERS_DO: Record<GroupKind, string> = {
  team: "Owners confirm the reviews of what this team maintains and answer its feedback",
  platform: "Owners change and publish what belongs to this platform, confirm its reviews, answer its feedback and add its members",
  practice: "Owners change and publish what belongs to this practice, confirm its reviews, answer its feedback and add its members",
};
/** What the owners of a group do, and where they find it. */
export const ownerText = (kind: GroupKind) => `${OWNERS_DO[kind]}. They find this under “My responsibilities”.`;
/** What the members of a platform or practice may do. */
export const MEMBERS_TEXT = "Members can create and change drafts here. An owner publishes them.";
/** The same for a reader, who cannot act on it: one line per role. */
const READER_LINE: Record<GroupRank, Record<GroupKind, string>> = {
  owner: { team: "Owners review what this team looks after and answer its feedback.", platform: "Owners decide what is published here.", practice: "Owners decide what is published here." },
  member: { team: "", platform: "Members write drafts for the owners.", practice: "Members write drafts for the owners." },
};
/** The problem of an address that is not one, in the words of the contact fields. */
const NOT_AN_EMAIL = "Write one email address, like team@company.com.";
/** Said when the portal knows no name for an address that was just added. */
const UNKNOWN_ADDRESS = "Nobody with this address has done anything in the portal yet. Check it is right.";

/**
 * The names of people, by address, where the portal knows them: `GET /api/members` gives them
 * to everyone signed in; an admin also reads every user's; everyone knows their own. Anybody
 * else is shown by address (`personLabel`).
 */
function useNames(admin: boolean, members: Membership[] | null): (email: string) => string | undefined {
  const me = useMe();
  const [users, setUsers] = useState<{ email: string; name?: string }[]>([]);
  useEffect(() => {
    if (!admin) return;
    loadUsers().then(setUsers, () => { /* the addresses are shown instead */ });
  }, [admin]);
  const names = useMemo(() => knownNames(me.user ? [{ email: me.user.email, name: me.user.name }] : [], members, users), [me.user, members, users]);
  return (email: string) => names[email.toLowerCase()];
}

/** One person of a group: by name where it is known (`personLabel`), the address as tooltip and mail link; "you" for the person signed in. */
function Person({ email, name, you, sub, action }: { email: string; name?: string; you?: boolean; sub?: React.ReactNode; action?: React.ReactNode }) {
  const label = personLabel({ email, name });
  return (
    <li>
      <span className="avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
      <span className="person">
        <PersonLink person={{ email, name }}>{label}</PersonLink>
        {(you || sub) && <em>{you && "You"}{you && sub && " · "}{sub}</em>}
      </span>
      {action}
    </li>
  );
}

/**
 * The field to add somebody by address: Enter or the button adds; an address that is not one is
 * said under the field; `note` is an information line under it (what the portal answered).
 */
function AddPerson({ label, button, busy, note, onAdd }: {
  label: string; button: string; busy: boolean; note: string;
  /** Resolves to true when the person was added (the field is then emptied). */
  onAdd: (email: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = useRef(`add-${Math.random().toString(36).slice(2, 8)}`).current;
  const submit = async () => {
    if (busy) return;
    if (!looksLikeEmail(email)) { setProblem(NOT_AN_EMAIL); input.current?.focus(); return; }
    setProblem("");
    if (await onAdd(email.trim().toLowerCase())) setEmail("");
  };
  return (
    <form className="member-add" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <UserPlus size={15} aria-hidden="true" />
      <input ref={input} type="email" value={email} placeholder="e.g. name@company.com" aria-label={label}
        aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-problem` : note ? `${id}-note` : undefined}
        onChange={(e) => { setEmail(e.target.value); if (problem && looksLikeEmail(e.target.value)) setProblem(""); }}
        onBlur={() => { if (email.trim() && !looksLikeEmail(email)) setProblem(NOT_AN_EMAIL); }} />
      <button className="btn small" disabled={busy}><Plus size={14} />{button}</button>
      {problem && <p className="field-error member-problem" id={`${id}-problem`}>{problem}</p>}
      {!problem && note && <p className="member-note" id={`${id}-note`} role="status"><Info size={14} aria-hidden="true" />{note}</p>}
    </form>
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
 * What a role allows is said at length only to whoever can act on it (an admin, its owners and
 * members); a reader gets one line per role. A group without owners says so in one line, and
 * shows its members only when it has any.
 *
 * `saved` is false for an entry that was added but not saved yet: it has to exist before anybody
 * can belong to it.
 */
export function GroupMembers({ kind, id, name, rank = "owner", saved, manage, members, membersError, onChanged, heading = "h3", reachAbove }: {
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
  /** The ways to reach the group are shown above (its page): a group without owners points there. */
  reachAbove?: boolean;
}) {
  const perms = usePerms();
  const me = useMe();
  const H = heading;
  const ownersByAdmin = rank === "owner" && manage && perms.admin;
  const membersByManager = rank === "member" && manage && kind !== "team" && canManageMembers(perms, kind, id);
  // whoever can act on what a role allows: an admin, and the group's own owners and members
  const acts = perms.admin || !!groupRank(perms, kind, id);
  const nameOf = useNames(perms.admin, members);
  const shown = (email: string) => personLabel({ email, name: nameOf(email) });
  const isMe = (email: string) => email.toLowerCase() === me.user?.email?.toLowerCase();
  const noun = GROUP[kind].noun;
  const roleName = rank === "owner" ? GROUP[kind].owner : GROUP[kind].member ?? GROUP[kind].owner;
  const title = rank === "owner" ? "Owners" : "Members";
  const what = acts ? (rank === "owner" ? ownerText(kind) : MEMBERS_TEXT) : READER_LINE[rank][kind];
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setError("");
    loadAccess().then(setAccess, (e) => setError(e.message));
  }, []);
  useEffect(() => { if (ownersByAdmin) load(); }, [ownersByAdmin, load]);
  useEffect(() => { setNote(""); }, [kind, id]);

  if (!ownersByAdmin && !membersByManager) {
    if (!saved) return null; // nobody can belong to something that does not exist yet
    const list = members ? membersOf(members, kind, id, rank) : [];
    if (members && list.length === 0) {
      // nobody to show: one line for the owners, nothing for the members
      if (rank === "member") return null;
      return (
        <div className="cat-members none" data-rank="owner">
          <p className="muted">No owner yet.{reachAbove ? " Use the ways to reach them above." : ""}</p>
        </div>
      );
    }
    return (
      <div className="cat-members" data-rank={rank}>
        <H>{title} {members && <span>{list.length}</span>}</H>
        {what && <p className="muted small">{what}{rank === "owner" && manage && acts && " An admin gives and takes this role."}</p>}
        {membersError && <p className="muted">The {title.toLowerCase()} could not be loaded: {membersError}</p>}
        {!members && !membersError && <Loading />}
        {list.length > 0 && <ul className="people">{list.map((m) => <Person key={m.email} email={m.email} name={nameOf(m.email)} you={isMe(m.email)} />)}</ul>}
      </div>
    );
  }

  // members, changed by an admin or an owner of the platform or practice
  if (membersByManager) {
    const list = members ? membersOf(members, kind, id, "member") : [];
    const remove = async (who: string, ask = true) => {
      if (ask && !(await confirmDialog({
        title: "Remove this member?",
        body: <>{shown(who)} will no longer be a {roleName} of {name} and will no longer be able to create or change its drafts. Their drafts stay.</>,
        confirmLabel: "Remove", danger: true,
      }))) return;
      try { await removeGroupMember(kind, id, who); onChanged?.(); } catch (e) { notify.error(`${shown(who)} could not be removed.`, e); }
    };
    const add = async (who: string) => {
      setBusy(true); setNote("");
      try {
        const r = await addGroupMember(kind, id, who);
        onChanged?.();
        if (r?.note) {
          // nothing changed: said as information, about oneself in the second person
          const owners = membersOf(r.members ?? [], kind, id, "owner");
          setNote(addedNote({ note: r.note, self: isMe(who), selfRank: owners.some((m) => m.email === who) ? "owner" : "member", group: name }));
          return true;
        }
        const added = (r?.members ?? []).find((m) => m.email.toLowerCase() === who);
        const label = personLabel({ email: who, name: added?.name ?? nameOf(who) });
        notify.info(`${label} can now create and change drafts for ${name}.`, { label: "Undo", run: () => { void remove(who, false); } });
        if (!added?.name && !nameOf(who)) setNote(UNKNOWN_ADDRESS);
        return true;
      } catch (e) { notify.error(`${who} could not be added.`, e); return false; /* what was typed stays in the field */ } finally { setBusy(false); }
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
              <Person key={m.email} email={m.email} name={nameOf(m.email)} you={isMe(m.email)}
                action={<button className="icon-btn member-remove" aria-label={`Remove ${m.email} as ${roleName}`} title={`Remove from this ${noun}`} onClick={() => remove(m.email)}><Trash2 size={15} aria-hidden="true" /></button>} />
            ))}
          </ul>
        )}
        <AddPerson label="Email of the new member" button="Add member" busy={busy} note={note} onAdd={add} />
      </div>
    );
  }

  // owners, changed by an admin: the same as giving or taking the role under Access
  const role = OWNER_ROLE[kind];
  const list = access ? membersOf(access.assignments, kind, id) : [];
  const add = async (who: string) => {
    setBusy(true); setNote("");
    try {
      if (list.some((m) => m.email === who)) { setNote(isMe(who) ? `You are already an owner of ${name}.` : `${shown(who)} is already an owner of ${name}: nothing changed.`); return true; }
      setAccess(await grantAccess({ email: who, role, scope: id }));
      onChanged?.();
      // the name, where the portal knows the person (also somebody who had no role until now)
      const known = nameOf(who) ?? nameFromMembers(await loadMembers().catch(() => undefined), who);
      notify.info(`${personLabel({ email: who, name: known })} is now ${kind === "team" ? "an Owner" : `a ${roleName}`} of ${name}.`);
      if (!known) setNote(UNKNOWN_ADDRESS);
      return true;
    } catch (e) { notify.error(`${who} could not be added.`, e); return false; /* what was typed stays in the field */ } finally { setBusy(false); }
  };
  const remove = async (who: string) => {
    const ok = await confirmDialog({
      title: "Remove this owner?",
      body: <>{kind === "team"
        ? <>{shown(who)} will no longer be an Owner of {name}. What the team maintains will no longer be among their responsibilities.</>
        : <>{shown(who)} will no longer be a {roleName} of {name} and will no longer be able to change or publish what belongs to it, unless another role lets them.</>}</>,
      confirmLabel: "Remove", danger: true,
    });
    if (!ok) return;
    try { setAccess(await revokeAccess({ email: who, role, scope: id })); onChanged?.(); }
    catch (e) { notify.error(`${shown(who)} could not be removed.`, e); }
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
              <Person key={m.email} email={m.email} name={nameOf(m.email)} you={isMe(m.email)}
                sub={<>since {formatDate(m.grantedAt)}, added by <span title={m.grantedBy.includes("@") ? m.grantedBy : undefined}>{shown(m.grantedBy)}</span></>}
                action={<button className="icon-btn member-remove" aria-label={`Remove ${m.email} as ${roleName}`} title={`Remove from this ${noun}`} onClick={() => remove(m.email)}><Trash2 size={15} aria-hidden="true" /></button>} />
            ))}
          </ul>
          <AddPerson label="Email of the new owner" button="Add owner" busy={busy} note={note} onAdd={add} />
        </>
      )}
    </div>
  );
}
