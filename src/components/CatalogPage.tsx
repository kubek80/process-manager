import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Boxes, CircleAlert, Code2, Compass, Server, ExternalLink, Layers, Network, Plus, Search, Shapes, Signpost, Tag, Trash2, Users, UsersRound, Wrench } from "lucide-react";
import type { Catalog, Contacts, Issue, Membership, PathSymbol, Process, Standard } from "../types";
import { PATH_SYMBOLS, PathMark, PathSymbolIcon } from "./marks";
import { otherNames } from "../lib/paths";
import { GroupMembers } from "./TeamMembers";
import { ContactFields } from "./ContactFields";
import { ContactList, PartOf, RankMark } from "./GroupParts";
import { EntryIcon } from "./EntryIcon";
import { IconField } from "./IconField";
import { hasMembers, membersOf, type GroupKind } from "../lib/members";
import { NO_DOMAIN, NO_TRIBE, ownFirst, partOf, summaryLine, teamSections, tidyLists } from "../lib/groups";
import { groupRank } from "../lib/rights";
import { useChangeBlocked, usePerms } from "../lib/session";
import { slugify, uniqueId } from "../lib/edit";
import { docCount, removeHint, useCatalog } from "../lib/catalog";
import { useDraft } from "../lib/draft";
import { BehindBanner, ConflictDialog, SaveBar } from "./Editing";
import { go, href, loadMembers, type CatalogList } from "../lib/store";
import { hasErrors, validateCatalog } from "../lib/validate";
import { checkerSummary, issueText, listIssueField, listIssuePlace, refusalText } from "../lib/editing";
import { focusWhenShown, useFieldMarks } from "../lib/fieldMarks";
import { addressedList, tabAfterKey } from "../lib/listTabs";
import { Field, IssueList, notify, useScrollFade } from "./ui";

type Key = "teams" | "tribes" | "domains" | "practices" | "platforms" | "categories" | "tools" | "patterns" | "tiers" | "paths" | "environments" | "languages";
type Row = { id: string; name: string; contact?: string; contacts?: Contacts; url?: string; description?: string; icon?: string; symbol?: PathSymbol; alsoCalled?: string[]; tribe?: string; domain?: string };

const KINDS: Record<Key, {
  title: string; noun: string; icon: typeof Users; blurb: string;
  fields: { field: "contact" | "url" | "description"; label: string; placeholder: string; long?: boolean; max?: number }[];
}> = {
  teams: {
    title: "Teams", noun: "team", icon: Users,
    blurb: "Maintain processes and standards, and take part in them.",
    fields: [], // the details of a team, practice or platform are ContactFields
  },
  tribes: {
    title: "Tribes", noun: "tribe", icon: UsersRound,
    blurb: "Groups of teams. A team can be part of one tribe, and a tribe part of one domain; all of it is optional.",
    fields: [{ field: "description", label: "What it is", placeholder: "e.g. The teams that build how customers pay", long: true, max: 600 }],
  },
  domains: {
    title: "Domains", noun: "domain", icon: Network,
    blurb: "Groups of tribes. A tribe can be part of one domain; a domain without tribes is fine.",
    fields: [{ field: "description", label: "What it is", placeholder: "e.g. Everything customers use to buy from us", long: true, max: 600 }],
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
  patterns: {
    title: "Architecture patterns", noun: "architecture pattern", icon: Shapes,
    blurb: "Ways systems are built, such as event-driven or microservices. Processes and standards are tagged with the ones they are about, and readers filter by them.",
    fields: [{ field: "description", label: "What it means", placeholder: "e.g. Services react to events instead of calling each other", long: true }],
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
/**
 * The lists' tabs in three groups, each its own row of tabs under a name: who (the groups of
 * people), what (how things are grouped and the systems used) and where it applies. A group
 * wraps as a whole; where a group's row is still too wide (a phone), it scrolls sideways with
 * its cut edge faded.
 */
const GROUPS: { id: string; name: string; keys: Key[] }[] = [
  { id: "who", name: "Who", keys: ["teams", "tribes", "domains", "practices", "platforms"] },
  { id: "what", name: "What", keys: ["categories", "tools", "patterns"] },
  { id: "where", name: "Where it applies", keys: ["tiers", "paths", "environments", "languages"] },
];
/** Lists an organisation may leave empty: readers of Teams & tools see them only once they have entries. */
const OPTIONAL: Key[] = ["patterns", "tribes", "domains"];
/** The lists that group other entries of the lists (tribes group teams, domains tribes), not processes and standards. */
const INNER: Partial<Record<Key, { of: "teams" | "tribes"; noun: string; many: string; field: "tribe" | "domain" }>> = {
  tribes: { of: "teams", noun: "team", many: "teams", field: "tribe" },
  domains: { of: "tribes", noun: "tribe", many: "tribes", field: "domain" },
};
/** The lists whose entries have other names ("golden path", "EDA"), found by the search. */
const WITH_OTHER_NAMES: Key[] = ["paths", "patterns"];
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
    } else if (key === "patterns") {
      if (Array.isArray(p.patterns) && p.patterns.includes(id)) how.push("tagged with this pattern");
    } else if (INNER[key]) {
      // tribes and domains group entries of the lists, not documents
    } else if (key === "tools") {
      const n = "steps" in p ? p.steps?.filter((s) => s.tool === id).length ?? 0 : 0;
      if (n) how.push(`${n} step${n > 1 ? "s" : ""}`);
    } else if (key === "tiers" || key === "environments" || key === "languages") {
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
  const viewOnly = useChangeBlocked(); // viewing as somebody else: Save is unavailable, the changes stay
  const docs = useMemo<(Process | Standard)[]>(() => [...processes, ...standards], [processes, standards]);
  const d = useDraft<Catalog>({ docKey: "catalog", saved: catalog, version, tidy: tidyCatalog, save, reload, what: "the lists", editable: editor });
  const { draft, clean, dirty } = d;
  const setDraft = d.change;
  // a save the server refused reads like a problem the page found itself: by name, never by place
  useEffect(() => { if (d.error) { notify.error("The lists could not be saved.", refusalText(d.error, "lists", clean)); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [key, setKeyHere] = useState<Key>(routeList ?? "teams");
  const [selected, setSelectedHere] = useState<string | null>(routeId ?? null);
  // Teams & tools keeps the list and the entry in the address (a link, Back, the group page's back
  // link lead to them); Admin › Lists keeps them on the page, and follows an address that names an
  // entry ("Edit in Admin › Lists", Back) without leaving the page: its unsaved changes stay
  useEffect(() => {
    const a = addressedList(editor, routeList, routeId, "teams");
    if (a) { setKeyHere(a.list); setSelectedHere(a.id); if (editor) setAdding(false); }
  }, [editor, routeList, routeId]);
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
  // Teams & tools: the teams under their domain and tribe, when the lists have tribes
  const sections = !editor && key === "teams" && (draft.tribes ?? []).length > 0 ? teamSections(draft, shown) : null;
  const first = sections ? sections[0]?.tribes[0]?.teams[0] as Row | undefined : shown[0];
  const current = adding ? undefined : rows.find((r) => r.id === selected) ?? first;
  const uses = current ? usesOf(key, current.id, docs) : [];
  // the teams of a tribe, the tribes of a domain, as the lists now have them
  const inner = INNER[key];
  const innerOf = (id: string) => (inner ? ((draft[inner.of] ?? []) as Row[]).filter((r) => r[inner.field] === id).sort((a, b) => a.name.localeCompare(b.name)) : []);
  const grouped = current ? innerOf(current.id) : [];
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
  const listBox = useRef<HTMLElement>(null);
  useEffect(() => {
    listBox.current?.querySelector<HTMLElement>(".cat-item.on")?.scrollIntoView({ block: "nearest" });
  }, [current?.id, key]);
  /** One entry in the list on the left. */
  const row = (r: Row, at: number) => {
    const used = usesOf(key, r.id, docs);
    const n = inner ? innerOf(r.id).length : used.length;
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
          <span className={`cat-uses ${n ? "" : "none"}`} title={inner ? (n ? `${n} ${n === 1 ? inner.noun : inner.many} in it` : `No ${inner.many} in it`) : n ? `Used by ${countOf(used)}` : "Not used by any process or standard"}>{n}</span>
        </button>
      </li>
    );
  };
  // the tabs shown, in order across their groups: an optional list without entries only in Admin
  const shownKeys = GROUPS.flatMap((g) => g.keys).filter((k) => editor || !OPTIONAL.includes(k) || (draft[k] ?? []).length > 0 || k === key);
  const tabRefs = useRef<Partial<Record<Key, HTMLButtonElement | null>>>({});

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

      {/* one set of tabs for the keyboard: one Tab stop, the arrows through all of them (`tabAfterKey`) */}
      <div className="cat-kinds-groups" role="group" aria-label="Lists" onKeyDown={(e) => {
        const to = tabAfterKey(shownKeys, key, e.key);
        if (!to) return;
        e.preventDefault();
        if (to !== key) switchTo(to);
        tabRefs.current[to]?.focus();
      }}>
        {GROUPS.map((g) => {
          const keys = g.keys.filter((k) => shownKeys.includes(k));
          return keys.length > 0 && (
            <ListTabs key={g.id} id={g.id} name={g.name} chosen={key}>
              {keys.map((k) => {
                const K = KINDS[k];
                return (
                  <button key={k} ref={(el) => { tabRefs.current[k] = el; }} role="tab" aria-selected={key === k} tabIndex={key === k ? 0 : -1} className={`tab ${key === k ? "on" : ""}`} title={K.blurb} onClick={() => switchTo(k)}>
                    {K.title}<span className="tab-count">{(draft[k] ?? []).length}</span>
                    {!editor && yoursIn(k) > 0 && <span className="tab-yours">{yoursIn(k)} yours</span>}
                  </button>
                );
              })}
            </ListTabs>
          );
        })}
      </div>
      <div ref={saveBar} className={`cat-toolbar ${editor ? "with-save" : ""} ${editor && dirty ? "dirty" : ""}`}>
        <p className="cat-blurb">{kind.blurb}</p>
        {/* the lists are saved together: Undo, Redo and Save stay in view above the list and the details */}
        {editor && (
          <div className="cat-save">
            {dirty && <span className="cat-save-text" role="status"><b>Unsaved changes</b> to the lists</span>}
            <SaveBar d={d} editor blocked={viewOnly || (hasErrors(issues) ? "Fix the problems first" : undefined)} />
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
        <section className="cat-list" ref={listBox}>
          <div className="cat-list-bar">
            <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind.title.toLowerCase()}`} aria-label={`Search ${kind.title.toLowerCase()}`} /></div>
            {editor && <button className="btn" onClick={() => { setAdding(true); setNewName(""); }}><Plus size={16} />New {kind.noun}</button>}
          </div>
          {sections ? (
            <div className="cat-sections">
              {sections.map((sec, i) => (
                <section key={sec.domain === null ? "-" : sec.domain?.id ?? "+"} className="cat-section" aria-labelledby={`cat-sec-${i}`}>
                  {/* a domain (or "Not in a domain") is a heading of its own; so are the teams in no tribe, after
                      every domain, so that they never read as part of the domain before them */}
                  <h2 id={`cat-sec-${i}`} className="cat-section-domain">{sec.domain ? <><a href={href({ page: "domain", id: sec.domain.id })}>{sec.domain.name}</a><span className="sr-only"> (domain)</span></> : sec.domain === null ? NO_TRIBE : NO_DOMAIN}</h2>
                  {sec.tribes.map((t, j) => (
                    <div key={t.tribe?.id ?? "-"} className="cat-section-tribe">
                      {t.tribe && <h3 id={`cat-sec-${i}-${j}`} className="cat-section-name"><a href={href({ page: "tribe", id: t.tribe.id })}>{t.tribe.name}</a><span className="sr-only"> (tribe)</span></h3>}
                      <ul>{t.teams.map((r) => row(r as Row, shown.indexOf(r as Row)))}</ul>
                    </div>
                  ))}
                </section>
              ))}
              {shown.length === 0 && <p className="cat-empty">Nothing matches your search.</p>}
            </div>
          ) : (
          <ul>
            {shown.map((r, at) => row(r, at))}
            {shown.length === 0 && <li className="cat-empty">{rows.length ? "Nothing matches your search." : `No ${kind.title.toLowerCase()} yet.`}</li>}
          </ul>
          )}
        </section>

        <section className="cat-detail" ref={detailBox}>
          {adding && (
            <div className="cat-new">
              <span className="cat-avatar big"><Plus size={22} /></span>
              <h2>New {kind.noun}</h2>
              <p className="muted">Give it the name people already use. You can add the details afterwards.</p>
              <Field label="Name">
                <input autoFocus value={newName} maxLength={40} placeholder={`e.g. ${key === "teams" ? "Cloud Platform team" : key === "practices" ? "Cyber security" : key === "platforms" ? "Google Cloud" : key === "categories" ? "Cloud" : key === "tools" ? "ServiceNow" : key === "tiers" ? "Tier 4" : key === "paths" ? "Lift and shift" : key === "patterns" ? "Event-driven" : key === "environments" ? "Pre-production" : "Rust"}`}
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
                  <h2>{group && !isNew(current.id) ? <a className="group-link" href={href({ page: "group", kind: group, id: current.id })}>{current.name || "Unnamed"}</a>
                    : inner && !isNew(current.id) ? <a className="group-link" href={href({ page: key === "tribes" ? "tribe" : "domain", id: current.id })}>{current.name || "Unnamed"}</a>
                    : current.name || "Unnamed"}</h2>
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
                  {WITH_OTHER_NAMES.includes(key) && (
                    <Field label="Also called" hint={key === "paths" ? "Other names people use for it, separated by commas, e.g. golden path. Searching for one finds what is for this path." : "Other names people use for it, separated by commas, e.g. EDA. Searching for one finds what is tagged with this pattern."}>
                      <input data-field="alsoCalled" value={(current.alsoCalled ?? []).join(", ")} placeholder={key === "paths" ? "e.g. golden path" : "e.g. EDA"}
                        onChange={(e) => { const names = e.target.value.split(",").map((t) => t.trimStart()); upd({ alsoCalled: names.some((t) => t.trim()) ? names : undefined }); }} />
                    </Field>
                  )}
                  {key === "paths" && <SymbolField value={current.symbol} onChange={(symbol) => upd({ symbol })} />}
                  {key === "teams" && ((draft.tribes ?? []).length > 0 || !!current.tribe) && (
                    <Field label="Tribe" hint="The group of teams it is part of, if any">
                      <GroupChoice field="tribe" value={current.tribe} options={(draft.tribes ?? []) as Row[]} none="No tribe" onChange={(tribe) => upd({ tribe })} />
                    </Field>
                  )}
                  {key === "tribes" && (
                    <Field label="Domain" hint="The group of tribes it is part of, if any">
                      <GroupChoice field="domain" value={current.domain} options={(draft.domains ?? []) as Row[]} none="No domain" onChange={(domain) => upd({ domain })} />
                    </Field>
                  )}
                  {group && <ContactFields key={`${key}/${current.id}`} kind={group} idPrefix={`lists-${group}`} value={{ description: current.description, contact: current.contact, contacts: current.contacts }}
                    onChange={(v) => upd({ description: v.description, contact: v.contact, contacts: v.contacts })} />}
                  {!group && kind.fields.map((f) => (
                    <Field key={f.field} label={f.label}>
                      {f.long
                        ? <textarea data-field={f.field} rows={2} maxLength={f.max ?? 200} value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />
                        : <input data-field={f.field} value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />}
                    </Field>
                  ))}
                </div>
              ) : group ? (
                <div className="cat-group-facts">
                  {key === "teams" && partOf(draft, current).length > 0 && <p className="cat-part-of"><PartOf pieces={partOf(draft, current)} /></p>}
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
                  {WITH_OTHER_NAMES.includes(key) && otherNames(current).length > 0 && (
                    <div>
                      <dt>Also called</dt>
                      <dd>{otherNames(current).join(", ")}</dd>
                    </div>
                  )}
                  {key === "tribes" && (
                    <div>
                      <dt>Domain</dt>
                      <dd>{(() => { const d = ((draft.domains ?? []) as Row[]).find((x) => x.id === current.domain); return d ? <a href={href({ page: "domain", id: d.id })}>{d.name}</a> : "Not in a domain"; })()}</dd>
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
                  {kind.fields.every((f) => !current[f.field]) && key !== "tribes" && <p className="muted">No details have been added yet.</p>}
                </dl>
              )}
              {!editor && inner && <div><a className="btn cat-open-page" href={href({ page: key === "tribes" ? "tribe" : "domain", id: current.id })}>Open the page of {current.name}<ArrowRight size={15} aria-hidden="true" /></a></div>}

              {inner ? (
                <div className="cat-usage cat-inner">
                  <h3>{grouped.length ? `${grouped.length} ${grouped.length === 1 ? inner.noun : inner.many} in this ${kind.noun}` : `No ${inner.many} in this ${kind.noun} yet`}</h3>
                  <ul>
                    {grouped.map((r) => (
                      <li key={r.id}>
                        {!editor
                          ? <a href={inner.of === "teams" ? href({ page: "group", kind: "team", id: r.id }) : href({ page: "tribe", id: r.id })}><strong>{r.name || "Unnamed"}</strong><ArrowUpRight size={14} aria-hidden="true" /></a>
                          : <button type="button" onClick={() => { setKey(inner.of); setSelected(r.id); }}><strong>{r.name || "Unnamed"}</strong><ArrowUpRight size={14} aria-hidden="true" /></button>}
                      </li>
                    ))}
                  </ul>
                  {editor && <p className="muted small">{inner.of === "teams" ? "A team is put in a tribe under Teams, in its own details." : "A tribe is put in a domain under Tribes, in its own details."}</p>}
                </div>
              ) : (
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
              )}

              {/* who belongs to the team, platform or practice: everyone sees it, admins change it where the lists are managed */}
              {group && (
                <div className="cat-people">
                  <GroupMembers kind={group} id={current.id} name={current.name} saved={!isNew(current.id)} manage={editor} members={members} membersError={membersError} onChanged={reloadMembers} />
                  {hasMembers(group) && <GroupMembers kind={group} id={current.id} name={current.name} rank="member" saved={!isNew(current.id)} manage={editor} members={members} membersError={membersError} onChanged={reloadMembers} />}
                </div>
              )}

              {editor && (
                <div className="cat-danger">
                  <button className="btn danger" disabled={!twin && (uses.length > 0 || stillMembers > 0 || grouped.length > 0)} onClick={() => remove(current)}>
                    <Trash2 size={15} />Remove this {kind.noun}
                  </button>
                  <span className="muted small">{twin ? `Another ${kind.noun} has the same id: what uses it keeps the other one.` : inner && grouped.length ? groupedHint(grouped.length, inner, kind.noun) : removeHint(countOf(uses), stillMembers, kind.noun)}</span>
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
 * One group of the lists' tabs: its name, then its tabs in a row of their own (a tablist named by
 * the group). On a narrow screen the row scrolls sideways: the cut edge fades, the chosen tab is
 * brought into view.
 */
function ListTabs({ id, name, chosen, children }: { id: string; name: string; chosen: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useScrollFade(box);
  useEffect(() => {
    const el = box.current, on = el?.querySelector<HTMLElement>(".tab.on");
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, on.offsetLeft - el.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
  }, [chosen]);
  return (
    <div className="cat-kinds-group" data-group={id}>
      <span className="cat-kinds-name" id={`cat-kinds-${id}`}>{name}</span>
      {/* tabIndex -1: a row that scrolls sideways is not a Tab stop of its own (the browser would make it one) */}
      <div ref={box} className="tabs cat-kinds" role="tablist" aria-labelledby={`cat-kinds-${id}`} tabIndex={-1}>{children}</div>
    </div>
  );
}

/**
 * The tribe of a team, or the domain of a tribe: a choice of the list by name, "No tribe" (or "No
 * domain") first. One it names that is no longer in the list still shows, so that it can be changed.
 */
function GroupChoice({ field, value, options, none, onChange }: { field: "tribe" | "domain"; value?: string; options: Row[]; none: string; onChange: (id: string | undefined) => void }) {
  const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select data-field={field} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{none}</option>
      {sorted.map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
      {value && !options.some((o) => o.id === value) && <option value={value}>{value} (not in the list)</option>}
    </select>
  );
}

/** Why a tribe or a domain cannot be removed yet: "Still the tribe of 2 teams. Take them out of it first, then it can be removed." */
function groupedHint(n: number, inner: { noun: string; many: string }, noun: string): string {
  return `Still the ${noun} of ${n} ${n === 1 ? inner.noun : inner.many}. Take ${n === 1 ? "it" : "them"} out of it first, then it can be removed.`;
}

/**
 * The picture of a path, chosen from the built-in ones (or none: a neutral signpost). One button
 * per picture; the chosen one is pressed.
 */
function SymbolField({ value, onChange }: { value?: PathSymbol; onChange: (symbol: PathSymbol | undefined) => void }) {
  const NONE = "None: a neutral signpost";
  const label = PATH_SYMBOLS.find((x) => x.symbol === value)?.label ?? NONE;
  // the caption under the row names the picture pointed at or focused, else the chosen one
  const [shown, setShown] = useState<string | null>(null);
  const choice = (symbol: PathSymbol | undefined, name: string) => (
    <button key={symbol ?? "none"} type="button" className="symbol-choice" data-symbol={symbol ?? "none"} aria-pressed={symbol ? value === symbol : !value} title={name} aria-label={name}
      onClick={() => onChange(symbol)} onMouseEnter={() => setShown(name)} onMouseLeave={() => setShown(null)} onFocus={() => setShown(name)} onBlur={() => setShown(null)}>
      <PathSymbolIcon symbol={symbol} size={22} />
    </button>
  );
  return (
    <div className="field" data-field="symbol">
      <span className="field-label">Picture<em>{label}</em></span>
      <div className="symbol-picker" role="group" aria-label="Picture">
        {PATH_SYMBOLS.map((x) => choice(x.symbol, x.label))}
        {choice(undefined, NONE)}
      </div>
      <p className="symbol-caption" aria-hidden="true">{shown ?? `Chosen: ${label}`}</p>
    </div>
  );
}
