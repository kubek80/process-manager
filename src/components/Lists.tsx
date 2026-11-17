import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { Profile } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { FILTER_LABEL, type FilterKey, type Option } from "../lib/search";
import { pageNumbers, PAGE_SIZES, showingText, type Page } from "../lib/paging";
import "../lists.css";

// The pieces the three lists share (Processes, Standards, the search results): the filter panel
// on the left, the chosen filters above the results, and the pages under them.

/** Long lists leave out what would give nothing; short ones (type, rigour) show it greyed. */
const HIDE_EMPTY: FilterKey[] = ["category", "practice", "platform", "owner"];

/** What one dropdown says it holds: "Any", the one name, or the names (cut by the layout). */
export function chosenSummary(options: Option[]): string {
  const on = options.filter((o) => o.chosen);
  return on.length ? on.map((o) => o.label).join(", ") : "Any";
}

/**
 * A dropdown with a checkbox per option and how many results each gives. Opens with Enter,
 * Space or the down arrow; the arrows move between the options; Escape closes it and returns
 * to the button.
 */
export function FilterDropdown({ name, label, options, onToggle }: { name: FilterKey; label?: string; options: Option[]; onToggle: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const title = label ?? FILTER_LABEL[name];
  const shown = HIDE_EMPTY.includes(name) ? options.filter((o) => o.count > 0 || o.chosen) : options;
  const boxes = () => [...(box.current?.querySelectorAll<HTMLInputElement>("input:not(:disabled)") ?? [])];
  const focusAt = (i: number) => { const all = boxes(); all[(i + all.length) % all.length]?.focus(); };
  // the down arrow on the button opens the list and goes to its first option
  useEffect(() => { if (open && focusFirst) { setFocusFirst(false); focusAt(0); } }, [open, focusFirst]); // eslint-disable-line react-hooks/exhaustive-deps
  // a list that is empty in every case (nothing uses it) is left out
  if (!options.length) return null;
  const summary = chosenSummary(shown);
  const n = shown.filter((o) => o.chosen).length;
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setFocusFirst(true); }
    if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
  };
  const onListKey = (e: KeyboardEvent) => {
    const all = boxes();
    const at = all.indexOf(document.activeElement as HTMLInputElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusAt(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (at <= 0) button.current?.focus(); else focusAt(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(all.length - 1); }
  };
  return (
    <div className={`filter-dd ${open ? "open" : ""} ${n ? "chosen" : ""}`.trim()} data-filter={name}>
      <button ref={button} type="button" className="filter-dd-button" aria-expanded={open} aria-controls={`${id}-list`}
        aria-label={`${title}: ${summary}`} onClick={() => setOpen(!open)} onKeyDown={onButtonKey}>
        <span className="filter-dd-text">
          <span className="filter-dd-name">{title}</span>
          <span className="filter-dd-value">{summary}</span>
        </span>
        {n > 1 && <span className="filter-dd-n" aria-hidden="true">{n}</span>}
        <ChevronDown size={16} aria-hidden="true" className="filter-dd-chevron" />
      </button>
      {open && (
        <div ref={box} id={`${id}-list`} className="filter-dd-list" role="group" aria-label={title} onKeyDown={onListKey}>
          {!shown.length && <p className="filter-none">Nothing to choose with the other filters.</p>}
          {shown.map((o) => {
            const off = o.count === 0 && !o.chosen;
            return (
              <label key={o.value} className={`filter-option ${o.chosen ? "on" : ""} ${off ? "off" : ""}`.trim()}>
                <input type="checkbox" checked={o.chosen} disabled={off} onChange={() => onToggle(o.value)}
                  aria-label={`${o.label}, ${o.count} ${o.count === 1 ? "result" : "results"}`} />
                <span className="filter-option-name">{o.label}</span>
                <span className="filter-option-count" aria-hidden="true">{o.count}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A yes/no filter of the panel: "Only my bookmarks", "Only what needs a review". */
export interface FlagControl { key: string; label: string; count: number; on: boolean; onChange: (on: boolean) => void }

/** "My application": the selects for tier, environment and language. */
function ProfileSelects({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const { catalog } = useCatalog();
  const lists = [
    { key: "tier" as const, list: catalog.tiers, any: "any tier", label: "Tier" },
    { key: "environment" as const, list: catalog.environments, any: "any environment", label: "Environment" },
    { key: "language" as const, list: catalog.languages, any: "any language", label: "Language" },
  ].filter((x) => x.list.length > 0);
  if (!lists.length) return null;
  return (
    <fieldset className="filter-group profile-filter">
      <legend>My application</legend>
      {lists.map(({ key, list, any, label }) => (
        <label key={key} className="filter-select">
          <span>{label}</span>
          <select aria-label={label} value={value[key] ?? ""} onChange={(e) => onChange({ ...value, [key]: e.target.value || undefined })}>
            <option value="">{any}</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      ))}
    </fieldset>
  );
}

export interface FilterPanelProps {
  id: string;
  /** On a narrow screen the panel is folded away until "Filters" is pressed. */
  open: boolean;
  text?: { value: string; onChange: (v: string) => void; placeholder: string; label: string };
  keys: FilterKey[];
  labels?: Partial<Record<FilterKey, string>>;
  options: Record<FilterKey, Option[]>;
  onToggle: (key: FilterKey, value: string) => void;
  flags: FlagControl[];
  profile: Profile;
  onProfile: (p: Profile) => void;
}

/** The filters on the left of a list. */
export function FilterPanel({ id, open, text, keys, labels, options, onToggle, flags, profile, onProfile }: FilterPanelProps) {
  return (
    <aside id={id} className={`filter-panel ${open ? "open" : ""}`.trim()} aria-label="Filters">
      {text && (
        <div className="search filter-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={text.value} onChange={(e) => text.onChange(e.target.value)} placeholder={text.placeholder} aria-label={text.label} autoComplete="off" spellCheck={false} />
        </div>
      )}
      {flags.length > 0 && (
        <div className="filter-group filter-flags">
          {flags.map((f) => (
            <label key={f.key} className={`filter-option flag ${f.on ? "on" : ""}`.trim()} data-flag={f.key}>
              <input type="checkbox" checked={f.on} onChange={(e) => f.onChange(e.target.checked)} aria-label={`${f.label}, ${f.count} ${f.count === 1 ? "result" : "results"}`} />
              <span className="filter-option-name">{f.label}</span>
              <span className="filter-option-count" aria-hidden="true">{f.count}</span>
            </label>
          ))}
        </div>
      )}
      <div className="filter-group filter-dds">
        {keys.map((k) => <FilterDropdown key={k} name={k} label={labels?.[k]} options={options[k]} onToggle={(v) => onToggle(k, v)} />)}
      </div>
      <ProfileSelects value={profile} onChange={onProfile} />
    </aside>
  );
}

/** A chosen filter as it is shown above the results, with a way to take it away. */
export interface Chosen { key: string; name: string; value: string; remove: () => void }

/** Every chosen filter at a glance, each with a way to remove it, and one to remove them all. */
export function ChosenFilters({ chosen, onClear }: { chosen: Chosen[]; onClear: () => void }) {
  if (!chosen.length) return null;
  return (
    <div className="filter-chosen" role="group" aria-label="Chosen filters">
      {chosen.map((c) => (
        <button key={c.key} type="button" className="filter-chip" aria-label={`Remove filter ${c.name}: ${c.value}`} onClick={c.remove}>
          <span className="filter-chip-key">{c.name}:</span>{c.value}<X size={13} aria-hidden="true" />
        </button>
      ))}
      <button type="button" className="filter-clear" onClick={onClear}>Clear all filters</button>
    </div>
  );
}

/** The chosen filters of "My application", for `ChosenFilters`. */
export function profileChosen(profile: Profile, onChange: (p: Profile) => void, catalog: ReturnType<typeof useCatalog>["catalog"]): Chosen[] {
  const name = (l: { id: string; name: string }[], id: string) => l.find((x) => x.id === id)?.name ?? id;
  const out: Chosen[] = [];
  const drop = (k: keyof Profile) => () => { const p = { ...profile }; delete p[k]; onChange(p); };
  if (profile.tier) out.push({ key: "p:tier", name: "Tier", value: name(catalog.tiers, profile.tier), remove: drop("tier") });
  if (profile.environment) out.push({ key: "p:environment", name: "Environment", value: name(catalog.environments, profile.environment), remove: drop("environment") });
  if (profile.language) out.push({ key: "p:language", name: "Language", value: name(catalog.languages, profile.language), remove: drop("language") });
  return out;
}

/** The line above the results: how many are shown (announced politely), "Filters (n)" on a phone, the page size. */
export function ResultsBar({ page, noun, panelId, open, onOpen, chosen, size, onSize, extra }: {
  page: Page; noun: { one: string; many: string }; panelId: string; open: boolean; onOpen: (open: boolean) => void; chosen: number;
  size: number; onSize: (n: number) => void; extra?: ReactNode;
}) {
  return (
    <div className="results-bar">
      <p className="list-count" role="status" aria-live="polite" aria-atomic="true">{showingText(page, noun)}{extra}</p>
      <button type="button" className="btn small filter-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => onOpen(!open)}>
        <SlidersHorizontal size={14} aria-hidden="true" />Filters{chosen ? ` (${chosen})` : ""}
      </button>
      <PageSize size={size} onSize={onSize} />
    </div>
  );
}

export function PageSize({ size, onSize }: { size: number; onSize: (n: number) => void }) {
  return (
    <label className="page-size">
      <span>Per page</span>
      <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Items per page">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}

/** The pages of a list: previous, the numbers (the current one marked), next. Nothing when it all fits on one. */
export function Pager({ page, onPage, label }: { page: Page; onPage: (n: number) => void; label: string }) {
  if (page.pages <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="pager-step" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} aria-hidden="true" /><span className="pager-word">Previous</span>
      </button>
      <ol className="pager-pages">
        {pageNumbers(page.page, page.pages).map((n, i) => n === "gap"
          ? <li key={`gap${i}`} className="pager-gap" aria-hidden="true">…</li>
          : (
            <li key={n}>
              <button type="button" className={`pager-num ${n === page.page ? "on" : ""}`.trim()} aria-current={n === page.page ? "page" : undefined}
                aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>
            </li>
          ))}
      </ol>
      <span className="pager-of">Page {page.page} of {page.pages}</span>
      <button type="button" className="pager-step" disabled={page.page >= page.pages} onClick={() => onPage(page.page + 1)} aria-label="Next page">
        <span className="pager-word">Next</span><ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

/**
 * The page of a list that is shown. Any change of `what` (the search, a filter) goes back to the
 * first page.
 */
export function usePaging(what: string): [number, (n: number) => void] {
  const [at, setAt] = useState({ what, page: 1 });
  const page = at.what === what ? at.page : 1;
  return [page, (n: number) => setAt({ what, page: n })];
}

/** After going to another page: the start of the results is where reading continues. */
export function toResults(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}
