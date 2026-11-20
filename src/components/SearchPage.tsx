import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Blend, CircleHelp, SearchX, Sparkles, Type } from "lucide-react";
import type { FeedbackByTarget, Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { useEngagement } from "../lib/engagement";
import { pageOf, sizeOf, useListView, usePageSize } from "../lib/paging";
import { useProfile, useRemembered } from "../lib/profile";
import { canEdit, canManage, useMe, usePerms } from "../lib/session";
import { sortOf, sortResults, type MetaByKind, type SortKey } from "../lib/sorting";
import { closestWanted, emptyWithFilters, noWordsText, otherWay, type ClosestOutcome, contentStamp, fromMeaning, fuse, markedWords, meaningHelp, modeLine, modeOf, needsServer, planOf, providerOf, rememberMode, SEARCH_MODES, truncatedText, typingMovesAddress, useMeaningSearch, type Found, type Provider, type SearchMode } from "../lib/meaning";
import { go, href, type SearchState } from "../lib/store";
import { countText, FILTER_LABEL, filterCount, filtersOf, profileOptions, rigourOptionLabel, search, toggleFilter, typeTab, withTypeTab, wordsOf, type FilterKey, type Filters, type Flag } from "../lib/search";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard, Marked } from "./DocCard";
import { needsReview } from "../lib/lifecycle";
import { AskForIt, bookmarksUnknown, ChosenFilters, engagementKnown, FilterPanel, OrderControls, Pager, profileChosen, ResultsBar, ResultsFoot, SearchBox, toResults, TypeTabs, useLinkFilters, type Chosen, type FlagControl } from "./Lists";
import "../search.css";

export { Marked };

/** The filters of the panel; the type is chosen with the tabs above the results. */
const KEYS: FilterKey[] = ["category", "platform", "practice", "rigour", "owner"];

/** The one search box, on Home and on the results page (it lives with the lists, which use it too). */
export { SearchBox };

const MODE_LABEL: Record<SearchMode, string> = { words: "Words", meaning: "Meaning", both: "Both" };
const MODE_ICON: Record<SearchMode, typeof Type> = { words: Type, meaning: Sparkles, both: Blend };

/**
 * "Search by": Words, Meaning, Both. One choice of three, like radio buttons: the arrow keys move
 * the choice, Tab leaves the group; the choice is announced.
 */
export function SearchModeSwitch({ mode, onChange, provider }: { mode: SearchMode; onChange: (m: SearchMode) => void; provider?: Provider }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [help, setHelp] = useState(false);
  const onKey = (e: KeyboardEvent) => {
    const at = SEARCH_MODES.indexOf(mode);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % SEARCH_MODES.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at + SEARCH_MODES.length - 1) % SEARCH_MODES.length
      : e.key === "Home" ? 0 : e.key === "End" ? SEARCH_MODES.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(SEARCH_MODES[to]);
    refs.current[SEARCH_MODES[to]]?.focus();
  };
  return (
    <div className={`search-mode ${help ? "help-open" : ""}`.trim()}>
      <div className="search-mode-row">
        <span className="search-mode-name sr-only" id="search-mode-name">Search by</span>
        <div className="seg search-mode-choices" role="radiogroup" aria-labelledby="search-mode-name" aria-describedby="search-mode-help search-mode-outside" onKeyDown={onKey}>
          {SEARCH_MODES.map((m) => {
            const Icon = MODE_ICON[m];
            return (
              <button key={m} ref={(el) => { refs.current[m] = el; }} type="button" role="radio" aria-checked={m === mode} tabIndex={m === mode ? 0 : -1}
                className={`seg-item ${m === mode ? "on" : ""}`.trim()} data-mode={m} title={modeLine(m, provider)} onClick={() => onChange(m)}>
                <Icon size={14} aria-hidden="true" />{MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
        <button type="button" className="search-mode-more" aria-expanded={help} aria-controls="search-mode-help" onClick={() => setHelp(!help)} title="How this works">
          <CircleHelp size={16} aria-hidden="true" /><span className="search-mode-more-word">How this works</span>
        </button>
      </div>
      <div className="search-mode-help-box" id="search-mode-help" hidden={!help}>
        <ul className="search-mode-help">
          <li><b>Words</b> finds what contains every word you type.</li>
          <li className="search-mode-meaning" data-provider={provider ?? "unknown"}><b>Meaning</b> {meaningHelp(provider)}</li>
          <li><b>Both</b> shows what either finds, the best of each first.</li>
        </ul>
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const n0 = (o: { results: unknown[] }) => o.results.length === 0;

export function SearchPage({ route, processes, standards, feedback, meta }: {
  route: SearchState; processes: Process[]; standards: Standard[];
  /** Open feedback per process and standard, for the cards. */
  feedback?: FeedbackByTarget;
  /** What the server says about each process and standard (dates, unpublished changes). */
  meta?: MetaByKind;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const eng = useEngagement();
  const known = engagementKnown(eng);
  // the server sends a never-published draft only to whoever may see it
  const drafts = true;
  const linkFilters = useMemo(() => filtersOf(route), [route]);
  const docs = useMemo(() => [...processes, ...standards], [processes, standards]);
  // an old link may name a filter value that no longer exists: it is left out, and the address corrected
  const { filters, notice } = useLinkFilters(linkFilters, docs, (f) => setFilters(f));
  const q = route.q ?? "";
  const [profile, setProfile] = useProfile();
  const [bookmarked, setBookmarked] = useRemembered("pm:search:bookmarked", false);
  const [due, setDue] = useState(false);
  const [mySize, setMySize] = usePageSize();
  // a shared link shows the same page: the address carries the page and its size
  const size = route.size ? sizeOf(route.size) : mySize;
  const sort: SortKey = sortOf(route.sort);
  // what stays in the address when something else changes: the page size and the order
  const keep = { ...(route.size ? { size: route.size } : {}), ...(sort ? { sort } : {}) };
  const mayEdit = (kind: "process" | "standard", d: Process | Standard) => canEdit(perms, kind, d);
  const manages = (kind: "process" | "standard", d: Process | Standard) => canManage(perms, kind, d);

  // search by meaning: offered when the server has it switched on (and has not switched it off since)
  const me = useMe();
  const [off, setOff] = useState(false);
  const offered = !!me.search?.meaning && !off;
  const mode: SearchMode = offered ? modeOf(route.mode) : "words";
  const modeParam = mode === "words" ? {} : { mode };
  // the query sent to the server is the one in the address: with Meaning and Both the address
  // changes only when the search is run (Enter, the button, a change of mode), not while typing
  const asked = q.trim();
  const [attempt, setAttempt] = useState(0); // Search again with the same words asks again (after a problem)
  // answers are kept per query and per content: after a save or a reload the next search asks again
  const stamp = useMemo(() => contentStamp(processes, standards), [processes, standards]);
  const meaning = useMeaningSearch(asked, needsServer(mode, asked, offered), attempt, stamp);
  useEffect(() => { if (meaning.problem?.kind === "off") setOff(true); }, [meaning.problem]);

  // what is typed is in the address at once, without a new entry in the browser's history
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  // what a person asked for on purpose (Enter, Search, a link): only then is the server asked
  // for the closest by meaning when words find nothing, never while typing
  const [submitted, setSubmitted] = useState(q.trim());
  useEffect(() => {
    // the address changed from elsewhere (Back, a link): the box shows what it says
    if (q !== pushed.current) { pushed.current = q; setText(q); setSubmitted(q.trim()); }
  }, [q]);
  // writes the words to the address: the search is run with them
  const run = (v: string, m: SearchMode = mode) => {
    pushed.current = v.trim() ? v : "";
    go({ page: "search", ...filters, q: v, ...keep, ...(m === "words" ? {} : { mode: m }) }, { replace: true });
  };
  // with Words the results follow the typing; with Meaning and Both the typing waits for Search
  const type = (v: string) => { setText(v); if (typingMovesAddress(mode, offered)) run(v); };
  const submit = () => { run(text); setSubmitted(text.trim()); setAttempt((n) => n + 1); };
  const setMode = (m: SearchMode) => {
    rememberMode(me.user?.email, m);
    run(text, m);
    setAttempt((n) => n + 1);
  };
  // a new search or filter starts again on the first page (the address leaves the page out)
  const setFilters = (f: Filters) => go({ page: "search", q, ...f, ...keep, ...modeParam }, { replace: true });
  const toFirst = () => { if (route.pageNo) go({ page: "search", q, ...filters, ...keep, ...modeParam }, { replace: true }); };

  const flags: Record<string, Flag> = {
    // while the bookmarks are not known, "only my bookmarks" waits instead of showing nothing
    bookmarked: { on: bookmarked && known, test: (k, d) => eng.isBookmarked(k, d.id) },
    review: { on: due, test: (k: "process" | "standard", d: Process | Standard) => manages(k, d) && needsReview(d, meta?.[k]?.[d.id]) },
  };
  const plan = planOf(mode, q, asked, offered, meaning);
  const shownQ = plan.q;
  const words = useMemo(() => (plan.show === "words" ? wordsOf(shownQ) : markedWords(wordsOf(shownQ))), [shownQ, plan.show]);
  // by meaning, and both ways: what was found, in its order; the filters, counts and pages work on it as on a word search
  const found = useMemo((): Found[] | undefined => {
    if (plan.show === "words") return undefined;
    if (plan.show === "none") return [];
    const byKey = new Map<string, Process | Standard>([...processes.map((p) => [`process:${p.id}`, p] as const), ...standards.map((d) => [`standard:${d.id}`, d] as const)]);
    const byMeaning = fromMeaning(plan.meaning, (k, id) => byKey.get(`${k}:${id}`));
    if (plan.show === "meaning") return byMeaning;
    const byWords = search({ processes, standards, catalog, q: shownQ, drafts, profile }).results
      .map((r): Found => ({ kind: r.kind, id: r.doc.id, score: r.score, hits: r.hits, by: ["words"] }));
    return fuse(byWords, byMeaning);
  }, [plan.show, plan.meaning, shownQ, processes, standards, catalog, drafts, profile]);
  const input = { processes, standards, catalog, q: shownQ, filters, drafts, profile, flags, found };
  const out = search(input);

  // by meaning (and both ways) the order is the best match the server gave, unless another is chosen
  const sorted = useMemo(() => sortResults(out.results, sort, meta), [out.results, sort, meta]);
  const anyChosen = filterCount(filters) > 0 || bookmarked || due || !!(profile.tier || profile.environment || profile.language);
  const withoutFilters = anyChosen && !out.results.length ? search({ processes, standards, catalog, q: shownQ, drafts, found }).results.length : 0;
  // drafts are not searched by meaning: an editor with drafts of their own is told where to find them
  const ownDrafts = processes.some((d) => d.status === "draft") || standards.some((d) => d.status === "draft");
  // the results are of an earlier search than what is in the box now
  const earlier = mode !== "words" && offered && !plan.busy && text.trim() !== shownQ.trim();
  // the server sent only the closest of more that matched: the counts are "at least"
  const truncated = plan.truncated && plan.show !== "words" && plan.show !== "none";

  // words found nothing (whatever the filters and "My application"): on a search asked for on purpose, the closest by meaning
  const wordHits = plan.show === "words" && asked ? search({ processes, standards, catalog, q: asked, drafts }).results.length : -1;
  // (words found nothing at all, whatever the filters: the closest are looked for, and the type tabs,
  // the filters and "My application" narrow them as they narrow any results)
  const filtered = filterCount(filters) > 0 || bookmarked || due;
  const wantClosest = closestWanted({ mode, offered, asked, submitted, wordHits });
  const closestState = useMeaningSearch(asked, wantClosest, attempt, stamp);
  const closestFound = useMemo(() => {
    if (!wantClosest || closestState.for !== asked || closestState.loading || !closestState.answer || closestState.answer.query !== asked) return null;
    const byKey = new Map<string, Process | Standard>([...processes.map((p) => [`process:${p.id}`, p] as const), ...standards.map((d) => [`standard:${d.id}`, d] as const)]);
    return fromMeaning(closestState.answer.results, (k, id) => byKey.get(`${k}:${id}`));
  }, [wantClosest, closestState, asked, processes, standards]);
  // how many came close at all (with "My application", which is kept for good), and those the filters leave
  const closestAll = useMemo(() => (closestFound ? search({ processes, standards, catalog, drafts, profile, found: closestFound }).results.length : 0), [closestFound, processes, standards, catalog, drafts, profile]);
  const closestIn = closestFound ? { ...input, found: closestFound } : null;
  const closestOut = closestIn ? search(closestIn) : null;
  const closest = closestOut ? closestOut.results : null;
  const closestWords = useMemo(() => markedWords(wordsOf(asked)), [asked]);
  const closestOutcome: ClosestOutcome = !wantClosest ? "not-tried" : closestState.problem ? "problem" : closest === null ? "waiting" : closestAll ? "found" : "nothing";
  // words found nothing and the closest by meaning are shown (or looked for): the tabs and the filters work on them
  const closestShown = n0(out) && (closestOutcome === "waiting" || closestOutcome === "found");
  const shownOut = closestShown && closestOut ? closestOut : out;

  // the tabs: how many results each kind gives with everything else as chosen
  const tab = typeTab(filters);
  const kindCount = (k: string) => shownOut.options.type.find((o) => o.value === k)?.count ?? 0;
  const tabCounts = { "": kindCount("process") + kindCount("standard"), process: kindCount("process"), standard: kindCount("standard") };
  // nothing of the chosen kind, but something of the other: the tab is what hides it
  const otherKind = tab && shownOut.results.length === 0 ? tabCounts[""] : 0;

  const [view, setView] = useListView(me.user?.email);
  const [open, setOpen] = useState(false); // the filters on a narrow screen
  const results = useRef<HTMLElement>(null);
  const n = out.results.length;
  const page = pageOf(n, route.pageNo ?? 1, size);
  const goTo = (p: number) => {
    go({ page: "search", q, ...filters, pageNo: p, size, ...(sort ? { sort } : {}), ...modeParam });
    toResults(results.current);
  };
  const changeSize = (s: number) => {
    setMySize(s);
    go({ page: "search", q, ...filters, size: s, ...(sort ? { sort } : {}), ...modeParam }, { replace: true });
  };
  // a new order starts again on the first page
  const changeSort = (k: SortKey) => go({ page: "search", q, ...filters, ...(route.size ? { size: route.size } : {}), ...(k ? { sort: k } : {}), ...modeParam }, { replace: true });

  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [processes, standards, catalog]);
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === id)).length;

  const mine = profileOptions(closestShown && closestIn ? closestIn : input);
  const flagControls: FlagControl[] = [
    { key: "bookmarked", label: "Only my bookmarks", count: shownOut.flags.bookmarked ?? 0, on: bookmarked, onChange: (v) => { setBookmarked(v); toFirst(); }, unknown: bookmarksUnknown(eng) },
  ];
  if ((shownOut.flags.review ?? 0) > 0 || due) flagControls.push({ key: "review", label: "Only what needs a review", count: shownOut.flags.review ?? 0, on: due, onChange: (v) => { setDue(v); toFirst(); } });
  const changeProfile = (p: typeof profile) => { setProfile(p); toFirst(); };

  const chosen: Chosen[] = [
    ...(bookmarked ? [{ key: "bookmarked", name: "Bookmarks", value: "only mine", remove: () => { setBookmarked(false); toFirst(); } }] : []),
    ...(due ? [{ key: "review", name: "Review", value: "due or overdue", remove: () => { setDue(false); toFirst(); } }] : []),
    ...KEYS.flatMap((k) => shownOut.options[k].filter((o) => o.chosen).map((o) => ({
      key: `${k}:${o.value}`, name: FILTER_LABEL[k], value: k === "rigour" ? rigourOptionLabel(o.value as never, "any") : o.label, remove: () => setFilters(toggleFilter(filters, k, o.value)),
    }))),
    ...profileChosen(profile, changeProfile, catalog),
  ];
  const clear = () => { setBookmarked(false); setDue(false); setProfile({}); setFilters({}); };
  // nothing found and nothing chosen to blame: no tabs, filters, order or pages to offer
  const bare = n === 0 && !anyChosen && !plan.busy && !closestShown;
  // nothing found: nothing to order or page through (the chosen filters stay, with a way to remove them)
  const noTools = n === 0 && !plan.busy && !closestShown;
  // how many the panel and the tabs speak of: the results, or the closest by meaning that the filters leave
  const shownN = closestShown ? (closest?.length ?? 0) : n;
  const other = otherWay({ offered, q: shownQ, show: plan.show, mode, filtered, closest: closestOutcome });
  const summary = <>{shownQ.trim() ? <> for “{shownQ.trim()}”</> : null}{chosen.length ? <> with {plural(chosen.length, "filter")}</> : null}</>;
  // the line above says so, instead of a count of none
  const closestLine = closestShown ? <>No exact match for “{shownQ.trim()}”.{closestOutcome === "found" && closest?.length ? " Closest by meaning:" : ""}</> : undefined;
  // nothing found, but the filters hide what there is: the empty state offers the one "Clear all filters"
  const clearsInEmpty = n === 0 && !plan.busy && !closestShown && otherKind === 0 && chosen.length > 0 && withoutFilters > 0;

  return (
    <div className="page search-page">
      <h1 className="sr-only">Search processes and standards</h1>
      <div className="search-head">
        <SearchBox big value={text} onChange={type} onSubmit={submit} autoFocus={!q && !chosen.length} />
        {offered && <SearchModeSwitch mode={mode} onChange={setMode} provider={providerOf(me.search?.provider)} />}
      </div>
      {/* a fact about privacy, not help: visible before Meaning or Both is chosen */}
      {offered && me.search?.outside && <p className="search-mode-outside" id="search-mode-outside">With Meaning and Both, what you type is sent to Google Cloud to be compared.</p>}

      <div className={`list-layout ${bare ? "no-panel" : ""}`.trim()}>
        <div className="list-head">
          {(!noTools || !!tab) && <TypeTabs value={tab} counts={tabCounts} atLeast={truncated} onChange={(t) => setFilters(withTypeTab(filters, t))} />}
          <ResultsBar page={page} noun={{ one: "result", many: "results" }} panelId="search-filters" open={open} onOpen={setOpen}
            chosen={chosen.length} size={size} onSize={changeSize} extra={summary} line={closestLine}
            sort={sort} onSort={changeSort} searched={!!shownQ.trim()} view={view} onView={setView} bare={noTools} unordered={closestShown}
            pager={<Pager page={page} onPage={goTo} label="Pages of results" compact />} />
          {truncated && <p className="search-truncated">{truncatedText(plan.meaning.length)}</p>}
          {notice}
          <ChosenFilters chosen={chosen} onClear={clear} clearAll={!clearsInEmpty} />
        </div>
        {!bare && (
          <FilterPanel id="search-filters" open={open} keys={KEYS} options={shownOut.options} onToggle={(k, v) => setFilters(toggleFilter(filters, k, v))}
            flags={flagControls} profile={profile} onProfile={changeProfile} profileOptions={mine} subject="any" total={shownN} atLeast={truncated}
            order={closestShown ? undefined : <OrderControls sort={sort} onSort={changeSort} searched={!!shownQ.trim()} size={size} onSize={changeSize} />}
            done={{ label: `Show ${countText(shownN, truncated)} ${shownN === 1 ? "result" : "results"}`, onClick: () => { setOpen(false); toResults(results.current); } }} />
        )}
        <section className="list-results" aria-label="Results" ref={results} tabIndex={-1} aria-busy={plan.busy || undefined}>
          {offered && (
            <div className="search-state" role="status" aria-live="polite">
              {plan.busy && <p className="search-busy"><span className="search-spinner" aria-hidden="true" />Searching for “{asked}”…</p>}
              {earlier && (
                <p className="search-earlier">
                  {shownQ.trim() ? `These results are for the earlier search “${shownQ.trim()}”.` : "These results show everything."}
                  {text.trim() ? ` Press Enter or Search to search for “${text.trim()}”.` : " Press Enter or Search to show everything."}
                </p>
              )}
              {ownDrafts && plan.show === "meaning" && <p className="search-drafts-note">Drafts are not searched by meaning. Use Words or Both to find your drafts too.</p>}
              {plan.problem && (
                <div className={`search-problem ${plan.problem.kind}`}>
                  <p>
                    {plan.problem.kind === "busy" || plan.problem.kind === "notready" ? `${plan.problem.message}${plan.show === "words" ? " Until then, these results are found by words only." : ""}`
                      : plan.show === "words" ? "Search by meaning is not available right now, so these results are found by words only."
                      : "Search by meaning is not available right now."}
                  </p>
                  {(plan.problem.kind !== "busy" || plan.show === "none") && (
                    <button type="button" className="btn small" onClick={() => setMode("words")}>{plan.show === "words" ? "Search by words" : "Search by words instead"}</button>
                  )}
                </div>
              )}
            </div>
          )}
          {n === 0 && (closestOutcome === "waiting" || closestOutcome === "found") ? (
            <div className="search-closest" role="status" aria-live="polite">
              {closest === null ? (
                <p className="search-busy"><span className="search-spinner" aria-hidden="true" />Looking for the closest by meaning…</p>
              ) : closest.length === 0 ? (
                <div className="list-empty search-empty">
                  <span className="list-empty-icon" aria-hidden="true"><SearchX size={22} /></span>
                  <h2>Nothing found</h2>
                  <p className="muted">{otherKind > 0
                    ? `None of the closest by meaning is a ${tab === "process" ? "process" : "standard"}${chosen.length ? " with these filters" : ""}. All kinds together give ${plural(otherKind, "result")}.`
                    : `None of the ${plural(closestAll, "closest result")} by meaning matches these filters.`}</p>
                  <div className="btn-row">
                    {otherKind > 0
                      ? <button type="button" className="btn small primary" onClick={() => setFilters(withTypeTab(filters, ""))}>Show all kinds</button>
                      : <button type="button" className="btn small primary" onClick={clear}>Clear all filters</button>}
                  </div>
                  <AskForIt />
                </div>
              ) : (
                <>
                  <ol className={`cards ${view === "rows" ? "rows" : ""}`.trim()}>
                    {closest.slice(0, size).map((r) => (
                      <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} hits={r.hits} words={closestWords} view={view}
                        openFeedback={openCount(feedback?.[r.kind]?.[r.doc.id] ?? [])} mayEdit={mayEdit(r.kind, r.doc)} manages={manages(r.kind, r.doc)} meta={meta?.[r.kind]?.[r.doc.id]}
                        usedBy={r.kind === "process" ? usedBy(r.doc.id) : undefined} />
                    ))}
                  </ol>
                  <AskForIt />
                </>
              )}
            </div>
          ) : plan.show === "none" || (plan.busy && n === 0) ? null : n === 0 ? (
            <div className="list-empty search-empty">
              <span className="list-empty-icon" aria-hidden="true"><SearchX size={22} /></span>
              <h2>Nothing found</h2>
              {processes.length + standards.length === 0 ? <p className="muted">There are no processes or standards yet.</p> : (
                <>
                  {/* the tab hides what the other kind gives: say so, and offer all kinds first */}
                  {otherKind > 0 && (
                    <p className="muted search-other-kind">
                      {`No ${tab === "process" ? "process" : "standard"} ${shownQ.trim() ? `matches “${shownQ.trim()}”` : "matches"}${chosen.length ? " with these filters" : ""}. All kinds together give ${plural(otherKind, "result")}.`}
                    </p>
                  )}
                  {otherKind > 0 && (
                    <div className="btn-row">
                      <button type="button" className="btn small primary" onClick={() => setFilters(withTypeTab(filters, ""))}>Show all kinds</button>
                    </div>
                  )}
                  {otherKind === 0 && <p className="muted">
                    {chosen.length ? emptyWithFilters(shownQ.trim(), withoutFilters)
                      : plan.show === "meaning" ? `Nothing close to “${shownQ.trim()}” was found.`
                      : plan.show === "words" ? noWordsText(shownQ.trim(), words.length, closestOutcome) : `Nothing matches “${shownQ.trim()}”.`}
                    {chosen.length > 0 && !withoutFilters && closestOutcome === "nothing" && " Nothing comes close by meaning either."}
                  </p>}
                  {/* the one way out when the filters hide what was found (the chips above remove one at a time) */}
                  {clearsInEmpty && (
                    <div className="btn-row">
                      <button type="button" className="btn small primary" onClick={clear}>Clear all filters</button>
                    </div>
                  )}
                  {/* the other way of searching, unless it is the filters that hide what was found; never the search just made */}
                  {other && !(chosen.length > 0 && withoutFilters > 0) && otherKind === 0 && (
                    <p className="search-try-other">
                      <button type="button" className="btn small accent-soft" onClick={() => (other === "closest" ? submit() : setMode(other))}>
                        {other === "words" ? "Search by words instead" : other === "closest" ? "Show the closest by meaning" : "Search by meaning instead"}
                      </button>
                    </p>
                  )}
                  <p className="muted small search-empty-browse">
                    Or browse <a href={href({ page: "library" })}>all processes</a> and <a href={href({ page: "standards" })}>all standards</a>.
                  </p>
                  <AskForIt />
                </>
              )}
            </div>
          ) : (
            <ol className={`cards ${view === "rows" ? "rows" : ""}`.trim()}>
              {sorted.slice(page.start, page.end).map((r) => {
                const edits = mayEdit(r.kind, r.doc);
                const broken = edits && hasErrors(r.kind === "process" ? validateProcess(r.doc, ids) : validateStandard(r.doc, ids));
                return (
                  <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} hits={r.hits} words={words}
                    openFeedback={openCount(feedback?.[r.kind]?.[r.doc.id] ?? [])} mayEdit={edits} manages={manages(r.kind, r.doc)} broken={broken} meta={meta?.[r.kind]?.[r.doc.id]}
                    usedBy={r.kind === "process" ? usedBy(r.doc.id) : undefined} foundBy={plan.show === "both" ? r.by : undefined} view={view} />
                );
              })}
            </ol>
          )}
          <ResultsFoot page={page} onPage={goTo} label="Pages of results, at the end" size={size} onSize={changeSize} />
        </section>
      </div>
    </div>
  );
}
