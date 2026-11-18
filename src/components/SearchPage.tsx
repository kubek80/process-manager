import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import type { FeedbackByTarget, Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { useEngagement } from "../lib/engagement";
import { useEditor } from "../lib/mode";
import { pageOf, sizeOf, usePageSize } from "../lib/paging";
import { useProfile, useRemembered } from "../lib/profile";
import { canEdit, useMe, usePerms, useVisibleDrafts } from "../lib/session";
import { fromMeaning, fuse, modeOf, nextAsked, needsServer, planOf, rememberMode, SEARCH_MODES, useMeaningSearch, type AskEvent, type Found, type SearchMode } from "../lib/meaning";
import { go, href, type SearchState } from "../lib/store";
import { FILTER_LABEL, filterCount, filtersOf, search, toggleFilter, wordsOf, type FilterKey, type Filters, type Flag } from "../lib/search";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard, Marked } from "./DocCard";
import { needsReview } from "./DocList";
import { AskForIt, bookmarksUnknown, ChosenFilters, engagementKnown, FilterPanel, Pager, profileChosen, ResultsBar, toResults, type Chosen, type FlagControl } from "./Lists";
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

const MODE_LABEL: Record<SearchMode, string> = { words: "Words", meaning: "Meaning", both: "Both" };

/**
 * "Search by": Words, Meaning, Both. One choice of three, like radio buttons: the arrow keys move
 * the choice, Tab leaves the group; the choice is announced.
 */
export function SearchModeSwitch({ mode, onChange, outside }: { mode: SearchMode; onChange: (m: SearchMode) => void; outside: boolean }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
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
    <div className="search-mode">
      <span className="search-mode-name" id="search-mode-name">Search by</span>
      <div className="search-mode-choices" role="radiogroup" aria-labelledby="search-mode-name" aria-describedby="search-mode-help" onKeyDown={onKey}>
        {SEARCH_MODES.map((m) => (
          <button key={m} ref={(el) => { refs.current[m] = el; }} type="button" role="radio" aria-checked={m === mode} tabIndex={m === mode ? 0 : -1}
            className={m === mode ? "on" : ""} data-mode={m} onClick={() => onChange(m)}>{MODE_LABEL[m]}</button>
        ))}
      </div>
      <ul className="search-mode-help" id="search-mode-help">
        <li><b>Words</b> finds what contains every word you type.</li>
        <li><b>Meaning</b> puts first what comes closest to what you type, even when not every word is in it.</li>
        <li><b>Both</b> shows what either finds, the best of each first.</li>
        {outside && <li className="search-mode-outside">With Meaning and Both, what you type is sent to Google Cloud to be compared.</li>}
      </ul>
    </div>
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
  const known = engagementKnown(eng);
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

  // search by meaning: offered when the server has it switched on (and has not switched it off since)
  const me = useMe();
  const [off, setOff] = useState(false);
  const offered = !!me.search?.meaning && !off;
  const mode: SearchMode = offered ? modeOf(route.mode) : "words";
  const modeParam = mode === "words" ? {} : { mode };
  // the query sent to the server: on arriving, on Search or Enter, on a change of mode - not while typing
  const [asked, setAsked] = useState(() => q.trim());
  const [attempt, setAttempt] = useState(0);
  const ask = (e: AskEvent) => { setAsked((a) => nextAsked(a, e)); if (e.type !== "type") setAttempt((n) => n + 1); };
  const meaning = useMeaningSearch(asked, needsServer(mode, asked, offered), attempt);
  useEffect(() => { if (meaning.problem?.kind === "off") setOff(true); }, [meaning.problem]);

  // what is typed is in the address at once, without a new entry in the browser's history
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => {
    // the address changed from elsewhere (Back, a link): that is a search of its own
    if (q !== pushed.current) { pushed.current = q; setText(q); ask({ type: "arrive", q }); }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = (v: string) => {
    setText(v);
    pushed.current = v.trim() ? v : "";
    go({ page: "search", ...filters, q: v, ...keep, ...modeParam }, { replace: true });
  };
  const submit = () => { type(text); ask({ type: "submit", q: text }); };
  const setMode = (m: SearchMode) => {
    rememberMode(me.user?.email, m);
    ask({ type: "mode", q: text });
    go({ page: "search", q, ...filters, ...keep, ...(m === "words" ? {} : { mode: m }) }, { replace: true });
  };
  // a new search or filter starts again on the first page (the address leaves the page out)
  const setFilters = (f: Filters) => go({ page: "search", q, ...f, ...keep, ...modeParam }, { replace: true });
  const toFirst = () => { if (route.pageNo) go({ page: "search", q, ...filters, ...keep, ...modeParam }, { replace: true }); };

  const flags: Record<string, Flag> = {
    // while the bookmarks are not known, "only my bookmarks" waits instead of showing nothing
    bookmarked: { on: bookmarked && known, test: (k, d) => eng.isBookmarked(k, d.id) },
    ...(editing ? { review: { on: due, test: (k: "process" | "standard", d: Process | Standard) => mayEdit(k, d) && needsReview(d) } } : {}),
  };
  const plan = planOf(mode, q, asked, offered, meaning);
  const shownQ = plan.q;
  const words = useMemo(() => wordsOf(shownQ), [shownQ]);
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
  const out = search({ processes, standards, catalog, q: shownQ, filters, drafts, profile, flags, found });
  const anyChosen = filterCount(filters) > 0 || bookmarked || due || !!(profile.tier || profile.environment || profile.language);
  const withoutFilters = anyChosen && !out.results.length ? search({ processes, standards, catalog, q: shownQ, drafts, found }).results.length : 0;
  // the results are of an earlier search than what is in the box now
  const earlier = mode !== "words" && offered && !plan.busy && text.trim() !== shownQ.trim();

  const [open, setOpen] = useState(false); // the filters on a narrow screen
  const results = useRef<HTMLElement>(null);
  const n = out.results.length;
  const page = pageOf(n, route.pageNo ?? 1, size);
  const goTo = (p: number) => {
    go({ page: "search", q, ...filters, pageNo: p, size, ...modeParam });
    toResults(results.current);
  };
  const changeSize = (s: number) => {
    setMySize(s);
    go({ page: "search", q, ...filters, size: s, ...modeParam }, { replace: true });
  };

  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [processes, standards, catalog]);
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === id)).length;

  const flagControls: FlagControl[] = [
    { key: "bookmarked", label: "Only my bookmarks", count: out.flags.bookmarked ?? 0, on: bookmarked, onChange: (v) => { setBookmarked(v); toFirst(); }, unknown: bookmarksUnknown(eng) },
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
  const summary = <>{shownQ.trim() ? <> for “{shownQ.trim()}”</> : null}{chosen.length ? <> with {plural(chosen.length, "filter")}</> : null}</>;

  return (
    <div className="page search-page">
      <h1 className="sr-only">Search processes and standards</h1>
      <SearchBox value={text} onChange={type} onSubmit={submit} autoFocus={!q && !chosen.length} />
      {offered && <SearchModeSwitch mode={mode} onChange={setMode} outside={!!me.search?.outside} />}

      <div className="list-layout">
        <div className="list-head">
          <ResultsBar page={page} noun={{ one: "result", many: "results" }} panelId="search-filters" open={open} onOpen={setOpen}
            chosen={chosen.length} size={size} onSize={changeSize} extra={summary} />
          <ChosenFilters chosen={chosen} onClear={clear} />
          <Pager page={page} onPage={goTo} label="Pages of results" compact />
        </div>
        <FilterPanel id="search-filters" open={open} keys={KEYS} options={out.options} onToggle={(k, v) => setFilters(toggleFilter(filters, k, v))}
          flags={flagControls} profile={profile} onProfile={changeProfile}
          done={{ label: `Show ${plural(n, "result")}`, onClick: () => { setOpen(false); toResults(results.current); } }} />
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
              {plan.problem && (
                <div className={`search-problem ${plan.problem.kind}`}>
                  <p>
                    {plan.problem.kind === "busy" ? `${plan.problem.message}${plan.show === "words" ? " Until then, these results are found by words only." : ""}`
                      : plan.show === "words" ? "Search by meaning is not available right now, so these results are found by words only."
                      : "Search by meaning is not available right now."}
                  </p>
                  {plan.problem.kind === "unavailable" && (
                    <button type="button" className="btn small" onClick={() => setMode("words")}>{plan.show === "words" ? "Search by words" : "Search by words instead"}</button>
                  )}
                </div>
              )}
            </div>
          )}
          {plan.show === "none" ? null : n === 0 ? (
            <div className="list-empty search-empty">
              <h2>Nothing found</h2>
              {processes.length + standards.length === 0 ? <p className="muted">There are no processes or standards yet.</p> : (
                <>
                  <p className="muted">
                    {chosen.length ? (shownQ.trim() ? `Nothing matches “${shownQ.trim()}” with these filters.` : "Nothing matches these filters.")
                      : plan.show === "meaning" ? `Nothing close to “${shownQ.trim()}” was found.` : `Nothing matches “${shownQ.trim()}”.`}
                    {chosen.length > 0 && withoutFilters > 0 && ` Without the filters there ${withoutFilters === 1 ? "is 1 result" : `are ${withoutFilters} results`}.`}
                    {!chosen.length && plan.show === "words" && words.length > 1 && " Every word must be found, so try fewer words."}
                    {!chosen.length && plan.show === "words" && words.length <= 1 && " Check the spelling, or try another word."}
                  </p>
                  {offered && shownQ.trim() && (plan.show === "meaning" || mode === "words") && (
                    <p className="search-try-other">
                      <button type="button" className="btn small accent-soft" onClick={() => setMode(plan.show === "meaning" ? "words" : "meaning")}>
                        {plan.show === "meaning" ? "Search by words instead" : "Search by meaning instead"}
                      </button>
                    </p>
                  )}
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
                    usedBy={r.kind === "process" ? usedBy(r.doc.id) : undefined} foundBy={plan.show === "both" ? r.by : undefined} />
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
