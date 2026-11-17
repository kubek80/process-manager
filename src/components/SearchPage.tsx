import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, ShieldCheck, SlidersHorizontal, Workflow, X } from "lucide-react";
import type { Process, Standard, TargetKind } from "../types";
import { useCatalog } from "../lib/catalog";
import { useVisibleDrafts } from "../lib/session";
import { go, href, type SearchState } from "../lib/store";
import {
  FILTER_KEYS, FILTER_LABEL, filterCount, filtersOf, matchRanges, rigourText, search, toggleFilter, wordsOf,
  type FilterKey, type Filters, type Hit, type Option, type Result,
} from "../lib/search";
import "../search.css";

const PLACEHOLDER = "Search processes and standards, e.g. GCP project or logging";
/** Lists that can be long: options that give nothing are left out. Type and rigour show them greyed. */
const HIDE_EMPTY: FilterKey[] = ["category", "practice", "platform"];
const PAGE = 30;

/** The one search box, on Home and on the results page. */
export function SearchBox({ value, onChange, onSubmit, big, autoFocus }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; big?: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // on a desktop the box is ready for typing; on a phone the keyboard would cover the page
    if (autoFocus && window.matchMedia?.("(min-width: 768px) and (pointer: fine)").matches) ref.current?.focus();
  }, [autoFocus]);
  return (
    <form role="search" aria-label="Processes and standards" className={`search-box ${big ? "big" : ""}`} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Search size={big ? 20 : 17} aria-hidden="true" />
      <input ref={ref} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={PLACEHOLDER}
        aria-label="Search processes and standards" enterKeyHint="search" autoComplete="off" spellCheck={false} />
      <button type="submit" className="btn primary">Search</button>
    </form>
  );
}

/** The text with the searched words marked; built as elements, never as HTML. */
export function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = matchRanges(text, words);
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    out.push(<mark key={`m${i}`} className="search-mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{out}</>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const KIND: Record<TargetKind, { word: string; Icon: typeof Workflow }> = {
  process: { word: "Process", Icon: Workflow },
  standard: { word: "Standard", Icon: ShieldCheck },
};

/** Where a place inside a document opens. */
function hitHref(r: Result, h: Hit): string {
  if (r.kind === "process") return href({ page: "process", id: r.doc.id, tab: "flow", ...(h.where === "step" && h.item ? { item: h.item } : {}) });
  return href({ page: "standard", id: r.doc.id, tab: "doc", ...(h.where === "requirement" && h.item ? { item: h.item } : {}) });
}
const HIT_WORD: Record<Hit["where"], string> = { step: "Step", requirement: "Requirement", prerequisite: "Before you start", scope: "Scope" };

export function SearchPage({ route, processes, standards }: { route: SearchState; processes: Process[]; standards: Standard[] }) {
  const { catalog } = useCatalog();
  const drafts = useVisibleDrafts(); // in editor mode, the drafts the person may edit
  const filters = useMemo(() => filtersOf(route), [route]);
  const chosen = filterCount(filters);
  const q = route.q ?? "";

  // what is typed is in the address at once, without a new entry in the browser's history
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => { if (q !== pushed.current) { pushed.current = q; setText(q); } }, [q]);
  const type = (v: string) => {
    setText(v);
    pushed.current = v.trim() ? v : "";
    go({ page: "search", ...filters, q: v }, { replace: true });
  };
  const setFilters = (f: Filters) => go({ page: "search", q, ...f }, { replace: true });

  const words = useMemo(() => wordsOf(q), [q]);
  const out = useMemo(() => search({ processes, standards, catalog, q, filters, drafts }), [processes, standards, catalog, q, filters, drafts]);
  const withoutFilters = useMemo(() => (chosen && !out.results.length ? search({ processes, standards, catalog, q, drafts }).results.length : 0),
    [chosen, out, processes, standards, catalog, q, drafts]);

  const [open, setOpen] = useState(false); // the filters on a narrow screen
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [q, filters]);

  // the chosen filters, with their names
  const chips = FILTER_KEYS.flatMap((k) => out.options[k].filter((o) => o.chosen).map((o) => ({ key: k, option: o })));
  const n = out.results.length;

  return (
    <div className="page search-page">
      <h1 className="search-sr">Search processes and standards</h1>
      <SearchBox value={text} onChange={type} onSubmit={() => type(text)} autoFocus={!q && !chosen} />

      <div className="search-bar">
        <p className="search-count" role="status" aria-live="polite" aria-atomic="true">
          <b>{plural(n, "result")}</b>{q.trim() ? <> for “{q.trim()}”</> : null}{chosen ? <> with {plural(chosen, "filter")}</> : null}
        </p>
        <button type="button" className="btn small search-filter-toggle" aria-expanded={open} aria-controls="search-filters" onClick={() => setOpen(!open)}>
          <SlidersHorizontal size={14} />Filters{chosen ? ` (${chosen})` : ""}
        </button>
      </div>
      {chips.length > 0 && (
        <div className="search-chosen" role="group" aria-label="Chosen filters">
          {chips.map(({ key, option }) => (
            <button key={`${key}:${option.value}`} type="button" className="chip on" aria-label={`Remove filter ${FILTER_LABEL[key]}: ${option.label}`}
              onClick={() => setFilters(toggleFilter(filters, key, option.value))}>
              <span className="search-chip-key">{FILTER_LABEL[key]}:</span>{option.label}<X size={13} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="btn ghost small search-clear" onClick={() => setFilters({})}>Clear all filters</button>
        </div>
      )}

      <div className="search-layout">
        <aside id="search-filters" className={`search-filters ${open ? "open" : ""}`} aria-label="Filters">
          {FILTER_KEYS.map((k) => (
            <FilterGroup key={k} name={k} options={out.options[k]} onToggle={(v) => setFilters(toggleFilter(filters, k, v))} />
          ))}
        </aside>

        <section className="search-results" aria-label="Results">
          {n === 0 ? (
            <div className="search-empty">
              <h2>Nothing found</h2>
              {processes.length + standards.length === 0 ? <p className="muted">There are no processes or standards yet.</p> : (
                <>
                  <p className="muted">
                    {chosen ? (q.trim() ? `Nothing matches “${q.trim()}” with these filters.` : "Nothing matches these filters.") : `Nothing matches “${q.trim()}”.`}
                    {chosen > 0 && withoutFilters > 0 && ` Without the filters there ${withoutFilters === 1 ? "is 1 result" : `are ${withoutFilters} results`}.`}
                    {!chosen && words.length > 1 && " Every word must be found, so try fewer words."}
                    {!chosen && words.length <= 1 && " Check the spelling, or try another word."}
                  </p>
                  {chosen > 0 && (
                    <div className="btn-row">
                      {chips.map(({ key, option }) => (
                        <button key={`${key}:${option.value}`} type="button" className="btn small" onClick={() => setFilters(toggleFilter(filters, key, option.value))}>
                          <X size={13} />Without {FILTER_LABEL[key]}: {option.label}
                        </button>
                      ))}
                      <button type="button" className="btn small primary" onClick={() => setFilters({})}>Clear all filters</button>
                    </div>
                  )}
                  <p className="muted small search-empty-browse">
                    Or browse <a href={href({ page: "library" })}>all processes</a> and <a href={href({ page: "standards" })}>all standards</a>.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <ol className="search-list">
                {out.results.slice(0, shown).map((r) => <ResultRow key={`${r.kind}:${r.doc.id}`} r={r} words={words} />)}
              </ol>
              {n > shown && (
                <button type="button" className="btn search-more" onClick={() => setShown(shown + PAGE)}>
                  Show more ({n - shown} left)
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function FilterGroup({ name, options, onToggle }: { name: FilterKey; options: Option[]; onToggle: (value: string) => void }) {
  const id = useId();
  const shown = HIDE_EMPTY.includes(name) ? options.filter((o) => o.count > 0 || o.chosen) : options;
  if (!shown.length) return null;
  return (
    <fieldset className="search-facet" data-filter={name}>
      <legend id={id}>{FILTER_LABEL[name]}</legend>
      {shown.map((o) => {
        const off = o.count === 0 && !o.chosen;
        return (
          <label key={o.value} className={`search-option ${o.chosen ? "on" : ""} ${off ? "off" : ""}`}>
            <input type="checkbox" checked={o.chosen} disabled={off} onChange={() => onToggle(o.value)}
              aria-label={`${o.label}, ${o.count} ${o.count === 1 ? "result" : "results"}`} />
            <span className="search-option-name">{o.label}</span>
            <span className="search-option-count"><span className="search-sr">, </span>{o.count}<span className="search-sr">{o.count === 1 ? " result" : " results"}</span></span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ResultRow({ r, words }: { r: Result; words: string[] }) {
  const { catalog } = useCatalog();
  const { word, Icon } = KIND[r.kind];
  const d = r.doc;
  const name = (l: { id: string; name: string }[] | undefined, id?: string) => (id ? (l ?? []).find((x) => x.id === id)?.name ?? id : "");
  const labels: [string, string][] = [
    ["Category", name(catalog.categories, d.category)],
    ["Platform", name(catalog.platforms, d.platform)],
    ["Practice", name(catalog.practices, d.practice)],
  ];
  const rigour = rigourText(r);
  const top = (["mandatory", "recommended", "optional"] as const).find((x) => r.rigour[x]);
  const link = href(r.kind === "process" ? { page: "process", id: d.id, tab: "flow" } : { page: "standard", id: d.id, tab: "doc" });
  return (
    <li className={`search-result ${r.kind}`} data-kind={r.kind} data-id={d.id}>
      <span className="search-kind"><Icon size={14} aria-hidden="true" />{word}</span>
      <h2 className="search-result-title"><a href={link}><Marked text={d.title} words={words} /></a></h2>
      {d.summary && <p className="search-summary"><Marked text={d.summary} words={words} /></p>}
      <div className="card-tags search-tags">
        {d.status === "draft" && <span className="tier-tag status-draft">Draft</span>}
        {d.status === "deprecated" && <span className="tier-tag status-deprecated">Retired</span>}
        {rigour && <span className={`tier-tag search-rigour rigour-${top}`} title="Rigour">{rigour}</span>}
        {labels.filter(([, v]) => v).map(([k, v]) => (
          <span key={k} className="tier-tag"><span className="search-tag-key">{k}</span>{v}</span>
        ))}
        {d.owner && <span className="tier-tag"><span className="search-tag-key">Owner</span>{name(catalog.teams, d.owner)}</span>}
      </div>
      {r.hits.length > 0 && (
        <ul className="search-hits" aria-label={`Found in ${d.title}`}>
          {r.hits.map((h, i) => (
            <li key={`${h.where}:${h.item ?? i}`}>
              <a href={hitHref(r, h)}>
                <span className="search-hit-where">{HIT_WORD[h.where]}{h.where === "requirement" && h.item ? ` ${h.item}` : ""}</span>
                {h.where !== "scope" && <span className="search-hit-label"><Marked text={h.label} words={words} /></span>}
              </a>
              {h.snippet && <span className="search-hit-snippet"><Marked text={h.snippet} words={words} /></span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
