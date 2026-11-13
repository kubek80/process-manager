import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { Process } from "./types";
import { go, loadProcesses, putProcess, removeProcess, useRoute, type Loaded } from "./lib/store";
import { blankProcess, tidy, today } from "./lib/edit";
import { Library } from "./components/Library";
import { ProcessPage } from "./components/ProcessPage";
import { AiDialog } from "./components/AiDialog";

export default function App() {
  const route = useRoute();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem("pm:theme"); if (s) return s === "dark"; } catch { /* ignore */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("pm:theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);

  useEffect(() => { loadProcesses().then(setData).catch((e) => setError(String(e.message ?? e))); }, []);

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
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
          Process Manager
        </a>
        <span className="local">Local workspace · files in <code>processes/</code></span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Switch theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>

      {error && <div className="page"><div className="check bad">{error}</div></div>}
      {!data && !error && <div className="page"><p className="muted">Loading…</p></div>}
      {data && route.page === "library" && (
        <Library processes={processes} broken={data.broken} onAi={() => setAi(true)}
          onNew={() => create(blankProcess(processes.map((p) => p.id)))} />
      )}
      {data && route.page === "process" && (current
        ? <ProcessPage key={current.id} process={current} all={processes} tab={route.tab} onSave={save} onDelete={() => remove(current.id)} />
        : <div className="page"><h1>Process not found</h1><p className="muted">There is no file <code>processes/{route.id}.json</code>.</p><a className="btn" href="#/">Back to all processes</a></div>)}
      {ai && <AiDialog all={processes} onClose={() => setAi(false)} onImport={create} />}
    </>
  );
}
