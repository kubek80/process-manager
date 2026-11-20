import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AppWindow, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Lightbulb, Rows3, Search, ShieldCheck, SlidersHorizontal, Workflow, X } from "lucide-react";
import type { Rigour, TargetKind } from "../types";
import { href } from "../lib/store";
import type { Profile } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { appSummary, countText, countWords, emptyFilterText, FILTER_LABEL, PROFILE_HINT, PROFILE_KEYS, PROFILE_LABEL, RIGOURS, rigourFilterName, rigourOptionLabel, type FilterKey, type Option, type ProfileKey, type TypeTab } from "../lib/search";
import { useRemembered } from "../lib/profile";
import { LevelBars } from "./marks";
import type { ListView } from "../lib/paging";
import { SORT_KEYS, sortLabel, sortOf, type SortKey } from "../lib/sorting";
import { pageNumbers, PAGE_SIZES, showingText, type Page } from "../lib/paging";
import "../lists.css";

// The pieces the three lists share (Processes, Standards, the search results): the filter panel
// on the left, the chosen filters above the results, and the pages under them.

/**
 * Long lists leave out what would give nothing; short ones (type, rigour) show it greyed. The
 * choices of "My application" (`single`) are facts about the reader, not ways to narrow a list:
 * they always offer every entry, also one that would give nothing.
 */
const HIDE_EMPTY: string[] = ["category", "practice", "platform", "owner"];

/** What one dropdown says it holds: "Any", the one name, or the names (cut by the layout). */
export function chosenSummary(options: Option[]): string {
  const on = options.filter((o) => o.chosen && o.value !== "");
  return on.length ? on.map((o) => o.label).join(", ") : "Any";
}

const SEARCH_PLACEHOLDER = "Search processes and standards, e.g. GCP project or logging";

/**
 * The one search box, full width at the top: on Home and the results page it searches when
 * Enter or Search is pressed; on the lists (`live`) the results follow the typing.
 */
export function SearchBox({ value, onChange, onSubmit, big, autoFocus, live, placeholder = SEARCH_PLACEHOLDER, label = "Search processes and standards" }: {
  value: string; onChange: (v: string) => void; onSubmit?: () => void; big?: boolean; autoFocus?: boolean;
  /** Searches as you type: no Search button. */
  live?: boolean;
  placeholder?: string; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // on a desktop the box is ready for typing; on a phone the keyboard would cover the page
    if (autoFocus && window.matchMedia?.("(min-width: 768px) and (pointer: fine)").matches) ref.current?.focus();
  }, [autoFocus]);
  return (
    <form role="search" aria-label={live ? label : "Processes and standards"} className={`search-box ${big ? "big" : ""} ${live ? "live" : ""}`.trim()}
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      <Search size={big ? 20 : 17} aria-hidden="true" />
      <input ref={ref} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={label} enterKeyHint="search" autoComplete="off" spellCheck={false} />
      {!live && <button type="submit" className="btn primary">Search</button>}
    </form>
  );
}

const isRigour = (v: string): v is Rigour => (RIGOURS as string[]).includes(v);

/** Whether every option of a filter would give nothing (and none is chosen): it has nothing to offer. */
export const nothingToChoose = (options: Option[]) => options.length > 0 && options.every((o) => o.count === 0 && !o.chosen);

/**
 * A dropdown with a checkbox per option and how many results each gives (or, with `single`, a
 * choice of one, the first option being "Any …"). Opens with Enter, Space or the down arrow; the
 * arrows move between the options; Escape closes it and returns to the button. When no option
 * would give anything, it says why (`empty`) instead of showing options that cannot be used.
 */
export function FilterDropdown({ name, label, options, onToggle, atLeast, single, hint, empty }: {
  name: string; label?: string; options: Option[]; onToggle: (value: string) => void; atLeast?: boolean;
  /** One choice of all (radio buttons), as "My application" is one application. */
  single?: boolean;
  /** A sentence at the top of the open list: what choosing does. */
  hint?: string;
  /** Why there is nothing to choose, when no option would give anything. */
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const title = label ?? (FILTER_LABEL as Record<string, string>)[name] ?? name;
  const dead = !single && nothingToChoose(options);
  const shown = dead ? [] : HIDE_EMPTY.includes(name) ? options.filter((o) => o.count > 0 || o.chosen) : options;
  const boxes = () => [...(box.current?.querySelectorAll<HTMLInputElement>("input:not(:disabled)") ?? [])];
  const focusAt = (i: number) => { const all = boxes(); all[(i + all.length) % all.length]?.focus(); };
  // the down arrow on the button opens the list and goes to its first option
  useEffect(() => { if (open && focusFirst) { setFocusFirst(false); focusAt(0); } }, [open, focusFirst]); // eslint-disable-line react-hooks/exhaustive-deps
  // a list that is empty in every case (nothing uses it) is left out
  if (!options.length) return null;
  const summary = dead ? "Nothing to choose" : chosenSummary(shown);
  const n = shown.filter((o) => o.chosen && o.value !== "").length;
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
    <div className={`filter-dd ${open ? "open" : ""} ${n ? "chosen" : ""} ${dead ? "nothing" : ""}`.trim()} data-filter={name}>
      <button ref={button} type="button" className="filter-dd-button" aria-expanded={open} aria-controls={`${id}-list`}
        aria-label={`${title}: ${summary}`} onClick={() => setOpen(!open)} onKeyDown={onButtonKey}>
        <span className="filter-dd-name">{title}</span>
        <span className="filter-dd-value">{summary}</span>
        {n > 1 && <span className="filter-dd-n" aria-hidden="true">{n}</span>}
        <ChevronDown size={16} aria-hidden="true" className="filter-dd-chevron" />
      </button>
      {open && (
        <div ref={box} id={`${id}-list`} className="filter-dd-list" role={single ? "radiogroup" : "group"} aria-label={title} onKeyDown={onListKey}>
          {hint && !dead && <p className="filter-dd-hint">{hint}</p>}
          {dead && <p className="filter-none">{empty ?? "Nothing to choose with the other filters."}</p>}
          {shown.map((o) => {
            const off = !single && o.count === 0 && !o.chosen;
            return (
              <label key={o.value} className={`filter-option ${o.chosen ? "on" : ""} ${off ? "off" : ""}`.trim()}>
                <input type={single ? "radio" : "checkbox"} name={single ? id : undefined} checked={o.chosen} disabled={off} onChange={() => onToggle(o.value)}
                  aria-label={`${o.label}, ${countWords(o.count, atLeast)}`} />
                <span className="filter-option-name">{name === "rigour" && isRigour(o.value) && <LevelBars level={o.value} />}{o.label}</span>
                <span className="filter-option-count" aria-hidden="true">{countText(o.count, atLeast)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A yes/no filter of the panel: "Only my bookmarks", "Only what needs a review". */
export interface FlagControl {
  key: string; label: string; count: number; on: boolean; onChange: (on: boolean) => void;
  /** Why it cannot be used yet (e.g. the bookmarks are still loading): no count is shown, it cannot be switched on. */
  unknown?: string;
}

export interface FilterPanelProps {
  id: string;
  /** On a narrow screen the panel is folded away until "Filters" is pressed. */
  open: boolean;
  keys: FilterKey[];
  labels?: Partial<Record<FilterKey, string>>;
  options: Record<FilterKey, Option[]>;
  onToggle: (key: FilterKey, value: string) => void;
  flags: FlagControl[];
  /** "My application": one tier, environment and language, with how many results each gives. */
  profile: Profile;
  onProfile: (p: Profile) => void;
  profileOptions: Record<ProfileKey, Option[]>;
  /** What the results are (for why a filter has nothing to choose), and how many there are now. */
  subject: TargetKind | "any";
  total: number;
  /** On a narrow screen, the button at the end of the open panel: "Show 12 processes". */
  done?: { label: string; onClick: () => void };
  /** The results are the closest of more that matched: the counts say "at least" ("12+"). */
  atLeast?: boolean;
  /** On a narrow screen only, at the top of the open panel: the order and the page size. */
  order?: ReactNode;
}

/** The filters on the left of a list: the yes/no ones, then one dropdown per filter, "My application" last. */
export function FilterPanel({ id, open, keys, labels, options, onToggle, flags, profile, onProfile, profileOptions, subject, total, done, atLeast, order }: FilterPanelProps) {
  const setProfile = (k: ProfileKey, v: string) => {
    const p = { ...profile };
    if (v) p[k] = v; else delete p[k];
    onProfile(p);
  };
  const hasApp = PROFILE_KEYS.some((k) => (profileOptions[k] ?? []).length > 0);
  const appChosen = PROFILE_KEYS.some((k) => !!profile[k]);
  const [appOpen, setAppOpen] = useRemembered("pm:filters:application", appChosen);
  const appId = useId();
  // with nothing found, a filter that has nothing to choose is left out (one that is chosen stays)
  const shownKeys = keys.filter((k) => options[k].length > 0 && (total > 0 || options[k].some((o) => o.chosen)));
  const shownFlags = flags.filter((f) => total > 0 || f.on);
  // the level in the words of what is listed: Mandatory for processes, Must for standards
  const named = (k: FilterKey): Option[] => (k === "rigour" ? options[k].map((o) => (isRigour(o.value) ? { ...o, label: rigourOptionLabel(o.value, subject) } : o)) : options[k]);
  return (
    <aside id={id} className={`filter-panel ${open ? "open" : ""}`.trim()} aria-label="Filters">
      {order && <div className="filter-group filter-order">{order}</div>}
      {shownFlags.length > 0 && (
        <div className="filter-group filter-flags" role="group" aria-labelledby={`${id}-show`}>
          <p className="filter-group-title" id={`${id}-show`}>Show only</p>
          {shownFlags.map((f) => (
            <label key={f.key} className={`filter-option flag ${f.on ? "on" : ""} ${f.unknown && !f.on ? "off" : ""}`.trim()} data-flag={f.key}>
              <input type="checkbox" checked={f.on} disabled={!!f.unknown && !f.on} onChange={(e) => f.onChange(e.target.checked)}
                aria-label={f.unknown ? `${f.label}: ${f.unknown}` : `${f.label}, ${countWords(f.count, atLeast)}`} />
              <span className="filter-option-name">{f.label}{f.unknown && <span className="filter-option-why" aria-hidden="true">{f.unknown}</span>}</span>
              {!f.unknown && <span className="filter-option-count" aria-hidden="true">{countText(f.count, atLeast)}</span>}
            </label>
          ))}
        </div>
      )}
      {shownKeys.length > 0 && (
        <div className="filter-group filter-dds" role="group" aria-labelledby={`${id}-narrow`}>
          <p className="filter-group-title" id={`${id}-narrow`}>Narrow down</p>
          <div className="filter-rows">
            {shownKeys.map((k) => (
              <FilterDropdown key={k} name={k} label={labels?.[k] ?? (k === "rigour" ? rigourFilterName(subject) : undefined)} options={named(k)} onToggle={(v) => onToggle(k, v)} atLeast={atLeast}
                empty={emptyFilterText(k, subject, total)} />
            ))}
          </div>
        </div>
      )}
      {hasApp && (total > 0 || appChosen) && (
        <div className={`filter-group filter-app ${appOpen ? "open" : ""} ${appChosen ? "chosen" : ""}`.trim()}>
          <button type="button" className="filter-app-toggle" aria-expanded={appOpen} aria-controls={appId} onClick={() => setAppOpen(!appOpen)}>
            <AppWindow size={15} aria-hidden="true" className="filter-app-icon" />
            <span className="filter-app-text">
              <span className="filter-group-title">My application</span>
              <span className="filter-app-summary">{appSummary(profileOptions)}</span>
            </span>
            <ChevronDown size={16} aria-hidden="true" className="filter-dd-chevron" />
          </button>
          {appOpen && (
            <div id={appId} className="filter-app-body">
              <p className="filter-profile-note">Shows only what applies to your application, here and on every process and standard. Remembered in this browser.</p>
              <div className="filter-rows">
                {PROFILE_KEYS.map((k) => (
                  <FilterDropdown key={k} name={k} label={PROFILE_LABEL[k]} options={profileOptions[k] ?? []} single hint={PROFILE_HINT[k]}
                    onToggle={(v) => setProfile(k, v)} atLeast={atLeast} empty={emptyFilterText(k, subject, total)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {done && <button type="button" className="btn primary filter-done" onClick={done.onClick}>{done.label}</button>}
    </aside>
  );
}

const TAB_ICON = { process: Workflow, standard: ShieldCheck } as const;
const TAB_LABEL: Record<TypeTab, string> = { "": "All", process: "Processes", standard: "Standards" };

/**
 * Above the results: All, Processes, Standards, each with how many results it gives. One choice of
 * three, like radio buttons: the arrow keys move the choice, Tab leaves the group.
 */
export function TypeTabs({ value, counts, onChange, atLeast }: {
  value: TypeTab; counts: Record<TypeTab, number>; onChange: (t: TypeTab) => void; atLeast?: boolean;
}) {
  const tabs: TypeTab[] = ["", "process", "standard"];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const at = tabs.indexOf(value);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % tabs.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at + tabs.length - 1) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to]);
    refs.current[tabs[to]]?.focus();
  };
  return (
    <div className="tabs type-tabs" role="radiogroup" aria-label="Show" onKeyDown={onKey}>
      {tabs.map((t) => {
        const Icon = t ? TAB_ICON[t] : null;
        return (
          <button key={t || "all"} ref={(el) => { refs.current[t] = el; }} type="button" role="radio" aria-checked={t === value} tabIndex={t === value ? 0 : -1}
            className={`tab type-tab ${t || "all"} ${t === value ? "on" : ""}`.trim()} data-type={t || "all"} onClick={() => onChange(t)}
            aria-label={`${TAB_LABEL[t]}, ${countWords(counts[t], atLeast)}`}>
            {Icon && <span className={`type-tab-mark ${t}`} aria-hidden="true"><Icon size={12} /></span>}
            <span className="type-tab-name">{TAB_LABEL[t]}</span>
            <span className="tab-count" aria-hidden="true">{countText(counts[t], atLeast)}</span>
          </button>
        );
      })}
    </div>
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

/** The line above the results: how many are shown (announced politely), "Filters (n)" on a phone, the order, the page size and the pages. */
export function ResultsBar({ page, noun, panelId, open, onOpen, chosen, size, onSize, extra, sort, onSort, searched, pager, view, onView, bare }: {
  page: Page; noun: { one: string; many: string }; panelId: string; open: boolean; onOpen: (open: boolean) => void; chosen: number;
  size: number; onSize: (n: number) => void; extra?: ReactNode;
  sort: SortKey; onSort: (k: SortKey) => void;
  /** Something is searched for: the usual order is the best match, else the name. */
  searched: boolean;
  /** The pager above the results, at the end of the line. */
  pager?: ReactNode;
  /** Cards or rows. */
  view: ListView; onView: (v: ListView) => void;
  /** Nothing to order, page or filter (nothing found, nothing chosen): the count alone. */
  bare?: boolean;
}) {
  return (
    <div className="results-bar">
      <p className="list-count" role="status" aria-live="polite" aria-atomic="true">{showingText(page, noun)}{extra}</p>
      {!bare && (
        <>
          <button type="button" className="btn small filter-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => onOpen(!open)}>
            <SlidersHorizontal size={14} aria-hidden="true" />Filters{chosen ? ` (${chosen})` : ""}
          </button>
          <div className="results-tools">
            <ViewSwitch view={view} onView={onView} />
            <span className="results-order"><SortBy sort={sort} onSort={onSort} searched={searched} /><PageSize size={size} onSize={onSize} /></span>
            {pager}
          </div>
        </>
      )}
    </div>
  );
}

const VIEW_LABEL: Record<ListView, string> = { cards: "Cards", rows: "Rows" };
/** Cards or rows: one segmented control; the arrow keys move the choice. */
export function ViewSwitch({ view, onView }: { view: ListView; onView: (v: ListView) => void }) {
  const views: ListView[] = ["cards", "rows"];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const to = view === "cards" ? "rows" : "cards";
    onView(to);
    refs.current[to]?.focus();
  };
  return (
    <div className="seg view-switch" role="radiogroup" aria-label="Show as" onKeyDown={onKey}>
      {views.map((v) => {
        const Icon = v === "cards" ? LayoutGrid : Rows3;
        return (
          <button key={v} ref={(el) => { refs.current[v] = el; }} type="button" role="radio" aria-checked={v === view} tabIndex={v === view ? 0 : -1}
            className={`seg-item ${v === view ? "on" : ""}`.trim()} data-view={v} onClick={() => onView(v)} title={`Show as ${VIEW_LABEL[v].toLowerCase()}`}>
            <Icon size={14} aria-hidden="true" /><span className="seg-word">{VIEW_LABEL[v]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The order and the page size, for the filter sheet of a phone (the bar holds them on a wider screen). */
export function OrderControls({ sort, onSort, searched, size, onSize }: { sort: SortKey; onSort: (k: SortKey) => void; searched: boolean; size: number; onSize: (n: number) => void }) {
  return (
    <div className="order-controls">
      <SortBy sort={sort} onSort={onSort} searched={searched} />
      <PageSize size={size} onSize={onSize} />
    </div>
  );
}

/** "Sort by": the best match (or the name), the newest, the most recently updated. */
export function SortBy({ sort, onSort, searched }: { sort: SortKey; onSort: (k: SortKey) => void; searched: boolean }) {
  return (
    <label className="sort-by">
      <span>Sort by</span>
      <select value={sort} onChange={(e) => onSort(sortOf(e.target.value))} aria-label="Sort by">
        {SORT_KEYS.map((k) => <option key={k} value={k}>{sortLabel(k, searched)}</option>)}
      </select>
    </label>
  );
}

export function PageSize({ size, onSize, label = "Items per page" }: { size: number; onSize: (n: number) => void; label?: string }) {
  return (
    <label className="page-size">
      <span>Per page</span>
      <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label={label}>
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}

/** Under the results: the pages and, beside them, the page size. Nothing when there is nothing to page through. */
export function ResultsFoot({ page, onPage, label, size, onSize }: { page: Page; onPage: (n: number) => void; label: string; size: number; onSize: (n: number) => void }) {
  if (!page.total || page.total <= PAGE_SIZES[0]) return null;
  return (
    <div className="results-foot">
      <Pager page={page} onPage={onPage} label={label} />
      <PageSize size={size} onSize={onSize} label="Items per page, at the end" />
    </div>
  );
}

export { bookmarksUnknown, engagementKnown } from "../lib/known";

/** The way to the requests: what is missing can be asked for. */
export function AskForIt({ className = "" }: { className?: string }) {
  return (
    <p className={`muted ask-for-it ${className}`.trim()}>
      Missing a process or standard? <a href={href({ page: "requests" })}><Lightbulb size={14} aria-hidden="true" /> Ask for it, or vote for what others asked for</a>
    </p>
  );
}

/** The pages of a list: previous, the numbers (the current one marked), next. Nothing when it all fits on one. */
export function Pager({ page, onPage, label, compact }: {
  page: Page; onPage: (n: number) => void; label: string;
  /** Above the results: smaller, at the right. */
  compact?: boolean;
}) {
  if (page.pages <= 1) return null;
  return (
    <nav className={`pager ${compact ? "compact" : ""}`.trim()} aria-label={label}>
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

/** After going to another page: the start of the results is where reading continues. */
export function toResults(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}
