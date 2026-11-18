import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { Process, Standard } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { Field } from "./ui";
import { ResourceEditor } from "./Resources";
import { BelongsEditor, DimsEditor, ReviewEditor } from "./Governance";
import { EditSection } from "./EditFrame";

/**
 * The sections of a process on the editing screen, other than its steps: what used to be the
 * "Details" dialog, one section at a time, chosen in the outline.
 */
type Set = (patch: Partial<Process>) => void;

/** Name, summary, owner, what it belongs to, where it applies, tags, lead time and review rhythm. */
export function ProcessAbout({ process, saved, all, set }: { process: Process; saved: Process; all: Process[]; set: Set }) {
  const { catalog } = useCatalog();
  return (
    <>
      <EditSection title="Name and summary">
        <Field label="Name" hint="Start with a verb: “Request a GCP project”"><input value={process.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Summary" hint="What the reader has at the end, in a sentence or two"><textarea rows={3} maxLength={400} value={process.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Owning team" hint="Reviews it and answers feedback">
            <select value={process.owner ?? ""} onChange={(e) => set({ owner: e.target.value || undefined })}>
              <option value="">Not set</option>
              {catalog.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {process.owner && !catalog.teams.some((t) => t.id === process.owner) && <option value={process.owner}>{process.owner} (not in the list)</option>}
            </select>
          </Field>
          <Field label="Typical lead time" hint="From the first step to the result"><input value={process.estimatedDuration ?? ""} maxLength={40} placeholder="3-5 working days" onChange={(e) => set({ estimatedDuration: e.target.value })} /></Field>
        </div>
      </EditSection>
      <EditSection title="What it belongs to" hint="How readers find it, and who besides the editors may change it.">
        <BelongsEditor kind="process" doc={process} saved={saved} onChange={set} />
      </EditSection>
      <EditSection title="Where it applies" hint="Nothing selected means everywhere. Readers who describe their application only see what applies to it.">
        <DimsEditor value={process} onChange={set} />
        <Field label="Tags" hint="Words readers might search for, separated by commas">
          <input value={(process.tags ?? []).join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart().slice(0, 30)).slice(0, 12) })} />
        </Field>
      </EditSection>
      <EditSection title="Review">
        <ReviewEditor doc={process} others={all} onChange={set} />
      </EditSection>
    </>
  );
}

/** What must be in place before step 1. */
export function ProcessBefore({ process, all, set }: { process: Process; all: Process[]; set: Set }) {
  const pre = process.prerequisites;
  return (
    <EditSection title="Before you start" hint="What the reader must have before step 1, such as an approved cost centre. Readers tick each one off.">
      {pre.length === 0 && <p className="empty-hint">Nothing is needed yet. Add what a reader must have in place, so nobody gets stuck halfway.</p>}
      <div className="rows">
        {pre.map((q, i) => {
          const upd = (patch: Partial<typeof q>) => set({ prerequisites: pre.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div className="prereq-edit" key={i}>
              <div className="row">
                <span className="row-n">{i + 1}</span>
                <input value={q.title} maxLength={120} placeholder="Approved cost centre" aria-label={`Prerequisite ${i + 1}`} autoFocus={q.title === ""} onChange={(e) => upd({ title: e.target.value })} />
                <button className="icon-btn" onClick={() => set({ prerequisites: pre.filter((_, j) => j !== i) })} aria-label={`Remove prerequisite ${i + 1}`}><X size={15} /></button>
              </div>
              <div className="row indent">
                <input value={q.description ?? ""} maxLength={400} placeholder="Why it is needed, how to check" aria-label={`About prerequisite ${i + 1}`} onChange={(e) => upd({ description: e.target.value })} />
              </div>
              <div className="row indent">
                <select value={q.processId ?? ""} aria-label={`Process that provides prerequisite ${i + 1}`} onChange={(e) => upd({ processId: e.target.value || undefined })}>
                  <option value="">No process for this</option>
                  {all.filter((p) => p.id !== process.id).map((p) => <option key={p.id} value={p.id}>Get it via: {p.title}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        <button className="btn small ghost" onClick={() => set({ prerequisites: [...pre, { title: "" }] })}><Plus size={14} />Add prerequisite</button>
      </div>
    </EditSection>
  );
}

/** Who takes part: each one is a lane on the map. */
export function ProcessPeople({ process, set }: { process: Process; set: Set }) {
  const { catalog } = useCatalog();
  const actors = process.actors;
  const freeTeams = catalog.teams.filter((t) => !actors.some((a) => a.teamId === t.id || a.id === t.id));
  const used = (id: string) => process.steps.some((s) => s.actor === id);
  const swap = (i: number, j: number) => {
    const a = [...actors];
    [a[i], a[j]] = [a[j], a[i]];
    set({ actors: a });
  };
  return (
    <EditSection title="Who takes part" hint="Each one is a lane on the map. The first is always the reader. A lane that still has steps cannot be removed: give its steps to someone else first.">
      <div className="rows">
        {actors.map((a, i) => (
          <div className="actor-edit" key={a.id}>
            <div className="row">
              <span className="row-n">{i + 1}</span>
              <input className="w-name" value={a.name} maxLength={40} placeholder="Team or role" aria-label={`Name of participant ${i + 1}`}
                onChange={(e) => set({ actors: actors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <button className="icon-btn" disabled={i < 2} onClick={() => swap(i, i - 1)} aria-label={`Move participant ${i + 1} up`}><ArrowUp size={15} /></button>
              <button className="icon-btn" disabled={i === 0 || i === actors.length - 1} onClick={() => swap(i, i + 1)} aria-label={`Move participant ${i + 1} down`}><ArrowDown size={15} /></button>
              <button className="icon-btn" disabled={i === 0 || used(a.id)} title={used(a.id) ? "Has steps - give them to someone else first" : "Remove"} aria-label={`Remove participant ${i + 1}`}
                onClick={() => set({ actors: actors.filter((_, j) => j !== i) })}><X size={15} /></button>
            </div>
            <div className="row indent">
              <input value={a.description ?? ""} maxLength={200} placeholder={i === 0 ? "The person following this process" : "How to reach them"} aria-label={`About participant ${i + 1}`}
                onChange={(e) => set({ actors: actors.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
            </div>
          </div>
        ))}
        <select className="add-select" value="" aria-label="Add a participant" onChange={(e) => {
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
    </EditSection>
  );
}

/** Skills and links that make the whole process faster. */
export function ProcessLinks({ process, set }: { process: Process; set: Set }) {
  return (
    <EditSection title="Links and resources" hint="Ways to do it faster or in self-service, such as a skill or a form. Readers see them under “Before you start”.">
      {!process.resources?.length && <p className="empty-hint">No links yet. A self-service skill or the form readers fill in saves them searching.</p>}
      <ResourceEditor list={process.resources ?? []} onChange={(resources) => set({ resources })} />
    </EditSection>
  );
}

/** The standards following this process helps to meet. */
export function ProcessStandards({ process, standards, set }: { process: Process; standards: Standard[]; set: Set }) {
  return (
    <EditSection title="Standards it helps to meet" hint="Shown on the process and on each standard, so readers of a standard find the way to comply.">
      <div className="chips" role="group" aria-label="Standards it helps to meet">
        {standards.map((s) => {
          const on = process.standards?.includes(s.id) ?? false;
          return <button key={s.id} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set({ standards: standards.map((x) => x.id).filter((id) => (id === s.id ? !on : process.standards?.includes(id))) })}>{s.title}</button>;
        })}
        {standards.length === 0 && <span className="muted small">There are no standards yet.</span>}
      </div>
    </EditSection>
  );
}
