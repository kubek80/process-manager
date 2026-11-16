import { useCallback, useEffect, useState } from "react";
import type { Profile } from "./edit";

/**
 * "My application": the tier, environment and language somebody chose to see only what applies
 * to them. Chosen once, it stays - on every list and every standard, and the next time the
 * portal is opened in this browser.
 */
const KEY = "pm:profile";
const CHANGED = "pm:profile-changed";

function read(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Profile;
    return { ...(p.tier ? { tier: String(p.tier) } : {}), ...(p.language ? { language: String(p.language) } : {}), ...(p.environment ? { environment: String(p.environment) } : {}) };
  } catch { return {}; }
}

export function useProfile(): [Profile, (p: Profile) => void] {
  const [profile, setProfile] = useState<Profile>(read);
  // several filters can be on screen over time; they all follow the same choice
  useEffect(() => {
    const on = () => setProfile(read());
    window.addEventListener(CHANGED, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(CHANGED, on); window.removeEventListener("storage", on); };
  }, []);
  const change = useCallback((p: Profile) => {
    setProfile(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: it lasts for this page */ }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [profile, change];
}

/** A value that is remembered while the browser tab is open, e.g. the search text of a list. */
export function useRemembered<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = sessionStorage.getItem(key); return raw === null ? initial : (JSON.parse(raw) as T); } catch { return initial; }
  });
  const change = useCallback((v: T) => {
    setValue(v);
    try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key]);
  return [value, change];
}
