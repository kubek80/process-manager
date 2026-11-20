import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Download, FileText, Pencil, Sparkles } from "lucide-react";
import type { Skill, SkillDetail, TargetKind } from "../types";
import { loadSkill, loadSkills, loadSkillVersion, putSkillExtra } from "../lib/store";
import { CopyButton, LoadError, Loading, notify } from "./ui";
import { formatDate } from "../lib/dates";

export const SKILL_KIND = { skill: { label: "Skill", icon: Sparkles }, "review-agent": { label: "Review agent", icon: Bot } } as const;

/** What the file is for, in a sentence for whoever reads the Skills tab. */
export function skillPurpose(kind: keyof typeof SKILL_KIND, sourceKind: TargetKind): string {
  if (kind === "review-agent") return "Lets an AI assistant check a pull request against this standard and point out what does not meet it.";
  return sourceKind === "process"
    ? "Lets an AI coding assistant walk a person through this process: it does their steps and says who does the others."
    : "Lets an AI coding assistant write code that meets this standard.";
}

/**
 * The text shown on the page: the file without its front matter (the lines between the opening
 * "---" and the next "---", which only the assistant reads). Copy and Download keep the whole file.
 */
export function skillPreview(text: string): string {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "") : text;
}

/** One generated skill or review agent: its text, its versions and the hand-written extra guidance. */
export function SkillPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [version, setVersion] = useState(0); // 0 = latest
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setDetail(null); setVersion(0); setEditing(false); setError(""); setSaveError("");
    loadSkill(id).then((d) => { setDetail(d); setContent(d.content); setExtra(d.skill.extra); }, (e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <LoadError what="This skill could not be loaded." error={error} onRetry={load} />;
  if (!detail) return <Loading />;
  const { skill, versions, canEdit } = detail;
  const K = SKILL_KIND[skill.kind];
  const show = async (v: number) => {
    if (v === 0) { setVersion(0); setContent(detail.content); return; }
    // on failure the version that was shown stays: an error is never shown as if it were the skill
    try { const text = await loadSkillVersion(id, v); setVersion(v); setContent(text); } catch (e) { notify.error(`Version ${v} could not be loaded.`, e); }
  };
  const saveExtra = async () => {
    setSaving(true); setSaveError("");
    try {
      const d = await putSkillExtra(id, extra);
      setDetail(d); setContent(d.content); setVersion(0); setEditing(false); onChanged?.();
    } catch (e) { setSaveError((e as Error).message); /* what was typed stays in the field */ } finally { setSaving(false); }
  };

  return (
    <div className="skill-panel">
      <header className="skill-head">
        <span className={`skill-icon ${skill.kind}`}><K.icon size={20} /></span>
        <div>
          <span className="eyebrow">{K.label}{!skill.active && " · withdrawn"}</span>
          <h3>{skill.title}</h3>
          <p className="skill-purpose">{skillPurpose(skill.kind, skill.sourceKind)}</p>
        </div>
      </header>
      <details className="skill-where">
        <summary>Where to put it</summary>
        <p>Download the file and save it in the repository you work in, as <code>{skill.path}</code>. The AI coding assistant finds it there by itself; to update it, download it again.</p>
      </details>
      {!skill.active && <div className="check warn"><span>Withdrawn: its source is a draft, retired or deleted. The last version is kept for reference.</span></div>}

      <div className="skill-bar">
        <label className="skill-version">Version
          <select value={version} onChange={(e) => show(Number(e.target.value))}>
            <option value={0}>{skill.version} (latest)</option>
            {versions.slice(1).map((v) => <option key={v.version} value={v.version}>{v.version} · {formatDate(v.createdAt)}</option>)}
          </select>
        </label>
        {/* which version of the process or standard this text was made from */}
        {(() => {
          const shown = versions.find((v) => v.version === (version || skill.version));
          return shown ? <span className="muted small skill-source">made from version {shown.sourceVersion} of the {skill.sourceKind}</span> : null;
        })()}
        <span className="spacer" />
        <CopyButton label="Copy" text={() => content} />
        <a className="btn" href={`/api/skills/${skill.id}/download`} download><Download size={16} />Download</a>
      </div>
      <pre className="skill-content" tabIndex={0} aria-label={`What the ${K.label.toLowerCase()} says`}>{skillPreview(content)}</pre>

      <section className="skill-extra">
        <h4><FileText size={15} />Extra guidance <span className="muted">added to every new version, kept when the source changes</span></h4>
        {editing ? (
          <>
            <textarea rows={5} value={extra} maxLength={8000} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Generated files under gen/ are exempt." aria-label="Extra guidance" />
            {saveError && <LoadError what="The guidance was not saved." error={`${saveError} What you typed is still here.`} />}
            <div className="btn-row">
              <button className="btn primary" disabled={saving} onClick={saveExtra}><Check size={15} />Save and regenerate</button>
              <button className="btn ghost" onClick={() => { setEditing(false); setExtra(skill.extra); setSaveError(""); }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {skill.extra ? <p className="skill-extra-text">{skill.extra}</p> : <p className="muted">None.</p>}
            {canEdit && <button className="btn small" onClick={() => setEditing(true)}><Pencil size={14} />{skill.extra ? "Change" : "Add guidance"}</button>}
          </>
        )}
      </section>
    </div>
  );
}

/** The Skills tab of a process or a standard: what is generated from it. */
export function SourceSkills({ kind, id, revision }: { kind: TargetKind; id: string; revision: unknown }) {
  const [list, setList] = useState<Skill[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // `revision` changes when the source is saved: reload, the skills have a new version then
  // the skill first, then the review agent
  const pick = (all: Skill[]) => all.filter((s) => s.sourceKind === kind && s.sourceId === id).sort((a, b) => b.kind.localeCompare(a.kind));
  const load = () => { setError(""); loadSkills().then((all) => setList(pick(all)), (e) => setError(e.message)); };
  useEffect(load, [kind, id, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = list?.find((s) => s.id === open) ?? list?.[0];

  if (error) return <LoadError what="The skills could not be loaded." error={error} onRetry={load} />;
  if (!list) return <Loading />;
  if (list.length === 0) return (
    <div className="skills-empty">
      <Sparkles size={22} />
      <p><b>No skill yet.</b> Skills are generated when the {kind} is active. Drafts and retired {kind === "process" ? "processes" : "standards"} have none.</p>
    </div>
  );
  return (
    <div className="skills-tab">
      <p className="lead small">Generated from this {kind} every time it is saved. Put the file in a repository and an AI coding assistant {kind === "process" ? "can follow the process for you" : "writes and reviews code against the standard"}.</p>
      <div className="skill-picker" role="tablist">
        {list.map((s) => {
          const K = SKILL_KIND[s.kind];
          return (
            <button key={s.id} role="tab" aria-selected={current?.id === s.id} className={current?.id === s.id ? "on" : ""} onClick={() => setOpen(s.id)}>
              <K.icon size={16} />{K.label}<span>v{s.version}</span>
            </button>
          );
        })}
      </div>
      {current && <SkillPanel key={current.id} id={current.id} onChanged={load} />}
    </div>
  );
}
