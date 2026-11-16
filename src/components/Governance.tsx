import { CalendarCheck, Code2, Layers, Server } from "lucide-react";
import type { Catalog, Governed, Status } from "../types";
import { environmentLabel, languageLabel, tierLabel, useCatalog } from "../lib/catalog";
import type { Profile } from "../lib/edit";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { Field } from "./ui";

type Dims = { tiers?: string[]; languages?: string[]; environments?: string[] };
const DIMS = [
  { key: "tiers", list: "tiers", all: "All tiers", label: "Application tiers", some: "only the selected tiers", none: "every application, whatever its tier" },
  { key: "environments", list: "environments", all: "All environments", label: "Environments", some: "only the selected environments", none: "every environment" },
  { key: "languages", list: "languages", all: "Any language", label: "Programming language", some: "only for the selected languages", none: "does not depend on the language" },
] as const;

/** Tags that say where a process or standard applies. */
export function DimTags({ doc, compact }: { doc: Dims; compact?: boolean }) {
  const { catalog } = useCatalog();
  return (
    <>
      {(!compact || !!doc.tiers?.length) && <span className={`tier-tag ${doc.tiers?.length ? "some" : ""}`}><Layers size={12} />{tierLabel(catalog, doc.tiers)}</span>}
      {(!compact || !!doc.environments?.length) && <span className={`tier-tag ${doc.environments?.length ? "some" : ""}`}><Server size={12} />{environmentLabel(catalog, doc.environments)}</span>}
      {(!compact || !!doc.languages?.length) && <span className={`tier-tag ${doc.languages?.length ? "some" : ""}`}><Code2 size={12} />{languageLabel(catalog, doc.languages)}</span>}
    </>
  );
}

/** Chips to choose the tiers, environments and languages something applies to. Nothing selected means all. */
export function DimsEditor({ value, onChange, narrow }: { value: Dims; onChange: (patch: Dims) => void; narrow?: boolean }) {
  const { catalog } = useCatalog();
  return (
    <>
      {DIMS.map((d) => {
        const picked = value[d.key] ?? [];
        const all = catalog[d.list] as { id: string; name: string; description?: string }[];
        return (
          <div className="field" key={d.key}>
            <span className="field-label">{d.label}<em>{picked.length ? d.some : narrow ? "same as the standard" : d.none}</em></span>
            <div className="chips" role="group" aria-label={d.label}>
              <button className={`chip ${picked.length === 0 ? "on" : ""}`} aria-pressed={picked.length === 0} onClick={() => onChange({ [d.key]: undefined })}>{narrow ? "As the standard" : d.all}</button>
              {all.map((x) => (
                <button key={x.id} className={`chip ${picked.includes(x.id) ? "on" : ""}`} aria-pressed={picked.includes(x.id)} title={x.description}
                  onClick={() => onChange({ [d.key]: all.map((y) => y.id).filter((id) => (id === x.id ? !picked.includes(id) : picked.includes(id))) })}>{x.name}</button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** "My application is…": hides what does not apply to the reader. */
export function ProfileFilter({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const { catalog } = useCatalog();
  const select = (key: keyof Profile, list: { id: string; name: string }[], any: string, label: string) =>
    list.length > 0 && (
      <select aria-label={label} value={value[key] ?? ""} onChange={(e) => onChange({ ...value, [key]: e.target.value || undefined })}>
        <option value="">{any}</option>
        {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    );
  return (
    <div className="profile-filter">
      <span><Layers size={15} />My application:</span>
      {select("tier", catalog.tiers, "any tier", "Tier")}
      {select("environment", catalog.environments, "any environment", "Environment")}
      {select("language", catalog.languages, "any language", "Language")}
    </div>
  );
}

/** Status and review rhythm, the same for processes and standards. */
export function LifecycleEditor<T extends Governed>({ doc, others, onChange }: {
  doc: T; others: { id: string; title: string }[]; onChange: (patch: Partial<Governed>) => void;
}) {
  const status = statusOf(doc);
  const choices = [3, 6, 12, 24];
  return (
    <div className="grid3">
      <div className="field">
        <span className="field-label">Status</span>
        <div className="chips" role="group" aria-label="Status">
          {(["draft", "active", "deprecated"] as Status[]).map((s) => (
            <button key={s} className={`chip ${status === s ? "on" : ""}`} aria-pressed={status === s} onClick={() => onChange({ status: s })}
              title={s === "draft" ? "Only editors see it" : s === "active" ? "In use, visible to everyone" : "Kept for reference, marked as retired"}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>
      <Field label="Owner reviews it every">
        <select value={doc.review?.intervalMonths ?? ""} onChange={(e) => onChange({ review: e.target.value ? { ...doc.review, intervalMonths: Number(e.target.value) } : undefined })}>
          <option value="">Never (not recommended)</option>
          {choices.map((m) => <option key={m} value={m}>{m} months</option>)}
          {doc.review && !choices.includes(doc.review.intervalMonths) && <option value={doc.review.intervalMonths}>{doc.review.intervalMonths} months</option>}
        </select>
      </Field>
      {status === "deprecated" && (
        <Field label="Use instead">
          <select value={doc.replacedBy ?? ""} onChange={(e) => onChange({ replacedBy: e.target.value || undefined })}>
            <option value="">Nothing replaces it</option>
            {others.filter((p) => p.id !== doc.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

export function ReviewTag({ doc }: { doc: Governed }) {
  const review = reviewInfo(doc);
  if (review.state === "none") return null;
  const last = doc.review?.lastReviewedAt;
  return (
    <span className={`review-tag ${review.state}`} title={last ? `Last reviewed ${last}${doc.review?.reviewedBy ? ` by ${doc.review.reviewedBy}` : ""}` : "Never reviewed"}>
      <CalendarCheck size={13} />{review.state === "ok" ? `Reviewed ${last}` : review.label}
    </span>
  );
}

export const unitsOf = (c: Catalog) => c.teams.filter((t) => t.kind && t.kind !== "team");
