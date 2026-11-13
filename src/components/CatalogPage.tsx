import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ExternalLink, Layers, Plus, Save, Search, Trash2, Undo2, Users, Wrench } from "lucide-react";
import type { Catalog, Process } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { useEditor } from "../lib/mode";
import { hasErrors, validateCatalog } from "../lib/validate";
import { go } from "../lib/store";
import { IssueList } from "./AiDialog";
import { Field } from "./ui";

type Key = "teams" | "tools" | "tiers";
type Row = { id: string; name: string; contact?: string; url?: string; description?: string };

const KINDS: Record<Key, {
  title: string; noun: string; icon: typeof Users; color: string; blurb: string;
  fields: { field: "contact" | "url" | "description"; label: string; placeholder: string; long?: boolean }[];
}> = {
  teams: {
    title: "Teams", noun: "team", icon: Users, color: "#0d9488",
    blurb: "Teams own processes and appear as lanes on the map.",
    fields: [
      { field: "contact", label: "How to reach them", placeholder: "Slack #cloud-platform, a mailbox or a queue" },
      { field: "description", label: "What they do", placeholder: "One sentence on what this team is responsible for", long: true },
    ],
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
};
const KEYS: Key[] = ["teams", "tools", "tiers"];

interface Use { process: Process; how: string }

function usesOf(key: Key, id: string, processes: Process[]): Use[] {
  const out: Use[] = [];
  for (const p of processes) {
    const how: string[] = [];
    if (key === "teams") {
      if (p.owner === id) how.push("owns it");
      if (p.actors?.some((a) => a.teamId === id)) how.push("takes part");
    } else if (key === "tools") {
      const n = p.steps?.filter((s) => s.tool === id).length ?? 0;
      if (n) how.push(`${n} step${n > 1 ? "s" : ""}`);
    } else if (p.tiers?.includes(id)) how.push("applies to this tier");
    if (how.length) out.push({ process: p, how: how.join(" · ") });
  }
  return out;
}

const strip = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "id" || k === "name" || (v ?? "").trim() !== "")) as Row;

export function CatalogPage({ processes }: { processes: Process[] }) {
  const { catalog, save } = useCatalog();
  const editor = useEditor();
  const [draft, setDraft] = useState<Catalog>(catalog);
  const [key, setKey] = useState<Key>("teams");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => setDraft(catalog), [catalog]);
  useEffect(() => { if (!editor) { setDraft(catalog); setAdding(false); } }, [editor, catalog]);

  const clean = useMemo<Catalog>(() => ({ ...draft, teams: draft.teams.map(strip), tools: draft.tools.map(strip), tiers: draft.tiers.map(strip) }) as Catalog, [draft]);
  const dirty = JSON.stringify(clean) !== JSON.stringify(catalog);
  const issues = validateCatalog(clean);

  const kind = KINDS[key];
  const rows = draft[key] as Row[];
  const shown = rows.filter((r) => `${r.name} ${r.contact ?? ""} ${r.description ?? ""} ${r.url ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const current = adding ? undefined : rows.find((r) => r.id === selected) ?? shown[0];
  const uses = current ? usesOf(key, current.id, processes) : [];
  const isNew = (id: string) => !(catalog[key] as Row[]).some((r) => r.id === id);

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
    <div className="page catalog-page">
      <div className="head-row">
        <div className="head-text">
          <h1>Teams, tools &amp; tiers</h1>
          <p className="lead">{editor
            ? "The shared lists every process picks from. Change a name here and it changes everywhere."
            : "Who owns what, how to reach them, and which systems the processes use."}</p>
        </div>
      </div>

      <div className="cat-tabs" role="tablist">
        {KEYS.map((k) => {
          const K = KINDS[k], Icon = K.icon;
          return (
            <button key={k} role="tab" aria-selected={key === k} className={key === k ? "on" : ""} style={{ "--c": K.color } as React.CSSProperties} onClick={() => switchTo(k)}>
              <span className="cat-tab-icon"><Icon size={18} /></span>
              <span className="cat-tab-text"><strong>{K.title}</strong><em>{K.blurb}</em></span>
              <span className="cat-tab-n">{draft[k].length}</span>
            </button>
          );
        })}
      </div>

      {issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      <div className="cat-split" style={{ "--c": kind.color } as React.CSSProperties}>
        <section className="cat-list">
          <div className="cat-list-bar">
            <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind.title.toLowerCase()}`} /></div>
            {editor && <button className="btn primary" onClick={() => { setAdding(true); setNewName(""); }}><Plus size={16} />New {kind.noun}</button>}
          </div>
          <ul>
            {shown.map((r) => {
              const n = usesOf(key, r.id, processes).length;
              const rank = rows.findIndex((x) => x.id === r.id);
              return (
                <li key={r.id}>
                  <button className={`cat-item ${current?.id === r.id ? "on" : ""}`} onClick={() => { setSelected(r.id); setAdding(false); }}>
                    <span className="cat-avatar">{key === "tiers" ? rank : r.name.slice(0, 1).toUpperCase()}</span>
                    <span className="cat-item-text">
                      <strong>{r.name || "Unnamed"}{isNew(r.id) && <i>new</i>}</strong>
                      <em>{r.contact ?? r.url?.replace(/^https?:\/\//, "") ?? r.description ?? "No details yet"}</em>
                    </span>
                    <span className={`cat-uses ${n ? "" : "none"}`} title={n ? `Used by ${n} process${n > 1 ? "es" : ""}` : "Not used by any process"}>{n}</span>
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
                <input autoFocus value={newName} maxLength={40} placeholder={key === "teams" ? "Cloud Platform team" : key === "tools" ? "ServiceNow" : "Tier 4"}
                  onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              </Field>
              <p className="muted small">Id used in process files: <code>{slugify(newName) ? newId : "…"}</code>. It never changes, even if you rename.</p>
              <div className="btn-row">
                <button className="btn primary" disabled={!slugify(newName)} onClick={add}><Plus size={16} />Add {kind.noun}</button>
                <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}

          {!adding && current && (
            <>
              <header className="cat-detail-head">
                <span className="cat-avatar big">{key === "tiers" ? rows.findIndex((x) => x.id === current.id) : current.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <span className="eyebrow">{kind.noun}</span>
                  <h2>{current.name || "Unnamed"}</h2>
                  <code>{current.id}</code>
                </div>
                {editor && key === "tiers" && (
                  <div className="cat-order">
                    <button className="icon-btn" title="More critical" onClick={() => move(-1)} disabled={rows[0]?.id === current.id}><ArrowUp size={16} /></button>
                    <button className="icon-btn" title="Less critical" onClick={() => move(1)} disabled={rows[rows.length - 1]?.id === current.id}><ArrowDown size={16} /></button>
                  </div>
                )}
              </header>

              {editor ? (
                <div className="form">
                  <Field label="Name"><input value={current.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} /></Field>
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
                <h3>Used by {uses.length ? `${uses.length} process${uses.length > 1 ? "es" : ""}` : "no process yet"}</h3>
                <ul>
                  {uses.map((u) => (
                    <li key={u.process.id}>
                      <button onClick={() => go({ page: "process", id: u.process.id, tab: "flow" })}>
                        <strong>{u.process.title}</strong><em>{u.how}</em><ArrowUpRight size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {editor && (
                <div className="cat-danger">
                  <button className="btn danger" disabled={uses.length > 0} onClick={() => { setRows(rows.filter((r) => r.id !== current.id)); setSelected(null); }}>
                    <Trash2 size={15} />Remove this {kind.noun}
                  </button>
                  <span className="muted small">{uses.length > 0
                    ? `Still used by ${uses.length} process${uses.length > 1 ? "es" : ""}. Change those first, then it can be removed.`
                    : "Nothing uses it, so it is safe to remove."}</span>
                </div>
              )}
            </>
          )}
          {!adding && !current && <p className="muted cat-empty">Select a {kind.noun} on the left{editor ? `, or add a new one` : ""}.</p>}
        </section>
      </div>

      {editor && dirty && (
        <div className="save-bar" role="status">
          <span><b>Unsaved changes</b> to teams, tools or tiers</span>
          <button className="btn" onClick={() => setDraft(catalog)}><Undo2 size={16} />Discard</button>
          <button className="btn primary" disabled={hasErrors(issues)} onClick={() => save(clean)}><Save size={16} />Save changes</button>
        </div>
      )}
      {editor && !dirty && <p className="saved cat-saved"><Check size={14} />All changes saved to <code>catalog/catalog.json</code></p>}
    </div>
  );
}
