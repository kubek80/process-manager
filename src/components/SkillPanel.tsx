import { useEffect, useState } from "react";
import { Bot, Check, Download, FileText, Pencil, Sparkles } from "lucide-react";
import type { Skill, SkillDetail, TargetKind } from "../types";
import { loadSkill, loadSkills, loadSkillVersion, putSkillExtra } from "../lib/store";
import { CopyButton } from "./ui";

export const SKILL_KIND = { skill: { label: "Skill", icon: Sparkles }, "review-agent": { label: "Review agent", icon: Bot } } as const;

/** One generated skill or review agent: its text, its versions and the hand-written extra guidance. */
export function SkillPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [version, setVersion] = useState(0); // 0 = latest
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDetail(null); setVersion(0); setEditing(false); setError("");
    loadSkill(id).then((d) => { setDetail(d); setContent(d.content); setExtra(d.skill.extra); }, (e) => setError(e.message));
  }, [id]);

  if (error) return <div className="check bad">{error}</div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { skill, versions, canEdit } = detail;
  const K = SKILL_KIND[skill.kind];
  const show = async (v: number) => {
    setVersion(v);
    setContent(v === 0 ? detail.content : await loadSkillVersion(id, v).catch((e) => `Could not load: ${e.message}`));
  };
  const saveExtra = async () => {
    try {
      const d = await putSkillExtra(id, extra);
      setDetail(d); setContent(d.content); setVersion(0); setEditing(false); onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="skill-panel">
      <header className="skill-head">
        <span className={`skill-icon ${skill.kind}`}><K.icon size={20} /></span>
        <div>
          <span className="eyebrow">{K.label}{!skill.active && " · withdrawn"}</span>
          <h3>{skill.title}</h3>
          <code>{skill.path}</code>
        </div>
      </header>
      {!skill.active && <div className="check warn"><span>Withdrawn: its source is a draft, retired or deleted. The last version is kept for reference.</span></div>}

      <div className="skill-bar">
        <label className="skill-version">Version
          <select value={version} onChange={(e) => show(Number(e.target.value))}>
            <option value={0}>{skill.version} (latest)</option>
            {versions.slice(1).map((v) => <option key={v.version} value={v.version}>{v.version} · {v.createdAt.slice(0, 10)}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <CopyButton label="Copy" text={() => content} />
        <a className="btn" href={`/api/skills/${skill.id}/download`} download><Download size={16} />Download</a>
      </div>
      <pre className="skill-content" tabIndex={0}>{content}</pre>

      <section className="skill-extra">
        <h4><FileText size={15} />Extra guidance <span className="muted">added to every new version, kept when the source changes</span></h4>
        {editing ? (
          <>
            <textarea rows={5} value={extra} maxLength={8000} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Generated files under gen/ are exempt." />
            <div className="btn-row">
              <button className="btn primary" onClick={saveExtra}><Check size={15} />Save and regenerate</button>
              <button className="btn ghost" onClick={() => { setEditing(false); setExtra(skill.extra); }}>Cancel</button>
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
  const [open, setOpen] = useState<string | null>(null);
  // `revision` changes when the source is saved: reload, the skills have a new version then
  // the skill first, then the review agent
  const pick = (all: Skill[]) => all.filter((s) => s.sourceKind === kind && s.sourceId === id).sort((a, b) => b.kind.localeCompare(a.kind));
  useEffect(() => { loadSkills().then((all) => setList(pick(all)), () => setList([])); }, [kind, id, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = list?.find((s) => s.id === open) ?? list?.[0];

  if (!list) return <p className="muted">Loading…</p>;
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
      {current && <SkillPanel key={current.id} id={current.id} onChanged={() => loadSkills().then((all) => setList(pick(all)))} />}
    </div>
  );
}
