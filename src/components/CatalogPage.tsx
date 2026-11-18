import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Boxes, Code2, Compass, Server, ExternalLink, Layers, Plus, Search, Tag, Trash2, Users, Wrench } from "lucide-react";
import type { Catalog, Membership, Process, Standard } from "../types";
import { GroupMembers } from "./TeamMembers";
import { EntryIcon } from "./EntryIcon";
import { IconField } from "./IconField";
import { membersOf, type GroupKind } from "../lib/members";
import { slugify, uniqueId } from "../lib/edit";
import { docCount, removeHint, useCatalog } from "../lib/catalog";
import { useDraft } from "../lib/draft";
import { BehindBanner, ConflictDialog, SaveBar } from "./Editing";
import { go, loadMembers } from "../lib/store";
import { hasErrors, validateCatalog } from "../lib/validate";
import { Field, IssueList, notify, useBottomBar } from "./ui";

type Key = "teams" | "practices" | "platforms" | "categories" | "tools" | "tiers" | "environments" | "languages";
type Row = { id: string; name: string; contact?: string; url?: string; description?: string; icon?: string };

const KINDS: Record<Key, {
  title: string; noun: string; icon: typeof Users; color: string; blurb: string;
  fields: { field: "contact" | "url" | "description"; label: string; placeholder: string; long?: boolean }[];
}> = {
  teams: {
    title: "Teams", noun: "team", icon: Users, color: "#0d9488",
    blurb: "Maintain processes and standards, and take part in them.",
    fields: [
      { field: "contact", label: "How to reach them", placeholder: "Slack #cloud-platform, a mailbox or a queue" },
      { field: "description", label: "What they do", placeholder: "One sentence on what this team is responsible for", long: true },
    ],
  },
  practices: {
    title: "Practices", noun: "practice", icon: Compass, color: "#7c3aed",
    blurb: "Ways of working, such as cyber security or engineering.",
    fields: [
      { field: "contact", label: "How to reach them", placeholder: "Slack #engineering-practice or a mailbox" },
      { field: "description", label: "What it covers", placeholder: "One sentence on what this practice agrees on", long: true },
    ],
  },
  platforms: {
    title: "Platforms", noun: "platform", icon: Boxes, color: "#0284c7",
    blurb: "Systems and services people get access to or build on.",
    fields: [
      { field: "contact", label: "How to reach its owners", placeholder: "Slack #cloud-platform or a mailbox" },
      { field: "description", label: "What it is", placeholder: "One sentence on what this platform is for", long: true },
    ],
  },
  categories: {
    title: "Categories", noun: "category", icon: Tag, color: "#be123c",
    blurb: "How processes and standards are grouped for readers.",
    fields: [{ field: "description", label: "What belongs here", placeholder: "e.g. Getting and changing cloud accounts", long: true }],
  },
  tools: {
    title: "Tools", noun: "tool", icon: Wrench, color: "#4f46e5",
    blurb: "Systems that steps are done in. Steps pick one from this list.",
    fields: [
      { field: "url", label: "Link", placeholder: "https://…" },
      { field: "description", label: "What it is used for", placeholder: "One sentence on what people do in this tool", long: true },
    ],
  },
  tiers: {
    title: "Application tiers", noun: "tier", icon: Layers, color: "#d97706",
    blurb: "A process applies to every tier or to a chosen few. Most critical first.",
    fields: [{ field: "description", label: "What makes an application this tier", placeholder: "e.g. Outage stops the business", long: true }],
  },
  environments: {
    title: "Environments", noun: "environment", icon: Server, color: "#0284c7",
    blurb: "Where things run. In the order work moves through them.",
    fields: [{ field: "description", label: "Notes", placeholder: "e.g. Production-like, used for final checks", long: true }],
  },
  languages: {
    title: "Languages", noun: "language", icon: Code2, color: "#db2777",
    blurb: "Some processes only apply to one language. Most apply to any.",
    fields: [{ field: "description", label: "Notes", placeholder: "e.g. Includes TypeScript", long: true }],
  },
};
const KEYS: Key[] = ["teams", "practices", "platforms", "categories", "tools", "tiers", "environments", "languages"];
/** The lists whose entries have members. */
const GROUP_OF: Partial<Record<Key, GroupKind>> = { teams: "team", practices: "practice", platforms: "platform" };
const ORDERED: Key[] = ["tiers", "environments"]; // lists whose order means something
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

const strip = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "id" || k === "name" || (v ?? "").trim() !== "")) as Row;
/** The lists without empty optional fields: what is compared with the saved lists, and saved. */
const tidyCatalog = (c: Catalog): Catalog =>
  ({
    ...c, teams: c.teams.map(strip), practices: (c.practices ?? []).map(strip), platforms: (c.platforms ?? []).map(strip), categories: (c.categories ?? []).map(strip),
    tools: c.tools.map(strip), tiers: c.tiers.map(strip), environments: c.environments.map(strip), languages: c.languages.map(strip),
  }) as Catalog;

/** The lists. Read-only it is a directory for everyone; editable it is the Lists section of the Admin panel. */
export function CatalogPage({ processes, standards, editable: editor }: { processes: Process[]; standards: Standard[]; editable: boolean }) {
  const { catalog, version, save, reload } = useCatalog();
  const docs = useMemo<(Process | Standard)[]>(() => [...processes, ...standards], [processes, standards]);
  const d = useDraft<Catalog>({ docKey: "catalog", saved: catalog, version, tidy: tidyCatalog, save, reload, what: "the lists", editable: editor });
  const { draft, clean, dirty } = d;
  const setDraft = d.change;
  useEffect(() => { if (d.error) { notify.error("The lists could not be saved.", d.error); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [key, setKey] = useState<Key>("teams");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const issues = validateCatalog(clean);
  // the bar with Save and Discard sticks to the bottom while there are changes: messages go above it
  const saveBar = useRef<HTMLDivElement>(null);
  useBottomBar(saveBar, editor && dirty);
  // who belongs to which team, platform and practice: everyone may read it
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const reloadMembers = useCallback(() => { loadMembers().then((m) => { setMembers(m); setMembersError(""); }, (e) => setMembersError(e.message)); }, []);
  useEffect(reloadMembers, [reloadMembers]);

  const kind = KINDS[key];
  const rows = (draft[key] ?? []) as Row[];
  const shown = rows.filter((r) => `${r.name} ${r.contact ?? ""} ${r.description ?? ""} ${r.url ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const current = adding ? undefined : rows.find((r) => r.id === selected) ?? shown[0];
  const uses = current ? usesOf(key, current.id, docs) : [];
  // people who are still members: the server refuses to remove an entry that roles point to
  const stillMembers = current && GROUP_OF[key] && members ? membersOf(members, GROUP_OF[key]!, current.id).length : 0;
  const isNew = (id: string) => !((catalog[key] ?? []) as Row[]).some((r) => r.id === id);
  const group = GROUP_OF[key];

  const setRows = (next: Row[]) => setDraft({ ...draft, [key]: next });
  const upd = (patch: Partial<Row>) => current && setRows(rows.map((r) => (r.id === current.id ? { ...r, ...patch } : r)));
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

      <div className="cat-tabs" role="tablist">
        {KEYS.map((k) => {
          const K = KINDS[k], Icon = K.icon;
          return (
            <button key={k} role="tab" aria-selected={key === k} className={key === k ? "on" : ""} style={{ "--c": K.color } as React.CSSProperties} onClick={() => switchTo(k)}>
              <span className="cat-tab-icon"><Icon size={18} /></span>
              <span className="cat-tab-text"><strong>{K.title}</strong><em>{K.blurb}</em></span>
              <span className="cat-tab-n">{(draft[k] ?? []).length}</span>
            </button>
          );
        })}
      </div>

      {issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      <div className="cat-split" style={{ "--c": kind.color } as React.CSSProperties}>
        <section className="cat-list">
          <div className="cat-list-bar">
            <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind.title.toLowerCase()}`} aria-label={`Search ${kind.title.toLowerCase()}`} /></div>
            {editor && <button className="btn primary" onClick={() => { setAdding(true); setNewName(""); }}><Plus size={16} />New {kind.noun}</button>}
          </div>
          <ul>
            {shown.map((r) => {
              const used = usesOf(key, r.id, docs);
              const n = used.length;
              const rank = rows.findIndex((x) => x.id === r.id);
              return (
                <li key={r.id}>
                  <button className={`cat-item ${current?.id === r.id ? "on" : ""}`} onClick={() => { setSelected(r.id); setAdding(false); }}>
                    <EntryIcon icon={WITH_ICON.includes(key) ? r.icon : undefined} size={32}
                      fallback={<span className="cat-avatar">{ORDERED.includes(key) ? rank + (key === "tiers" ? 0 : 1) : r.name.slice(0, 1).toUpperCase()}</span>} />
                    <span className="cat-item-text">
                      <strong>{r.name || "Unnamed"}{isNew(r.id) && <i>new</i>}</strong>
                      <em>{r.contact ?? r.url?.replace(/^https?:\/\//, "") ?? r.description ?? "No details yet"}</em>
                    </span>
                    <span className={`cat-uses ${n ? "" : "none"}`} title={n ? `Used by ${countOf(used)}` : "Not used by any process or standard"}>{n}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="cat-empty">{rows.length ? "Nothing matches your search." : `No ${kind.title.toLowerCase()} yet.`}</li>}
          </ul>
        </section>

        <section className="cat-detail">
          {adding && (
            <div className="cat-new">
              <span className="cat-avatar big"><Plus size={22} /></span>
              <h2>New {kind.noun}</h2>
              <p className="muted">Give it the name people already use. You can add the details afterwards.</p>
              <Field label="Name">
                <input autoFocus value={newName} maxLength={40} placeholder={key === "teams" ? "Cloud Platform team" : key === "practices" ? "Cyber security" : key === "platforms" ? "Google Cloud" : key === "categories" ? "Cloud" : key === "tools" ? "ServiceNow" : key === "tiers" ? "Tier 4" : key === "environments" ? "Pre-production" : "Rust"}
                  onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              </Field>
              <p className="muted small">Id: <code>{slugify(newName) ? newId : "…"}</code>. It is made from the name and never changes, even if you rename.</p>
              <div className="btn-row">
                <button className="btn primary" disabled={!slugify(newName)} onClick={add}><Plus size={16} />Add {kind.noun}</button>
                <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}

          {!adding && current && (
            <>
              <header className="cat-detail-head">
                <EntryIcon icon={WITH_ICON.includes(key) ? current.icon : undefined} size={56}
                  fallback={<span className="cat-avatar big">{ORDERED.includes(key) ? rows.findIndex((x) => x.id === current.id) + (key === "tiers" ? 0 : 1) : current.name.slice(0, 1).toUpperCase()}</span>} />
                <div>
                  <span className="eyebrow">{kind.noun}</span>
                  <h2>{current.name || "Unnamed"}</h2>
                  <code>{current.id}</code>
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
                  <Field label="Name"><input value={current.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} /></Field>
                  {WITH_ICON.includes(key) && <IconField key={current.id} icon={current.icon} name={current.name} onChange={(icon) => upd({ icon })} />}
                  {kind.fields.map((f) => (
                    <Field key={f.field} label={f.label}>
                      {f.long
                        ? <textarea rows={2} maxLength={200} value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />
                        : <input value={current[f.field] ?? ""} placeholder={f.placeholder} onChange={(e) => upd({ [f.field]: e.target.value })} />}
                    </Field>
                  ))}
                </div>
              ) : (
                <dl className="cat-facts">
                  {kind.fields.map((f) => current[f.field] && (
                    <div key={f.field}>
                      <dt>{f.label}</dt>
                      <dd>{f.field === "url"
                        ? <a className="btn link-btn" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open {current.name}</a>
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
              {group && <GroupMembers kind={group} id={current.id} name={current.name} saved={!isNew(current.id)} manage={editor} members={members} membersError={membersError} onChanged={reloadMembers} />}

              {editor && (
                <div className="cat-danger">
                  <button className="btn danger" disabled={uses.length > 0 || stillMembers > 0} onClick={() => { setRows(rows.filter((r) => r.id !== current.id)); setSelected(null); }}>
                    <Trash2 size={15} />Remove this {kind.noun}
                  </button>
                  <span className="muted small">{removeHint(countOf(uses), stillMembers, kind.noun)}</span>
                </div>
              )}
            </>
          )}
          {!adding && !current && <p className="muted cat-empty">Select a {kind.noun} on the left{editor ? `, or add a new one` : ""}.</p>}
        </section>
      </div>

      {editor && <BehindBanner d={d} meta={{ version, updatedAt: "", updatedBy: "", createdAt: "" }} noun="the lists" />}
      {editor && (
        <div ref={saveBar} className={`cat-save ${dirty ? "dirty" : ""}`}>
          {dirty && <span className="cat-save-text" role="status"><b>Unsaved changes</b> to the lists</span>}
          <SaveBar d={d} editor blocked={hasErrors(issues) ? "Fix the problems first" : undefined} />
        </div>
      )}
      {editor && <ConflictDialog d={d} kind="catalog" id="catalog" noun="the lists" />}
    </div>
  );
}
