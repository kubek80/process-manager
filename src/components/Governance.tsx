import type { ReactNode } from "react";
import { ArrowLeft, CalendarCheck, Code2, Compass, Layers, Rows3, Server, TriangleAlert } from "lucide-react";
import type { DocMeta, Governed, Rigour, TargetKind } from "../types";
import { environmentLabel, languageLabel, ownedBy, platformName, practiceName, tierLabel, useCatalog } from "../lib/catalog";
import { belongsChoice, belongsRefused, wouldLoseEdit, type Belongs, type BelongsField } from "../lib/rights";
import { usePerms } from "../lib/session";
import type { Profile } from "../lib/edit";
import { quietReview, statusOf, type ReviewInfo } from "../lib/lifecycle";
import { Field } from "./ui";
import { Fact, KindTag } from "./marks";
import { VersionTag } from "./Editing";
import { formatDate } from "../lib/dates";
import { printedLine } from "../lib/media";
import "../lists.css";

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

/**
 * How often the owner reviews it and, for a retired one, what readers should use instead. The
 * status itself is not edited here: Publish, Retire and Unpublish on the editing screen set it.
 */
export function ReviewEditor<T extends Governed>({ doc, others, onChange }: {
  doc: T; others: { id: string; title: string }[]; onChange: (patch: Partial<Governed>) => void;
}) {
  const choices = [3, 6, 12, 24];
  return (
    <div className="grid2">
      <Field label="Owner reviews it every" hint="The owning team is reminded when a review is due">
        <select value={doc.review?.intervalMonths ?? ""} onChange={(e) => onChange({ review: e.target.value ? { ...doc.review, intervalMonths: Number(e.target.value) } : undefined })}>
          <option value="">Never (not recommended)</option>
          {choices.map((m) => <option key={m} value={m}>{m} months</option>)}
          {doc.review && !choices.includes(doc.review.intervalMonths) && <option value={doc.review.intervalMonths}>{doc.review.intervalMonths} months</option>}
        </select>
      </Field>
      {statusOf(doc) === "deprecated" && (
        <Field label="Use instead" hint="Where readers of the retired one are sent">
          <select value={doc.replacedBy ?? ""} onChange={(e) => onChange({ replacedBy: e.target.value || undefined })}>
            <option value="">Nothing replaces it</option>
            {others.filter((p) => p.id !== doc.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

/**
 * Where the review stands, for the line under the facts: when it was last confirmed, or when the
 * first review is due. A review that is due or overdue is a mark at the top instead (`ReviewMark`).
 */
export function ReviewTag({ doc, review }: { doc: Governed; review: ReviewInfo }) {
  if (review.state === "none") return null;
  const last = doc.review?.lastReviewedAt;
  const by = doc.review?.reviewedBy ? ` by ${doc.review.reviewedBy}` : "";
  return (
    <span className="review-tag" title={last ? `Last reviewed ${last}${by}` : review.first ? "Not reviewed yet: the first review is counted from when it was published" : "Not reviewed yet"}>
      <CalendarCheck size={13} aria-hidden="true" />{quietReview(review, last)}
    </span>
  );
}

/** A review that is due (warning) or overdue (problem), as the cards mark it. */
export function ReviewMark({ review }: { review: ReviewInfo }) {
  if (review.state !== "soon" && review.state !== "overdue") return null;
  return <span className={`card-mark ${review.state === "overdue" ? "bad" : "warn"}`} data-line="review">{review.label}</span>;
}

/** Where it applies and who looks after it, as the cards say it: platform, practice, tiers, and environments and languages when narrowed. */
export function WhereFacts({ doc }: { doc: Governed }) {
  const { catalog } = useCatalog();
  return (
    <>
      {doc.platform && <Fact icon={Layers} label="Platform">{platformName(catalog, doc.platform)}</Fact>}
      {doc.practice && <Fact icon={Compass} label="Practice">{practiceName(catalog, doc.practice)}</Fact>}
      <Fact icon={Rows3} label="Application tiers">{tierLabel(catalog, doc.tiers)}</Fact>
      {!!doc.environments?.length && <Fact icon={Server} label="Environments">{environmentLabel(catalog, doc.environments)}</Fact>}
      {!!doc.languages?.length && <Fact icon={Code2} label="Languages">{languageLabel(catalog, doc.languages)}</Fact>}
    </>
  );
}

/**
 * On the editing screen, under the name of "What readers will see" while About is chosen: what the
 * head of the reader's page will say about the fields of About - the category and the team that
 * looks after it, in the same words, then `children` (the level, the lead time) and where it
 * applies. A team not chosen yet is said, so that choosing one is seen to arrive here.
 */
export function PreviewFacts({ kind, doc, children }: { kind: TargetKind; doc: Governed; children?: ReactNode }) {
  const { catalog } = useCatalog();
  const said = ownedBy(catalog, kind, doc);
  return (
    <span className="preview-facts">
      {said && <span className="preview-owner">{said}</span>}
      {!doc.owner && <span className="preview-owner none">{kind === "process" ? "No owning team yet" : "Not issued by a team yet"}</span>}
      {children}
      <WhereFacts doc={doc} />
    </span>
  );
}

/**
 * The head of the reader's page of a process or standard, the same for both: the kind tag, the
 * category and who owns it in plain words, marks for what needs attention, the title, the
 * summary, the facts to compare first (`facts`, as on the card), where it applies, and when it
 * was changed and reviewed. `actions` go to the right of the title; `children` (the use and
 * feedback line) below.
 */
export function DocHead({ kind, doc, meta, review, facts, actions, notice, onBack, onHistory, children }: {
  kind: TargetKind; doc: Governed; meta?: DocMeta; review: ReviewInfo;
  facts: ReactNode; actions?: ReactNode; onBack: () => void; onHistory: () => void; children?: ReactNode;
  /** What a reader must know before anything else (retired, review overdue): directly under the title. */
  notice?: ReactNode;
}) {
  const { catalog } = useCatalog();
  const status = statusOf(doc);
  return (
    <header className="doc-head">
      <div className="doc-kicker">
        <button className="back" onClick={onBack}><ArrowLeft size={16} />All {kind === "process" ? "processes" : "standards"}</button>
        <KindTag kind={kind} />
        {(doc.category || doc.owner) && <span className="doc-owner">{ownedBy(catalog, kind, doc)}</span>}
        {(status !== "active" || review.state === "soon" || review.state === "overdue") && (
          <span className="doc-marks">
            {status === "draft" && <span className="card-mark draft">Draft</span>}
            {status === "deprecated" && <span className="card-mark retired">Retired</span>}
            <ReviewMark review={review} />
          </span>
        )}
      </div>
      <div className="doc-head-row">
        <div className="doc-head-text">
          <h1>{doc.title}</h1>
          {doc.summary && <p className="lead">{doc.summary}</p>}
        </div>
        {actions && <div className="head-actions">{actions}</div>}
      </div>
      {notice && <div className="doc-notices">{notice}</div>}
      <div className="doc-facts">{facts}<WhereFacts doc={doc} /></div>
      <div className="doc-foot">
        <p className="doc-when">
          {doc.updatedAt && <span className="doc-changed" title="When what it says last changed. Versions lists every time it was stored: saved, imported or confirmed in a review.">Content changed {formatDate(doc.updatedAt)}</span>}
          <ReviewTag doc={doc} review={review} />
          <VersionTag meta={meta} onOpen={onHistory} />
        </p>
        {children}
      </div>
    </header>
  );
}

/** The last line of a printed process or standard (only drawn while printing). */
export function PrintFoot({ doc, meta }: { doc: Governed & { title: string }; meta?: DocMeta }) {
  const address = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}${window.location.hash.replace(/^(#\/[ps]\/[a-z0-9-]+).*$/, "$1")}` : undefined;
  return <footer className="print-foot">{printedLine({ title: doc.title, version: meta?.version, changed: doc.updatedAt, printedAt: new Date(), address })}</footer>;
}

/** How binding a process is, in words for readers. */
export const RIGOUR: Record<Rigour, { label: string; hint: string }> = {
  mandatory: { label: "Mandatory", hint: "The only allowed way to get this done." },
  recommended: { label: "Recommended", hint: "The expected way. Another way needs a good reason." },
  optional: { label: "Optional", hint: "A help that may be used, or not." },
};

type Grouped = { category?: string; practice?: string; platform?: string; rigour?: Rigour };

/**
 * Why the person could not save this document as it is now, or "" when they can. For somebody
 * who may change it only through their platforms and practices: a platform or practice that is
 * not theirs cannot be set, changed or taken away; and a document moved away from all of theirs
 * is no longer theirs to save. The server refuses both; this says so before they try.
 */
export function useBelongsWarning(kind: TargetKind, saved: Belongs, now: Belongs): string {
  const perms = usePerms();
  const { catalog } = useCatalog();
  const refused = belongsRefused(perms, kind, saved, now);
  if (refused.length) {
    const name = (f: BelongsField, id?: string) => (id ? `“${f === "platform" ? platformName(catalog, id) : practiceName(catalog, id)}”` : "none");
    const parts = refused.map((f) => `the ${f} (it was ${name(f, saved[f])}, now ${name(f, now[f])})`);
    return `Only the owners of a platform or practice, or an editor, can change ${parts.join(" and ")}. Put it back as it was under About.`;
  }
  if (!wouldLoseEdit(perms, kind, saved, now)) return "";
  const yours = [...perms.platforms.map((id) => `the platform ${platformName(catalog, id)}`), ...perms.practices.map((id) => `the practice ${practiceName(catalog, id)}`)];
  return `You may change this ${kind} because it belongs to a platform or practice you own. With this platform and practice it would no longer be yours, so you could not save it. Keep it with ${yours.join(" or ") || "one of yours"}.`;
}

/** The hint beside a platform or practice picker that the person may not change. */
export const LOCKED_HINT = "Only its owners or an editor can change this";

/** Category, practice and platform (and for a process its rigour), as they are picked in Details. */
export function BelongsEditor({ kind, doc, saved, onChange }: {
  kind: TargetKind; doc: Grouped & Belongs;
  /** The document as it was saved: what the person's right to change it comes from. */
  saved: Belongs;
  onChange: (patch: Grouped) => void;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  type Row = { id: string; name: string; description?: string };
  const select = (field: "category" | BelongsField, list: Row[], choice: "any" | "own" | "locked") => {
    const mine = field === "platform" ? perms.platforms : field === "practice" ? perms.practices : [];
    // somebody who edits only through their platforms and practices is offered only their own
    const offered = choice === "any" ? list : choice === "own" ? list.filter((x) => mine.includes(x.id)) : [];
    const value = doc[field] ?? "";
    return (
      <select value={value} disabled={choice === "locked"} onChange={(e) => onChange({ [field]: e.target.value || undefined })}>
        {(choice !== "locked" || !value) && <option value="">None</option>}
        {offered.map((x) => <option key={x.id} value={x.id} title={x.description}>{x.name}</option>)}
        {value && !offered.some((x) => x.id === value) && <option value={value}>{list.find((x) => x.id === value)?.name ?? `${value} (not in the list)`}</option>}
      </select>
    );
  };
  const belongs = (field: BelongsField, label: string, list: Row[]) => {
    const choice = belongsChoice(perms, kind, field, saved[field]);
    return (
      <Field label={label} hint={choice === "locked" ? LOCKED_HINT : choice === "own" ? "you can pick one of yours" : "its owners may change it"}>
        {select(field, list, choice)}
      </Field>
    );
  };
  const lose = useBelongsWarning(kind, saved, doc);
  return (
    <>
      <div className="grid3">
        <Field label="Category" hint="where it is grouped">{select("category", catalog.categories, "any")}</Field>
        {belongs("platform", "Platform", catalog.platforms)}
        {belongs("practice", "Practice", catalog.practices)}
      </div>
      {lose && <div className="check warn" role="alert"><TriangleAlert size={16} /><span>{lose}</span></div>}
      {kind === "process" && (
        <div className="field">
          <span className="field-label">Rigour<em>how binding it is: {doc.rigour ? RIGOUR[doc.rigour]?.hint : "readers are not told whether they must use it."}</em></span>
          <div className="chips" role="group" aria-label="Rigour">
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
