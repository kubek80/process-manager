import { ArrowUpRight, BookOpen, FileCode2, GitBranch, Link2, Plus, Sparkles, X } from "lucide-react";
import type { Resource, ResourceKind } from "../types";

export const RESOURCE_KINDS: Record<ResourceKind, { label: string; icon: typeof Link2 }> = {
  skill: { label: "Self-service skill", icon: Sparkles },
  repository: { label: "Repository", icon: GitBranch },
  template: { label: "Template", icon: FileCode2 },
  documentation: { label: "Documentation", icon: BookOpen },
  other: { label: "Link", icon: Link2 },
};

/** Links that help to do or automate the work. Skills come first: they let an assistant do it for you. */
export function Resources({ list, compact }: { list: Resource[]; compact?: boolean }) {
  const sorted = [...list].sort((a, b) => Number(b.kind === "skill") - Number(a.kind === "skill"));
  return (
    <ul className={`resources ${compact ? "compact" : ""}`}>
      {sorted.map((r, i) => {
        const K = RESOURCE_KINDS[r.kind ?? "other"];
        return (
          <li key={i} className={r.kind === "skill" ? "skill" : ""}>
            <a href={r.url} target="_blank" rel="noreferrer">
              <span className="res-icon"><K.icon size={16} /></span>
              <span className="res-text">
                <em>{K.label}</em>
                <strong>{r.title}</strong>
                {r.description && <span>{r.description}</span>}
              </span>
              <ArrowUpRight size={15} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Links and skills, one field per row: the kind, its name, its address, what it does for the reader. */
export function ResourceEditor({ list, onChange }: { list: Resource[]; onChange: (l: Resource[]) => void }) {
  const upd = (i: number, patch: Partial<Resource>) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="rows">
      {list.map((r, i) => (
        <div className="prereq-edit res-edit" key={i}>
          <div className="row">
            <select className="res-kind" value={r.kind ?? "other"} aria-label={`Kind of link ${i + 1}`} onChange={(e) => upd(i, { kind: e.target.value as ResourceKind })}>
              {(Object.keys(RESOURCE_KINDS) as ResourceKind[]).map((k) => <option key={k} value={k}>{RESOURCE_KINDS[k].label}</option>)}
            </select>
            <button className="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`}><X size={15} /></button>
          </div>
          <input value={r.title} maxLength={80} placeholder="Name, e.g. Order form" aria-label={`Name of link ${i + 1}`} autoFocus={r.title === "" && r.url === ""} onChange={(e) => upd(i, { title: e.target.value })} />
          <input value={r.url} placeholder="https://…" aria-label={`Address of link ${i + 1}`} onChange={(e) => upd(i, { url: e.target.value })} />
          <input value={r.description ?? ""} maxLength={200} placeholder="What it does for the reader" aria-label={`What link ${i + 1} does for the reader`} onChange={(e) => upd(i, { description: e.target.value })} />
        </div>
      ))}
      <button className="btn small ghost" onClick={() => onChange([...list, { title: "", url: "", kind: "other" }])}><Plus size={14} />Add link or skill</button>
    </div>
  );
}
