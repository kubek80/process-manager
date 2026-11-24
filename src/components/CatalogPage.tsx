import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Boxes, CircleAlert, Code2, Compass, Server, ExternalLink, Layers, Plus, Search, Signpost, Tag, Trash2, Users, Wrench } from "lucide-react";
import type { Catalog, Contacts, Issue, Membership, PathSymbol, Process, Standard } from "../types";
import { PATH_SYMBOLS, PathMark, PathSymbolIcon } from "./marks";
import { GroupMembers } from "./TeamMembers";
import { ContactFields } from "./ContactFields";
import { ContactList, RankMark } from "./GroupParts";
import { EntryIcon } from "./EntryIcon";
import { IconField } from "./IconField";
import { hasMembers, membersOf, type GroupKind } from "../lib/members";
import { ownFirst, summaryLine, tidyLists } from "../lib/groups";
import { groupRank } from "../lib/rights";
import { usePerms } from "../lib/session";
import { slugify, uniqueId } from "../lib/edit";
import { docCount, removeHint, useCatalog } from "../lib/catalog";
import { useDraft } from "../lib/draft";
import { BehindBanner, ConflictDialog, SaveBar } from "./Editing";
import { go, href, loadMembers, type CatalogList } from "../lib/store";
import { hasErrors, validateCatalog } from "../lib/validate";
import { checkerSummary, issueText, listIssueField, listIssuePlace, refusalText } from "../lib/editing";
import { focusWhenShown, useFieldMarks } from "../lib/fieldMarks";
import { Field, IssueList, notify, useScrollFade } from "./ui";

type Key = "teams" | "practices" | "platforms" | "categories" | "tools" | "tiers" | "paths" | "environments" | "languages";
type Row = { id: string; name: string; contact?: string; contacts?: Contacts; url?: string; description?: string; icon?: string; symbol?: PathSymbol };

const KINDS: Record<Key, {
  title: string; noun: string; icon: typeof Users; blurb: string;
  fields: { field: "contact" | "url" | "description"; label: string; placeholder: string; long?: boolean }[];
}> = {
  teams: {
    title: "Teams", noun: "team", icon: Users,
    blurb: "Maintain processes and standards, and take part in them.",
    fields: [], // the details of a team, practice or platform are ContactFields
  },
  practices: {
    title: "Practices", noun: "practice", icon: Compass,
    blurb: "Ways of working, such as cyber security or engineering.",
    fields: [], // the details of a team, practice or platform are ContactFields
  },
  platforms: {
    title: "Platforms", noun: "platform", icon: Boxes,
    blurb: "Systems and services people get access to or build on.",
    fields: [], // the details of a team, practice or platform are ContactFields
  },
  categories: {
    title: "Categories", noun: "category", icon: Tag,
    blurb: "How processes and standards are grouped for readers.",
    fields: [{ field: "description", label: "What belongs here", placeholder: "e.g. Getting and changing cloud accounts", long: true }],
  },
  tools: {
    title: "Tools", noun: "tool", icon: Wrench,
    blurb: "Systems that steps are done in. Steps pick one from this list.",
    fields: [
      { field: "url", label: "Link", placeholder: "https://…" },
      { field: "description", label: "What it is used for", placeholder: "One sentence on what people do in this tool", long: true },
    ],
  },
  tiers: {
    title: "Application tiers", noun: "tier", icon: Layers,
    blurb: "A process applies to every tier or to a chosen few. Most critical first.",
    fields: [{ field: "description", label: "What makes an application this tier", placeholder: "e.g. Outage stops the business", long: true }],
  },
  paths: {
    title: "Paths", noun: "path", icon: Signpost,
    blurb: "Which path a process or standard is for: something new, something that exists, the ready-made way. Each has a picture; readers see them in this order.",
    fields: [{ field: "description", label: "What it means", placeholder: "e.g. Something new is built from scratch", long: true }],
  },
  environments: {
    title: "Environments", noun: "environment", icon: Server,
    blurb: "Where things run. In the order work moves through them.",
    fields: [{ field: "description", label: "Notes", placeholder: "e.g. Production-like, used for final checks", long: true }],
  },
  languages: {
    title: "Languages", noun: "language", icon: Code2,
    blurb: "Some processes only apply to one language. Most apply to any.",
    fields: [{ field: "description", label: "Notes", placeholder: "e.g. Includes TypeScript", long: true }],
  },
};
const KEYS: Key[] = ["teams", "practices", "platforms", "categories", "tools", "tiers", "paths", "environments", "languages"];
/** The lists whose entries have members. */
const GROUP_OF: Partial<Record<Key, GroupKind>> = { teams: "team", practices: "practice", platforms: "platform" };
const ORDERED: Key[] = ["tiers", "paths", "environments"]; // lists whose order means something (the paths: the order of the lanes of "Which path is this for")
/** The lists whose entries can have an icon. */
const WITH_ICON: Key[] = ["tools", "languages"];

interface Use { process: Process | Standard; how: string }

function usesOf(key: Key, id: string, processes: (Process | Standard)[]): Use[] {
  const out: Use[] = [];
  for (const p of processes) {
    const how: string[] = [];
    if (key === "teams") {
      if (p.owner === id) how.push("requirements" in p ? "issues this standard" : "owns it");
      if ("actors" in p && p.actors?.some((a) => a.teamId === id)) how.push("takes part");
    } else if (key === "practices" || key === "platforms" || key === "categories") {
      const field = key === "practices" ? "practice" : key === "platforms" ? "platform" : "category";
      if (p[field] === id) how.push(key === "categories" ? "grouped here" : `belongs to this ${field}`);
    } else if (key === "paths") {
      if (Array.isArray(p.paths) && p.paths.includes(id)) how.push("is for this path");
    } else if (key === "tools") {
      const n = "steps" in p ? p.steps?.filter((s) => s.tool === id).length ?? 0 : 0;
      if (n) how.push(`${n} step${n > 1 ? "s" : ""}`);
    } else {
      const inReq = "requirements" in p && Array.isArray(p.requirements) && p.requirements.some((r) => r?.[key]?.includes(id));
      if (p[key]?.includes(id)) how.push(key === "languages" ? "specific to this language" : `applies to this ${key === "tiers" ? "tier" : "environment"}`);
      else if (inReq) how.push("one of its requirements");
    }
    if (how.length) out.push({ process: p, how: how.join(" · ") });
  }
  return out;
}

/** What uses something, counted by kind: "2 processes and 1 standard". */
const countOf = (uses: Use[]) => docCount(uses.filter((u) => !("requirements" in u.process)).length, uses.filter((u) => "requirements" in u.process).length);

/** The lists without empty optional fields: what is compared with the saved lists, and saved (`tidyLists`). */
const tidyCatalog = tidyLists;

/** The lists. Read-only it is a directory for everyone; editable it is the Lists section of the Admin panel. */
export function CatalogPage({ processes, standards, editable: editor, list: routeList, id: routeId }: {
  processes: Process[]; standards: Standard[]; editable: boolean;
  /** Teams & tools: the list and the entry the address names (`#/catalog/platforms/google-cloud`). */
  list?: CatalogList; id?: string;
}) {
  const { catalog, version, save, reload } = useCatalog();
  const docs = useMemo<(Process | Standard)[]>(() => [...processes, ...standards], [processes, standards]);
  const d = useDraft<Catalog>({ docKey: "catalog", saved: catalog, version, tidy: tidyCatalog, save, reload, what: "the lists", editable: editor });
  const { draft, clean, dirty } = d;
  const setDraft = d.change;
  // a save the server refused reads like a problem the page found itself: by name, never by place
  useEffect(() => { if (d.error) { notify.error("The lists could not be saved.", refusalText(d.error, "lists", clean)); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [key, setKeyHere] = useState<Key>(routeList ?? "teams");
  const [selected, setSelectedHere] = useState<string | null>(routeId ?? null);
  // Teams & tools keeps the list and the entry in the address (a link, Back, the group page's back
  // link lead to them); Admin › Lists keeps them on the page
  useEffect(() => { if (!editor) { setKeyHere(routeList ?? "teams"); setSelectedHere(routeId ?? null); } }, [editor, routeList, routeId]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const setKey = (k: Key) => { setKeyHere(k); keyRef.current = k; if (!editor) go({ page: "catalog", list: k }, { replace: true }); };
  const setSelected = (id: string | null) => {
    setSelectedHere(id);
    if (!editor) go({ page: "catalog", list: keyRef.current, ...(id ? { id } : {}) }, { replace: true });
  };
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const issues = validateCatalog(clean);
  /** A problem of the lists in words, naming its list and entry (`issueText`). */
  const issueWords = (i: Issue) => issueText(i, "lists", clean);
  // the bar with Save and Discard sticks to the bottom while there are changes: messages go above it
  const saveBar = useRef<HTMLDivElement>(null);
  // who belongs to which team, platform and practice: everyone may read it
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const reloadMembers = useCallback(() => { loadMembers().then((m) => { setMembers(m); setMembersError(""); }, (e) => setMembersError(e.message)); }, []);
  useEffect(reloadMembers, [reloadMembers]);

  const kind = KINDS[key];
  // how many entries of a list are the person's own (teams, platforms, practices)
  const yoursIn = (k: Key) => (GROUP_OF[k] ? ((draft[k] ?? []) as Row[]).filter((r) => groupRank(perms, GROUP_OF[k]!, r.id)).length : 0);
  const rows = (draft[key] ?? []) as Row[];
  const perms = usePerms();
  const group = GROUP_OF[key];
  const mine = (id: string) => !!group && !!groupRank(perms, group, id);
  // the person's own groups first, then by name; tiers and environments keep their order
  const found = rows.filter((r) => `${r.name} ${r.contact ?? ""} ${summaryLine(r)} ${r.description ?? ""} ${r.url ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const shown = ORDERED.includes(key) ? found : ownFirst(found, mine);
  const current = adding ? undefined : rows.find((r) => r.id === selected) ?? shown[0];
  const uses = current ? usesOf(key, current.id, docs) : [];
  // people who are still members: the server refuses to remove an entry that roles point to
  const stillMembers = current && GROUP_OF[key] && members ? membersOf(members, GROUP_OF[key]!, current.id).length + membersOf(members, GROUP_OF[key]!, current.id, "member").length : 0;
  // two entries with the same id: removing one leaves everything that uses the id with the other
  const twin = !!current && rows.filter((r) => r.id === current.id).length > 1;
  const isNew = (id: string) => !((catalog[key] ?? []) as Row[]).some((r) => r.id === id);

  const setRows = (next: Row[]) => setDraft({ ...draft, [key]: next });
  const upd = (patch: Partial<Row>) => current && setRows(rows.map((r) => (r === current ? { ...r, ...patch } : r)));
  const move = (dir: -1 | 1) => {
    if (!current) return;
    const i = rows.findIndex((r) => r.id === current.id), j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  const newId = uniqueId(slugify(newName) || "new", rows.map((r) => r.id));
  const add = () => {
    if (!slugify(newName)) return;
    setRows([...rows, { id: newId, name: newName.trim() }]);
    setSelected(newId); setAdding(false); setNewName(""); setQ("");
  };
  const switchTo = (k: Key) => { setKey(k); setSelected(null); setAdding(false); setQ(""); };
  // Removing an entry says so, with Undo (it puts the entry back where it was, whatever was changed
  // since); the selection moves to its neighbour, which stays in view.
  const latest = useRef(draft);
  latest.current = draft;
  const remove = (entry: Row) => {
    // only this entry: another one with the same id (lists imported with a mistake) stays
    const list = key, at = rows.includes(entry) ? rows.indexOf(entry) : rows.findIndex((r) => r.id === entry.id);
    const next = rows.filter((_, i) => i !== at);
    setRows(next);
    setSelected(next[Math.min(at, next.length - 1)]?.id ?? null);
    notify.info(`${entry.name || `The ${KINDS[list].noun}`} removed`, {
      label: "Undo",
      run: () => {
        const now = latest.current, have = (now[list] ?? []) as Row[];
        if (have.some((r) => r.id === entry.id)) return;
        setDraft({ ...now, [list]: [...have.slice(0, at), entry, ...have.slice(at)] });
        setKey(list); setSelected(entry.id); setAdding(false);
      },
    }, "It is gone for everyone once the lists are saved.");
  };
  // Each problem leads to its place: that list's tab, that entry, the keyboard on the field. The
  // fields of the entry shown are marked as on the editing screen (`useFieldMarks`).
  const detailBox = useRef<HTMLElement>(null);
  const fieldOf = (i: Issue, box: HTMLElement): HTMLElement | null => {
    for (const sel of listIssueField(i.path)) { const el = box.querySelector<HTMLElement>(sel); if (el && el.getClientRects().length) return el; }
    return null;
  };
  const issueEntry = (i: Issue) => {
    const { list, index } = listIssuePlace(i.path);
    const entry = list && index !== undefined ? ((clean[list] ?? []) as Row[])[index] : undefined;
    return list && entry ? { list, entry } : undefined;
  };
  const shownIssues = adding || !current ? [] : issues.filter((i) => { const at = issueEntry(i); return at?.list === key && at.entry.id === current.id; });
  useFieldMarks(shownIssues, { box: () => detailBox.current, find: fieldOf, text: issueWords });
  const pickIssue = (i: Issue) => {
    const at = issueEntry(i);
    if (!at) return;
    setKey(at.list); setSelected(at.entry.id); setAdding(false); setQ("");
    focusWhenShown(() => (detailBox.current ? fieldOf(i, detailBox.current) : null));
  };

  // the chosen entry is kept in view in the list (after adding, removing or Undo)
  const listBox = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listBox.current?.querySelector<HTMLElement>(".cat-item.on")?.scrollIntoView({ block: "nearest" });
  }, [current?.id, key]);
  // on a narrow screen the lists' tabs scroll sideways: the cut edge fades, the chosen one is brought into view
  const tabsBox = useRef<HTMLDivElement>(null);
  useScrollFade(tabsBox);
  useEffect(() => {
    const box = tabsBox.current, on = box?.querySelector<HTMLElement>(".tab.on");
    if (!box || !on || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, on.offsetLeft - box.offsetLeft - (box.clientWidth - on.offsetWidth) / 2);
  }, [key]);

  return (
    <div className={editor ? "catalog-page" : "page catalog-page"}>
      {!editor && (
        <div className="head-row">
          <div className="head-text">
            <h1>Teams, tools &amp; more</h1>
            <p className="lead">Who owns what, who belongs to each team, platform and practice, how to reach them, and which systems, tiers and environments the processes and standards refer to.</p>
          </div>
        </div>
      )}

      <div ref={tabsBox} className="tabs cat-kinds" role="tablist" aria-label="Lists">
        {KEYS.map((k) => {
          const K = KINDS[k];
          return (
            <button key={k} role="tab" aria-selected={key === k} className={`tab ${key === k ? "on" : ""}`} title={K.blurb} onClick={() => switchTo(k)}>
              {K.title}<span className="tab-count">{(draft[k] ?? []).length}</span>
              {!editor && yoursIn(k) > 0 && <span className="tab-yours">{yoursIn(k)} yours</span>}
            </button>
          );
        })}
      </div>
      <div ref={saveBar} className={`cat-toolbar ${editor ? "with-save" : ""} ${editor && dirty ? "dirty" : ""}`}>
        <p className="cat-blurb">{kind.blurb}</p>
        {/* the lists are saved together: Undo, Redo and Save stay in view above the list and the details */}
        {editor && (
          <div className="cat-save">
            {dirty && <span className="cat-save-text" role="status"><b>Unsaved changes</b> to the lists</span>}
            <SaveBar d={d} editor blocked={hasErrors(issues) ? "Fix the problems first" : undefined} />
          </div>
        )}
      </div>

      {/* what stops saving, each by the entry's name; readers of Teams & tools cannot change it, so it is not theirs to see */}
      {editor && issues.length > 0 && (
        <section className="issues-panel cat-issues" aria-labelledby="cat-issues-head">
          <h2 id="cat-issues-head" className="cat-issues-head"><CircleAlert size={16} aria-hidden="true" />{checkerSummary(issues).text}<span>The lists can be saved once {issues.length === 1 ? "it is" : "these are"} fixed. Press one to go to it.</span></h2>
          <IssueList issues={issues} text={issueWords} onPick={pickIssue} pickTitle="Go to it" label="What is to fix in the lists" />
        </section>
      )}

      <div className="cat-split">
        <section className="cat-list">
          <div className="cat-list-bar">
            <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind.title.toLowerCase()}`} aria-label={`Search ${kind.title.toLowerCase()}`} /></div>
            {editor && <button className="btn" onClick={() => { setAdding(true); setNewName(""); }}><Plus size={16} />New {kind.noun}</button>}
          </div>
          <ul ref={listBox}>
            {shown.map((r, at) => {
              const used = usesOf(key, r.id, docs);
              const n = used.length;
              const rank = rows.findIndex((x) => x.id === r.id);
              return (
                // a second entry with the same id (lists imported with a mistake) is still its own row
                <li key={shown.findIndex((x) => x.id === r.id) === at ? r.id : `${r.id}/${at}`}>
                  <button className={`cat-item ${current === r ? "on" : ""}`} onClick={() => { setSelected(r.id); setAdding(false); }}>
                    <EntryIcon icon={WITH_ICON.includes(key) ? r.icon : undefined} size={32}
                      fallback={key === "paths" ? <span className="cat-avatar path-avatar" data-symbol={r.symbol ?? "none"}><PathSymbolIcon symbol={r.symbol} size={18} /></span>
                        : <span className="cat-avatar">{ORDERED.includes(key) ? rank + (key === "tiers" ? 0 : 1) : r.name.slice(0, 1).toUpperCase()}</span>} />
                    <span className="cat-item-text">
                      <span className="cat-item-line">
                        <strong>{r.name || "Unnamed"}{isNew(r.id) && <i>new</i>}</strong>
                        {group && !isNew(r.id) && <RankMark rank={groupRank(perms, group, r.id)} />}
                      </span>
                      <em>{summaryLine(r)}</em>
                    </span>
                    <span className={`cat-uses ${n ? "" : "none"}`} title={n ? `Used by ${countOf(used)}` : "Not used by any process or standard"}>{n}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="cat-empty">{rows.length ? "Nothing matches your search." : `No ${kind.title.toLowerCase()} yet.`}</li>}
          </ul>
        </section>

        <section className="cat-detail" ref={detailBox}>
          {adding && (
            <div className="cat-new">
              <span className="cat-avatar big"><Plus size={22} /></span>
              <h2>New {kind.noun}</h2>
              <p className="muted">Give it the name people already use. You can add the details afterwards.</p>
              <Field label="Name">
                <input autoFocus value={newName} maxLength={40} placeholder={`e.g. ${key === "teams" ? "Cloud Platform team" : key === "practices" ? "Cyber security" : key === "platforms" ? "Google Cloud" : key === "categories" ? "Cloud" : key === "tools" ? "ServiceNow" : key === "tiers" ? "Tier 4" : key === "paths" ? "Lift and shift" : key === "environments" ? "Pre-production" : "Rust"}`}
                  onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              </Field>
              <p className="muted small">Id: <code>{slugify(newName) ? newId : "…"}</code>. It is made from the name and never changes, even if you rename.</p>
              <div className="btn-row">
                {/* the one main button of the view: Save changes, once there is something to save */}
                <button className={`btn ${dirty ? "" : "primary"}`} disabled={!slugify(newName)} onClick={add}><Plus size={16} />Add {kind.noun}</button>
                <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}

          {!adding && current && (
            <>
              <header className="cat-detail-head">
                <EntryIcon icon={WITH_ICON.includes(key) ? current.icon : undefined} size={56}
                  fallback={key === "paths" ? <span className="cat-avatar big path-avatar" data-symbol={current.symbol ?? "none"}><PathSymbolIcon symbol={current.symbol} size={28} /></span>
                    : <span className="cat-avatar big">{ORDERED.includes(key) ? rows.findIndex((x) => x.id === current.id) + (key === "tiers" ? 0 : 1) : current.name.slice(0, 1).toUpperCase()}</span>} />
                <div>
                  <span className="eyebrow">{kind.noun}</span>
                  <h2>{group && !isNew(current.id) ? <a className="group-link" href={href({ page: "group", kind: group, id: current.id })}>{current.name || "Unnamed"}</a> : current.name || "Unnamed"}</h2>
                  {group && !isNew(current.id) && <RankMark rank={groupRank(perms, group, current.id)} className="cat-rank" />}
                  {editor && <p className="cat-id">Id <code>{current.id}</code></p>}
                </div>
                {editor && ORDERED.includes(key) && (
                  <div className="cat-order">
                    <button className="icon-btn" title="Move up" aria-label="Move up" onClick={() => move(-1)} disabled={rows[0]?.id === current.id}><ArrowUp size={16} /></button>
                    <button className="icon-btn" title="Move down" aria-label="Move down" onClick={() => move(1)} disabled={rows[rows.length - 1]?.id === current.id}><ArrowDown size={16} /></button>
                  </div>
                )}
              </header>

              {editor ? (
                <div className="form">
                  <Field label="Name"><input data-field="name" value={current.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} /></Field>
                  {WITH_ICON.includes(key) && <IconField key={current.id} icon={current.icon} name={current.name} onChange={(icon) => upd({ icon })} />}
                  {key === "paths" && <SymbolField value={current.symbol} onChange={(symbol) => upd({ symbol })} />}
                  {group && <ContactFields key={`${key}/${current.id}`} kind={group} idPrefix={`lists-${group}`} value={{ description: current.description, contact: current.contact, contacts: current.contacts }}
                    onChange={(v) => upd({ description: v.description, contact: v.contact, contacts: v.contacts })} />}
                  {!group && kind.fields.map((f) => (
                    <Field key={f.field} label={f.label}>
                      {f.long
                        ? <textarea data-field={f.field} rows={2} maxLength={200} value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />
                        : <input data-field={f.field} value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />}
                    </Field>
                  ))}
                </div>
              ) : group ? (
                <div className="cat-group-facts">
                  {current.description?.trim() ? <p className="cat-group-description">{current.description}</p> : null}
                  <ContactList entry={current} name={current.name} empty="Nothing is known yet about how to reach them." />
                  <a className="btn cat-open-page" href={href({ page: "group", kind: group, id: current.id })}>Open the page of {current.name}<ArrowRight size={15} aria-hidden="true" /></a>
                </div>
              ) : (
                <dl className="cat-facts">
                  {key === "paths" && (
                    <div>
                      <dt>How it is marked</dt>
                      <dd><PathMark entry={current} named size="md" /></dd>
                    </div>
                  )}
                  {kind.fields.map((f) => current[f.field] && (
                    <div key={f.field}>
                      <dt>{f.label}</dt>
                      <dd>{f.field === "url"
                        ? <a className="btn link-btn" href={current.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open {current.name}</a>
                        : current[f.field]}</dd>
                    </div>
                  ))}
                  {kind.fields.every((f) => !current[f.field]) && <p className="muted">No details have been added yet.</p>}
                </dl>
              )}

              <div className="cat-usage">
                <h3>Used by {uses.length ? countOf(uses) : "nothing yet"}</h3>
                <ul>
                  {uses.map((u) => (
                    <li key={("requirements" in u.process ? "s/" : "p/") + u.process.id}>
                      <button onClick={() => go("requirements" in u.process ? { page: "standard", id: u.process.id, tab: "doc" } : { page: "process", id: u.process.id, tab: "flow" })}>
                        <strong>{u.process.title}</strong><em>{u.how}</em><ArrowUpRight size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* who belongs to the team, platform or practice: everyone sees it, admins change it where the lists are managed */}
              {group && (
                <div className="cat-people">
                  <GroupMembers kind={group} id={current.id} name={current.name} saved={!isNew(current.id)} manage={editor} members={members} membersError={membersError} onChanged={reloadMembers} />
                  {hasMembers(group) && <GroupMembers kind={group} id={current.id} name={current.name} rank="member" saved={!isNew(current.id)} manage={editor} members={members} membersError={membersError} onChanged={reloadMembers} />}
                </div>
              )}

              {editor && (
                <div className="cat-danger">
                  <button className="btn danger" disabled={!twin && (uses.length > 0 || stillMembers > 0)} onClick={() => remove(current)}>
                    <Trash2 size={15} />Remove this {kind.noun}
                  </button>
                  <span className="muted small">{twin ? `Another ${kind.noun} has the same id: what uses it keeps the other one.` : removeHint(countOf(uses), stillMembers, kind.noun)}</span>
                </div>
              )}
            </>
          )}
          {!adding && !current && <p className="muted cat-empty">Select a {kind.noun} on the left{editor ? `, or add a new one` : ""}.</p>}
        </section>
      </div>

      {editor && <BehindBanner d={d} meta={{ version, updatedAt: "", updatedBy: "", createdAt: "" }} noun="the lists" />}
      {editor && <ConflictDialog d={d} kind="catalog" id="catalog" noun="the lists" />}
    </div>
  );
}

/**
 * The picture of a path, chosen from the built-in ones (or none: a neutral signpost). One button
 * per picture; the chosen one is pressed.
 */
function SymbolField({ value, onChange }: { value?: PathSymbol; onChange: (symbol: PathSymbol | undefined) => void }) {
  const label = PATH_SYMBOLS.find((x) => x.symbol === value)?.label ?? "None: a neutral signpost";
  return (
    <div className="field" data-field="symbol">
      <span className="field-label">Picture<em>{label}</em></span>
      <div className="symbol-picker" role="group" aria-label="Picture">
        {PATH_SYMBOLS.map((x) => (
          <button key={x.symbol} type="button" className="symbol-choice" data-symbol={x.symbol} aria-pressed={value === x.symbol} title={x.label} aria-label={x.label}
            onClick={() => onChange(x.symbol)}><PathSymbolIcon symbol={x.symbol} size={22} /></button>
        ))}
        <button type="button" className="symbol-choice" data-symbol="none" aria-pressed={!value} title="None: a neutral signpost" aria-label="None: a neutral signpost"
          onClick={() => onChange(undefined)}><PathSymbolIcon size={22} /></button>
      </div>
    </div>
  );
}
