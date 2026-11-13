import { useEffect, useState } from "react";
import { BookOpen, Eye, LayoutGrid, Moon, Pencil, Settings2, Sun } from "lucide-react";
import type { Catalog, Feedback, Process } from "./types";
import { go, loadCatalog, loadFeedback, loadProcesses, putCatalog, putFeedback, putProcess, removeProcess, useRoute, type Loaded } from "./lib/store";
import { CatalogContext, EMPTY_CATALOG } from "./lib/catalog";
import { CatalogPage } from "./components/CatalogPage";
import { GuidePage } from "./components/GuidePage";
import { ModeContext, type Mode } from "./lib/mode";
import { blankProcess, tidy, today } from "./lib/edit";
import { Library } from "./components/Library";
import { ProcessPage } from "./components/ProcessPage";
import { AiDialog } from "./components/AiDialog";

export default function App() {
  const route = useRoute();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem("pm:mode") === "editor" ? "editor" : "consumer"; } catch { return "consumer"; }
  });
  const switchMode = (m: Mode) => { setMode(m); try { localStorage.setItem("pm:mode", m); } catch { /* ignore */ } };
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [feedback, setFeedback] = useState<Record<string, Feedback[]>>({});
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem("pm:theme"); if (s) return s === "dark"; } catch { /* ignore */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("pm:theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);

  useEffect(() => {
    Promise.all([loadProcesses(), loadCatalog(), loadFeedback()])
      .then(([d, c, f]) => { setCatalog(c); setFeedback(f); setData(d); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const saveCatalog = async (c: Catalog) => {
    try { await putCatalog(c); setCatalog(c); } catch (e) { alert(`Could not save: ${(e as Error).message}`); }
  };
  // feedback is saved the moment it is given - it is not part of the process draft
  const saveFeedback = (id: string, list: Feedback[]) => {
    setFeedback((f) => ({ ...f, [id]: list }));
    putFeedback(id, list).catch((e) => alert(`Could not save feedback: ${e.message}`));
  };

  const save = async (p: Process) => {
    try {
      await putProcess(p);
      setData((d) => d && { ...d, processes: [...d.processes.filter((x) => x.id !== p.id), p].sort((a, b) => a.id.localeCompare(b.id)) });
    } catch (e) {
      alert(`Could not save: ${(e as Error).message}`);
      throw e;
    }
  };
  const create = async (p: Process) => {
    await save(tidy({ ...p, $schema: "../schema/process.schema.json", updatedAt: today() }));
    setAi(false);
    go({ page: "process", id: p.id, tab: "flow" });
  };
  const remove = async (id: string) => {
    await removeProcess(id);
    setData((d) => d && { ...d, processes: d.processes.filter((x) => x.id !== id) });
    go({ page: "library" });
  };

  const processes = data?.processes ?? [];
  const current = route.page === "process" ? processes.find((p) => p.id === route.id) : undefined;

  return (
    <ModeContext.Provider value={mode}>
    <CatalogContext.Provider value={{ catalog, save: saveCatalog }}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
          Process Manager
        </a>
        <nav className="nav">
          <a className={`nav-link ${route.page === "library" || route.page === "process" ? "on" : ""}`} href="#/"><LayoutGrid size={15} /><span>Processes</span></a>
          <a className={`nav-link ${route.page === "catalog" ? "on" : ""}`} href="#/catalog"><Settings2 size={15} /><span>Teams, tools &amp; tiers</span></a>
          <a className={`nav-link ${route.page === "guide" ? "on" : ""}`} href="#/guide"><BookOpen size={15} /><span>Guide</span></a>
        </nav>
        <span className="spacer" />
        <div className="mode-switch" role="group" aria-label="Mode">
          <button className={mode === "consumer" ? "on" : ""} aria-pressed={mode === "consumer"} onClick={() => switchMode("consumer")} title="Follow processes and give feedback"><Eye size={14} /><span>Consumer</span></button>
          <button className={mode === "editor" ? "on editor" : ""} aria-pressed={mode === "editor"} onClick={() => switchMode("editor")} title="Change processes, teams, tools and tiers"><Pencil size={14} /><span>Editor</span></button>
        </div>
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Switch theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>

      {error && <div className="page"><div className="check bad">{error}</div></div>}
      {!data && !error && <div className="page"><p className="muted">Loading…</p></div>}
      {data && route.page === "library" && (
        <Library processes={processes} broken={data.broken} feedback={feedback} onAi={() => setAi(true)}
          onNew={() => create(blankProcess(processes.map((p) => p.id)))} />
      )}
      {data && route.page === "catalog" && <CatalogPage processes={processes} />}
      {data && route.page === "guide" && <GuidePage />}
      {data && route.page === "process" && (current
        ? <ProcessPage key={current.id} process={current} all={processes} tab={route.tab} onSave={save} onDelete={() => remove(current.id)}
          feedback={feedback[current.id] ?? []} onFeedback={(list) => saveFeedback(current.id, list)} />
        : <div className="page"><h1>Process not found</h1><p className="muted">There is no file <code>processes/{route.id}.json</code>.</p><a className="btn" href="#/">Back to all processes</a></div>)}
      {ai && <AiDialog all={processes} onClose={() => setAi(false)} onImport={create} />}
    </CatalogContext.Provider>
    </ModeContext.Provider>
  );
}
