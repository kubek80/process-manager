import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "./Alert";
import { ArrowLeft, ArrowRight, Boxes, Compass, PencilLine, Plus, Users } from "lucide-react";
import type { DocMeta, FeedbackByTarget, Membership, Process, Standard, TargetKind, Team } from "../types";
import { docCount, useCatalog } from "../lib/catalog";
import { belongsHeading, contactsOk, groupEntry, groupFilter, KIND_WORD, LIST_OF, partOf, tidyContacts } from "../lib/groups";
import { GROUP, hasMembers, type GroupKind } from "../lib/members";
import { canChangeDetails, canCreate, canManageMembers, editsAll, groupRank, newDocPlaces } from "../lib/rights";
import { canDraft, canManage, useChangeBlocked, useMe, usePerms } from "../lib/session";
import { sortResults, type MetaByKind } from "../lib/sorting";
import { useListView } from "../lib/paging";
import { usePrinting } from "../lib/media";
import { search } from "../lib/search";
import { href, loadMembers, putGroupDetails } from "../lib/store";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard } from "./DocCard";
import { ViewSwitch } from "./Lists";
import { ContactFields, type DetailsValue } from "./ContactFields";
import { ContactList, RankMark } from "./GroupParts";
import { GroupMembers } from "./TeamMembers";
import { confirmDialog, Modal, notify } from "./ui";
import "../group.css";

const ICON: Record<GroupKind, typeof Users> = { team: Users, platform: Boxes, practice: Compass };
/** How many of what belongs to it are shown before "Show all". */
const FIRST = 12;

/**
 * The page of a team, a platform or a practice: what it is, how to reach it, who is behind it, and
 * the processes and standards that belong to it (for a team: what it owns), as the lists draw them.
 * Whoever may changes its details here, and an owner of a platform or practice its members.
 */
export function GroupPage({ kind, id, processes, standards, feedback, meta, onNew }: {
  kind: GroupKind; id: string; processes: Process[]; standards: Standard[];
  feedback?: FeedbackByTarget;
  meta?: MetaByKind;
  /** Opens the dialog for a new process or standard, placed on this platform or practice (or with this owning team). */
  onNew?: (noun: TargetKind, place: { platform?: string; practice?: string; owner?: string }) => void;
}) {
  const { catalog, reload } = useCatalog();
  const perms = usePerms();
  const blocked = useChangeBlocked(); // viewing as somebody else: their buttons show, unavailable
  const me = useMe();
  const entry = groupEntry(catalog, kind, id)!;
  const Icon = ICON[kind];
  const rank = groupRank(perms, kind, id);
  const mayDetails = canChangeDetails(perms, kind, id);
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(false);
  const [view, setView] = useListView(me.user?.email);

  // who is behind it: everyone signed in may read it
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const reloadMembers = useCallback(() => { loadMembers().then((m) => { setMembers(m); setMembersError(""); }, (e) => setMembersError(e.message)); }, []);
  useEffect(reloadMembers, [reloadMembers]);

  // what belongs to it: the same search and cards as the lists; drafts only for whoever may see them
  const filters = groupFilter(kind, id);
  const out = useMemo(() => search({ processes, standards, catalog, filters, drafts: true }), [processes, standards, catalog, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortResults(out.results, "", meta), [out.results, meta]);
  const nP = sorted.filter((r) => r.kind === "process").length;
  const nS = sorted.length - nP;
  const printing = usePrinting();
  const shown = all || printing ? sorted : sorted.slice(0, FIRST);
  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [processes, standards, catalog]);
  const usedBy = (pid: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === pid)).length;
  const searchLink = href({ page: "search", ...filters });
  // a new process or standard starts here for whoever may draft here (a team: whoever may create at all)
  const mayNew = (noun: TargetKind) => kind === "team"
    ? canCreate(perms, noun)
    : editsAll(perms, noun) || newDocPlaces(perms, noun).some((x) => x.kind === kind && x.id === id);
  const place = kind === "team" ? { owner: id } : kind === "platform" ? { platform: id } : { practice: id };
  const news = onNew ? (["process", "standard"] as TargetKind[]).filter(mayNew) : [];

  return (
    <div className="page group-page" data-group={kind}>
      <a className="back" href={href({ page: "catalog", list: LIST_OF[kind], id })}><ArrowLeft size={16} aria-hidden="true" />Teams &amp; tools</a>
      <header className="group-head">
        <div className="group-kicker">
          <span className="group-kind"><Icon size={14} aria-hidden="true" />{KIND_WORD[kind]}</span>
          <RankMark rank={rank} />
        </div>
        <div className="group-title-row">
          <h1>{entry.name}</h1>
          {mayDetails && <button className="btn" disabled={!!blocked} title={blocked || undefined} onClick={() => setEditing(true)}><PencilLine size={15} aria-hidden="true" />Edit details</button>}
        </div>
        {/* a team's tribe and domain, when it is part of one; each leads to its entry in Teams & tools */}
        {kind === "team" && partOf(catalog, entry as Team).length > 0 && (
          <p className="group-part">{partOf(catalog, entry as Team).map((p, i) => (p.list && p.id
            ? <a key={i} href={href({ page: "catalog", list: p.list, id: p.id })}>{p.text}</a>
            : <span key={i}>{p.text}</span>))}</p>
        )}
        {entry.description?.trim()
          ? <p className="lead group-lead">{entry.description}</p>
          : <p className="muted group-lead">No description yet.</p>}
      </header>

      <div className="group-body">
        <section className="group-reach" aria-labelledby="group-reach">
          <h2 id="group-reach" className="group-h">How to reach them</h2>
          <ContactList entry={entry} name={entry.name} empty={mayDetails ? "Nothing is known yet. Use Edit details to add how people reach them." : "Nothing is known yet about how to reach them."} />
        </section>

        <section className="group-people" aria-label="People">
          <GroupMembers kind={kind} id={id} name={entry.name} saved manage heading="h2" members={members} membersError={membersError} onChanged={reloadMembers} reachAbove />
          {hasMembers(kind) && (
            <GroupMembers kind={kind} id={id} name={entry.name} rank="member" saved manage={canManageMembers(perms, kind, id)} heading="h2"
              members={members} membersError={membersError} onChanged={reloadMembers} />
          )}
        </section>

        <section className="group-docs" aria-labelledby="group-docs">
          <div className="group-docs-head">
            <div>
              <h2 id="group-docs" className="group-h">{belongsHeading(kind)}</h2>
              <p className="group-count" aria-live="polite">{sorted.length ? docCount(nP, nS) : "Nothing yet"}</p>
            </div>
            {(sorted.length > 0 || news.length > 0) && (
              <div className="group-docs-tools">
                {sorted.length > 0 && <ViewSwitch view={view} onView={setView} />}
                {sorted.length > 0 && <a className="btn small" href={searchLink}>Open in the search<ArrowRight size={14} aria-hidden="true" /></a>}
                {news.map((noun) => (
                  <button key={noun} type="button" className="btn small" disabled={!!blocked} title={blocked || undefined} onClick={() => onNew!(noun, place)}><Plus size={14} aria-hidden="true" />New {noun}</button>
                ))}
              </div>
            )}
          </div>
          {sorted.length === 0 ? (
            <p className="muted group-empty">{kind === "team"
              ? "This team does not look after any process or standard yet."
              : `No process or standard belongs to this ${GROUP[kind].noun} yet.`}</p>
          ) : (
            <>
              <ol className={`cards ${view === "rows" ? "rows" : ""}`.trim()}>
                {shown.map((r) => {
                  const edits = canDraft(perms, r.kind, r.doc);
                  const broken = edits && hasErrors(r.kind === "process" ? validateProcess(r.doc, ids) : validateStandard(r.doc, ids));
                  return (
                    <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} view={view} level={3}
                      openFeedback={openCount(feedback?.[r.kind]?.[r.doc.id] ?? [])} mayEdit={edits} manages={canManage(perms, r.kind, r.doc)} broken={broken}
                      meta={metaOf(meta, r.kind, r.doc.id)} usedBy={r.kind === "process" ? usedBy(r.doc.id) : undefined} />
                  );
                })}
              </ol>
              {sorted.length > FIRST && (
                <button type="button" className="btn small group-more" aria-expanded={all} onClick={() => setAll(!all)}>
                  {all ? "Show fewer" : `Show all ${sorted.length}`}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {editing && <DetailsDialog kind={kind} id={id} name={entry.name} saved={entry} onClose={() => setEditing(false)}
        onSaved={async () => { await reload().catch(() => {}); setEditing(false); notify.info(`The details of ${entry.name} are saved.`); }} />}
    </div>
  );
}

const metaOf = (meta: MetaByKind | undefined, kind: TargetKind, id: string): DocMeta | undefined => meta?.[kind]?.[id];

/** The text fields as they are compared and saved: without spaces around, empty ones left out. */
const tidyDetails = (v: DetailsValue): DetailsValue => ({
  description: v.description?.trim() ?? "", contact: v.contact?.trim() ?? "", contacts: tidyContacts(v.contacts),
});
const same = (a: DetailsValue, b: DetailsValue) => JSON.stringify(tidyDetails(a)) === JSON.stringify(tidyDetails(b));

/**
 * The description and the contact details of one group, changed by whoever may: Save sends only
 * these fields; a refusal shows the server's sentence at the top.
 */
function DetailsDialog({ kind, id, name, saved, onClose, onSaved }: {
  kind: GroupKind; id: string; name: string; saved: DetailsValue;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const start: DetailsValue = { description: saved.description ?? "", contact: saved.contact ?? "", contacts: { ...saved.contacts } };
  const [value, setValue] = useState<DetailsValue>(start);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const dirty = !same(value, start);
  const ok = contactsOk(value.contacts);
  const close = async () => {
    if (dirty && !(await confirmDialog({ title: "Discard your changes?", body: `Your changes to the details of ${name} are not saved.`, confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (!ok) {
      // the first field to fix is brought into view and focused (the message at the top may be scrolled away)
      setTimeout(() => document.querySelector<HTMLElement>(".contact-fields [aria-invalid='true']")?.focus(), 0);
      return;
    }
    if (busy) return;
    if (!dirty) { onClose(); return; }
    setBusy(true); setRefused("");
    const t = tidyDetails(value);
    try {
      await putGroupDetails(kind, id, { description: t.description, contact: t.contact, contacts: t.contacts ?? null });
      await onSaved();
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={`Details of ${name}`} subtitle="What readers see on this page: what it is and how to reach them. Leave out what does not apply." onClose={close} wide
      footer={<><span className="spacer" /><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {refused && <Alert tone="problem" role="alert">{refused}</Alert>}
        {tried && !ok && <Alert tone="problem" role="alert">Fix the marked fields first.</Alert>}
        <ContactFields kind={kind} value={value} onChange={setValue} showAll={tried} idPrefix={`details-${kind}`} />
      </form>
    </Modal>
  );
}
