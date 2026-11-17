import { Boxes, CalendarCheck, Code2, Compass, Gauge, Layers, Server, Tag, TriangleAlert } from "lucide-react";
import type { Governed, Rigour, Status, TargetKind } from "../types";
import { categoryName, environmentLabel, languageLabel, platformName, practiceName, tierLabel, useCatalog } from "../lib/catalog";
import { editsAll, wouldLoseEdit, type Belongs } from "../lib/rights";
import { usePerms } from "../lib/session";
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

/** How binding a process is, in words for readers. */
export const RIGOUR: Record<Rigour, { label: string; hint: string }> = {
  mandatory: { label: "Mandatory", hint: "The only allowed way to get this done." },
  recommended: { label: "Recommended", hint: "The expected way. Another way needs a good reason." },
  optional: { label: "Optional", hint: "A help that may be used, or not." },
};

type Grouped = { category?: string; practice?: string; platform?: string; rigour?: Rigour };

/**
 * Tags for what a process or standard belongs to: its category, platform and practice, and for
 * a process how binding it is. `compact` leaves out the category (a card shows it on top).
 */
export function BelongsTags({ doc, compact }: { doc: Grouped; compact?: boolean }) {
  const { catalog } = useCatalog();
  return (
    <>
      {doc.rigour && RIGOUR[doc.rigour] && <span className={`tier-tag rigour-${doc.rigour}`} title={RIGOUR[doc.rigour].hint}><Gauge size={12} />{RIGOUR[doc.rigour].label}</span>}
      {!compact && doc.category && <span className="tier-tag" title="Category"><Tag size={12} />{categoryName(catalog, doc.category)}</span>}
      {doc.platform && <span className="tier-tag" title="Platform"><Boxes size={12} />{platformName(catalog, doc.platform)}</span>}
      {doc.practice && <span className="tier-tag" title="Practice"><Compass size={12} />{practiceName(catalog, doc.practice)}</span>}
    </>
  );
}

/**
 * Why the person could not save this document as it is now, or "" when they can: for somebody
 * who may change it only through their platforms and practices, a document moved away from all
 * of them is no longer theirs to save. The server refuses it; this says so before they try.
 */
export function useLosingWarning(kind: TargetKind, saved: Belongs, now: Belongs): string {
  const perms = usePerms();
  const { catalog } = useCatalog();
  if (!wouldLoseEdit(perms, kind, saved, now)) return "";
  const yours = [...perms.platforms.map((id) => `the platform ${platformName(catalog, id)}`), ...perms.practices.map((id) => `the practice ${practiceName(catalog, id)}`)];
  return `You may change this ${kind} because it belongs to a platform or practice you own. With this platform and practice it would no longer be yours, so you could not save it. Keep it with ${yours.join(" or ") || "one of yours"}.`;
}

/** Category, practice and platform (and for a process its rigour), as they are picked in Details. */
export function BelongsEditor({ kind, doc, saved, onChange }: {
  kind: TargetKind; doc: Grouped & Belongs;
  /** The document as it was saved: what the person's right to change it comes from. */
  saved: Belongs;
  onChange: (patch: Grouped) => void;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const limited = !editsAll(perms, kind); // edits only through platforms and practices
  const pick = (field: "category" | "practice" | "platform", label: string, hint: string, list: { id: string; name: string; description?: string }[], mine: string[] = []) => (
    <Field label={label} hint={hint}>
      <select value={doc[field] ?? ""} onChange={(e) => onChange({ [field]: e.target.value || undefined })}>
        <option value="">None</option>
        {list.map((x) => <option key={x.id} value={x.id} title={x.description}>{x.name}{limited && mine.includes(x.id) ? " (yours)" : ""}</option>)}
        {doc[field] && !list.some((x) => x.id === doc[field]) && <option value={doc[field]}>{doc[field]} (not in the list)</option>}
      </select>
    </Field>
  );
  const lose = useLosingWarning(kind, saved, doc);
  return (
    <>
      <div className="grid3">
        {pick("category", "Category", "where it is grouped", catalog.categories)}
        {pick("platform", "Platform", "its owners may change it", catalog.platforms, perms.platforms)}
        {pick("practice", "Practice", "its owners may change it", catalog.practices, perms.practices)}
      </div>
      {lose && <div className="check warn" role="alert"><TriangleAlert size={16} /><span>{lose}</span></div>}
      {kind === "process" && (
        <div className="field">
          <span className="field-label">How binding<em>{doc.rigour ? RIGOUR[doc.rigour]?.hint : "Readers are not told whether they must use it."}</em></span>
          <div className="chips" role="group" aria-label="How binding">
            <button className={`chip ${!doc.rigour ? "on" : ""}`} aria-pressed={!doc.rigour} title="Readers are not told whether they must use it." onClick={() => onChange({ rigour: undefined })}>Not stated</button>
            {(Object.keys(RIGOUR) as Rigour[]).map((r) => (
              <button key={r} className={`chip ${doc.rigour === r ? "on" : ""}`} aria-pressed={doc.rigour === r} title={RIGOUR[r].hint} onClick={() => onChange({ rigour: r })}>{RIGOUR[r].label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
