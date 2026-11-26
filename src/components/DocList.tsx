import { useEffect, useMemo, useRef, useState } from "react";
import type { DocMeta, Feedback, Process, Standard, TargetKind } from "../types";
import { useCatalog } from "../lib/catalog";
import { useEngagement } from "../lib/engagement";
import { needsReview } from "../lib/lifecycle";
import { pageOf, sizeOf, useListView, usePageSize } from "../lib/paging";
import { useProfile, useRemembered } from "../lib/profile";
import { canDraft, canManage, useMe, usePerms } from "../lib/session";
import { sortOf, useRememberedSort, sortResults, type SortKey } from "../lib/sorting";
import { FILTER_LABEL, filterCount, filtersOf, profileOptions, rigourFilterName, rigourOptionLabel, search, toggleFilter, wordsOf, type FilterKey, type Filters, type Flag } from "../lib/search";
import { go, parseRoute, type ListState } from "../lib/store";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard } from "./DocCard";
import { AskForIt, bookmarksUnknown, ChosenFilters, engagementKnown, FilterPanel, OrderControls, Pager, profileChosen, ResultsBar, ResultsFoot, SearchBox, toResults, useLinkFilters, type Chosen, type FlagControl } from "./Lists";

const KEYS: FilterKey[] = ["category", "platform", "practice", "rigour", "path", "pattern", "owner"];
const NOUN: Record<TargetKind, { one: string; many: string }> = { process: { one: "process", many: "processes" }, standard: { one: "standard", many: "standards" } };
const PLACEHOLDER: Record<TargetKind, string> = { process: "Search processes: GCP, repository, Akamai…", standard: "Search standards: logging, Terraform, SEC-LOG-01…" };
/** On a phone: the examples alone, short enough to be read whole (the heading says what is listed). */
const SHORT_PLACEHOLDER: Record<TargetKind, string> = { process: "e.g. GCP, repository, Akamai", standard: "e.g. logging, SEC-LOG-01" };

/**
 * The list of all processes, or all standards: the filters on the left, the cards, the pages.
 * The search, the filters, the page and a chosen order are in the address (`#/processes?q=…&
 * platform=…&page=2`, the same names as the search page), so that a list can be shared, reloaded
 * and come back to with Back. "Only my bookmarks" and "Only what needs a review" are remembered in
 * this browser tab; "My application" and the page size in this browser.
 */
export function DocList({ kind, processes, standards, standardIds, feedback, empty, meta }: {
  kind: TargetKind;
  /** All processes: listed for "process", and what a standard may refer to. */
  processes: Process[];
  /** The standards listed (for "standard"). */
  standards: Standard[];
  /** The ids of all standards, which a process or standard may refer to. */
  standardIds: string[];
  feedback: Record<string, Feedback[]>;
  /** What to say when there is nothing at all yet. */
  empty: string;
  /** What the server says about each one listed (dates, unpublished changes), by id. */
  meta?: Record<string, DocMeta | undefined>;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const me = useMe();
  const eng = useEngagement();
  const known = engagementKnown(eng);
  const list = kind === "process" ? "processes" : "standards";
  const page = kind === "process" ? "library" : "standards";
  // the address is the truth; the app re-renders this page whenever it changes
  const route = parseRoute(location.hash) as ListState & { page: string };
  const state: ListState = route.page === page ? route : {};
  const q = state.q ?? "";
  const linkFilters = useMemo(() => filtersOf(state), [JSON.stringify(state)]); // eslint-disable-line react-hooks/exhaustive-deps
  // an old link may name a filter value that no longer exists: it is left out, and the address corrected
  const { filters, notice } = useLinkFilters(linkFilters, kind === "process" ? processes : standards, (f) => setFilters(f));
  const [bookmarked, setBookmarked] = useRemembered(`pm:${list}:bookmarked`, false);
  const [due, setDue] = useRemembered(`pm:${list}:review`, false);
  const [profile, setProfile] = useProfile();
  const [mySize, setMySize] = usePageSize();
  const size = state.size ? sizeOf(state.size) : mySize;
  const [mySort, setMySort] = useRememberedSort(list, me.user?.email);
  const sort: SortKey = state.sort ? sortOf(state.sort) : mySort;
  const [view, setView] = useListView(me.user?.email);
  const [open, setOpen] = useState(false);
  const results = useRef<HTMLElement>(null);
  // who may change it, if only as a draft (a member of its platform or practice), sees whether it needs fixing
  const mayEdit = (d: Process | Standard) => canDraft(perms, kind, d);
  // who looks after it (edits it, or owns the team that maintains it) sees where its review stands
  const manages = (d: Process | Standard) => canManage(perms, kind, d);

  // what stays in the address when something else changes
  const keep = { ...(state.size ? { size: state.size } : {}), ...(state.sort ? { sort: state.sort } : {}) };
  const to = (s: ListState, replace = true) => go({ page, ...s } as never, { replace });
  // what is typed is in the address at once (a new search starts on the first page)
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => { if (q !== pushed.current) { pushed.current = q; setText(q); } }, [q]);
  const type = (v: string) => { setText(v); pushed.current = v.trim() ? v : ""; to({ q: v, ...filters, ...keep }); };
  const setQ = (v: string) => { setText(v); pushed.current = v; to({ q: v, ...filters, ...keep }); };
  const setFilters = (f: Filters) => to({ q, ...f, ...keep });
  const toFirst = () => { if (state.pageNo) to({ q, ...filters, ...keep }); };

  const flags: Record<string, Flag> = {
    // while the bookmarks are not known, "only my bookmarks" waits instead of showing nothing
    bookmarked: { on: bookmarked && known, test: (k, d) => eng.isBookmarked(k, d.id) },
    review: { on: due, test: (_k: TargetKind, d: Process | Standard) => manages(d) && needsReview(d, meta?.[d.id]) },
  };
  // the server sends a never-published draft only to whoever may see it
  const input = {
    processes: kind === "process" ? processes : [], standards: kind === "standard" ? standards : [],
    catalog, q, filters, drafts: true, profile, flags,
  };
  const out = search(input);
  const mine = profileOptions(input);
  const sorted = useMemo(() => sortResults(out.results, sort, { [kind]: meta }), [out.results, sort, kind, meta]);
  const words = useMemo(() => wordsOf(q), [q]);
  const n = out.results.length;
  const pg = pageOf(n, state.pageNo ?? 1, size);
  const goTo = (p: number) => { to({ q, ...filters, ...keep, pageNo: p }, false); toResults(results.current); };
  const changeSize = (s: number) => { setMySize(s); to({ q, ...filters, ...keep, size: s }); };
  const changeSort = (k: SortKey) => { setMySort(k); to({ q, ...filters, ...(state.size ? { size: state.size } : {}), ...(k ? { sort: k } : {}) }); };

  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds, catalog }), [processes, standardIds, catalog]);
  const broken = (d: Process | Standard) => hasErrors(kind === "process" ? validateProcess(d, ids) : validateStandard(d, ids));
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === id)).length;

  const flagControls: FlagControl[] = [
    { key: "bookmarked", label: "Only my bookmarks", count: out.flags.bookmarked ?? 0, on: bookmarked, onChange: (v) => { setBookmarked(v); toFirst(); }, unknown: bookmarksUnknown(eng) },
  ];
  // offered to whoever has something to look after that is due
  if ((out.flags.review ?? 0) > 0 || due) flagControls.push({ key: "review", label: "Only what needs a review", count: out.flags.review ?? 0, on: due, onChange: (v) => { setDue(v); toFirst(); } });

  const chosen: Chosen[] = [
    ...(q.trim() ? [{ key: "q", name: "Search", value: q.trim(), remove: () => setQ("") }] : []),
    ...(bookmarked ? [{ key: "bookmarked", name: "Bookmarks", value: "only mine", remove: () => { setBookmarked(false); toFirst(); } }] : []),
    ...(due ? [{ key: "review", name: "Review", value: "due or overdue", remove: () => { setDue(false); toFirst(); } }] : []),
    ...KEYS.flatMap((k) => out.options[k].filter((o) => o.chosen).map((o) => ({
      key: `${k}:${o.value}`, name: k === "rigour" ? rigourFilterName(kind) : FILTER_LABEL[k],
      value: k === "rigour" ? rigourOptionLabel(o.value as never, kind) : o.label, remove: () => setFilters(toggleFilter(filters, k, o.value)),
    }))),
    ...profileChosen(profile, (p) => { setProfile(p); toFirst(); }, catalog),
  ];
  const clear = () => { setText(""); pushed.current = ""; setBookmarked(false); setDue(false); setProfile({}); to({ ...keep }); };
  const nothing = kind === "process" ? processes.length === 0 : standards.length === 0;
  const panelId = `${kind}-filters`;
  // nothing found and nothing chosen to blame: no filters, order or pages to offer
  const bare = n === 0 && filterCount(filters) === 0 && !bookmarked && !due && !(profile.tier || profile.path || profile.environment || profile.language);

  return (
    <>
      <SearchBox big live value={text} onChange={type} placeholder={PLACEHOLDER[kind]} shortPlaceholder={SHORT_PLACEHOLDER[kind]} label={kind === "process" ? "Search processes" : "Search standards"} />
      <div className={`list-layout ${bare ? "no-panel" : ""}`.trim()}>
        <div className="list-head">
          <ResultsBar page={pg} noun={NOUN[kind]} panelId={panelId} open={open} onOpen={setOpen} chosen={chosen.length} size={size} onSize={changeSize}
            sort={sort} onSort={changeSort} searched={!!q.trim()} view={view} onView={setView} bare={n === 0}
            pager={<Pager page={pg} onPage={goTo} label={`Pages of ${NOUN[kind].many}`} compact />} />
          {notice}
          {/* nothing found: the empty state holds the one "Clear all filters" */}
          <ChosenFilters chosen={chosen} onClear={clear} clearAll={n > 0} />
        </div>
        {!bare && (
          <FilterPanel id={panelId} open={open} keys={KEYS} options={out.options} onToggle={(k, v) => setFilters(toggleFilter(filters, k, v))}
            flags={flagControls} profile={profile} onProfile={(p) => { setProfile(p); toFirst(); }} profileOptions={mine} subject={kind} total={n}
            order={<OrderControls sort={sort} onSort={changeSort} searched={!!q.trim()} size={size} onSize={changeSize} />}
            done={{ label: `Show ${n} ${n === 1 ? NOUN[kind].one : NOUN[kind].many}`, onClick: () => { setOpen(false); toResults(results.current); } }} />
        )}
        <section className="list-results" aria-label="Results" ref={results} tabIndex={-1}>
          {n === 0 ? (
            <div className="list-empty">
              <p>{nothing ? empty : `No ${NOUN[kind].one} matches.`}</p>
              {!nothing && chosen.length > 0 && <button type="button" className="btn small" onClick={clear}>Clear all filters</button>}
              <AskForIt />
            </div>
          ) : (
            <ol className={`cards ${view === "rows" ? "rows" : ""}`.trim()}>
              {sorted.slice(pg.start, pg.end).map((r) => {
                const edits = mayEdit(r.doc);
                return (
                  <DocCard key={r.doc.id} kind={kind} doc={r.doc} rigour={r.rigour} rules={r.rules} hits={r.hits} words={words} showKind={false} view={view}
                    openFeedback={openCount(feedback[r.doc.id] ?? [])} mayEdit={edits} manages={manages(r.doc)} broken={edits && broken(r.doc)}
                    usedBy={kind === "process" ? usedBy(r.doc.id) : undefined} meta={meta?.[r.doc.id]} />
                );
              })}
            </ol>
          )}
          <ResultsFoot page={pg} onPage={goTo} label={`Pages of ${NOUN[kind].many}, at the end`} size={size} onSize={changeSize} />
        </section>
      </div>
    </>
  );
}
