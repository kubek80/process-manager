import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import type { TargetKind } from "../types";
import { platformName, practiceName, teamName, useCatalog } from "../lib/catalog";
import {
  chartScale, csvHref, deletedNote, fillWeeks, firstDir, groupTotals, labelEvery, partialWeek, PERIODS, short, sortRows, weekLabel, weekName,
  type GroupBy, type Period, type SortDir, type SortKey, type Statistics, type StatWeek,
} from "../lib/statistics";
import { href, loadStatistics } from "../lib/store";
import { LoadError, Loading } from "./ui";
import { KindIcon, kindWord } from "./marks";
import "../requests.css";

const PERIOD_KEY = "pm:statistics-period";
const readPeriod = (): Period => {
  try { const p = localStorage.getItem(PERIOD_KEY); if (PERIODS.some((x) => x.id === p)) return p as Period; } catch { /* private mode */ }
  return "30";
};
const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-GB");

const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: "views", label: "Views", hint: "Once per person per day" },
  { key: "people", label: "People", hint: "Different people who viewed it" },
  { key: "downloads", label: "Skill downloads", hint: "Downloads of its skill or review agent" },
  { key: "upvotes", label: "Upvotes", hint: "Given in the period" },
  { key: "feedbackOpen", label: "Feedback open", hint: "Waiting for an answer now" },
  { key: "feedbackHandled", label: "Feedback handled", hint: "Answered in the period" },
];
const GROUP_LABEL: Record<GroupBy, string> = { platform: "By platform", practice: "By practice", team: "By owning team" };
const GROUP_HEAD: Record<GroupBy, string> = { platform: "Platform", practice: "Practice", team: "Owning team" };

/** Admin > Statistics: how much each process and standard is used, over a chosen period. */
export function StatisticsSection() {
  const { catalog } = useCatalog();
  const [period, setPeriod] = useState<Period>(readPeriod);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<TargetKind | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "views", dir: "desc" });
  const [by, setBy] = useState<GroupBy>("platform");

  const load = useCallback(() => {
    setError("");
    let live = true;
    loadStatistics(period).then((s) => live && setStats(s), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [period]);
  useEffect(load, [load]);
  // the period already shown is not loaded again (its numbers would be cleared and never come back)
  const choose = (p: Period) => { if (p === period) return; setPeriod(p); setStats(null); try { localStorage.setItem(PERIOD_KEY, p); } catch { /* private mode */ } };

  const rows = useMemo(() => sortRows((stats?.rows ?? []).filter((r) => kind === "all" || r.kind === kind), sort.key, sort.dir), [stats, kind, sort]);
  const groups = useMemo(() => (stats ? groupTotals(stats, by, catalog) : []), [stats, by, catalog]);
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) }));
  const periodLabel = period === "365" ? "year" : PERIODS.find((p) => p.id === period)!.label.toLowerCase();

  const SortHead = ({ k, label, hint, num }: { k: SortKey; label: string; hint?: string; num?: boolean }) => {
    const on = sort.key === k;
    const Icon = !on ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={num ? "num" : ""} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title={hint}>
        <button className={`stat-sort ${on ? "on" : ""}`} onClick={() => sortBy(k)}>{label}<Icon size={12} aria-hidden="true" /></button>
      </th>
    );
  };

  return (
    <div className="admin-section statistics">
      <div className="lead small stat-about">
        <p>A view counts once per person per day, however often they open it; the portal counts views but nobody, admins included, can see who viewed what. Views by admins and editors count like everyone else's. A skill download counts once per person per skill per day.</p>
        <p>A day runs from midnight to midnight UTC, so for people in other time zones the day changes at another hour.</p>
      </div>
      <div className="stat-toolbar">
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.id} className={`seg-item ${period === p.id ? "on" : ""}`} aria-pressed={period === p.id} onClick={() => choose(p.id)}>{p.label}</button>)}
        </div>
        <span className="spacer" />
        <a className="btn" href={csvHref(period)} download><Download size={16} />Download as CSV</a>
      </div>
      {error && <LoadError what="The statistics could not be loaded." error={error} onRetry={load} />}
      {!stats && !error && <Loading />}
      {stats && <>
        <p className="muted small stat-range">{stats.from ? `From ${stats.from} to ${stats.to}` : `Up to ${stats.to}`}</p>
        {deletedNote(stats.totals) && <p className="muted small stat-deleted">{deletedNote(stats.totals)}</p>}
        <div className="stat-row stat-totals">
          <div className="stat"><strong>{n(stats.totals.views)}</strong><span>views</span></div>
          <div className="stat"><strong>{n(stats.totals.people)}</strong><span>different people</span></div>
          <div className="stat"><strong>{n(stats.totals.downloads)}</strong><span>skill downloads</span></div>
          <div className="stat"><strong>{n(stats.totals.upvotes)}</strong><span>upvotes</span></div>
          <div className="stat"><strong>{n(stats.totals.feedbackOpened)}</strong><span>feedback given</span></div>
          <div className="stat"><strong>{n(stats.totals.feedbackHandled)}</strong><span>feedback handled</span></div>
          <div className="stat"><strong>{n(stats.totals.requests)}</strong><span>requests</span></div>
        </div>

        <section className="admin-card" aria-labelledby="stat-trend">
          <h2 id="stat-trend">Views per week</h2>
          <TrendChart weeks={fillWeeks(stats.trend ?? [])} period={periodLabel} />
        </section>

        <section className="admin-card" aria-labelledby="stat-docs">
          <h2 id="stat-docs">Per process and standard <span>{rows.length}</span></h2>
          <div className="seg stat-seg" role="group" aria-label="Kind">
            {(["all", "process", "standard"] as const).map((k) => (
              <button key={k} className={`seg-item ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : k === "process" ? "Processes" : "Standards"}<span className="seg-n">{stats.rows.filter((r) => k === "all" || r.kind === k).length}</span>
              </button>
            ))}
          </div>
          {rows.length === 0 ? <p className="muted">Nothing to count yet.</p> : (
            <div className="stat-table-wrap" tabIndex={0} role="region" aria-label="Statistics per process and standard">
              <table className="stat-table">
                <thead><tr>
                  <SortHead k="title" label="Name" />
                  <th>Belongs to</th>
                  {COLUMNS.map((c) => <SortHead key={c.key} k={c.key} label={c.label} hint={c.hint} num />)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const belongs = [r.platform && platformName(catalog, r.platform), r.practice && practiceName(catalog, r.practice)].filter(Boolean).join(" · ");
                    return (
                    <tr key={r.kind + r.id}>
                      <td className="stat-name"><div className="stat-name-in">
                        <span className={`stat-kind ${r.kind}`} title={kindWord(r.kind)}><KindIcon kind={r.kind} size={12} /><span className="stat-sr-only">{kindWord(r.kind)}: </span></span>
                        <span className="stat-title">
                          <a href={href(r.kind === "process" ? { page: "process", id: r.id, tab: "flow" } : { page: "standard", id: r.id, tab: "doc" })} title={r.title}>{r.title}</a>
                          {r.status && r.status !== "active" && <span className={`tier-tag status-${r.status}`}>{r.status === "draft" ? "Draft" : "Retired"}</span>}
                        </span>
                      </div></td>
                      <td className="stat-belongs">
                        {r.owner ? <span className="stat-owner">{teamName(catalog, r.owner)}</span> : <span className="muted">No owning team</span>}
                        {belongs && <span className="stat-scope">{belongs}</span>}
                      </td>
                      <td className="num">{n(r.views)}</td>
                      <td className="num">{n(r.people)}</td>
                      <td className="num">{n(r.downloads)}</td>
                      <td className="num" title={`${n(r.upvotesTotal)} in total`}>{n(r.upvotes)}</td>
                      <td className="num">{r.feedbackOpen ? <a className="tier-tag flagged" href={href(r.kind === "process" ? { page: "process", id: r.id, tab: "feedback" } : { page: "standard", id: r.id, tab: "feedback" })}>{n(r.feedbackOpen)}</a> : 0}</td>
                      <td className="num">{n(r.feedbackHandled)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Views, people, skill downloads, upvotes and handled feedback are counted in the chosen period; open feedback is as of now.</p>
        </section>

        <section className="admin-card" aria-labelledby="stat-groups">
          <h2 id="stat-groups">Totals</h2>
          <div className="seg stat-seg" role="group" aria-label="Totals grouped">
            {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => <button key={g} className={`seg-item ${by === g ? "on" : ""}`} aria-pressed={by === g} onClick={() => setBy(g)}>{GROUP_LABEL[g]}</button>)}
          </div>
          {groups.length === 0 ? <p className="muted">Nothing to count yet.</p> : (
            <div className="stat-table-wrap" tabIndex={0} role="region" aria-label={`Totals ${GROUP_LABEL[by].toLowerCase()}`}>
              <table className="stat-table">
                <thead><tr><th>{GROUP_HEAD[by]}</th><th className="num">Processes and standards</th><th className="num">Views</th><th className="num" title="Different people; one person who read several counts once where the portal can tell">People</th><th className="num">Skill downloads</th><th className="num">Upvotes</th><th className="num">Feedback handled</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id || "none"} className={g.id ? "" : "stat-none"}>
                      <td>{g.name}</td><td className="num">{n(g.documents)}</td><td className="num">{n(g.views)}</td><td className="num">{n(g.people)}</td>
                      <td className="num">{n(g.downloads)}</td><td className="num">{n(g.upvotes)}</td><td className="num">{n(g.feedbackHandled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </div>
  );
}

/** Columns of views per week, drawn at the size of its box so that the labels stay readable. */
function TrendChart({ weeks, period }: { weeks: StatWeek[]; period: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    set();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    watch?.observe(el);
    return () => watch?.disconnect();
  }, []);
  const total = weeks.reduce((s, w) => s + w.views, 0);
  if (!weeks.length || total === 0) return <div ref={box}><p className="muted stat-nodata">{period === "all time" ? "Nothing has been viewed yet." : `No views in the last ${period}.`}</p></div>;

  const height = 200, left = 40, right = 8, top = 12, bottom = 26;
  const plotW = width - left - right, plotH = height - top - bottom;
  const { top: max, ticks } = chartScale(Math.max(...weeks.map((w) => w.views)));
  const slot = plotW / weeks.length;
  const bar = Math.max(2, Math.min(36, slot - Math.max(2, slot * 0.25)));
  const every = labelEvery(weeks.length, Math.max(2, Math.floor(plotW / 56)));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const first = weeks[0].week, last = weeks[weeks.length - 1].week;
  return (
    <div ref={box} className="stat-trend">
      <svg width={width} height={height} role="img" aria-label={`Views per week, from the week of ${weekLabel(first)} to the week of ${weekLabel(last)}: ${total} views in all. The numbers are in the table that follows.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="stat-grid" x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
            <text className="stat-axis" x={left - 6} y={y(t)} dy="0.32em" textAnchor="end">{short(t)}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = left + i * slot + (slot - bar) / 2;
          const h = Math.max(w.views > 0 ? 2 : 0, (w.views / max) * plotH);
          return (
            <g key={w.week}>
              <rect className={`stat-bar ${partialWeek(w) ? "partial" : ""}`} x={x} y={top + plotH - h} width={bar} height={h} rx={Math.min(4, bar / 2)}>
                <title>{`${weekName(w)}: ${w.views} views, ${w.people} people, ${w.downloads} skill downloads`}</title>
              </rect>
              {(i % every === 0 || weeks.length === 1) && <text className="stat-axis" x={left + i * slot + slot / 2} y={height - 8} textAnchor="middle">{weekLabel(w.week)}</text>}
            </g>
          );
        })}
        <line className="stat-baseline" x1={left} x2={width - right} y1={top + plotH} y2={top + plotH} />
      </svg>
      {weeks.some(partialWeek) && <p className="muted small stat-partial-note"><span className="stat-swatch partial" aria-hidden="true" />Lighter bars: weeks only partly inside the period (the first or the last).</p>}
      <table className="stat-sr-only">
        <caption>Views per week</caption>
        <thead><tr><th>Week</th><th>Views</th><th>People</th><th>Skill downloads</th></tr></thead>
        <tbody>{weeks.map((w) => <tr key={w.week}><td>{weekName(w)}</td><td>{w.views}</td><td>{w.people}</td><td>{w.downloads}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
