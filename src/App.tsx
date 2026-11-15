import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Eye, LayoutGrid, LogOut, Moon, Pencil, Settings2, Sun } from "lucide-react";
import type { Catalog, Feedback, Me, Process } from "./types";
import {
  createFeedback, deleteFeedback, go, loadCatalog, loadFeedback, loadMe, loadProcesses, logout, putCatalog, putProcess,
  removeProcess, setAlsoHit, setResolved, useRoute, type Loaded,
} from "./lib/store";
import { CatalogContext, EMPTY_CATALOG } from "./lib/catalog";
import { FeedbackContext, MeContext, type FeedbackActions } from "./lib/session";
import { ModeContext, type Mode } from "./lib/mode";
import { blankProcess, tidy, today } from "./lib/edit";
import { CatalogPage } from "./components/CatalogPage";
import { GuidePage } from "./components/GuidePage";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { ProcessPage } from "./components/ProcessPage";
import { AiDialog } from "./components/AiDialog";

const say = (what: string, e: unknown) => alert(`${what}: ${(e as Error).message}`);

function useTheme() {
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem("pm:theme"); if (s) return s === "dark"; } catch { /* ignore */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("pm:theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

/** Signed out: the sign-in screen. Signed in: the app. */
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTheme();
  const refresh = useCallback(() => { loadMe().then(setMe).catch((e) => setError(e.message)); }, []);
  useEffect(refresh, [refresh]);

  if (error) return <main className="login"><div className="login-card"><div className="check bad">{error}</div></div></main>;
  if (!me) return null;
  if (!me.authenticated) return <Login me={me} onSignedIn={refresh} />;
  return <Shell key={me.user!.email} me={me} onSignedOut={refresh} />;
}

function UserMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const role = me.editor ? "Editor" : me.teams?.length ? "Process owner" : "Consumer";
  return (
    <div className="user-menu">
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Your account">
        <span className="avatar">{me.user!.name.slice(0, 1).toUpperCase()}</span><span className="user-name">{me.user!.name}</span>
      </button>
      {open && (
        <div className="user-pop" onMouseLeave={() => setOpen(false)}>
          <strong>{me.user!.name}</strong>
          <span className="muted">{me.user!.email}</span>
          <span className="user-role">{role}{me.teams?.length ? ` · ${me.teams.join(", ")}` : ""}</span>
          <button className="btn small" onClick={async () => { await logout().catch(() => {}); onSignedOut(); }}>
            <LogOut size={14} />{me.provider === "dev" ? "Switch user" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const route = useRoute();
  const [dark, setDark] = useTheme();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [feedback, setFeedback] = useState<Record<string, Feedback[]>>({});
  const [wanted, setWanted] = useState<Mode>(() => {
    try { return localStorage.getItem("pm:mode") === "editor" ? "editor" : "consumer"; } catch { return "consumer"; }
  });
  // the Editor view exists only for people who are editors
  const mode: Mode = me.editor ? wanted : "consumer";
  const switchMode = (m: Mode) => { setWanted(m); try { localStorage.setItem("pm:mode", m); } catch { /* ignore */ } };

  useEffect(() => {
    Promise.all([loadProcesses(), loadCatalog(), loadFeedback()])
      .then(([d, c, f]) => { setCatalog(c); setFeedback(f); setData(d); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const saveCatalog = async (c: Catalog) => {
    try { await putCatalog(c); setCatalog(c); } catch (e) { say("Could not save", e); }
  };

  // feedback is saved the moment it is given - it is not part of the process draft
  const actions = useMemo<FeedbackActions>(() => {
    const put = (item: Feedback) => setFeedback((all) => {
      const list = all[item.processId] ?? [];
      return { ...all, [item.processId]: list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] };
    });
    return {
      add: (spec) => createFeedback(spec).then((item) => { put(item); return true; }, (e) => { say("Could not send your feedback", e); return false; }),
      alsoHit: (item, on) => { setAlsoHit(item.id, on).then(put, (e) => say("Could not record that", e)); },
      resolve: (item, resolved) => { setResolved(item.id, resolved).then(put, (e) => say("Could not change the feedback", e)); },
      remove: (item) => {
        deleteFeedback(item.id).then(
          () => setFeedback((all) => ({ ...all, [item.processId]: (all[item.processId] ?? []).filter((x) => x.id !== item.id) })),
          (e) => say("Could not delete the feedback", e));
      },
    };
  }, []);

  const save = async (p: Process) => {
    try {
      await putProcess(p);
      setData((d) => d && { ...d, processes: [...d.processes.filter((x) => x.id !== p.id), p].sort((a, b) => a.id.localeCompare(b.id)) });
      // editing a step can make feedback on it "may already be fixed"
      loadFeedback().then(setFeedback).catch(() => {});
    } catch (e) {
      say("Could not save", e);
      throw e;
    }
  };
  const create = async (p: Process) => {
    await save(tidy({ ...p, $schema: "../schema/process.schema.json", updatedAt: today() }));
    setAi(false);
    go({ page: "process", id: p.id, tab: "flow" });
  };
  const remove = async (id: string) => {
    try {
      await removeProcess(id);
      setData((d) => d && { ...d, processes: d.processes.filter((x) => x.id !== id) });
      go({ page: "library" });
    } catch (e) { say("Could not delete", e); }
  };

  const processes = data?.processes ?? [];
  const current = route.page === "process" ? processes.find((p) => p.id === route.id) : undefined;

  return (
    <MeContext.Provider value={me}>
    <ModeContext.Provider value={mode}>
    <CatalogContext.Provider value={{ catalog, save: saveCatalog }}>
    <FeedbackContext.Provider value={actions}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
          Process Manager
        </a>
        <nav className="nav">
          <a className={`nav-link ${route.page === "library" || route.page === "process" ? "on" : ""}`} href="#/"><LayoutGrid size={15} /><span>Processes</span></a>
          <a className={`nav-link ${route.page === "catalog" ? "on" : ""}`} href="#/catalog"><Settings2 size={15} /><span>Teams &amp; tools</span></a>
          <a className={`nav-link ${route.page === "guide" ? "on" : ""}`} href="#/guide"><BookOpen size={15} /><span>Guide</span></a>
        </nav>
        <span className="spacer" />
        {me.editor && (
          <div className="mode-switch" role="group" aria-label="Mode">
            <button className={mode === "consumer" ? "on" : ""} aria-pressed={mode === "consumer"} onClick={() => switchMode("consumer")} title="Follow processes and give feedback"><Eye size={14} /><span>Consumer</span></button>
            <button className={mode === "editor" ? "on editor" : ""} aria-pressed={mode === "editor"} onClick={() => switchMode("editor")} title="Change processes, teams, tools and tiers"><Pencil size={14} /><span>Editor</span></button>
          </div>
        )}
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Switch theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <UserMenu me={me} onSignedOut={onSignedOut} />
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
          feedback={feedback[current.id] ?? []} />
        : <div className="page"><h1>Process not found</h1><p className="muted">There is no file <code>processes/{route.id}.json</code>.</p><a className="btn" href="#/">Back to all processes</a></div>)}
      {ai && <AiDialog all={processes} onClose={() => setAi(false)} onImport={create} />}
    </FeedbackContext.Provider>
    </CatalogContext.Provider>
    </ModeContext.Provider>
    </MeContext.Provider>
  );
}
