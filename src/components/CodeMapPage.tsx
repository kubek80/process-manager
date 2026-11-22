import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileCode2, FlaskConical, Layers, Maximize2, MessageSquareText, Search, Table2, Workflow } from "lucide-react";
import { AREAS, CATEGORIES } from "../codemap";
import type { CodeCategory, CodeChart, CodeExample, CodeFile, CodeTable } from "../codemap/types";
import {
  alsoIn, anchorOf, categoriesOf, categoryById, commentAt, commentCount, commentLineFlags, countLine, fileAnchor, fileHome, fileIn, firstSentence, hitCount,
  inlineParts, isOwnFile, linesOf, neighbours, placeComments, searchMap, tableAnchor, testedFiles, type MapHit, type Placement,
} from "../lib/codemap";
import { useMedia } from "../lib/media";
import { wordsOf } from "../lib/search";
import { ApiError, copyText, go, href, loadSource, loadSystem, parseRoute, type CodeView } from "../lib/store";
import { Marked } from "./DocCard";
import { FlowView } from "./FlowView";
import { LoadError, Modal, scrollToStart } from "./ui";
import "../codemap.css";

/**
 * Admin › Code map (`#/admin/code`): the portal's own source sorted into categories for whoever
 * reviews it (`src/codemap`). The overview finds a file, a table or a word over the whole map;
 * a category shows what its part must do, its charts, tables, worked examples and files; a file
 * shows its text from the server (`GET /api/admin/source`) with its requirements as comments
 * above the lines they are about. The address carries the place a page opens at (`?at=`), so a
 * search hit lands on its sentence, its table or its line. Its logic is `src/lib/codemap.ts`.
 */

/** The category list beside the page from this width; below it, a menu above the page. */
const WIDE = "(min-width: 1120px)";
/** At most this many hits of one category are shown before "Show all". */
const HITS_SHOWN = 8;
/** The smallest zoom a chart is drawn at on a category's page: a wider chart scrolls sideways. */
const CHART_MIN = 0.9;
/** The viewer's own choices on this page, kept in the browser (per viewer, never shared). */
const WRAP_KEY = "pm.codemap.wrap", FILES_KEY = "pm.codemap.files";
/** How long a place that was jumped to stays marked. */
const FLASH_MS = 2400;

const codeRoute = (v: CodeView) => href({ page: "admin", section: "code", ...v });
const fileRoute = (category: string, file: string, at?: string) => codeRoute({ category, file, at });

function readPref(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writePref(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode: not kept */ } }
function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => readPref(key) ?? fallback);
  return [v, (next: string) => { setV(next); writePref(key, next); }];
}

/** The part of the address that is the code map's, followed as it changes (the app passes only the section). */
function useCodeView(): CodeView {
  const read = () => {
    const r = parseRoute(typeof location === "undefined" ? "" : location.hash);
    return r.page === "admin" && r.section === "code" ? { category: r.category, file: r.file, q: r.q, at: r.at } : {};
  };
  const [view, setView] = useState<CodeView>(read);
  useEffect(() => {
    const on = () => setView(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return view;
}

// the search of the overview, kept while a category or a file is open: "Overview" returns to it
let lastQ = "";

/** Puts the place into the current address without a step in the history (Back then returns there). */
function keepPlace(v: CodeView) {
  try { history.replaceState(history.state, "", codeRoute(v)); } catch { /* the address stays as it was */ }
}

/** Brings an element to the top of the window (the scroll is corrected once what is above has settled), focuses it and marks it a moment. */
function land(el: HTMLElement | null, flash = true) {
  if (!el) return;
  scrollToStart(el);
  el.focus({ preventScroll: true });
  if (!flash) return;
  el.classList.remove("cm-flash");
  void el.offsetWidth; // start the mark again when the same place is jumped to twice
  el.classList.add("cm-flash");
  window.setTimeout(() => el.classList.remove("cm-flash"), FLASH_MS);
}

/** A text of the map: what its writer put between backticks is shown as code; `words` are marked. */
function Txt({ text, words }: { text: string; words?: string[] }) {
  return <>{inlineParts(text).map((p, i) => {
    const t = words ? <Marked text={p.text} words={words} /> : p.text;
    return p.code ? <code key={i}>{t}</code> : <Fragment key={i}>{t}</Fragment>;
  })}</>;
}

/** Whether a box has more than it shows (and so must be reachable with the keyboard to scroll it). */
function useOverflows(ref: RefObject<HTMLElement | null>, watch?: unknown): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref, watch]);
  return over;
}

export function CodeMapPage({ label, hint }: { label: string; hint: string }) {
  const view = useCodeView();
  const wide = useMedia(WIDE);
  const heading = useRef<HTMLHeadingElement>(null);
  const category = categoryById(CATEGORIES, view.category);
  const file = fileIn(category, view.file);

  // a category or a file was opened: at the place the address names, else at the top with the
  // focus on its heading. A file's place is reached by the file itself, once its text is there.
  const where = view.category ? `${view.category}/${view.file ?? ""}` : "";
  useEffect(() => {
    if (!where) return;
    if (view.at && !view.file) {
      const el = document.getElementById(anchorOf(view.at) ?? "");
      if (el) { land(el); return; }
    }
    if (view.at && file) return;
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [where, view.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view.category) return <Overview label={label} hint={hint} q={view.q ?? ""} />;

  let body: ReactNode;
  if (!category) {
    body = <NotFound heading={heading} title="Not in the code map" text={<>There is no category “{view.category}” in the code map.</>} back={{ to: codeRoute({ q: lastQ || undefined }), label: "Back to the code map" }} />;
  } else if (view.file && !file) {
    const elsewhere = alsoIn(CATEGORIES, view.file, category.id);
    body = <NotFound heading={heading} title={`Not in ${category.title}`}
      text={<><code className="cm-path">{view.file}</code> is not one of the files of {category.title}.{elsewhere.length > 0 && <> It is in{" "}
        {elsewhere.map((c, i) => <Fragment key={c.id}>{i > 0 && ", "}<a href={fileRoute(c.id, view.file!)}>{c.title}</a></Fragment>)}.</>}</>}
      back={{ to: codeRoute({ category: category.id }), label: `Back to ${category.title}` }} />;
  } else if (file) {
    body = <FileView key={`${category.id}/${file.path}`} category={category} file={file} heading={heading} at={view.at} />;
  } else {
    body = <CategoryView key={category.id} category={category} heading={heading} />;
  }

  return (
    <div className={`cm-frame ${wide ? "wide" : ""}`}>
      {wide
        ? <aside className="cm-side"><CategoryNav current={category?.id} /></aside>
        : <details key={where} className="cm-menu">
          <summary>Categories{category && <span>· {category.title}</span>}</summary>
          <CategoryNav current={category?.id} />
        </details>}
      <div className="cm-main">{body}</div>
    </div>
  );
}

/** Every category of every area, the open one marked: reachable from wherever the map is open. */
function CategoryNav({ current }: { current?: string }) {
  return (
    <nav className="cm-cats" aria-label="Code map categories">
      <a className="cm-cats-all" href={codeRoute({ q: lastQ || undefined })}><ArrowLeft size={14} aria-hidden="true" />{lastQ ? "Overview and search" : "Overview"}</a>
      {AREAS.map((a) => (
        <div key={a.id} className="cm-cats-area">
          <p className="cm-cats-title">{a.title}</p>
          <ul>
            {categoriesOf(CATEGORIES, a.id).map((c) => (
              <li key={c.id}><a href={codeRoute({ category: c.id })} className={c.id === current ? "on" : ""} aria-current={c.id === current ? "page" : undefined}>{c.title}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Where the page is: the map, the area, and (on a file's page) the category. */
function Crumbs({ category, here }: { category?: CodeCategory; here?: boolean }) {
  const area = category && AREAS.find((a) => a.id === category.area);
  return (
    <p className="cm-crumbs">
      <a href={codeRoute({ q: lastQ || undefined })}>Code map</a>
      {area && <><span aria-hidden="true">›</span><span>{area.title}</span></>}
      {category && !here && <><span aria-hidden="true">›</span><a href={codeRoute({ category: category.id })}>{category.title}</a></>}
    </p>
  );
}

function NotFound({ heading, title, text, back }: { heading: RefObject<HTMLHeadingElement | null>; title: string; text: ReactNode; back: { to: string; label: string } }) {
  return (
    <div className="cm-page cm-not-found">
      <Crumbs />
      <header className="admin-head"><h1 ref={heading} tabIndex={-1}>{title}</h1><p className="lead">{text}</p></header>
      <a className="btn small cm-back" href={back.to}><ArrowLeft size={14} aria-hidden="true" />{back.label}</a>
    </div>
  );
}

// ---------- the overview

/** The route through the map for a reviewer's first hour: the category and what it answers. */
const FIRST_HOUR: [string, string][] = [
  ["tables", "what is stored"],
  ["saving", "how a row comes to be"],
  ["vectors", "how rows become searchable by meaning"],
  ["search", "the two searches and how they meet"],
  ["rights", "who may do what, and where it is enforced"],
  ["api", "the server, its routes and what it answers"],
];

function Overview({ label, hint, q }: { label: string; hint: string; q: string }) {
  const [text, setText] = useState(q);
  useEffect(() => { setText(q); lastQ = q; }, [q]); // Back and Forward bring another search
  const results = useMemo(() => searchMap(CATEGORIES, text), [text]);
  const words = useMemo(() => wordsOf(text), [text]);
  const searching = words.length > 0;
  const n = hitCount(results);
  const [source, setSource] = useState<boolean | undefined>(undefined);
  useEffect(() => { let live = true; showsSource().then((s) => { if (live) setSource(s); }); return () => { live = false; }; }, []);
  const route = FIRST_HOUR.map(([id, line]) => ({ c: categoryById(CATEGORIES, id), line })).filter((r) => r.c);
  return (
    <div className="cm-page cm-overview">
      <header className="admin-head">
        <h1>{label}</h1>
        <p className="lead">{hint}: every part of it in a category that says what the part must do, shows how it works in flow charts and lists its files. Open a file to read it with its requirements as comments above the lines they are about.</p>
      </header>
      {source === false && <p className="cm-nosource" role="status">Here the files themselves cannot be opened: the portal does not run beside its source code (<code>npm run dev</code> does). Their paths, what they must do, the charts and the tables are all here.</p>}
      <div className="cm-find">
        <label className="search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={text} placeholder="Find a file, a table or a word" aria-label="Find a file, a table or a word"
            onChange={(e) => { setText(e.target.value); lastQ = e.target.value.trim() ? e.target.value : ""; go({ page: "admin", section: "code", q: e.target.value }, { replace: true }); }} />
        </label>
      </div>
      {searching
        ? <section className="cm-results" aria-labelledby="cm-results-h">
          <h2 id="cm-results-h" aria-live="polite">{n === 0 ? "Nothing found" : `${n} ${n === 1 ? "place" : "places"} in ${results.length} ${results.length === 1 ? "category" : "categories"}`}</h2>
          {n === 0 && <p className="muted">No category, path, requirement, table, chart or example contains all of “{text.trim()}”. Try fewer or shorter words.</p>}
          {results.map((r) => <ResultGroup key={r.category.id} category={r.category} hits={r.hits} words={words} />)}
        </section>
        : <>
          {route.length > 0 && (
            <section className="cm-first" aria-labelledby="cm-first-h">
              <h2 id="cm-first-h">The first hour</h2>
              <ol>
                {route.map(({ c, line }) => <li key={c!.id}><a href={codeRoute({ category: c!.id })}>{c!.title}</a><span> - {line}</span></li>)}
              </ol>
            </section>
          )}
          {AREAS.map((a) => (
            <section key={a.id} className="cm-area" aria-labelledby={`cm-area-${a.id}`}>
              <div className="cm-area-head"><h2 id={`cm-area-${a.id}`}>{a.title}</h2><p className="muted">{a.hint}</p></div>
              <ul className="cm-cards">
                {categoriesOf(CATEGORIES, a.id).map((c) => (
                  <li key={c.id}>
                    <a className="cm-card" href={codeRoute({ category: c.id })}>
                      <h3>{c.title}</h3>
                      <p>{c.summary ? <Txt text={firstSentence(c.summary)} /> : "Not written yet."}</p>
                      <span className="cm-count">{countLine(c)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>}
    </div>
  );
}

const HIT_ICON = { category: Layers, file: FileCode2, requirement: MessageSquareText, table: Table2, chart: Workflow, example: ArrowDown } as const;
const HIT_WORD = { category: "Category", file: "File", requirement: "Requirement", table: "Table", chart: "Chart", example: "Worked example" } as const;

function ResultGroup({ category, hits, words }: { category: CodeCategory; hits: MapHit[]; words: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? hits : hits.slice(0, HITS_SHOWN);
  const target = (h: MapHit) => (h.file ? fileRoute(category.id, h.file, h.at) : codeRoute({ category: category.id, at: h.at }));
  return (
    <div className="cm-group">
      <h3><a href={codeRoute({ category: category.id })}>{category.title}</a><span className="cm-count">{hits.length}</span></h3>
      <ul className="cm-hits">
        {shown.map((h, i) => {
          const Icon = HIT_ICON[h.kind];
          const prose = h.kind === "requirement" || h.kind === "category" || h.kind === "chart" || h.kind === "example";
          return (
            <li key={i}>
              <a href={target(h)}>
                <Icon size={15} aria-hidden="true" /><span className="cm-sr">{HIT_WORD[h.kind]}: </span>
                <span className="cm-hit-text">
                  <span className={prose ? "" : "cm-path"}>{prose ? <Txt text={h.text} words={words} /> : <Marked text={h.text} words={words} />}</span>
                  {h.detail && <em><Txt text={h.kind === "category" ? firstSentence(h.detail) : h.detail} words={words} /></em>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {hits.length > shown.length && <button className="btn small ghost" onClick={() => setAll(true)}>Show all {hits.length} in {category.title}</button>}
    </div>
  );
}

// ---------- a category

/** A requirement drawn as a review comment. */
function Comment({ children, at }: { children: ReactNode; at?: ReactNode }) {
  return (
    <div className="cm-comment" role="note">
      <MessageSquareText size={15} aria-hidden="true" />
      <div><p>{children}</p>{at && <p className="cm-at">{at}</p>}</div>
    </div>
  );
}

/** A path that opens its file where the map describes it (a test where a file names it); plain text where no category does. */
function FileLink({ path, from }: { path: string; from?: string }) {
  const home = fileHome(CATEGORIES, from, path);
  return home ? <a className="cm-path" href={fileRoute(home, path)}>{path}</a> : <code className="cm-path">{path}</code>;
}

function PathList({ paths, from }: { paths: string[]; from?: string }) {
  return <>{paths.map((p, i) => <Fragment key={p}>{i > 0 && <span className="cm-sep" aria-hidden="true"> · </span>}<FileLink path={p} from={from} /></Fragment>)}</>;
}

/** A box that scrolls inside itself; a Tab stop only when it has more than it shows. */
function ScrollBox({ className, label, children, as = "div" }: { className: string; label: string; children: ReactNode; as?: "div" | "pre" }) {
  const ref = useRef<HTMLDivElement & HTMLPreElement>(null);
  const over = useOverflows(ref);
  const Tag = as;
  return <Tag ref={ref} className={className} tabIndex={over ? 0 : undefined} role={over ? "region" : undefined} aria-label={over ? label : undefined}>{children}</Tag>;
}

function CategoryView({ category: c, heading }: { category: CodeCategory; heading: RefObject<HTMLHeadingElement | null> }) {
  const [filesMode, setFilesMode] = usePref(FILES_KEY, "comments");
  const parts = [
    { id: "code-must", label: "What it must do", n: c.requirements.length },
    { id: "code-charts", label: "How it works", n: c.charts.length },
    { id: "code-tables", label: "Tables", n: c.tables?.length ?? 0 },
    { id: "code-examples", label: "Examples", n: c.examples?.length ?? 0 },
    { id: "code-files", label: "Files", n: c.files.length },
  ].filter((p) => p.n > 0);
  /** Jumps to a place of this page and keeps it in the address. */
  const jump = (at: string) => { keepPlace({ category: c.id, at }); land(document.getElementById(anchorOf(at) ?? "")); };
  // a link to a file (or anywhere in the map) from a block of this page: the address first keeps
  // the block, so that the browser's Back returns to it
  const remember = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.("a[href^='#/admin/code/']");
    const block = a?.closest<HTMLElement>("[data-at]");
    if (a && block?.dataset.at) keepPlace({ category: c.id, at: block.dataset.at });
  };
  return (
    <div className="cm-page cm-category" onClickCapture={remember}>
      <Crumbs category={c} here />
      <header className="admin-head">
        <h1 ref={heading} tabIndex={-1}>{c.title}</h1>
        {c.summary && <p className="lead"><Txt text={c.summary} /></p>}
        <p className="cm-count">{countLine(c)}</p>
      </header>
      {parts.length > 1 && (
        <nav className="cm-jump" aria-label="On this page">
          {parts.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => land(document.getElementById(p.id), false)}>{p.label}<span>{p.n}</span></button>
          ))}
        </nav>
      )}
      {c.requirements.length > 0 && (
        <section id="code-must" className="cm-part" tabIndex={-1} aria-labelledby="code-must-h">
          <h2 id="code-must-h">What this part must do</h2>
          <ul className="cm-reqs">{c.requirements.map((r, i) => <li key={i} id={`code-must-${i}`} tabIndex={-1}><Comment><Txt text={r} /></Comment></li>)}</ul>
        </section>
      )}
      {c.charts.length > 0 && (
        <section id="code-charts" className="cm-part" tabIndex={-1} aria-labelledby="code-charts-h">
          <h2 id="code-charts-h">How it works</h2>
          {c.charts.map((ch) => <Chart key={ch.process.id} chart={ch} />)}
        </section>
      )}
      {(c.tables?.length ?? 0) > 0 && (
        <section id="code-tables" className="cm-part" tabIndex={-1} aria-labelledby="code-tables-h">
          <h2 id="code-tables-h">Tables</h2>
          {c.tables!.length > 3 && (
            <ul className="cm-index" aria-label="Tables of this part">
              {c.tables!.map((t) => <li key={t.name}><button type="button" onClick={() => jump(`table-${t.name}`)}><span className="cm-path">{t.name}</span><em><Txt text={firstSentence(t.purpose)} /></em></button></li>)}
            </ul>
          )}
          {c.tables!.map((t) => <TableBlock key={t.name} table={t} from={c.id} />)}
        </section>
      )}
      {(c.examples?.length ?? 0) > 0 && (
        <section id="code-examples" className="cm-part" tabIndex={-1} aria-labelledby="code-examples-h">
          <h2 id="code-examples-h">Worked examples</h2>
          {c.examples!.map((e, i) => <ExampleBlock key={e.title} example={e} index={i} from={c.id} />)}
        </section>
      )}
      <section id="code-files" className="cm-part" tabIndex={-1} aria-labelledby="code-files-h">
        <div className="cm-part-head">
          <h2 id="code-files-h">Files</h2>
          <div className="seg" role="group" aria-label="Show the files">
            {([["comments", "With comments"], ["paths", "Paths only"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`seg-item ${filesMode === k ? "on" : ""}`} aria-pressed={filesMode === k} onClick={() => setFilesMode(k)}>{l}</button>
            ))}
          </div>
        </div>
        {c.files.length > 6 && filesMode === "comments" && (
          <ul className="cm-index" aria-label="Files of this part">
            {c.files.map((f) => <li key={f.path}><button type="button" onClick={() => jump(`file-${f.path}`)}><span className="cm-path">{f.path}</span><em><Txt text={firstSentence(f.role)} /></em></button></li>)}
          </ul>
        )}
        <ul className={`cm-files ${filesMode === "paths" ? "compact" : ""}`}>{c.files.map((f) => <FileBlock key={f.path} file={f} category={c} compact={filesMode === "paths"} />)}</ul>
      </section>
    </div>
  );
}

const NO_STEPS = new Set<string>();

function Chart({ chart }: { chart: CodeChart }) {
  const [big, setBig] = useState(false);
  const at = `chart-${chart.process.id}`;
  return (
    <figure className="cm-chart guide-fig" id={anchorOf(at)} data-at={at} tabIndex={-1}>
      <div className="cm-chart-head">
        <h3>{chart.process.title}</h3>
        <button type="button" className="btn small ghost" onClick={() => setBig(true)} aria-label={`Enlarge the chart “${chart.process.title}”`}><Maximize2 size={14} aria-hidden="true" />Enlarge</button>
      </div>
      <FlowView bare bareMin={CHART_MIN} editable={false} process={chart.process} selectedId={null} done={NO_STEPS} feedback={[]} onSelect={() => {}} />
      <figcaption><Txt text={chart.caption} /></figcaption>
      {big && (
        <Modal title={chart.process.title} subtitle={<Txt text={chart.caption} />} onClose={() => setBig(false)} className="cm-enlarge">
          <FlowView editable={false} follow={false} process={chart.process} selectedId={null} done={NO_STEPS} feedback={[]} onSelect={() => {}} />
        </Modal>
      )}
    </figure>
  );
}

function TableBlock({ table: t, from }: { table: CodeTable; from: string }) {
  const id = tableAnchor(t.name);
  return (
    <article className="cm-table" id={id} data-at={`table-${t.name}`} tabIndex={-1} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}><Table2 size={16} aria-hidden="true" /><span className="cm-path">{t.name}</span></h3>
      <p><Txt text={t.purpose} /></p>
      <ScrollBox className="cm-scroll" label={`Columns of ${t.name}`}>
        <table className="cm-cols">
          <thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Note</th></tr></thead>
          <tbody>{t.columns.map((col) => <tr key={col.name}><td className="cm-path">{col.name}</td><td className="cm-path cm-type">{col.type}</td><td>{col.note ? <Txt text={col.note} /> : ""}</td></tr>)}</tbody>
        </table>
      </ScrollBox>
      {(t.keys?.length ?? 0) > 0 && <><h4>Keys, references and indexes</h4><ul className="cm-plain">{t.keys!.map((k, i) => <li key={i}><Txt text={k} /></li>)}</ul></>}
      {(t.rules?.length ?? 0) > 0 && <><h4>What its rows keep true</h4><ul className="cm-reqs">{t.rules!.map((r, i) => <li key={i}><Comment><Txt text={r} /></Comment></li>)}</ul></>}
      <dl className="cm-facts">
        <div><dt>Created in</dt><dd><FileLink path={t.createdIn} from={from} /></dd></div>
        <div><dt>Written by</dt><dd><PathList paths={t.writtenBy} from={from} /></dd></div>
        {(t.readBy?.length ?? 0) > 0 && <div><dt>Read by</dt><dd><PathList paths={t.readBy!} from={from} /></dd></div>}
      </dl>
    </article>
  );
}

function ExampleBlock({ example: e, index, from }: { example: CodeExample; index: number; from: string }) {
  const at = `example-${index}`;
  return (
    <article className="cm-example" id={anchorOf(at)} data-at={at} tabIndex={-1}>
      <h3><Txt text={e.title} /></h3>
      <p className="muted"><Txt text={e.caption} /></p>
      <ol className="cm-stages">
        {e.stages.map((s, i) => (
          <li key={i}>
            {i > 0 && <ArrowDown className="cm-arrow" size={18} aria-hidden="true" />}
            <div className="cm-stage">
              <p className="cm-stage-head"><span className="cm-stage-n">{i + 1}</span><strong><Txt text={s.label} /></strong>{s.where && <FileLink path={s.where} from={from} />}</p>
              {s.note && <p className="cm-stage-note"><Txt text={s.note} /></p>}
              <ScrollBox as="pre" className="cm-shape" label={`${s.label}: the data`}>{s.shape}</ScrollBox>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function AlsoIn({ path, category }: { path: string; category: string }) {
  const others = alsoIn(CATEGORIES, path, category);
  if (!others.length) return null;
  return <p className="cm-also"><span>Also in:</span> {others.map((o, i) => <Fragment key={o.id}>{i > 0 && ", "}<a href={fileRoute(o.id, path)}>{o.title}</a></Fragment>)}</p>;
}

function Tests({ tests, from }: { tests?: string[]; from: string }) {
  if (!tests?.length) return null;
  return <p className="cm-tests"><FlaskConical size={14} aria-hidden="true" /><span>Tested by:</span> <PathList paths={tests} from={from} /></p>;
}

function FileBlock({ file: f, category: c, compact }: { file: CodeFile; category: CodeCategory; compact?: boolean }) {
  const at = `file-${f.path}`;
  return (
    <li className="cm-file" id={fileAnchor(f.path)} data-at={at} tabIndex={-1}>
      <div className="cm-file-head">
        <h3><a className="cm-path" href={fileRoute(c.id, f.path)}>{f.path}</a></h3>
        {c.start === f.path && <span className="cm-start">Read first</span>}
        {compact && f.requirements.length > 0 && <span className="cm-count">{f.requirements.length} {f.requirements.length === 1 ? "comment" : "comments"}</span>}
        {!compact && <a className="btn small ghost cm-open" href={fileRoute(c.id, f.path)} aria-label={`Open ${f.path}`}><FileCode2 size={14} aria-hidden="true" />Open</a>}
      </div>
      <p className="cm-role"><Txt text={f.role} /></p>
      {!compact && <>
        {f.requirements.length > 0 && <ul className="cm-reqs">{f.requirements.map((r, i) => (
          <li key={i}><Comment at={r.at ? <>at <a href={fileRoute(c.id, f.path, `req-${i}`)}><code>{r.at}</code></a></> : undefined}><Txt text={r.text} /></Comment></li>
        ))}</ul>}
        <Tests tests={f.tests} from={c.id} />
        <AlsoIn path={f.path} category={c.id} />
      </>}
    </li>
  );
}

// ---------- a file

type Source = { state: "loading" } | { state: "off" } | { state: "missing" } | { state: "error"; message: string } | { state: "ok"; text: string };

// whether this installation shows its source at all, asked once
let canShow: Promise<boolean | undefined> | null = null;
const showsSource = () => (canShow ??= loadSystem().then((s) => s.source, () => { canShow = null; return undefined; }));

function useSource(path: string): [Source, () => void] {
  const [source, setSource] = useState<Source>({ state: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setSource({ state: "loading" });
    (async () => {
      const shows = await showsSource();
      if (shows === false) return { state: "off" } as Source;
      try {
        return { state: "ok", text: (await loadSource(path)).text } as Source;
      } catch (e) {
        // the portal shows source, but not this file; where it is not known, a 404 means the source is off
        if (e instanceof ApiError && e.status === 404) return { state: shows ? "missing" : "off" } as Source;
        return { state: "error", message: e instanceof Error ? e.message : String(e) } as Source;
      }
    })().then((s) => { if (live) setSource(s); });
    return () => { live = false; };
  }, [path, round]);
  return [source, useCallback(() => setRound((r) => r + 1), [])];
}

const baseName = (p: string) => p.split("/").pop() ?? p;

function CopyPath({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn small ghost" onClick={async () => { if (await copyText(path)) { setDone(true); setTimeout(() => setDone(false), 1600); } }}>
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{done ? "Copied" : "Copy path"}
    </button>
  );
}

function StepFiles({ c, prev, next }: { c: CodeCategory; prev?: CodeFile; next?: CodeFile }) {
  return (
    <span className="cm-step">
      {prev && <a className="btn small ghost" href={fileRoute(c.id, prev.path)} title={prev.path} aria-label={`Previous file: ${prev.path}`}><ChevronLeft size={14} aria-hidden="true" />{baseName(prev.path)}</a>}
      {next && <a className="btn small ghost" href={fileRoute(c.id, next.path)} title={next.path} aria-label={`Next file: ${next.path}`}>{baseName(next.path)}<ChevronRight size={14} aria-hidden="true" /></a>}
    </span>
  );
}

function FileView({ category: c, file: f, heading, at }: { category: CodeCategory; file: CodeFile; heading: RefObject<HTMLHeadingElement | null>; at?: string }) {
  const [source, retry] = useSource(f.path);
  const own = isOwnFile(c, f.path);
  const { prev, next, index } = neighbours(c, f.path);
  const lines = useMemo(() => (source.state === "ok" ? linesOf(source.text) : null), [source]);
  const placed = useMemo(() => (lines ? placeComments(lines, f.requirements) : null), [lines, f.requirements]);
  const [wrap, setWrap] = usePref(WRAP_KEY, "0");
  // Back to the category returns to this file's row (a test: to the row of the file that names it)
  const row = own ? f.path : testedFiles(c, f.path)[0]?.path;
  /** Jumps to a requirement's comment (or its entry when it is not on a line) and keeps it in the address. */
  const toReq = useCallback((i: number) => {
    keepPlace({ category: c.id, file: f.path, at: `req-${i}` });
    land(document.getElementById(anchorOf(`req-${i}`, (n) => placed?.lineOf[n] ?? -1) ?? ""));
  }, [c.id, f.path, placed]);

  // the place in the address is reached once the text is there (or known not to come)
  const arrived = useRef(false);
  useEffect(() => {
    if (!at || arrived.current || source.state === "loading") return;
    arrived.current = true;
    const id = anchorOf(at, (n) => placed?.lineOf[n] ?? -1);
    const el = id ? document.getElementById(id) : null;
    if (el) requestAnimationFrame(() => land(el)); else heading.current?.focus();
  }, [at, source.state, placed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cm-page cm-file-page">
      <Crumbs category={c} />
      <header className="admin-head cm-file-title">
        <h1 ref={heading} tabIndex={-1} className="cm-path">{f.path}</h1>
        <p className="lead"><Txt text={f.role} /></p>
      </header>
      <div className="cm-file-bar">
        <a className="btn small" href={codeRoute({ category: c.id, at: row ? `file-${row}` : undefined })}><ArrowLeft size={14} aria-hidden="true" />Back to {c.title}</a>
        <CopyPath path={f.path} />
        {own && <span className="cm-pos">File {index + 1} of {c.files.length}</span>}
        {own && <StepFiles c={c} prev={prev} next={next} />}
      </div>
      <Tests tests={f.tests} from={c.id} />
      <AlsoIn path={f.path} category={c.id} />
      {f.requirements.length > 0 && (
        <section className="cm-part" aria-labelledby="cm-top-h">
          <h2 id="cm-top-h">What this file must do</h2>
          <ul className="cm-reqs">
            {f.requirements.map((r, i) => {
              const line = placed ? placed.lineOf[i] : -1;
              const where = placed
                ? line >= 0 ? <button type="button" className="link-btn cm-line-link" onClick={() => toReq(i)}>line {line + 1}</button>
                  : r.at ? <span className="cm-lost">Not placed: the line it points at was not found (<code>{r.at}</code>).</span> : <>about the whole file</>
                : r.at ? <>at <code>{r.at}</code></> : undefined;
              return <li key={i} id={`cm-req-${i}`} tabIndex={-1}><Comment at={where}><Txt text={r.text} /></Comment></li>;
            })}
          </ul>
        </section>
      )}
      <section className="cm-part" aria-labelledby="cm-source-h">
        <h2 id="cm-source-h">The file</h2>
        {source.state === "loading" && <p className="muted loading" role="status">Loading the file…</p>}
        {source.state === "off" && <p className="cm-nosource" role="status">The file itself is shown only where the portal runs beside its source code (<code>npm run dev</code>). Its path and what it must do are above.</p>}
        {source.state === "missing" && <p className="cm-nosource" role="status">This file cannot be shown here: it is not tracked by git yet, or it is not a text file the portal may show. Its path and what it must do are above.</p>}
        {source.state === "error" && <LoadError what="The file could not be loaded." error={source.message} onRetry={retry} />}
        {lines && placed && <>
          <ReadBar placed={placed} wrap={wrap === "1"} setWrap={(on) => setWrap(on ? "1" : "0")} next={own ? next : undefined} c={c} />
          <SourceText path={f.path} lines={lines} placed={placed} wrap={wrap === "1"} />
          {own && (prev || next) && <div className="cm-file-foot"><span className="cm-pos">File {index + 1} of {c.files.length}</span><StepFiles c={c} prev={prev} next={next} /></div>}
        </>}
      </section>
    </div>
  );
}

/** The bar that stays in view while a file is read: from comment to comment, wrapping long lines, the next file. */
function ReadBar({ placed, wrap, setWrap, next, c }: { placed: Placement; wrap: boolean; setWrap: (on: boolean) => void; next?: CodeFile; c: CodeCategory }) {
  const bar = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => [...placed.byLine.keys()].sort((a, b) => a - b), [placed]);
  const [cur, setCur] = useState(0);
  const els = () => marks.map((i) => document.getElementById(`cm-c-${i + 1}`));
  const line = () => (bar.current?.getBoundingClientRect().bottom ?? 0) + 16;
  useEffect(() => {
    if (!marks.length) return;
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCur(commentAt(els().map((e) => e?.getBoundingClientRect().top ?? Infinity), line() + 24)));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(frame); };
  }, [marks]); // eslint-disable-line react-hooks/exhaustive-deps
  // the next comment is the first below the bar, the previous one the last above it
  const go = (dir: 1 | -1) => {
    const y = line(), tops = els().map((e) => e?.getBoundingClientRect().top ?? 0);
    const to = dir === 1 ? tops.findIndex((t) => t > y + 8) : tops.map((t, i) => (t < y - 8 ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    if (to >= 0) land(els()[to]);
  };
  return (
    <div className="cm-readbar" ref={bar} role="toolbar" aria-label="Reading this file">
      {marks.length > 0 && (
        <span className="cm-readbar-comments">
          <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous comment"><ChevronUp size={16} aria-hidden="true" /></button>
          <span className="cm-readbar-n" aria-live="polite">{cur > 0 ? `Comment ${cur} of ${marks.length}` : commentCount(marks.length)}</span>
          <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next comment"><ChevronDown size={16} aria-hidden="true" /></button>
        </span>
      )}
      <label className="switch cm-wrap">
        <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
        <span className="switch-ui" />Wrap lines
      </label>
      {next && <a className="btn small ghost cm-readbar-next" href={fileRoute(c.id, next.path)} title={next.path} aria-label={`Next file: ${next.path}`}>Next: {baseName(next.path)}<ChevronRight size={14} aria-hidden="true" /></a>}
    </div>
  );
}

/** The text of a file with line numbers, its anchored requirements as comment blocks above their lines. */
const SourceText = memo(function SourceText({ path, lines, placed, wrap }: { path: string; lines: string[]; placed: Placement; wrap: boolean }) {
  const quiet = useMemo(() => commentLineFlags(path, lines), [path, lines]);
  const box = useRef<HTMLDivElement>(null);
  const over = useOverflows(box, wrap);
  return (
    <div ref={box} className={`cm-code ${wrap ? "wrap" : ""}`} role="region" aria-label={`Source of ${path}`} tabIndex={over ? 0 : undefined} style={{ "--cm-digits": String(lines.length).length } as React.CSSProperties}>
      <div className="cm-code-inner">
        {lines.map((line, i) => (
          <Fragment key={i}>
            {placed.byLine.has(i) && (
              <div className="cm-inline" id={`cm-c-${i + 1}`} tabIndex={-1} role="note" aria-label={`Requirement at line ${i + 1}`}>
                {placed.byLine.get(i)!.map((r, k) => <p key={k}><MessageSquareText size={14} aria-hidden="true" /><span><Txt text={r.text} /></span></p>)}
              </div>
            )}
            <div className={quiet[i] ? "cm-line quiet" : "cm-line"}><span className="cm-ln" aria-hidden="true">{i + 1}</span><span className="cm-text">{line || " "}</span></div>
          </Fragment>
        ))}
      </div>
    </div>
  );
});
