import { useLayoutEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import type { Me } from "../types";
import { changeBlocked, mayViewAs, opensChange } from "../lib/rights";
import { personLabel } from "../lib/members";
import { useMe } from "../lib/session";
import { startViewAs, stopViewAs } from "../lib/store";
import { returnPlace, VIEW_AS_BUTTON, viewAsHint, viewAsName, viewingEnds } from "../lib/users";
import { notify } from "./ui";
import "../viewas.css";

/** Where the place viewing started from is kept: this tab only, a convenience, never a right. */
const RETURN_KEY = "pm:viewAsReturn";
/** Said when a link to the editing screen is pressed (or its address typed) while viewing, with the reason under it. */
export const EDIT_CLOSED = "The editing screen does not open while you view the portal as somebody else.";

const remember = (hash: string) => { try { sessionStorage.setItem(RETURN_KEY, hash); } catch { /* storage off: back to Admin › Access */ } };
const recall = () => { try { const v = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); return v; } catch { return null; } };

/** Opens `hash` with everything loaded afresh: nothing the admin's own view had loaded stays on the page of the other person, or back. */
function reopenAt(hash: string) {
  if (window.location.hash !== hash) window.location.hash = hash;
  window.location.reload();
}

/** The reader's page of what an editing-screen address opens: `#/p/x/edit/…` becomes `#/p/x`. */
const readerOf = (hash: string) => hash.replace(/^(#\/[ps]\/[^/]+)\/edit(?:\/.*)?$/, "$1");

/**
 * The band shown while an admin views the portal as somebody else: on every page, the editing
 * screen and dialogs included, fixed to the bottom of the window so that it cannot be scrolled
 * away (`src/viewas.css`), never printed. It names whose view it is, says that nothing can be
 * changed and when it ends by itself, and has "Stop viewing". The server refuses every change;
 * the band keeps the editing screen closed, since work typed there could not be saved.
 */
export function ViewAsBand({ me }: { me: Me }) {
  const label = personLabel({ email: me.user?.email ?? "", name: me.user?.name });
  const blocked = changeBlocked(me);
  const ends = viewingEnds(me.viewedBy?.until);
  const [busy, setBusy] = useState(false);
  const band = useRef<HTMLDivElement>(null);

  // the page knows it, for the styles (room for the band, the editing screen's height)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("viewing-as");
    const set = () => root.style.setProperty("--viewas-h", `${Math.ceil(band.current?.getBoundingClientRect().height ?? 0)}px`);
    set();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    if (band.current) watch?.observe(band.current);
    return () => { watch?.disconnect(); root.classList.remove("viewing-as"); root.style.removeProperty("--viewas-h"); };
  }, []);

  // the editing screen stays closed: its links say why instead, and an address typed in goes to the reader's page
  useLayoutEffect(() => {
    const away = () => {
      if (!opensChange(window.location.hash)) return;
      window.location.replace(readerOf(window.location.hash));
      notify.error(EDIT_CLOSED, blocked);
    };
    const click = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || !opensChange(link.getAttribute("href") ?? "")) return;
      e.preventDefault();
      e.stopPropagation();
      notify.error(EDIT_CLOSED, blocked);
    };
    away();
    window.addEventListener("hashchange", away);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("hashchange", away); document.removeEventListener("click", click, true); };
  }, [blocked]);

  const stop = () => {
    setBusy(true);
    stopViewAs().then(() => reopenAt(returnPlace(recall())), (e) => { setBusy(false); notify.error("Viewing could not be stopped.", e); });
  };

  return (
    <div ref={band} className="viewas-band" role="region" aria-label="Viewing the portal as somebody else">
      <Eye size={18} aria-hidden="true" className="viewas-icon" />
      <p className="viewas-text">
        <span>Viewing the portal as <strong className="viewas-who" title={me.user?.email}>{label}</strong></span>
        <span className="viewas-rule">Nothing can be changed</span>
        {ends && <span className="viewas-ends">Ends by itself at {ends}</span>}
      </p>
      <button className="btn small viewas-stop" disabled={busy} onClick={stop}><X size={15} aria-hidden="true" />Stop viewing</button>
    </div>
  );
}

/**
 * "View as" for one person, where an admin finds people (Admin › Access, the owners and members
 * of a group). Shown only to whom `mayViewAs` allows; the portal then opens afresh as that
 * person, on Home, and "Stop viewing" returns to where it started.
 */
export function ViewAsButton({ email, name, className = "btn small" }: { email: string; name?: string; className?: string }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!mayViewAs(me, email)) return null;
  const label = personLabel({ email, name });
  const start = () => {
    setBusy(true);
    const from = window.location.hash || "#/";
    startViewAs(email).then(() => { remember(from); reopenAt("#/"); }, (e) => { setBusy(false); notify.error(`You cannot view the portal as ${label}.`, e); });
  };
  return (
    <button className={`${className} viewas-start`} disabled={busy} onClick={start} aria-label={viewAsName(label)} title={viewAsHint(label)}>
      <Eye size={14} aria-hidden="true" />{VIEW_AS_BUTTON}
    </button>
  );
}
