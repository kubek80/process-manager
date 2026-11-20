import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { DocMeta, Feedback, Process, Standard } from "../types";
import { addRequirement, appendRequirement, deleteRequirement, EXAMPLE, moveRequirementTo, shortName, tidyStandard, today, updateRequirement } from "../lib/edit";
import { issueTarget, issuesByPlace, issuesFor, noteMove, selectionKey, STANDARD_SECTIONS, standardOutline, withoutEarlySuggestions, type Selection, type StandardSection } from "../lib/editing";
import { isDrawableStandard, standardSchema, validateStandard } from "../lib/validate";
import { useSelectedItem } from "../lib/selection";
import { canEdit } from "../lib/rights";
import { usePerms } from "../lib/session";
import { useCatalog } from "../lib/catalog";
import { statusOf } from "../lib/lifecycle";
import { href } from "../lib/store";
import { openCount } from "./Feedback";
import { EditFrame, EditSection, focusSelectedInOutline, ItemIssues, Outline } from "./EditFrame";
import { EditSession, type Session } from "./EditSession";
import { NoRight } from "./EditProcessPage";
import { GovernedSections, WhereSection } from "./ProcessSections";
import { RequirementCard, RequirementFields } from "./Requirements";
import { ResourceEditor, Resources } from "./Resources";
import { standardAiSpec, StandardIntro } from "./StandardPage";
import { Field, notify, scrollBehavior } from "./ui";

const stamp = (s: Standard): Standard => ({ ...s, updatedAt: today() });

/** The editing screen of a standard (`#/s/:id/edit[/:REQ-ID]`). */
export function EditStandardPage(props: {
  standard: Standard; meta?: DocMeta; all: Standard[]; processes: Process[]; feedback: Feedback[]; item?: string;
  onSave: (s: Standard, base: number, note?: string) => Promise<number>;
  onReload: () => Promise<{ saved: Standard; version: number } | null>;
  onRefresh: () => Promise<void>;
  onDelete: (base: number) => void;
  onDraftMeta: (d: { updatedAt: string; updatedBy: string; updatedByName?: string } | null) => void;
}) {
  const { standard, all, processes } = props;
  const perms = usePerms();
  const { catalog } = useCatalog();
  const ctx = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: all.map((s) => s.id), catalog }), [processes, all, catalog]);
  const check = useCallback((s: Standard) => validateStandard(s, ctx), [ctx]);
  if (!canEdit(perms, "standard", standard)) return <NoRight noun="standard" title={standard.title} readHref={href({ page: "standard", id: standard.id, tab: "doc" })} />;
  return (
    <EditSession<Standard> o={{
      kind: "standard", doc: standard, meta: props.meta, others: all, tidy: tidyStandard, stamp, check, drawable: isDrawableStandard,
      aiSpec: (current) => standardAiSpec(current, all, processes, catalog),
      json: { validate: check as (v: unknown) => ReturnType<typeof check>, schema: standardSchema, schemaFile: "schema/standard.schema.json" },
      onSave: props.onSave, onReload: props.onReload, onRefresh: props.onRefresh, onDelete: props.onDelete, onDraftMeta: props.onDraftMeta,
    }}>
      {(s) => <StandardEditor s={s} {...props} />}
    </EditSession>
  );
}

function StandardEditor({ s, standard, all, processes, feedback, item }: {
  s: Session<Standard>; standard: Standard; all: Standard[]; processes: Process[]; feedback: Feedback[]; item?: string;
}) {
  const { d } = s;
  const draft = d.draft;
  const drawable = s.drawable;
  const setDraft = d.change;
  const set = (patch: Partial<Standard>) => setDraft((x) => ({ ...x, ...patch }));
  const { catalog } = useCatalog();
  const [reqId, selectReq] = useSelectedItem(item, (id) => ({ page: "edit-standard", id: standard.id, ...(id ? { item: id } : {}) }),
    (id) => !drawable || draft.requirements.some((r) => r.id === id));
  const [section, setSection] = useState<StandardSection>("about");
  const sel: Selection = reqId ? { section: "requirements", item: reqId } : { section };
  const current = drawable && reqId ? draft.requirements.find((r) => r.id === reqId) : undefined;

  const choose = (next: Selection, open = true) => {
    if (next.item) selectReq(next.item);
    else { if (reqId) selectReq(null); setSection(next.section as StandardSection); }
    if (open) s.setPanel("fields");
  };
  // the selected requirement is brought into view in the middle
  useEffect(() => {
    if (!reqId) return;
    const t = setTimeout(() => document.getElementById(`req-${reqId}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }), 30);
    return () => clearTimeout(t);
  }, [reqId]);

  // while its fields are changed, the selected requirement stays in view in the middle
  useEffect(() => {
    if (!reqId) return;
    const t = setTimeout(() => document.getElementById(`req-${reqId}`)?.scrollIntoView({ block: "nearest" }), 120);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // a refused save or publish brings its first problem into view
  useEffect(() => { if (s.focus) choose(issueTarget("standard", draft, s.focus.issue.path)); }, [s.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // what Undo or Redo brought back is selected
  useEffect(() => { if (s.reveal && draft.requirements.some((x) => x.id === s.reveal!.item)) choose({ section: "requirements", item: s.reveal.item }, false); }, [s.reveal?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // suggestions about a requirement added on this screen wait until it has been left once
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const lastReq = useRef<string | null>(null);
  useEffect(() => {
    const was = lastReq.current;
    if (was && was !== reqId) setLeft((l) => (l.has(was) ? l : new Set(l).add(was)));
    lastReq.current = reqId;
  }, [reqId]);
  const issues = useMemo(() => (drawable
    ? withoutEarlySuggestions("standard", draft, s.issues, (id) => !left.has(id) && !(d.saved.requirements ?? []).some((x) => x.id === id))
    : s.issues), [drawable, draft, s.issues, left, d.saved]);
  const byPlace = useMemo(() => (drawable ? issuesByPlace("standard", draft, issues) : new Map()), [drawable, draft, issues]);
  const add = (after?: string) => { const r = addRequirement(draft, after); setDraft(r.standard); selectReq(r.id); s.setPanel("fields"); };
  const sectionLabel = STANDARD_SECTIONS.find((x) => x.id === section)?.label ?? "About";
  const fieldsLabel = current ? `${current.id}: ${current.title || "(no name yet)"}` : sectionLabel;
  const helpers = processes.filter((p) => p.standards?.includes(draft.id) && statusOf(p) === "active");

  let fields;
  if (!drawable) fields = <p className="empty-hint pad">Repair the JSON first: its problems are listed next to it.</p>;
  else if (current) {
    fields = <RequirementFields key={current.id} r={current} standard={draft} processes={processes} feedback={feedback} issues={issuesFor("standard", draft, issues, sel)}
      onChange={(patch) => setDraft(updateRequirement(draft, current.id, patch))}
      onRename={(id) => { if (!draft.requirements.some((x) => x.id === id && x !== current)) { setDraft(updateRequirement(draft, current.id, { id })); selectReq(id); } }}
      onDelete={() => {
        // no question: it is deleted at once, and the message offers Undo
        const at = draft.requirements.indexOf(current);
        const next = deleteRequirement(draft, current.id);
        setDraft(next);
        editNotice.info(current.title?.trim() ? `Requirement ${current.id} “${shortName(current.title)}” deleted.` : `Requirement ${current.id} (no name yet) deleted.`, { label: "Undo", run: () => d.undo() });
        const neighbour = next.requirements[Math.min(at, next.requirements.length - 1)];
        if (neighbour) selectReq(neighbour.id); else { selectReq(null); setSection("requirements"); }
        focusSelectedInOutline(neighbour?.title);
      }}
      onMove={(before) => { const next = moveRequirementTo(draft, current.id, before); noteMove(next, current.id); setDraft(next); }}
      onAddAfter={() => add(current.id)} />;
  } else {
    const head = <h2 className="fields-section-title">{sectionLabel}</h2>;
    const own = issuesFor("standard", draft, issues, { section }).filter((i) => !issueTarget("standard", draft, i.path).item);
    const body = {
      about: (
        <>
          <EditSection title="Name and summary">
            <Field label="Name" hint="What it is about, in a few words"><input value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Summary" hint="What it protects or achieves"><textarea rows={3} maxLength={400} value={draft.summary} onChange={(e) => set({ summary: e.target.value })}
              onFocus={(e) => { if (draft.summary === EXAMPLE.standardSummary) e.target.select(); }} /></Field>
            <Field label="Issued by" hint="The team that reviews it, answers feedback and grants exceptions">
              <select value={draft.owner} onChange={(e) => set({ owner: e.target.value })}>
                {catalog.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {!catalog.teams.some((t) => t.id === draft.owner) && <option value={draft.owner}>{draft.owner} (not in the list)</option>}
              </select>
            </Field>
          </EditSection>
          <GovernedSections kind="standard" doc={draft} saved={d.saved} others={all} set={set} issues={own} />
        </>
      ),
      scope: (<>
        <EditSection title="Scope and exceptions">
          <Field label="Scope" hint="What it covers and what it does not"><textarea rows={4} maxLength={400} value={draft.scope ?? ""} onChange={(e) => set({ scope: e.target.value })} /></Field>
          <Field label="How to ask for an exception" hint="Readers who cannot comply follow this">
            <select value={draft.exceptionProcessId ?? ""} onChange={(e) => set({ exceptionProcessId: e.target.value || undefined })}>
              <option value="">Ask the issuing team directly</option>
              {processes.map((p) => <option key={p.id} value={p.id}>Process: {p.title}</option>)}
            </select>
          </Field>
        </EditSection>
        <WhereSection kind="standard" doc={draft} set={set} issues={own} open />
      </>),
      requirements: (
        <div className="empty-hint">
          <p>{draft.requirements.length} requirement{draft.requirements.length === 1 ? "" : "s"}. Select one in the outline or in the middle to change it.</p>
          <p>To add several, type their names one after the other under <b>Add a requirement</b> at the end of the outline.</p>
          <button className="btn small" onClick={() => add()}><Plus size={14} />Add a requirement at the end</button>
        </div>
      ),
      background: (
        <EditSection title="Background" hint="Policies, documentation and other reading behind the standard.">
          {!draft.resources?.length && <p className="empty-hint">No background yet. Link the policy this standard comes from, so readers can check the source.</p>}
          <ResourceEditor list={draft.resources ?? []} onChange={(resources) => set({ resources })} />
        </EditSection>
      ),
    }[section];
    fields = <>{head}<ItemIssues issues={own} />{body}</>;
  }

  const middle = s.json ? s.jsonView : (
    <div className="edit-preview standard-doc">
      <button className={`preview-head ${sel.section === "about" ? "on" : ""}`} onClick={() => choose({ section: "about" })} aria-label={`About: ${draft.title || "(no name yet)"}`}>
        <span className="preview-label">What readers will see</span>
        <h2>{draft.title || <span className="muted">(no name yet)</span>}</h2>
        <p>{draft.summary && draft.summary !== EXAMPLE.standardSummary ? draft.summary : <span className="muted">No summary yet. Say what it protects or achieves.</span>}</p>
      </button>
      <div className={`preview-part clickable ${sel.section === "scope" ? "on" : ""}`} onClick={() => choose({ section: "scope" })}>
        <StandardIntro standard={draft} processes={processes} helpers={helpers} />
      </div>
      {draft.resources?.length
        ? <div className={`preview-part clickable ${sel.section === "background" ? "on" : ""}`} onClick={() => choose({ section: "background" })}><section className="prereqs"><h2>Background</h2><Resources list={draft.resources} /></section></div>
        : <button className="preview-empty" onClick={() => choose({ section: "background" })}>No background yet. <b>Link the policy behind it</b></button>}
      <ol className="reqs">
        {draft.requirements.map((r) => (
          <RequirementCard key={r.id} r={r} standard={draft} processes={processes} applies flags={openCount(feedback, r.id)}
            selected={reqId === r.id} onSelect={() => choose({ section: "requirements", item: r.id })} />
        ))}
      </ol>
      <button className="btn add-req" onClick={() => add()}><Plus size={15} />Add a requirement</button>
    </div>
  );

  return (
    <>
      <EditFrame kind="standard" title={draft.title} {...s.frame} issues={issues} selection={selectionKey(sel)}
        place={(i) => { const t = issueTarget("standard", draft, i.path); return t.item ?? STANDARD_SECTIONS.find((x) => x.id === t.section)?.label ?? "About"; }}
        onPickIssue={(i) => choose(issueTarget("standard", draft, i.path))}
        outline={drawable ? <Outline label="Outline of the standard" entries={standardOutline(draft)} selected={selectionKey(sel)} issues={byPlace}
          feedback={(id) => openCount(feedback, id)}
          onSelect={(e) => choose({ section: e.section, item: e.item })}
          onEnter={() => { s.setPanel("fields"); setTimeout(() => document.querySelector<HTMLElement>(".edit-fields-body :is(input, textarea, select):not([disabled])")?.focus(), 60); }}
          onAdd={{ section: "requirements", label: "Add a requirement", placeholder: "Short name of the rule", run: (name) => { const r = appendRequirement(draft, name); setDraft(r.standard); selectReq(r.id); } }}
          onMove={(id, before) => { const next = moveRequirementTo(draft, id, before); noteMove(next, id); setDraft(next); }}
          onNudge={(id, dir) => {
            const ids = draft.requirements.map((r) => r.id), i = ids.indexOf(id);
            const put = (before: string | null) => { const next = moveRequirementTo(draft, id, before); noteMove(next, id); setDraft(next); };
            if (dir === -1 && i > 0) put(ids[i - 1]);
            if (dir === 1 && i >= 0 && i < ids.length - 1) put(ids[i + 2] ?? null);
          }} /> : null}
        middle={middle} fields={<div className="edit-fields-body">{fields}</div>} fieldsLabel={fieldsLabel}
        panel={s.panel} setPanel={s.setPanel} json={s.json} />
      {s.dialogs}
    </>
  );
}
