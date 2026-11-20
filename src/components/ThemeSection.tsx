import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ImageUp, Info, Loader2, Moon, RotateCcw, Save, ShieldCheck, Sun, TriangleAlert, Trash2, Workflow } from "lucide-react";
import { useDraft } from "../lib/draft";
import { ICON_TYPES, iconContentType, iconFileProblem } from "../lib/icons";
import { iconUrl, loadAdminLook, saveLook, uploadIcon, type SavedLook } from "../lib/store";
import {
  DEFAULT_APPEARANCE, DEFAULT_COLOR, DEFAULT_NAME, derive, lookProblems, lookProperties, MAX_NAME, nameOf, normalizeHex, PALETTES, takeLook, tidyLook,
  type Appearance, type ColorPart, type ColorUse, type Look,
} from "../lib/theme";
import { BrandLogo, DefaultMark } from "./Brand";
import { confirmDialog, LoadError, Loading, Modal, useBottomBar } from "./ui";
import "../icons.css";
import "../lists.css";
import "../theme.css";

/** Admin › Theming: the name, the logo, the colours and the appearance of the portal, with a live preview. */
export function ThemeSection() {
  const [saved, setSaved] = useState<SavedLook | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { setError(""); loadAdminLook().then(setSaved, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (error) return <LoadError what="The look of the portal could not be loaded." error={error} onRetry={load} />;
  if (!saved) return <Loading />;
  return <ThemeEditor saved={saved} onSaved={setSaved} />;
}

const COLOR_TEXT: Record<ColorPart, { label: string; hint: string }> = {
  brand: { label: "Brand colour", hint: "Buttons, links, focus rings and what is selected" },
  process: { label: "Processes", hint: "The mark and tag of every process" },
  standard: { label: "Standards", hint: "The mark and tag of every standard" },
};
const APPEARANCES: { id: Appearance; label: string; icon?: typeof Sun }[] = [
  { id: "device", label: "As the device is set" },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

const same = (a: Look, b: Look) => JSON.stringify(tidyLook(a)) === JSON.stringify(tidyLook(b));
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function ThemeEditor({ saved, onSaved }: { saved: SavedLook; onSaved: (s: SavedLook) => void }) {
  const d = useDraft<Look>({
    docKey: "theme", saved: saved.look, version: saved.revision, tidy: tidyLook, what: "the look of the portal",
    save: async (look, base) => {
      const s = await saveLook(look, base);
      onSaved(s);
      takeLook(s.look, s.revision); // everything on this page follows at once
      return s.revision;
    },
    reload: async () => {
      const s = await loadAdminLook();
      onSaved(s);
      return { saved: s.look, version: s.revision };
    },
  });
  const look = d.draft;
  const set = (patch: Partial<Look>) => d.change((l) => ({ ...l, ...patch }));
  const derived = useMemo(() => derive(look), [look]);
  const problems = lookProblems(look);
  const bar = useRef<HTMLDivElement>(null);
  useBottomBar(bar, d.dirty);
  const isDefault = Object.keys(tidyLook(saved.look)).length === 0;

  const backToDefault = async () => {
    const yes = await confirmDialog({
      title: "Go back to the default look?",
      body: `Everyone sees the name “${DEFAULT_NAME}”, the default mark, the default colours and the appearance their device is set to, from their next page load.`
        + (d.dirty ? " Your unsaved changes here are dropped." : ""),
      confirmLabel: "Go back to the default look", cancelLabel: "Keep this look", danger: true,
    });
    if (yes) await d.save("", () => ({}));
  };

  return (
    <div className="admin-section theme-section">
      <div className="theme-layout">
        <div className="theme-settings">
          <section className="theme-group" aria-labelledby="theme-name">
            <h3 id="theme-name">Name and logo</h3>
            <NameField value={look.name ?? ""} onChange={(name) => set({ name: name || undefined })} />
            <LogoField logo={look.logo} onChange={(logo) => set({ logo })} />
          </section>

          <section className="theme-group" aria-labelledby="theme-colours">
            <h3 id="theme-colours">Colours</h3>
            <div className="palettes" role="group" aria-label="Ready-made colours">
              {PALETTES.map((p) => {
                const on = (["brand", "process", "standard"] as const).every((k) => (look[k] ?? "") === (p.colors[k] ?? ""));
                return (
                  <button key={p.name} type="button" className={`palette ${on ? "on" : ""}`} aria-pressed={on}
                    onClick={() => set({ brand: p.colors.brand, process: p.colors.process, standard: p.colors.standard })}>
                    <span className="palette-swatches" aria-hidden="true">
                      {(["brand", "process", "standard"] as const).map((k) => <i key={k} style={{ background: p.colors[k] ?? DEFAULT_COLOR[k] }} />)}
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
            {(["brand", "process", "standard"] as const).map((part) => (
              <ColorField key={part} part={part} value={look[part]} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
            <p className="muted small">The colours for good, warning and problems stay as they are, so that they always mean the same.</p>
          </section>

          <section className="theme-group" aria-labelledby="theme-appearance">
            <h3 id="theme-appearance">Light or dark</h3>
            <p className="muted small">For people who have not chosen light or dark with the switch in the top bar. Their own choice always wins.</p>
            <div className="segmented" role="radiogroup" aria-labelledby="theme-appearance">
              {APPEARANCES.map((a) => {
                const on = (look.appearance ?? DEFAULT_APPEARANCE) === a.id;
                return (
                  <button key={a.id} type="button" role="radio" aria-checked={on} className={on ? "on" : ""}
                    onClick={() => set({ appearance: a.id === DEFAULT_APPEARANCE ? undefined : a.id })}>
                    {a.icon && <a.icon size={14} aria-hidden="true" />}{a.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="theme-group theme-default">
            <p className="muted small">
              {saved.revision > 0 && saved.updatedAt
                ? <>Last changed by {saved.updatedByName || saved.updatedBy || "an admin"} on {when(saved.updatedAt)}.</>
                : <>This is the default look: nobody has changed it yet.</>}
            </p>
            <button type="button" className="btn small ghost" disabled={(isDefault && !d.dirty) || d.saving} onClick={backToDefault}>
              <RotateCcw size={14} aria-hidden="true" />Back to the default look
            </button>
          </section>
        </div>

        <LookPreview look={look} />
      </div>

      {(d.dirty || d.error) && (
        <div ref={bar} className="theme-save" role="region" aria-label="Unsaved changes">
          {d.error
            ? <span className="theme-save-text bad" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span><b>Not saved.</b> {d.error}</span></span>
            : problems.length
              ? <span className="theme-save-text bad" role="status"><TriangleAlert size={16} aria-hidden="true" /><span>{problems.join(" ")}</span></span>
              : <span className="theme-save-text" role="status"><b>Unsaved changes</b> to the look. Everyone sees them once you save.</span>}
          <span className="spacer" />
          {d.dirty && <button type="button" className="btn" onClick={() => { d.discard(); d.clearError(); }}>Discard</button>}
          {d.dirty && (
            <button type="button" className="btn primary" disabled={d.saving || problems.length > 0} onClick={() => { void d.save(); }}>
              <Save size={16} aria-hidden="true" />{d.saving ? "Saving…" : "Save for everyone"}
            </button>
          )}
        </div>
      )}

      {d.conflict && (
        <Modal title="Another admin changed the look" onClose={d.dismissConflict}
          footer={<>
            <span className="spacer" />
            <button className="btn" onClick={() => { void d.takeTheirs(); }}>Show theirs</button>
            <button className="btn primary" onClick={() => { void d.keepMine(); }}>Save mine over theirs</button>
          </>}>
          <p>{d.conflict.updatedByName || d.conflict.updatedBy || "Another admin"} saved a look{d.conflict.updatedAt ? ` on ${when(d.conflict.updatedAt)}` : ""} while you were making yours. Your changes are still here and not saved.</p>
          <p className="muted small">“Show theirs” puts their look on screen; Undo brings yours back.</p>
        </Modal>
      )}
    </div>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const n = value.trim().length;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>Name of the portal<em>In the top bar, the browser tab, the sign-in page and shared links</em></label>
      <div className="theme-name">
        <input id={id} value={value} maxLength={MAX_NAME + 20} placeholder={DEFAULT_NAME} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-n`} />
        <span id={`${id}-n`} className={`theme-count ${n > MAX_NAME ? "over" : ""}`} aria-live="polite">{n}/{MAX_NAME}</span>
      </div>
      {!value.trim() && <span className="muted small">Empty: “{DEFAULT_NAME}”.</span>}
    </div>
  );
}

function LogoField({ logo, onChange }: { logo?: string; onChange: (logo: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const wrong = iconFileProblem(file);
    if (wrong) { setProblem(wrong); return; }
    setBusy(true); setProblem("");
    try {
      const type = iconContentType(file);
      const { id } = await uploadIcon(type === file.type ? file : new Blob([file], { type }));
      onChange(id);
    } catch (e) {
      setProblem((e as Error).message); // the server's own sentence, e.g. that it is not square
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="field" role="group" aria-labelledby={labelId}>
      <span className="field-label" id={labelId}>Logo<em>In the top bar and on the sign-in page</em></span>
      <div className="theme-logo">
        <span className="theme-logo-tile">
          {logo ? <img src={iconUrl(logo)} alt="" width={44} height={44} /> : <span className="logo big"><DefaultMark size={24} /></span>}
        </span>
        <div className="theme-logo-actions">
          <div className="btn-row">
            <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 size={14} className="icon-spin" aria-hidden="true" /> : <ImageUp size={14} aria-hidden="true" />}{busy ? "Uploading…" : logo ? "Choose another image…" : "Choose image…"}
            </button>
            {logo && <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setProblem(""); onChange(undefined); }}><Trash2 size={14} aria-hidden="true" />Use the default mark</button>}
          </div>
          <span className="muted small">A square image: PNG, JPEG, WebP or SVG, at most 64 KB and 512 × 512 pixels. It should read on light and on dark.</span>
          <input ref={input} type="file" hidden accept={[...ICON_TYPES, ".svg"].join(",")} aria-label="Logo image" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </div>
  );
}

function ColorField({ part, value, use, onChange }: { part: ColorPart; value?: string; use?: ColorUse; onChange: (v: string | undefined) => void }) {
  const id = useId();
  const shown = value ?? DEFAULT_COLOR[part];
  const [text, setText] = useState(shown);
  const [wrong, setWrong] = useState(false);
  // a palette, Undo or Discard changes the colour from outside: the field follows
  useEffect(() => { setText(shown); setWrong(false); }, [shown]);
  const { label, hint } = COLOR_TEXT[part];
  const typed = (t: string) => {
    setText(t);
    const hex = normalizeHex(t);
    setWrong(false);
    if (hex && hex !== shown) onChange(hex);
  };
  const adjusted = use && (use.adjusted.light || use.adjusted.dark);
  return (
    <div className="color-field" role="group" aria-labelledby={`${id}-l`}>
      <div className="color-head">
        <span className="field-label" id={`${id}-l`}>{label}<em>{hint}</em></span>
        {!value && <span className="color-default">Default</span>}
      </div>
      <div className="color-inputs">
        <input type="color" className="color-swatch" value={shown} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={`${label}: pick a colour`} />
        <input className={`color-hex mono ${wrong ? "invalid" : ""}`} value={text} spellCheck={false} maxLength={9} aria-label={`${label} as a code, e.g. #0055aa`}
          aria-invalid={wrong || undefined} aria-describedby={wrong ? `${id}-e` : undefined}
          onChange={(e) => typed(e.target.value)} onBlur={() => { if (!normalizeHex(text)) setWrong(true); else setText(normalizeHex(text)!); }} />
        {value && <button type="button" className="btn small ghost" onClick={() => onChange(undefined)}>Use the default</button>}
      </div>
      {wrong && <span className="field-error" id={`${id}-e`}>Write the colour as # and six digits or letters a-f, e.g. #0055aa.</span>}
      {use && (
        <div className="color-used">
          <span className="muted">In use:</span>
          <span className="color-chip"><i style={{ background: use.used.light }} />Light <code>{use.used.light}</code></span>
          <span className="color-chip"><i style={{ background: use.used.dark }} />Dark <code>{use.used.dark}</code></span>
        </div>
      )}
      {adjusted && <p className="color-note"><Info size={14} aria-hidden="true" /><span>{adjustedText(use!)}</span></p>}
      {use?.grey && (
        <p className="color-note warn"><TriangleAlert size={14} aria-hidden="true" />
          <span>This colour is grey: {part === "brand" ? "buttons, links and what is selected" : `the mark of ${part === "process" ? "processes" : "standards"}`} hardly stand out from ordinary text.</span>
        </p>
      )}
      {use?.nearRed && (
        <p className="color-note warn"><TriangleAlert size={14} aria-hidden="true" />
          <span>This colour looks like the red that marks problems. People may take {part === "brand" ? "buttons and links" : `the mark of ${part === "process" ? "processes" : "standards"}`} for a warning. You can still use it.</span>
        </p>
      )}
    </div>
  );
}

/** Says plainly that a colour was made lighter or darker to stay readable. */
export function adjustedText(u: ColorUse): string {
  const how = u.adjusted.light && u.adjusted.dark ? "darker in the light look and lighter in the dark look"
    : u.adjusted.light ? "darker in the light look" : "lighter in the dark look";
  return `Made ${how}, so that text in this colour stays readable.`;
}

/** The look as it would be, in light and dark next to each other: driven by the values being edited. */
function LookPreview({ look }: { look: Look }) {
  const style = lookProperties(look) as React.CSSProperties;
  const name = nameOf(look);
  return (
    <section className="theme-preview" aria-label="Preview">
      <div className="theme-preview-head">
        <h3>Preview</h3>
        <span className="muted small">{same(look, {}) ? "The default look. " : ""}Nothing changes for anyone until you save.</span>
      </div>
      <div className="preview-panes">
        {(["light", "dark"] as const).map((mode) => (
          <div key={mode} className={`preview-pane look-${mode}`} style={style} aria-label={mode === "light" ? "Light" : "Dark"} role="img">
            <div className="pv-top">
              <BrandLogo look={look} className="pv-logo" src={look.logo ? iconUrl(look.logo) : undefined} />
              <b className="pv-name" title={name}>{name}</b>
              <span className="pv-nav on">Home</span>
              <span className="pv-nav">Processes</span>
              <span className="pv-mode">{mode === "light" ? <Moon size={13} /> : <Sun size={13} />}</span>
            </div>
            <div className="pv-body">
              <div className="pv-row">
                <span className="btn small primary pv-btn">Save changes</span>
                <span className="btn small pv-btn">Cancel</span>
                <span className="pv-link">Read the guide</span>
              </div>
              <div className="pv-field">
                <span className="pv-label">Search</span>
                <span className="pv-input">GCP project<i className="pv-caret" /></span>
              </div>
              <div className="pv-options">
                <span className="pv-option on"><Check size={13} />Google Cloud<b>2</b></span>
                <span className="pv-option">GitHub<b>4</b></span>
              </div>
              <div className="pv-card process">
                <span className="pv-tag process"><Workflow size={11} />Process</span>
                <strong>Request a GCP project</strong>
                <span className="pv-sum">Get a new Google Cloud project with the right owners.</span>
              </div>
              <div className="pv-card standard">
                <span className="pv-tag standard"><ShieldCheck size={11} />Standard</span>
                <strong>Secure logging</strong>
                <span className="pv-sum">What to log, and what never to log.</span>
              </div>
            </div>
            <span className="pv-mode-label">{mode === "light" ? "Light" : "Dark"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
