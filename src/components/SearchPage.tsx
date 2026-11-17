import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { FeedbackByTarget, Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { useEngagement } from "../lib/engagement";
import { useEditor } from "../lib/mode";
import { pageOf, sizeOf, usePageSize } from "../lib/paging";
import { useProfile, useRemembered } from "../lib/profile";
import { canEdit, usePerms, useVisibleDrafts } from "../lib/session";
import { go, href, type SearchState } from "../lib/store";
import { FILTER_LABEL, filterCount, filtersOf, search, toggleFilter, wordsOf, type FilterKey, type Filters, type Flag } from "../lib/search";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard, Marked } from "./DocCard";
import { needsReview } from "./DocList";
import { AskForIt, ChosenFilters, FilterPanel, Pager, profileChosen, ResultsBar, toResults, type Chosen, type FlagControl } from "./Lists";
import "../search.css";

export { Marked };

const PLACEHOLDER = "Search processes and standards, e.g. GCP project or logging";
const KEYS: FilterKey[] = ["type", "category", "platform", "practice", "rigour", "owner"];

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SearchPage({ route, processes, standards, feedback }: {
  route: SearchState; processes: Process[]; standards: Standard[];
  /** Open feedback per process and standard, for the cards. */
  feedback?: FeedbackByTarget;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editing = useEditor();
  const eng = useEngagement();
  const drafts = useVisibleDrafts(); // in editor mode, the drafts the person may edit
  const filters = useMemo(() => filtersOf(route), [route]);
  const q = route.q ?? "";
  const [profile, setProfile] = useProfile();
  const [bookmarked, setBookmarked] = useRemembered("pm:search:bookmarked", false);
  const [due, setDue] = useState(false);
  const [mySize, setMySize] = usePageSize();
  // a shared link shows the same page: the address carries the page and its size
  const size = route.size ? sizeOf(route.size) : mySize;
  const keep = route.size ? { size: route.size } : {};
  const mayEdit = (kind: "process" | "standard", d: Process | Standard) => editing && canEdit(perms, kind, d);

  // what is typed is in the address at once, without a new entry in the browser's history
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => { if (q !== pushed.current) { pushed.current = q; setText(q); } }, [q]);
  const type = (v: string) => {
    setText(v);
    pushed.current = v.trim() ? v : "";
    go({ page: "search", ...filters, q: v, ...keep }, { replace: true });
  };
  // a new search or filter starts again on the first page (the address leaves the page out)
  const setFilters = (f: Filters) => go({ page: "search", q, ...f, ...keep }, { replace: true });
  const toFirst = () => { if (route.pageNo) go({ page: "search", q, ...filters, ...keep }, { replace: true }); };

  const flags: Record<string, Flag> = {
    bookmarked: { on: bookmarked, test: (k, d) => eng.isBookmarked(k, d.id) },
    ...(editing ? { review: { on: due, test: (k: "process" | "standard", d: Process | Standard) => mayEdit(k, d) && needsReview(d) } } : {}),
  };
  const words = useMemo(() => wordsOf(q), [q]);
  const out = search({ processes, standards, catalog, q, filters, drafts, profile, flags });
  const anyChosen = filterCount(filters) > 0 || bookmarked || due || !!(profile.tier || profile.environment || profile.language);
  const withoutFilters = anyChosen && !out.results.length ? search({ processes, standards, catalog, q, drafts }).results.length : 0;

  const [open, setOpen] = useState(false); // the filters on a narrow screen
  const results = useRef<HTMLElement>(null);
  const n = out.results.length;
  const page = pageOf(n, route.pageNo ?? 1, size);
  const goTo = (p: number) => {
    go({ page: "search", q, ...filters, pageNo: p, size });
    toResults(results.current);
  };
  const changeSize = (s: number) => {
    setMySize(s);
    go({ page: "search", q, ...filters, size: s }, { replace: true });
  };

  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [processes, standards, catalog]);
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === id)).length;

  const flagControls: FlagControl[] = [
    { key: "bookmarked", label: "Only my bookmarks", count: out.flags.bookmarked ?? 0, on: bookmarked, onChange: (v) => { setBookmarked(v); toFirst(); } },
  ];
  if (editing && ((out.flags.review ?? 0) > 0 || due)) flagControls.push({ key: "review", label: "Only what needs a review", count: out.flags.review ?? 0, on: due, onChange: (v) => { setDue(v); toFirst(); } });
  const changeProfile = (p: typeof profile) => { setProfile(p); toFirst(); };

  const chosen: Chosen[] = [
    ...(bookmarked ? [{ key: "bookmarked", name: "Bookmarks", value: "only mine", remove: () => { setBookmarked(false); toFirst(); } }] : []),
    ...(due ? [{ key: "review", name: "Review", value: "due or overdue", remove: () => { setDue(false); toFirst(); } }] : []),
    ...KEYS.flatMap((k) => out.options[k].filter((o) => o.chosen).map((o) => ({
      key: `${k}:${o.value}`, name: FILTER_LABEL[k], value: o.label, remove: () => setFilters(toggleFilter(filters, k, o.value)),
    }))),
    ...profileChosen(profile, changeProfile, catalog),
  ];
  const clear = () => { setBookmarked(false); setDue(false); setProfile({}); setFilters({}); };
  const summary = <>{q.trim() ? <> for “{q.trim()}”</> : null}{chosen.length ? <> with {plural(chosen.length, "filter")}</> : null}</>;

  return (
    <div className="page search-page">
      <h1 className="sr-only">Search processes and standards</h1>
      <SearchBox value={text} onChange={type} onSubmit={() => type(text)} autoFocus={!q && !chosen.length} />

      <div className="list-layout">
        <div className="list-head">
          <ResultsBar page={page} noun={{ one: "result", many: "results" }} panelId="search-filters" open={open} onOpen={setOpen}
            chosen={chosen.length} size={size} onSize={changeSize} extra={summary} />
          <ChosenFilters chosen={chosen} onClear={clear} />
          <Pager page={page} onPage={goTo} label="Pages of results" compact />
        </div>
        <FilterPanel id="search-filters" open={open} keys={KEYS} options={out.options} onToggle={(k, v) => setFilters(toggleFilter(filters, k, v))}
          flags={flagControls} profile={profile} onProfile={changeProfile} />
        <section className="list-results" aria-label="Results" ref={results} tabIndex={-1}>
          {n === 0 ? (
            <div className="list-empty search-empty">
              <h2>Nothing found</h2>
              {processes.length + standards.length === 0 ? <p className="muted">There are no processes or standards yet.</p> : (
                <>
                  <p className="muted">
                    {chosen.length ? (q.trim() ? `Nothing matches “${q.trim()}” with these filters.` : "Nothing matches these filters.") : `Nothing matches “${q.trim()}”.`}
                    {chosen.length > 0 && withoutFilters > 0 && ` Without the filters there ${withoutFilters === 1 ? "is 1 result" : `are ${withoutFilters} results`}.`}
                    {!chosen.length && words.length > 1 && " Every word must be found, so try fewer words."}
                    {!chosen.length && words.length <= 1 && " Check the spelling, or try another word."}
                  </p>
                  {chosen.length > 0 && (
                    <div className="btn-row">
                      {chosen.map((c) => (
                        <button key={c.key} type="button" className="btn small" onClick={c.remove}><X size={13} />Without {c.name}: {c.value}</button>
                      ))}
                      <button type="button" className="btn small primary" onClick={clear}>Clear all filters</button>
                    </div>
                  )}
                  <p className="muted small search-empty-browse">
                    Or browse <a href={href({ page: "library" })}>all processes</a> and <a href={href({ page: "standards" })}>all standards</a>.
                  </p>
                  <AskForIt />
                </>
              )}
            </div>
          ) : (
            <ol className="cards">
              {out.results.slice(page.start, page.end).map((r) => {
                const mine = mayEdit(r.kind, r.doc);
                const broken = mine && hasErrors(r.kind === "process" ? validateProcess(r.doc, ids) : validateStandard(r.doc, ids));
                return (
                  <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} hits={r.hits} words={words}
                    openFeedback={openCount(feedback?.[r.kind]?.[r.doc.id] ?? [])} mayEdit={mine} broken={broken}
                    usedBy={r.kind === "process" ? usedBy(r.doc.id) : undefined} />
                );
              })}
            </ol>
          )}
          <Pager page={page} onPage={goTo} label="Pages of results, at the end" />
        </section>
      </div>
    </div>
  );
}
