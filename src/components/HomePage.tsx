import { useMemo, useState } from "react";
import { ArrowRight, LayoutGrid, ShieldCheck } from "lucide-react";
import type { Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { useVisibleDrafts } from "../lib/session";
import { go, href } from "../lib/store";
import { search, type FilterKey } from "../lib/search";
import { SearchBox } from "./SearchPage";
import "../search.css";

const WAYS: { key: Extract<FilterKey, "platform" | "practice" | "category">; title: string; hint: string }[] = [
  { key: "platform", title: "By platform", hint: "Everything about one platform" },
  { key: "practice", title: "By practice", hint: "Everything a practice looks after" },
  { key: "category", title: "By category", hint: "Everything on one subject" },
];

/** The start: one search over processes and standards, and ways to browse them. */
export function HomePage({ processes, standards }: { processes: Process[]; standards: Standard[] }) {
  const { catalog } = useCatalog();
  const drafts = useVisibleDrafts(); // drafts only count for those who may edit them, as they are only shown to them
  const [text, setText] = useState("");
  const out = useMemo(() => search({ processes, standards, catalog, drafts }), [processes, standards, catalog, drafts]);
  const count = (kind: string) => out.options.type.find((o) => o.value === kind)?.count ?? 0;
  const nProcesses = count("process");
  const nStandards = count("standard");

  return (
    <div className="page home-page">
      <section className="home-search" aria-labelledby="home-title">
        <h1 id="home-title">Find a process or a standard</h1>
        <p className="lead">How to get something done, step by step, and the rules your work has to meet.</p>
        <SearchBox big autoFocus value={text} onChange={setText} onSubmit={() => go({ page: "search", q: text })} />
      </section>

      <div className="home-all">
        <a className="home-entry" href={href({ page: "library" })}>
          <span className="home-entry-icon process"><LayoutGrid size={18} aria-hidden="true" /></span>
          <span className="home-entry-text"><b>All processes</b><span className="muted">How to get something done, step by step</span></span>
          <span className="home-entry-count">{nProcesses}<span className="search-sr"> processes</span></span>
          <ArrowRight size={16} className="home-entry-go" aria-hidden="true" />
        </a>
        <a className="home-entry" href={href({ page: "standards" })}>
          <span className="home-entry-icon standard"><ShieldCheck size={18} aria-hidden="true" /></span>
          <span className="home-entry-text"><b>All standards</b><span className="muted">Rules set by cyber security, platforms and practices</span></span>
          <span className="home-entry-count">{nStandards}<span className="search-sr"> standards</span></span>
          <ArrowRight size={16} className="home-entry-go" aria-hidden="true" />
        </a>
      </div>

      <div className="home-browse">
        {WAYS.map(({ key, title, hint }) => {
          const options = out.options[key].filter((o) => o.count > 0);
          if (!options.length) return null;
          return (
            <section key={key} className="home-group" data-browse={key} aria-labelledby={`home-${key}`}>
              <h2 id={`home-${key}`}>{title}</h2>
              <p className="muted small">{hint}</p>
              <ul className="home-links">
                {options.map((o) => (
                  <li key={o.value}>
                    <a className="chip" href={href({ page: "search", [key]: [o.value] })} aria-label={`${o.label}, ${o.count} ${o.count === 1 ? "result" : "results"}`}>
                      {o.label}<span>{o.count}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
