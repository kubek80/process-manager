import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Plus, Save, Undo2, X } from "lucide-react";
import type { Catalog, Process } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { hasErrors, validateCatalog } from "../lib/validate";
import { IssueList } from "./AiDialog";

type Key = "tiers" | "teams" | "tools";
type Row = { id: string; name: string; [k: string]: string | undefined };

const SECTIONS: { key: Key; title: string; hint: string; noun: string; extra: { field: string; placeholder: string }[] }[] = [
  { key: "tiers", title: "Application tiers", hint: "A process applies to all tiers or to a chosen subset. Most critical first.", noun: "tier", extra: [{ field: "description", placeholder: "What makes an application this tier" }] },
  { key: "teams", title: "Teams", hint: "Teams own processes and appear as lanes on the map.", noun: "team", extra: [{ field: "contact", placeholder: "How to reach them, e.g. Slack #cloud-platform" }] },
  { key: "tools", title: "Tools", hint: "Systems that steps are done in.", noun: "tool", extra: [{ field: "url", placeholder: "https://…" }] },
];

export function CatalogPage({ processes }: { processes: Process[] }) {
  const { catalog, save } = useCatalog();
  const [draft, setDraft] = useState<Catalog>(catalog);
  useEffect(() => setDraft(catalog), [catalog]);

  const clean: Catalog = {
    ...draft,
    ...Object.fromEntries(SECTIONS.map(({ key }) => [key, (draft[key] as Row[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "id" || k === "name" || (v ?? "").trim() !== "")))])),
  } as Catalog;
  const dirty = JSON.stringify(clean) !== JSON.stringify(catalog);
  const issues = validateCatalog(clean);

  const uses = (key: Key, id: string) => processes.filter((p) =>
    key === "tiers" ? p.tiers?.includes(id)
      : key === "teams" ? p.owner === id || p.actors?.some((a) => a.teamId === id)
        : p.steps?.some((s) => s.tool === id)).length;

  const setRows = (key: Key, rows: Row[]) => setDraft({ ...draft, [key]: rows });

  return (
    <div className="page catalog-page">
      <a className="back" href="#/"><ArrowLeft size={16} />All processes</a>
      <div className="head-row">
        <div className="head-text">
          <h1>Teams, tools &amp; tiers</h1>
          <p className="lead">The lists that processes pick from. Stored in <code>catalog/catalog.json</code>.</p>
        </div>
        <div className="head-actions">
          {dirty
            ? <>
              <button className="btn" onClick={() => setDraft(catalog)}><Undo2 size={16} />Discard</button>
              <button className="btn primary" disabled={hasErrors(issues)} onClick={() => save(clean)}><Save size={16} />Save changes</button>
            </>
            : <span className="saved"><Check size={14} />Saved</span>}
        </div>
      </div>
      {issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      <div className="catalog-grid">
        {SECTIONS.map(({ key, title, hint, noun, extra }) => {
          const rows = draft[key] as Row[];
          const upd = (i: number, patch: Partial<Row>) => setRows(key, rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
          const swap = (i: number, j: number) => { const a = [...rows]; [a[i], a[j]] = [a[j], a[i]]; setRows(key, a); };
          return (
            <section key={key} className="catalog-card">
              <h2>{title} <span>{rows.length}</span></h2>
              <p className="muted small">{hint}</p>
              <div className="rows">
                {rows.map((r, i) => {
                  const n = uses(key, r.id);
                  return (
                    <div className="catalog-row" key={r.id}>
                      <div className="row">
                        <input className="w-name" value={r.name} maxLength={40} placeholder={`Name of the ${noun}`} onChange={(e) => upd(i, { name: e.target.value })} />
                        {extra.map((x) => (
                          <input key={x.field} value={r[x.field] ?? ""} placeholder={x.placeholder} onChange={(e) => upd(i, { [x.field]: e.target.value })} />
                        ))}
                        {key === "tiers" && <>
                          <button className="icon-btn" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move up"><ArrowUp size={15} /></button>
                          <button className="icon-btn" disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move down"><ArrowDown size={15} /></button>
                        </>}
                        <button className="icon-btn" disabled={n > 0} title={n > 0 ? `Used by ${n} process(es) - change those first` : "Remove"}
                          onClick={() => setRows(key, rows.filter((_, j) => j !== i))}><X size={15} /></button>
                      </div>
                      <span className="catalog-id"><code>{r.id}</code>{n > 0 ? ` · used by ${n} process${n > 1 ? "es" : ""}` : " · not used"}</span>
                    </div>
                  );
                })}
                <button className="btn small ghost" onClick={() => {
                  const name = window.prompt(`Name of the new ${noun}`)?.trim();
                  if (!name || !slugify(name)) return;
                  setRows(key, [...rows, { id: uniqueId(slugify(name), rows.map((r) => r.id)), name }]);
                }}><Plus size={14} />Add {noun}</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
