import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, FileCode2, FlaskConical, MessageSquareText, Search, Table2 } from "lucide-react";
import { AREAS, CATEGORIES } from "../codemap";
import type { CodeCategory, CodeChart, CodeExample, CodeFile, CodeTable, Requirement } from "../codemap/types";
import {
  alsoIn, categoriesOf, categoryById, commentCount, commentLineFlags, countLine, fileHome, fileIn, firstSentence, hitCount,
  inlineParts, linesOf, neighbours, placeComments, searchMap, tableAnchor, type MapHit, type Placement,
} from "../lib/codemap";
import { useMedia } from "../lib/media";
import { wordsOf } from "../lib/search";
import { ApiError, copyText, go, href, loadSource, loadSystem, parseRoute, type CodeView } from "../lib/store";
import { Marked } from "./DocCard";
import { FlowView } from "./FlowView";
import { LoadError, scrollBehavior } from "./ui";
import "../codemap.css";

/**
 * Admin › Code map (`#/admin/code`): the portal's own source sorted into categories for whoever
 * reviews it (`src/codemap`). The overview finds a file, a table or a word over the whole map;
 * a category shows what its part must do, its charts, tables, worked examples and files; a file
 * shows its text from the server (`GET /api/admin/source`) with its requirements as comments
 * above the lines they are about. Its logic is `src/lib/codemap.ts`.
 */

/** The category list beside the page from this width; below it, a menu above the page. */
const WIDE = "(min-width: 1120px)";
/** At most this many hits of one category are shown before "Show all". */
const HITS_SHOWN = 8;

const codeRoute = (v: CodeView) => href({ page: "admin", section: "code", ...v });
const fileRoute = (category: string, file: string) => codeRoute({ category, file });

/** The part of the address that is the code map's, followed as it changes (the app passes only the section). */
function useCodeView(): CodeView {
  const read = () => {
    const r = parseRoute(typeof location === "undefined" ? "" : location.hash);
    return r.page === "admin" && r.section === "code" ? { category: r.category, file: r.file, q: r.q } : {};
  };
  const [view, setView] = useState<CodeView>(read);
  useEffect(() => {
    const on = () => setView(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return view;
}

/** A text of the map: what its writer put between backticks is shown as code; `words` are marked. */
function Txt({ text, words }: { text: string; words?: string[] }) {
  return <>{inlineParts(text).map((p, i) => {
    const t = words ? <Marked text={p.text} words={words} /> : p.text;
    return p.code ? <code key={i}>{t}</code> : <Fragment key={i}>{t}</Fragment>;
  })}</>;
}

// A search hit for a table opens its category at the table: the place to go to, taken once by the category.
let pendingAnchor: string | null = null;

/** Brings an element of the page to the top of the window and puts the focus on it. */
function bringTo(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  el.focus({ preventScroll: true });
}

export function CodeMapPage({ label, hint }: { label: string; hint: string }) {
  const view = useCodeView();
  const wide = useMedia(WIDE);
  const heading = useRef<HTMLHeadingElement>(null);
  const category = categoryById(CATEGORIES, view.category);

  // a category or a file was opened: start at the top, with the focus on its heading
  const where = view.category ? `${view.category}/${view.file ?? ""}` : "";
  useEffect(() => {
    if (!where) return;
    const target = pendingAnchor ? document.getElementById(pendingAnchor) : null;
    pendingAnchor = null;
    if (target) { bringTo(target); return; }
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [where]);

  if (!view.category) return <Overview label={label} hint={hint} q={view.q ?? ""} />;

  const file = fileIn(category, view.file);
  let body: ReactNode;
  if (!category) {
    body = <NotFound heading={heading} title="Not in the code map" text={<>There is no category “{view.category}” in the code map.</>} back={{ to: codeRoute({}), label: "Back to the code map" }} />;
  } else if (view.file && !file) {
    const elsewhere = alsoIn(CATEGORIES, view.file, category.id);
    body = <NotFound heading={heading} title={`Not in ${category.title}`}
      text={<><code className="cm-path">{view.file}</code> is not one of the files of {category.title}.{elsewhere.length > 0 && <> It is in{" "}
        {elsewhere.map((c, i) => <Fragment key={c.id}>{i > 0 && ", "}<a href={fileRoute(c.id, view.file!)}>{c.title}</a></Fragment>)}.</>}</>}
      back={{ to: codeRoute({ category: category.id }), label: `Back to ${category.title}` }} />;
  } else if (file) {
    body = <FileView key={`${category.id}/${file.path}`} category={category} file={file} heading={heading} />;
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
      <a className="cm-cats-all" href={codeRoute({})}><ArrowLeft size={14} />Overview</a>
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

function Crumbs({ category }: { category?: CodeCategory }) {
  const area = category && AREAS.find((a) => a.id === category.area);
  return (
    <p className="cm-crumbs">
      <a href={codeRoute({})}>Code map</a>
      {area && <><span aria-hidden="true">›</span><span>{area.title}</span></>}
      {category && <><span aria-hidden="true">›</span><a href={codeRoute({ category: category.id })}>{category.title}</a></>}
    </p>
  );
}

function NotFound({ heading, title, text, back }: { heading: React.RefObject<HTMLHeadingElement | null>; title: string; text: ReactNode; back: { to: string; label: string } }) {
  return (
    <div className="cm-page cm-not-found">
      <Crumbs />
      <header className="admin-head"><h1 ref={heading} tabIndex={-1}>{title}</h1><p className="lead">{text}</p></header>
      <a className="btn small" href={back.to}><ArrowLeft size={14} />{back.label}</a>
    </div>
  );
}

// ---------- the overview

function Overview({ label, hint, q }: { label: string; hint: string; q: string }) {
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]); // Back and Forward bring another search
  const results = useMemo(() => searchMap(CATEGORIES, text), [text]);
  const words = useMemo(() => wordsOf(text), [text]);
  const searching = words.length > 0;
  const n = hitCount(results);
  const tables = categoryById(CATEGORIES, "tables"), vectors = categoryById(CATEGORIES, "vectors");
  return (
    <div className="cm-page cm-overview">
      <header className="admin-head">
        <h1>{label}</h1>
        <p className="lead">{hint}: every part of it in a category that says what the part must do, shows how it works in flow charts and lists its files. Open a file to read it with its requirements as comments above the lines they are about.</p>
      </header>
      <div className="cm-find">
        <label className="search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={text} placeholder="Find a file, a table or a word" aria-label="Find a file, a table or a word"
            onChange={(e) => { setText(e.target.value); go({ page: "admin", section: "code", q: e.target.value }, { replace: true }); }} />
        </label>
        {!searching && tables && vectors && <p className="muted small">New to the code? Start with <a href={codeRoute({ category: tables.id })}>{tables.title}</a>, then <a href={codeRoute({ category: vectors.id })}>{vectors.title}</a>.</p>}
      </div>
      {searching
        ? <section className="cm-results" aria-labelledby="cm-results-h">
          <h2 id="cm-results-h" aria-live="polite">{n === 0 ? "Nothing found" : `${n} ${n === 1 ? "place" : "places"} in ${results.length} ${results.length === 1 ? "category" : "categories"}`}</h2>
          {n === 0 && <p className="muted">No path, role, requirement or table contains all of “{text.trim()}”. Try fewer or shorter words.</p>}
          {results.map((r) => <ResultGroup key={r.category.id} category={r.category} hits={r.hits} words={words} />)}
        </section>
        : AREAS.map((a) => (
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
    </div>
  );
}

const HIT_ICON = { file: FileCode2, requirement: MessageSquareText, table: Table2 } as const;
const HIT_WORD = { file: "File", requirement: "Requirement", table: "Table" } as const;

function ResultGroup({ category, hits, words }: { category: CodeCategory; hits: MapHit[]; words: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? hits : hits.slice(0, HITS_SHOWN);
  const target = (h: MapHit) => (h.file ? fileRoute(category.id, h.file) : codeRoute({ category: category.id }));
  return (
    <div className="cm-group">
      <h3><a href={codeRoute({ category: category.id })}>{category.title}</a><span className="cm-count">{hits.length}</span></h3>
      <ul className="cm-hits">
        {shown.map((h, i) => {
          const Icon = HIT_ICON[h.kind];
          return (
            <li key={i}>
              <a href={target(h)} onClick={() => { pendingAnchor = h.table ? tableAnchor(h.table) : h.kind === "requirement" && !h.file ? "code-must" : null; }}>
                <Icon size={15} aria-hidden="true" /><span className="cm-sr">{HIT_WORD[h.kind]}: </span>
                <span className="cm-hit-text">
                  <span className={h.kind === "requirement" ? "" : "cm-path"}>{h.kind === "requirement" ? <Txt text={h.text} words={words} /> : <Marked text={h.text} words={words} />}</span>
                  {h.detail && <em><Txt text={h.detail} words={words} /></em>}
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
function Comment({ children, at, id, label }: { children: ReactNode; at?: ReactNode; id?: string; label?: string }) {
  return (
    <div className="cm-comment" role="note" id={id} tabIndex={id ? -1 : undefined} aria-label={label}>
      <MessageSquareText size={15} aria-hidden="true" />
      <div><p>{children}</p>{at && <p className="cm-at">{at}</p>}</div>
    </div>
  );
}

/** A path that opens its file where the map describes it; plain text where no category does. */
function FileLink({ path, from }: { path: string; from?: string }) {
  const home = fileHome(CATEGORIES, from, path);
  return home ? <a className="cm-path" href={fileRoute(home, path)}>{path}</a> : <code className="cm-path">{path}</code>;
}

function PathList({ paths, from }: { paths: string[]; from?: string }) {
  return <>{paths.map((p, i) => <Fragment key={p}>{i > 0 && <span className="cm-sep" aria-hidden="true"> · </span>}<FileLink path={p} from={from} /></Fragment>)}</>;
}

function CategoryView({ category: c, heading }: { category: CodeCategory; heading: React.RefObject<HTMLHeadingElement | null> }) {
  const parts = [
    { id: "code-must", label: "What it must do", n: c.requirements.length },
    { id: "code-charts", label: "How it works", n: c.charts.length },
    { id: "code-tables", label: "Tables", n: c.tables?.length ?? 0 },
    { id: "code-examples", label: "Examples", n: c.examples?.length ?? 0 },
    { id: "code-files", label: "Files", n: c.files.length },
  ].filter((p) => p.n > 0);
  return (
    <div className="cm-page cm-category">
      <Crumbs />
      <header className="admin-head">
        <h1 ref={heading} tabIndex={-1}>{c.title}</h1>
        {c.summary && <p className="lead"><Txt text={c.summary} /></p>}
        <p className="cm-count">{countLine(c)}</p>
      </header>
      {parts.length > 1 && (
        <nav className="cm-jump" aria-label="On this page">
          {parts.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => bringTo(document.getElementById(p.id))}>{p.label}<span>{p.n}</span></button>
          ))}
        </nav>
      )}
      {c.requirements.length > 0 && (
        <section id="code-must" className="cm-part" tabIndex={-1} aria-labelledby="code-must-h">
          <h2 id="code-must-h">What this part must do</h2>
          <ul className="cm-reqs">{c.requirements.map((r, i) => <li key={i}><Comment><Txt text={r} /></Comment></li>)}</ul>
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
          {c.tables!.map((t) => <TableBlock key={t.name} table={t} from={c.id} />)}
        </section>
      )}
      {(c.examples?.length ?? 0) > 0 && (
        <section id="code-examples" className="cm-part" tabIndex={-1} aria-labelledby="code-examples-h">
          <h2 id="code-examples-h">Worked examples</h2>
          {c.examples!.map((e) => <ExampleBlock key={e.title} example={e} from={c.id} />)}
        </section>
      )}
      <section id="code-files" className="cm-part" tabIndex={-1} aria-labelledby="code-files-h">
        <h2 id="code-files-h">Files</h2>
        <ul className="cm-files">{c.files.map((f) => <FileBlock key={f.path} file={f} category={c} />)}</ul>
      </section>
    </div>
  );
}

const NO_STEPS = new Set<string>();

function Chart({ chart }: { chart: CodeChart }) {
  return (
    <figure className="cm-chart guide-fig">
      <h3>{chart.process.title}</h3>
      <FlowView bare editable={false} process={chart.process} selectedId={null} done={NO_STEPS} feedback={[]} onSelect={() => {}} />
      <figcaption><Txt text={chart.caption} /></figcaption>
    </figure>
  );
}

function TableBlock({ table: t, from }: { table: CodeTable; from: string }) {
  return (
    <article className="cm-table" id={tableAnchor(t.name)} tabIndex={-1} aria-labelledby={`${tableAnchor(t.name)}-h`}>
      <h3 id={`${tableAnchor(t.name)}-h`}><Table2 size={16} aria-hidden="true" /><span className="cm-path">{t.name}</span></h3>
      <p><Txt text={t.purpose} /></p>
      <div className="cm-scroll" tabIndex={0} role="region" aria-label={`Columns of ${t.name}`}>
        <table className="cm-cols">
          <thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Note</th></tr></thead>
          <tbody>{t.columns.map((col) => <tr key={col.name}><td className="cm-path">{col.name}</td><td className="cm-path cm-type">{col.type}</td><td>{col.note ? <Txt text={col.note} /> : ""}</td></tr>)}</tbody>
        </table>
      </div>
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

function ExampleBlock({ example: e, from }: { example: CodeExample; from: string }) {
  return (
    <article className="cm-example">
      <h3>{e.title}</h3>
      <p className="muted"><Txt text={e.caption} /></p>
      <ol className="cm-stages">
        {e.stages.map((s, i) => (
          <li key={i}>
            {i > 0 && <ArrowDown className="cm-arrow" size={18} aria-hidden="true" />}
            <div className="cm-stage">
              <p className="cm-stage-head"><span className="cm-stage-n">{i + 1}</span><strong><Txt text={s.label} /></strong>{s.where && <FileLink path={s.where} from={from} />}</p>
              {s.note && <p className="cm-stage-note"><Txt text={s.note} /></p>}
              <pre className="cm-shape" tabIndex={0} aria-label={`${s.label}: the data`}>{s.shape}</pre>
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

function FileBlock({ file: f, category: c }: { file: CodeFile; category: CodeCategory }) {
  return (
    <li className="cm-file">
      <div className="cm-file-head">
        <h3><a className="cm-path" href={fileRoute(c.id, f.path)}>{f.path}</a></h3>
        {c.start === f.path && <span className="cm-start">Read first</span>}
        <a className="btn small ghost cm-open" href={fileRoute(c.id, f.path)} aria-label={`Open ${f.path}`}><FileCode2 size={14} aria-hidden="true" />Open</a>
      </div>
      <p className="cm-role"><Txt text={f.role} /></p>
      {f.requirements.length > 0 && <ul className="cm-reqs">{f.requirements.map((r, i) => <li key={i}><Comment at={r.at ? <>at <code>{r.at}</code></> : undefined}><Txt text={r.text} /></Comment></li>)}</ul>}
      <Tests tests={f.tests} from={c.id} />
      <AlsoIn path={f.path} category={c.id} />
    </li>
  );
}

// ---------- a file

type Source = { state: "loading" } | { state: "none" } | { state: "error"; message: string } | { state: "ok"; text: string };

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
      if ((await showsSource()) === false) return { state: "none" } as Source;
      try {
        return { state: "ok", text: (await loadSource(path)).text } as Source;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { state: "none" } as Source;
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

function FileView({ category: c, file: f, heading }: { category: CodeCategory; file: CodeFile; heading: React.RefObject<HTMLHeadingElement | null> }) {
  const [source, retry] = useSource(f.path);
  const { prev, next, index } = neighbours(c, f.path);
  const lines = useMemo(() => (source.state === "ok" ? linesOf(source.text) : null), [source]);
  const placed = useMemo(() => (lines ? placeComments(lines, f.requirements) : null), [lines, f.requirements]);
  // without the text, every requirement is shown at the top, the anchored ones with the line they are about
  const top: { r: Requirement; lost?: boolean }[] = placed
    ? [...placed.top.map((r) => ({ r })), ...placed.lost.map((r) => ({ r, lost: true }))]
    : f.requirements.map((r) => ({ r }));
  return (
    <div className="cm-page cm-file-page">
      <Crumbs category={c} />
      <header className="admin-head cm-file-title">
        <h1 ref={heading} tabIndex={-1} className="cm-path">{f.path}</h1>
        <p className="lead"><Txt text={f.role} /></p>
      </header>
      <div className="cm-file-bar">
        <a className="btn small" href={codeRoute({ category: c.id })}><ArrowLeft size={14} aria-hidden="true" />Back to {c.title}</a>
        <CopyPath path={f.path} />
        <span className="cm-pos">File {index + 1} of {c.files.length}</span>
        <span className="cm-step">
          {prev ? <a className="btn small ghost" href={fileRoute(c.id, prev.path)} title={prev.path} aria-label={`Previous file: ${prev.path}`}><ChevronLeft size={14} aria-hidden="true" />{baseName(prev.path)}</a> : null}
          {next ? <a className="btn small ghost" href={fileRoute(c.id, next.path)} title={next.path} aria-label={`Next file: ${next.path}`}>{baseName(next.path)}<ChevronRight size={14} aria-hidden="true" /></a> : null}
        </span>
      </div>
      <Tests tests={f.tests} from={c.id} />
      <AlsoIn path={f.path} category={c.id} />
      {top.length > 0 && (
        <section className="cm-part" aria-labelledby="cm-top-h">
          <h2 id="cm-top-h">What this file must do</h2>
          <ul className="cm-reqs">
            {top.map(({ r, lost }, i) => (
              <li key={i}>
                <Comment at={lost ? <span className="cm-lost">Not placed: the line it points at was not found (<code>{r.at}</code>).</span> : !placed && r.at ? <>at <code>{r.at}</code></> : undefined}><Txt text={r.text} /></Comment>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="cm-part" aria-labelledby="cm-source-h">
        <h2 id="cm-source-h">The file</h2>
        {source.state === "loading" && <p className="muted loading" role="status">Loading the file…</p>}
        {source.state === "none" && <p className="cm-nosource" role="status">The file itself is shown only where the portal runs beside its source code (<code>npm run dev</code>). Its path and what it must do are above.</p>}
        {source.state === "error" && <LoadError what="The file could not be loaded." error={source.message} onRetry={retry} />}
        {lines && placed && <SourceText path={f.path} lines={lines} placed={placed} />}
      </section>
    </div>
  );
}

/** The text of a file with line numbers, its anchored requirements as comment blocks above their lines. */
const SourceText = memo(function SourceText({ path, lines, placed }: { path: string; lines: string[]; placed: Placement }) {
  const quiet = useMemo(() => commentLineFlags(path, lines), [path, lines]);
  const marks = useMemo(() => [...placed.byLine.keys()].sort((a, b) => a - b), [placed]);
  const commentId = (i: number) => `cm-c-${i + 1}`;
  const count = marks.reduce((n, i) => n + placed.byLine.get(i)!.length, 0);
  return (
    <>
      {count > 0 && (
        <p className="cm-marks">
          <span>{commentCount(count)}:</span>{" "}
          {marks.map((i, k) => (
            <Fragment key={i}>{k > 0 && <span className="cm-sep" aria-hidden="true"> · </span>}
              <button type="button" className="link-btn" onClick={() => bringTo(document.getElementById(commentId(i)))}>{k === 0 ? `line ${i + 1}` : i + 1}</button>
            </Fragment>
          ))}
        </p>
      )}
      <div className="cm-code" role="region" aria-label={`Source of ${path}`} tabIndex={0} style={{ "--cm-digits": String(lines.length).length } as React.CSSProperties}>
        <div className="cm-code-inner">
          {lines.map((line, i) => (
            <Fragment key={i}>
              {placed.byLine.has(i) && (
                <div className="cm-inline" id={commentId(i)} tabIndex={-1} role="note" aria-label={`Requirement at line ${i + 1}`}>
                  {placed.byLine.get(i)!.map((r, k) => <p key={k}><MessageSquareText size={14} aria-hidden="true" /><span><Txt text={r.text} /></span></p>)}
                </div>
              )}
              <div className={quiet[i] ? "cm-line quiet" : "cm-line"}><span className="cm-ln" aria-hidden="true">{i + 1}</span><span className="cm-text">{line || " "}</span></div>
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
});
