import { useMemo, useState } from "react";
import { ArrowRight, Compass, Eye, History, ShieldCheck, Workflow } from "lucide-react";
import type { FeedbackByTarget, Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { sortBookmarks, useEngagement } from "../lib/engagement";
import { canEdit, useMe, usePerms } from "../lib/session";
import { agoText, mostViewed, recentlyUpdated, type MetaByKind } from "../lib/sorting";
import { rememberedMode } from "../lib/meaning";
import { go, href } from "../lib/store";
import { formatDate } from "../lib/dates";
import { NO_CATEGORY_LABEL, search, type FilterKey, type Result } from "../lib/search";
import { SearchBox } from "./SearchPage";
import { DocCard, docHref } from "./DocCard";
import { KindIcon, kindWord } from "./marks";
import { openCount } from "./Feedback";
import { AskForIt, engagementKnown } from "./Lists";
import "../search.css";

/** How many bookmarks Home shows before "Show all". */
const FEW = 6;
/** How many entries the short lists of Home show. */
const SHELF = 5;
/** How many ways in each group of Browse shows before "Show all". */
const BROWSE_FEW = 6;

const WAYS: { key: Extract<FilterKey, "platform" | "practice" | "category">; title: string; hint: string }[] = [
  { key: "platform", title: "By platform", hint: "Everything about one platform" },
  { key: "practice", title: "By practice", hint: "Everything a practice looks after" },
  { key: "category", title: "By category", hint: "Everything on one subject" },
];

/** The start: one search over processes and standards, what is new and used, and ways to browse. */
export function HomePage({ processes, standards, feedback, meta }: {
  processes: Process[]; standards: Standard[];
  /** Open feedback per process and standard, for the bookmarked cards. */
  feedback?: FeedbackByTarget;
  /** What the server says about each process and standard (dates, unpublished changes). */
  meta?: MetaByKind;
}) {
  const { catalog } = useCatalog();
  const [text, setText] = useState("");
  const me = useMe();
  const perms = usePerms();
  // a new search is made the way this person chose last (by words, by meaning, or both)
  const startSearch = () => {
    const mode = me.search?.meaning ? rememberedMode(me.user?.email) : "words";
    go({ page: "search", q: text, ...(mode === "words" ? {} : { mode }) });
  };
  // the server sends a never-published draft only to whoever may see it, so it counts for them
  const out = useMemo(() => search({ processes, standards, catalog, drafts: true }), [processes, standards, catalog]);
  const count = (kind: string) => out.options.type.find((o) => o.value === kind)?.count ?? 0;
  const nProcesses = count("process");
  const nStandards = count("standard");
  const eng = useEngagement();
  const known = engagementKnown(eng); // until the use and the bookmarks are known, their sections stay away
  // the bookmarks, newest first; only what this person can see
  const marked = useMemo(() => {
    const byKey = new Map<string, Result>(out.results.map((r) => [`${r.kind}:${r.doc.id}`, r]));
    return sortBookmarks(eng.bookmarks).map((b) => byKey.get(`${b.kind}:${b.id}`)).filter((r): r is Result => !!r);
  }, [eng.bookmarks, out]);
  const [allMarked, setAllMarked] = useState(false);
  const [allWays, setAllWays] = useState<Partial<Record<string, boolean>>>({});
  // what is new and what is used: published only, never a draft (whoever may see one or not)
  const recent = useMemo(() => recentlyUpdated(out.results, meta, SHELF), [out, meta]);
  const viewed = known ? mostViewed(out.results, (r) => eng.countsOf(r.kind, r.doc.id).views, SHELF) : [];
  const ways = WAYS.map((w) => ({ ...w, options: out.options[w.key].filter((o) => o.count > 0) })).filter((w) => w.options.length > 0);
  const now = new Date();
  const maxViews = viewed[0]?.views ?? 0;

  return (
    <div className="page home-page">
      <div className="home-layout">
        <div className="home-main">
          <section className="home-search" aria-labelledby="home-title">
            <h1 id="home-title">Find a process or a standard</h1>
            <p className="lead">How to get something done, step by step, and the rules your work has to meet.</p>
            <SearchBox big autoFocus value={text} onChange={setText} onSubmit={startSearch} />
          </section>

          <div className="home-all">
            <a className="home-entry process" href={href({ page: "library" })}>
              <span className="home-entry-icon process"><Workflow size={20} aria-hidden="true" /></span>
              <span className="home-entry-text">
                <span className="home-entry-kind">Processes</span>
                <b>All processes</b><span className="muted">How to get something done</span>
              </span>
              <span className="home-entry-count">{nProcesses}<span className="search-sr"> processes</span></span>
              <ArrowRight size={16} className="home-entry-go" aria-hidden="true" />
            </a>
            <a className="home-entry standard" href={href({ page: "standards" })}>
              <span className="home-entry-icon standard"><ShieldCheck size={20} aria-hidden="true" /></span>
              <span className="home-entry-text">
                <span className="home-entry-kind">Standards</span>
                <b>All standards</b><span className="muted">The rules your work must meet</span>
              </span>
              <span className="home-entry-count">{nStandards}<span className="search-sr"> standards</span></span>
              <ArrowRight size={16} className="home-entry-go" aria-hidden="true" />
            </a>
          </div>

          {known && marked.length > 0 && (
            <section className="home-bookmarks" aria-labelledby="home-bookmarks">
              <h2 id="home-bookmarks">Your bookmarks</h2>
              <ol className="cards">
                {(allMarked ? marked : marked.slice(0, FEW)).map((r) => (
                  <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} level={3}
                    openFeedback={openCount(feedback?.[r.kind]?.[r.doc.id] ?? [])} mayEdit={false}
                    meta={canEdit(perms, r.kind, r.doc) ? meta?.[r.kind]?.[r.doc.id] : undefined} />
                ))}
              </ol>
              {marked.length > FEW && (
                <button type="button" className="btn small home-bookmarks-more" aria-expanded={allMarked} onClick={() => setAllMarked(!allMarked)}>
                  {allMarked ? "Show fewer" : `Show all ${marked.length} bookmarks`}
                </button>
              )}
            </section>
          )}

          {(recent.length > 0 || viewed.length > 0) && (
            <div className="home-shelves">
              {recent.length > 0 && (
                <section className="home-shelf" data-shelf="recent" aria-labelledby="home-recent">
                  <h2 id="home-recent"><History size={15} aria-hidden="true" />Recently updated</h2>
                  <ol className="home-rank">
                    {recent.map(({ item: r, at }) => (
                      <ShelfRow key={`${r.kind}:${r.doc.id}`} r={r} sub={subOf(r, catalog)}
                        figure={<time dateTime={at} title={formatDate(at)}>{agoText(at, now)}</time>} />
                    ))}
                  </ol>
                </section>
              )}
              {viewed.length > 0 && (
                <section className="home-shelf" data-shelf="viewed" aria-labelledby="home-viewed">
                  <h2 id="home-viewed"><Eye size={15} aria-hidden="true" />Most viewed</h2>
                  <ol className="home-rank">
                    {viewed.map(({ item: r, views }) => (
                      <ShelfRow key={`${r.kind}:${r.doc.id}`} r={r} sub={subOf(r, catalog)}
                        figure={<>
                          <span className={`home-rank-bar ${r.kind}`} aria-hidden="true"><i style={{ width: `${Math.max(8, Math.round((views / maxViews) * 100))}%` }} /></span>
                          <span className="home-rank-n">{views}<span className="search-sr"> {views === 1 ? "view" : "views"}</span></span>
                        </>} />
                    ))}
                  </ol>
                </section>
              )}
            </div>
          )}

          <AskForIt className="home-ask" />
        </div>

        {ways.length > 0 && (
          <aside className="home-browse" aria-labelledby="home-browse-title">
            <h2 id="home-browse-title" className="home-browse-title"><Compass size={16} aria-hidden="true" />Browse</h2>
            {ways.map(({ key, title, hint, options }) => (
              <section key={key} className="home-group" data-browse={key} aria-labelledby={`home-${key}`}>
                <h3 id={`home-${key}`}>{title}</h3>
                <p className="muted small">{hint}</p>
                <ul className="home-links" id={`home-links-${key}`}>
                  {(allWays[key] ? options : options.slice(0, BROWSE_FEW)).map((o) => (
                    <li key={o.value}>
                      <a className="chip" href={href({ page: "search", [key]: [o.value] })} aria-label={`${o.label}, ${o.count} ${o.count === 1 ? "result" : "results"}`}>
                        {o.label}<span>{o.count}</span>
                      </a>
                    </li>
                  ))}
                </ul>
                {options.length > BROWSE_FEW && (
                  <button type="button" className="home-links-more" aria-expanded={!!allWays[key]} aria-controls={`home-links-${key}`}
                    onClick={() => setAllWays({ ...allWays, [key]: !allWays[key] })}>
                    {allWays[key] ? "Show fewer" : `Show all ${options.length}`}
                  </button>
                )}
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

/** What a row of Home's short lists says under the title: the category and the team that maintains it. */
function subOf(r: Result, catalog: ReturnType<typeof useCatalog>["catalog"]): string {
  const cat = r.doc.category ? catalog.categories.find((c) => c.id === r.doc.category)?.name ?? r.doc.category : NO_CATEGORY_LABEL;
  const owner = r.doc.owner ? catalog.teams.find((t) => t.id === r.doc.owner)?.name ?? r.doc.owner : "";
  return [cat, owner].filter(Boolean).join(" · ");
}

/** One row of a short list on Home: the kind mark, the title and what it is about, a figure on the right. */
function ShelfRow({ r, sub, figure }: { r: Result; sub: string; figure: React.ReactNode }) {
  const word = kindWord(r.kind);
  const title = typeof r.doc.title === "string" && r.doc.title ? r.doc.title : r.doc.id;
  return (
    <li data-kind={r.kind} data-id={r.doc.id}>
      <a className="home-rank-row" href={docHref(r.kind, r.doc.id)}>
        <span className={`home-rank-mark ${r.kind}`} title={word}><KindIcon kind={r.kind} size={14} /><span className="search-sr">{word}: </span></span>
        <span className="home-rank-text">
          <span className="home-rank-title">{title}</span>
          <span className="home-rank-sub">{sub}</span>
        </span>
        <span className="home-rank-figure">{figure}</span>
      </a>
    </li>
  );
}
