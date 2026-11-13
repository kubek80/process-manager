import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { Process } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { Field, Modal } from "./ui";

export function ProcessSettings({ process, all, onChange, onClose, onDelete }: {
  process: Process; all: Process[]; onChange: (p: Process) => void; onClose: () => void; onDelete: () => void;
}) {
  const set = (patch: Partial<Process>) => onChange({ ...process, ...patch });
  const pre = process.prerequisites;
  const actors = process.actors;
  const { catalog } = useCatalog();
  const tiers = process.tiers ?? [];
  const freeTeams = catalog.teams.filter((t) => !actors.some((a) => a.teamId === t.id || a.id === t.id));
  const used = (id: string) => process.steps.some((s) => s.actor === id);
  const swap = (i: number, j: number) => {
    const a = [...actors];
    [a[i], a[j]] = [a[j], a[i]];
    set({ actors: a });
  };

  return (
    <Modal wide title="Process details" subtitle="Changes are applied to the draft. Press Save on the process page to write them to the file." onClose={onClose}
      footer={<><button className="btn danger" onClick={onDelete}><Trash2 size={15} />Delete process</button><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></>}>
      <div className="form">
        <h4>About</h4>
        <Field label="Name" hint="start with a verb"><input value={process.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Summary" hint="what the reader gets at the end"><textarea rows={2} maxLength={400} value={process.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
        <div className="grid3">
          <Field label="Category"><input value={process.category ?? ""} maxLength={40} placeholder="Cloud" onChange={(e) => set({ category: e.target.value })} /></Field>
          <Field label="Owning team">
            <select value={process.owner ?? ""} onChange={(e) => set({ owner: e.target.value || undefined })}>
              <option value="">Not set</option>
              {catalog.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {process.owner && !catalog.teams.some((t) => t.id === process.owner) && <option value={process.owner}>{process.owner} (not in the list)</option>}
            </select>
          </Field>
          <Field label="Typical lead time"><input value={process.estimatedDuration ?? ""} maxLength={40} placeholder="3-5 working days" onChange={(e) => set({ estimatedDuration: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span className="field-label">Applies to application tiers<em>{tiers.length ? "only the selected tiers" : "every application, whatever its tier"}</em></span>
          <div className="chips">
            <button className={`chip ${tiers.length === 0 ? "on" : ""}`} onClick={() => set({ tiers: undefined })}>All tiers</button>
            {catalog.tiers.map((t) => (
              <button key={t.id} className={`chip ${tiers.includes(t.id) ? "on" : ""}`} title={t.description}
                onClick={() => set({ tiers: catalog.tiers.map((x) => x.id).filter((id) => (id === t.id ? !tiers.includes(id) : tiers.includes(id))) })}>{t.name}</button>
            ))}
          </div>
          <a className="small" href="#/catalog">Manage teams, tools and tiers</a>
        </div>
        <Field label="Tags" hint="comma separated">
          <input value={(process.tags ?? []).join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart().slice(0, 30)).slice(0, 12) })} />
        </Field>

        <h4>Who takes part <span className="muted">each one is a lane on the map</span></h4>
        <div className="rows">
          {actors.map((a, i) => (
            <div className="row" key={a.id}>
              <span className="row-n">{i + 1}</span>
              <input className="w-name" value={a.name} maxLength={40} placeholder="Team or role"
                onChange={(e) => set({ actors: actors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input value={a.description ?? ""} maxLength={200} placeholder={i === 0 ? "The person following this process" : "How to reach them"}
                onChange={(e) => set({ actors: actors.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
              <button className="icon-btn" disabled={i < 2} onClick={() => swap(i, i - 1)} aria-label="Move up"><ArrowUp size={15} /></button>
              <button className="icon-btn" disabled={i === 0 || i === actors.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move down"><ArrowDown size={15} /></button>
              <button className="icon-btn" disabled={i === 0 || used(a.id)} title={used(a.id) ? "Has steps - reassign them first" : "Remove"}
                onClick={() => set({ actors: actors.filter((_, j) => j !== i) })}><X size={15} /></button>
            </div>
          ))}
          <select className="add-select" value="" onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const taken = actors.map((a) => a.id);
            if (v === "__custom") {
              const name = `Participant ${actors.length}`;
              return set({ actors: [...actors, { id: uniqueId(slugify(name), taken), name }] });
            }
            const team = catalog.teams.find((t) => t.id === v)!;
            set({ actors: [...actors, { id: uniqueId(team.id, taken), name: team.name, description: team.contact, teamId: team.id }] });
          }}>
            <option value="">＋ Add participant…</option>
            {freeTeams.length > 0 && <optgroup label="Teams">{freeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
            <option value="__custom">Someone else (role, person or system)</option>
          </select>
        </div>

        <h4>Prerequisites <span className="muted">what must be in place before step 1</span></h4>
        <div className="rows">
          {pre.map((q, i) => {
            const upd = (patch: Partial<typeof q>) => set({ prerequisites: pre.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div className="prereq-edit" key={i}>
                <div className="row">
                  <span className="row-n">{i + 1}</span>
                  <input value={q.title} maxLength={120} placeholder="Approved cost centre" onChange={(e) => upd({ title: e.target.value })} />
                  <button className="icon-btn" onClick={() => set({ prerequisites: pre.filter((_, j) => j !== i) })} aria-label="Remove"><X size={15} /></button>
                </div>
                <div className="row indent">
                  <input value={q.description ?? ""} maxLength={400} placeholder="Why it is needed / how to check" onChange={(e) => upd({ description: e.target.value })} />
                  <select value={q.processId ?? ""} onChange={(e) => upd({ processId: e.target.value || undefined })}>
                    <option value="">No process for this</option>
                    {all.filter((p) => p.id !== process.id).map((p) => <option key={p.id} value={p.id}>Get it via: {p.title}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          <button className="btn small ghost" onClick={() => set({ prerequisites: [...pre, { title: "" }] })}><Plus size={14} />Add prerequisite</button>
        </div>
      </div>
    </Modal>
  );
}
