import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Eye, LayoutGrid, LogOut, Moon, Pencil, Settings2, ShieldCheck, Sun, Users } from "lucide-react";
import type { Catalog, Feedback, FeedbackByTarget, Me, Process, Standard } from "./types";
import {
  createFeedback, deleteFeedback, go, href, loadCatalog, loadFeedback, loadMe, loadProcesses, loadStandards, logout, putCatalog, putProcess, putStandard,
  removeProcess, removeStandard, setAlsoHit, setResolved, useRoute,
} from "./lib/store";
import { CatalogContext, EMPTY_CATALOG } from "./lib/catalog";
import { canEditSomething, canOpenAdmin, canEditStandard, FeedbackContext, MeContext, roleLabel, usePerms, type FeedbackActions } from "./lib/session";
import { ModeContext, type Mode } from "./lib/mode";
import { blankProcess, blankStandard, tidy, tidyStandard, today } from "./lib/edit";
import { AdminPage } from "./components/AdminPage";
import { CatalogPage } from "./components/CatalogPage";
import { GuidePage } from "./components/GuidePage";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { ProcessPage, processAiSpec } from "./components/ProcessPage";
import { StandardPage, standardAiSpec } from "./components/StandardPage";
import { StandardsLibrary } from "./components/StandardsLibrary";
import { AiDialog } from "./components/AiDialog";
import { unitsOf } from "./components/Governance";

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
  return <MeContext.Provider value={me}><Shell key={me.user!.email} me={me} onSignedOut={refresh} /></MeContext.Provider>;
}

function UserMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const perms = usePerms();
  return (
    <div className="user-menu">
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Your account">
        <span className="avatar">{me.user!.name.slice(0, 1).toUpperCase()}</span><span className="user-name">{me.user!.name}</span>
      </button>
      {open && (
        <div className="user-pop" onMouseLeave={() => setOpen(false)}>
          <strong>{me.user!.name}</strong>
          <span className="muted">{me.user!.email}</span>
          <span className="user-role">{roleLabel(perms)}</span>
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
  const perms = usePerms();
  const [dark, setDark] = useTheme();
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<null | "process" | "standard">(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [feedback, setFeedback] = useState<FeedbackByTarget>({ process: {}, standard: {} });
  const [wanted, setWanted] = useState<Mode>(() => {
    try { return localStorage.getItem("pm:mode") === "editor" ? "editor" : "consumer"; } catch { return "consumer"; }
  });
  // the Editor view exists only for people who can edit something
  const mode: Mode = canEditSomething(perms) ? wanted : "consumer";
  const switchMode = (m: Mode) => { setWanted(m); try { localStorage.setItem("pm:mode", m); } catch { /* ignore */ } };

  useEffect(() => {
    Promise.all([loadProcesses(), loadStandards(), loadCatalog(), loadFeedback()])
      .then(([p, s, c, f]) => { setCatalog(c); setFeedback(f); setStandards(s); setProcesses(p); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const saveCatalog = async (c: Catalog) => {
    try { await putCatalog(c); setCatalog(c); } catch (e) { say("Could not save", e); }
  };

  // feedback is saved the moment it is given - it is not part of a draft
  const actions = useMemo<FeedbackActions>(() => {
    const change = (item: Feedback, fn: (list: Feedback[]) => Feedback[]) =>
      setFeedback((all) => ({ ...all, [item.targetKind]: { ...all[item.targetKind], [item.targetId]: fn(all[item.targetKind][item.targetId] ?? []) } }));
    const put = (item: Feedback) => change(item, (list) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]));
    return {
      add: (spec) => createFeedback(spec).then((item) => { put(item); return true; }, (e) => { say("Could not send your feedback", e); return false; }),
      alsoHit: (item, on) => { setAlsoHit(item.id, on).then(put, (e) => say("Could not record that", e)); },
      resolve: (item, resolved) => { setResolved(item.id, resolved).then(put, (e) => say("Could not change the feedback", e)); },
      remove: (item) => { deleteFeedback(item.id).then(() => change(item, (list) => list.filter((x) => x.id !== item.id)), (e) => say("Could not delete the feedback", e)); },
    };
  }, []);

  // editing a step or requirement can make feedback on it "may already be fixed"
  const refreshFeedback = () => { loadFeedback().then(setFeedback).catch(() => {}); };
  const byId = <T extends { id: string }>(list: T[], doc: T) => [...list.filter((x) => x.id !== doc.id), doc].sort((a, b) => a.id.localeCompare(b.id));

  const saveProcess = async (p: Process) => {
    try { await putProcess(p); setProcesses((list) => list && byId(list, p)); refreshFeedback(); } catch (e) { say("Could not save", e); throw e; }
  };
  const createProcess = async (p: Process) => {
    await saveProcess(tidy({ ...p, $schema: "../schema/process.schema.json", updatedAt: today() }));
    setAi(null);
    go({ page: "process", id: p.id, tab: "flow" });
  };
  const deleteProcess = async (id: string) => {
    try { await removeProcess(id); setProcesses((list) => list && list.filter((x) => x.id !== id)); go({ page: "library" }); } catch (e) { say("Could not delete", e); }
  };
  const saveStandard = async (s: Standard) => {
    try { await putStandard(s); setStandards((list) => byId(list, s)); refreshFeedback(); } catch (e) { say("Could not save", e); throw e; }
  };
  const createStandard = async (s: Standard) => {
    await saveStandard(tidyStandard({ ...s, $schema: "../schema/standard.schema.json", updatedAt: today() }));
    setAi(null);
    go({ page: "standard", id: s.id, tab: "doc" });
  };
  const deleteStandard = async (id: string) => {
    try { await removeStandard(id); setStandards((list) => list.filter((x) => x.id !== id)); go({ page: "standards" }); } catch (e) { say("Could not delete", e); }
  };
  // a new standard belongs to a unit the person may edit for
  const myUnit = unitsOf(catalog).find((u) => canEditStandard(perms, u.id))?.id ?? "";

  const all = processes ?? [];
  const process = route.page === "process" ? all.find((p) => p.id === route.id) : undefined;
  const standard = route.page === "standard" ? standards.find((s) => s.id === route.id) : undefined;
  const on = (...pages: string[]) => (pages.includes(route.page) ? "on" : "");

  return (
    <ModeContext.Provider value={mode}>
    <CatalogContext.Provider value={{ catalog, save: saveCatalog }}>
    <FeedbackContext.Provider value={actions}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
          Process Manager
        </a>
        <nav className="nav">
          <a className={`nav-link ${on("library", "process")}`} href={href({ page: "library" })}><LayoutGrid size={15} /><span>Processes</span></a>
          <a className={`nav-link ${on("standards", "standard")}`} href={href({ page: "standards" })}><ShieldCheck size={15} /><span>Standards</span></a>
          <a className={`nav-link ${on("catalog")}`} href={href({ page: "catalog" })}><Users size={15} /><span>Teams &amp; tools</span></a>
          <a className={`nav-link ${on("guide")}`} href={href({ page: "guide" })}><BookOpen size={15} /><span>Guide</span></a>
          {canOpenAdmin(perms) && <a className={`nav-link ${on("admin")}`} href={href({ page: "admin", section: perms.admin ? "access" : "lists" })}><Settings2 size={15} /><span>Admin</span></a>}
        </nav>
        <span className="spacer" />
        {canEditSomething(perms) && (
          <div className="mode-switch" role="group" aria-label="Mode">
            <button className={mode === "consumer" ? "on" : ""} aria-pressed={mode === "consumer"} onClick={() => switchMode("consumer")} title="Read, follow and give feedback"><Eye size={14} /><span>Consumer</span></button>
            <button className={mode === "editor" ? "on editor" : ""} aria-pressed={mode === "editor"} onClick={() => switchMode("editor")} title="Change what you have the right to change"><Pencil size={14} /><span>Editor</span></button>
          </div>
        )}
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Switch theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <UserMenu me={me} onSignedOut={onSignedOut} />
      </header>

      {error && <div className="page"><div className="check bad">{error}</div></div>}
      {!processes && !error && <div className="page"><p className="muted">Loading…</p></div>}
      {processes && route.page === "library" && (
        <Library processes={all} standardIds={standards.map((s) => s.id)} feedback={feedback.process} onAi={() => setAi("process")}
          onNew={() => createProcess(blankProcess(all.map((p) => p.id)))} />
      )}
      {processes && route.page === "standards" && (
        <StandardsLibrary standards={standards} processes={all} feedback={feedback.standard} onAi={() => setAi("standard")}
          onNew={() => createStandard(blankStandard(standards.map((s) => s.id), myUnit))} />
      )}
      {processes && route.page === "catalog" && <CatalogPage processes={all} standards={standards} editable={false} />}
      {processes && route.page === "guide" && <GuidePage />}
      {processes && route.page === "admin" && (canOpenAdmin(perms)
        ? <AdminPage section={route.section} processes={all} standards={standards} feedback={feedback} />
        : <div className="page"><h1>Admin</h1><p className="muted">You do not have access to the Admin panel. An admin can give it to you.</p></div>)}
      {processes && route.page === "process" && (process
        ? <ProcessPage key={process.id} process={process} all={all} standards={standards} tab={route.tab} onSave={saveProcess} onDelete={() => deleteProcess(process.id)}
          feedback={feedback.process[process.id] ?? []} />
        : <div className="page"><h1>Process not found</h1><p className="muted">There is no process “{route.id}”.</p><a className="btn" href="#/">Back to all processes</a></div>)}
      {processes && route.page === "standard" && (standard
        ? <StandardPage key={standard.id} standard={standard} all={standards} processes={all} tab={route.tab} onSave={saveStandard} onDelete={() => deleteStandard(standard.id)}
          feedback={feedback.standard[standard.id] ?? []} />
        : <div className="page"><h1>Standard not found</h1><p className="muted">There is no standard “{route.id}”.</p><a className="btn" href="#/standards">Back to all standards</a></div>)}
      {ai === "process" && <AiDialog spec={processAiSpec(undefined, all, standards, catalog)} onClose={() => setAi(null)} onImport={createProcess} />}
      {ai === "standard" && <AiDialog spec={standardAiSpec(undefined, standards, all, catalog)} onClose={() => setAi(null)} onImport={createStandard} />}
    </FeedbackContext.Provider>
    </CatalogContext.Provider>
    </ModeContext.Provider>
  );
}
