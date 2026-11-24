import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Eye, ImageUp, Info, LayoutGrid, Loader2, Moon, Redo2, RotateCcw, Save, Search, Sun, TriangleAlert, Trash2, Undo2 } from "lucide-react";
import type { Process, Standard } from "../types";
import { useCatalog } from "../lib/catalog";
import { search } from "../lib/search";
import { useDraft } from "../lib/draft";
import { ICON_TYPES, iconContentType, iconFileProblem } from "../lib/icons";
import { iconUrl, loadAdminLook, saveLook, uploadIcon, type SavedLook } from "../lib/store";
import {
  confusion, DEFAULT_APPEARANCE, DEFAULT_COLOR, DEFAULT_NAME, derive, DESIGNER, forgetOwnChoice, isDark, kindsAlikeText, kindsAlikeToColourBlindText, lookProblems, lookProperties, MAX_NAME, nameOf,
  normalizeHex, paletteName, PALETTES, TINT_STEPS, STATE_PARTS, warningCount, warningsText, takeLook, tidyLook, underlineLinks, useLook, type Appearance, type ColorPart, type ColorUse, type Font, type Look,
} from "../lib/theme";
import { BrandLogo } from "./Brand";
import { DocCard } from "./DocCard";
import { confirmDialog, LoadError, Loading, Modal, useBottomBar } from "./ui";
import "../icons.css";
import "../lists.css";
import "../controls.css";
import "../theme.css";
import "../edit.css";
import { formatDateTime } from "../lib/dates";

/** Admin › Theming: the name, the logo, the colours and the appearance of the portal, with a live preview. */
export function ThemeSection({ processes, standards }: { processes: Process[]; standards: Standard[] }) {
  const [saved, setSaved] = useState<SavedLook | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { setError(""); loadAdminLook().then(setSaved, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (error) return <LoadError what="The look of the portal could not be loaded." error={error} onRetry={load} />;
  if (!saved) return <Loading />;
  return <ThemeEditor saved={saved} onSaved={setSaved} processes={processes} standards={standards} />;
}

const COLOR_TEXT: Record<ColorPart, { label: string; hint: string }> = {
  brand: { label: "Brand colour", hint: "Links, focus rings, what is selected, and the main buttons unless they have a colour of their own. Its tints colour soft backgrounds" },
  secondary: { label: "Second colour", hint: "The page ground and the light tints of tables, rows and toned-down areas; never text" },
  ink: { label: "Ink", hint: "Text, the editing bar, and the ground of the dark look" },
  process: { label: "Processes", hint: "The mark and tag of every process" },
  standard: { label: "Standards", hint: "The mark and tag of every standard" },
  mainButton: { label: "Main buttons", hint: "The one main action of a view, such as Publish, Save or Search" },
  otherButtons: { label: "Other buttons", hint: "The outlined buttons beside it, such as Cancel, Discard or Give feedback. Quiet buttons without an outline stay grey" },
  success: { label: "Success", hint: "Published, saved, nothing to fix, done" },
  warning: { label: "Warning", hint: "Review due, drafts, unsaved changes, a step that loops back" },
  info: { label: "Information", hint: "Notices that only tell something, such as what readers still see" },
  problem: { label: "Problem", hint: "Review overdue, what is to fix, errors, buttons that delete. The designer's palette has no red: this one is the portal's own" },
  highlight: { label: "Highlight", hint: "Words found by a search, in the results and on the page" },
  quiet: { label: "Quiet surface", hint: "A warm, calm ground for notes and asides" },
};
/** What each colour of the designer's palette does in the default look (Snow has no setting: the surfaces stay white so that every colour is measured against them). */
const DESIGNER_JOBS: { name: keyof typeof DESIGNER; job: string }[] = [
  { name: "ocean", job: "Brand, links, main buttons" }, { name: "sky", job: "Second colour: page ground and tints" },
  { name: "snow", job: "Surfaces" }, { name: "midnight", job: "Ink: text, editing bar, dark look" },
  { name: "land", job: "Success" }, { name: "earth", job: "Warnings" }, { name: "berry", job: "Standards" },
  { name: "sun", job: "Highlights" }, { name: "grain", job: "Quiet surface" },
];
/** What a colour left at its default does, where that is not simply the default colour. */
const DEFAULT_TEXT: Partial<Record<ColorPart, string>> = { mainButton: "Follows the brand", info: "Follows the brand", otherButtons: "Neutral" };
const FONT_CHOICES: { id: Font | undefined; label: string; family: string }[] = [
  { id: undefined, label: "Default (Roboto)", family: '"Roboto Variable", Roboto, Helvetica, Arial, sans-serif' },
  { id: "inter", label: "Inter", family: '"Inter Variable", Inter, system-ui, sans-serif' },
];
const APPEARANCES: { id: Appearance; label: string; icon?: typeof Sun }[] = [
  { id: "device", label: "As the device is set" },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

const same = (a: Look, b: Look) => JSON.stringify(tidyLook(a)) === JSON.stringify(tidyLook(b));
const when = formatDateTime;

function ThemeEditor({ saved, onSaved, processes, standards }: { saved: SavedLook; onSaved: (s: SavedLook) => void; processes: Process[]; standards: Standard[] }) {
  const { own } = useLook();
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
  const warnings = warningCount(derived);
  const settings = useRef<HTMLDivElement>(null);
  /** Brings the first warning into view and puts the keyboard on it. */
  const toFirstWarning = () => {
    const first = settings.current?.querySelector<HTMLElement>(".color-note.warn");
    if (!first) return;
    first.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    first.focus({ preventScroll: true });
  };
  // Save asks once about the warnings; the same warnings are not asked about again
  const accepted = useRef("");
  const save = async () => {
    const said = derived.colors.flatMap((c) => c.warnings).join("|") + warnings;
    if (warnings > 0 && accepted.current !== said) {
      const yes = await confirmDialog({
        title: `Save with ${warningsText(warnings)}?`,
        body: `Some colours of this look will be mistaken for others, as the ${warnings === 1 ? "warning beside the colour says" : "warnings beside the colours say"}. Everyone sees the look once you save.`,
        confirmLabel: "Save anyway", cancelLabel: "Look at them first",
      });
      if (!yes) { toFirstWarning(); return; }
      accepted.current = said;
    }
    await d.save();
  };
  const bar = useRef<HTMLDivElement>(null);
  useBottomBar(bar, d.dirty);
  const isDefault = Object.keys(tidyLook(saved.look)).length === 0;

  const backToDefault = async () => {
    const yes = await confirmDialog({
      title: "Go back to the default look?",
      body: `Everyone sees the name “${DEFAULT_NAME}”, the default mark, the default colours and font, and the appearance their device is set to, from their next page load.`
        + (d.dirty ? " Your unsaved changes here are dropped." : ""),
      confirmLabel: "Go back to the default look", cancelLabel: "Keep this look", danger: true,
    });
    if (yes) await d.save("", () => ({}));
  };

  return (
    <div className="admin-section theme-section">
      <div className="theme-layout">
        <div className="theme-settings" ref={settings}>
          <div className="theme-status">
            <p className="small">
              {saved.revision > 0 && saved.updatedAt
                ? <>Last changed by <b>{saved.updatedByName || saved.updatedBy || "an admin"}</b> on {when(saved.updatedAt)}.</>
                : <>This is the default look: nobody has changed it yet.</>}
            </p>
            <div className="btn-row">
              <button type="button" className="btn small" disabled={(isDefault && !d.dirty) || d.saving} onClick={backToDefault}>
                <RotateCcw size={14} aria-hidden="true" />Back to the default look
              </button>
              <span className="spacer" />
              <button type="button" className="btn small ghost" disabled={!d.canUndo} onClick={d.undo} title="Undo the last change here (Ctrl+Z)"><Undo2 size={14} aria-hidden="true" />Undo</button>
              <button type="button" className="btn small ghost" disabled={!d.canRedo} onClick={d.redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} aria-hidden="true" />Redo</button>
            </div>
          </div>

          <section className="theme-group" aria-labelledby="theme-name">
            <h3 id="theme-name">Name and logo</h3>
            <NameField value={look.name ?? ""} onChange={(name) => set({ name: name || undefined })} />
            <LogoField look={look} onChange={(logo) => set({ logo })} />
          </section>

          <section className="theme-group" aria-labelledby="theme-palette">
            <h3 id="theme-palette">The designer's palette</h3>
            <p className="muted small">The default look. Every colour below starts from it; change any of them, or go back to it with “Back to the default”. Two colours are the portal's own: a teal for processes, so that people who cannot tell red from green still tell them from standards in Berry, and a red for problems, which the palette does not have.</p>
            <ul className="designer-palette" aria-label="The designer's palette">
              {DESIGNER_JOBS.map(({ name, job }) => (
                <li key={name}><i style={{ background: DESIGNER[name] }} aria-hidden="true" /><b>{name[0].toUpperCase() + name.slice(1)}</b><code>{DESIGNER[name]}</code><span className="muted">{job}</span></li>
              ))}
            </ul>
          </section>

          <section className="theme-group" aria-labelledby="theme-ground">
            <h3 id="theme-ground">Brand, second colour and ink</h3>
            {(["brand", "secondary", "ink"] as const).map((part) => (
              <ColorField key={part} part={part} value={look[part]} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
          </section>

          <section className="theme-group" aria-labelledby="theme-colours">
            <h3 id="theme-colours">Kinds</h3>
            <div className="palettes-head">
              <span className="field-label">Ready-made colours<em>They set the brand and the two kinds; buttons and states keep what you chose for them</em></span>
              <span className="palette-legend muted small" aria-hidden="true">
                <span><i className="dot" />brand</span><span><i className="dot" />processes</span><span><i className="square" />standards</span>
              </span>
            </div>
            <div className="palettes" role="group" aria-label="Ready-made colours">
              {PALETTES.map((p) => {
                const on = (["brand", "process", "standard"] as const).every((k) => (look[k] ?? "") === (p.colors[k] ?? ""));
                const c = (k: ColorPart) => p.colors[k] ?? DEFAULT_COLOR[k];
                return (
                  <button key={p.name} type="button" className={`palette ${on ? "on" : ""}`} aria-pressed={on}
                    title={`${p.name}: brand ${c("brand")}, processes ${c("process")}, standards ${c("standard")}`}
                    onClick={() => set({ brand: p.colors.brand, process: p.colors.process, standard: p.colors.standard })}>
                    <span className="palette-swatches" aria-hidden="true">
                      {(["brand", "process", "standard"] as const).map((k) => <i key={k} style={{ background: c(k) }} />)}
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
            {(["process", "standard"] as const).map((part) => (
              <ColorField key={part} part={part} value={look[part]} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
            {derived.kindsAlike.length > 0 && (
              <p className="color-note warn" role="status" tabIndex={-1}><TriangleAlert size={14} aria-hidden="true" /><span>{kindsAlikeText(derived.kindsAlike)}</span></p>
            )}
            {derived.kindsAlikeToColourBlind.length > 0 && (
              <p className="color-note warn" role="status" tabIndex={-1}><TriangleAlert size={14} aria-hidden="true" /><span>{kindsAlikeToColourBlindText(derived.kindsAlikeToColourBlind)}</span></p>
            )}
          </section>

          <section className="theme-group" aria-labelledby="theme-buttons">
            <h3 id="theme-buttons">Buttons</h3>
            {(["mainButton", "otherButtons"] as const).map((part) => (
              <ColorField key={part} part={part} value={look[part]} fallback={part === "mainButton" ? look.brand : undefined} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
          </section>

          <section className="theme-group" aria-labelledby="theme-states">
            <h3 id="theme-states">States</h3>
            <p className="muted small">The same colour always means the same: choose colours that stay far apart. Icons beside them say the same for people who see colours differently.</p>
            {STATE_PARTS.map((part) => (
              <ColorField key={part} part={part} value={look[part]} fallback={part === "info" ? look.brand : undefined} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
          </section>

          <section className="theme-group" aria-labelledby="theme-marks">
            <h3 id="theme-marks">Highlight and quiet surface</h3>
            {(["highlight", "quiet"] as const).map((part) => (
              <ColorField key={part} part={part} value={look[part]} use={derived.colors.find((c) => c.part === part)} onChange={(v) => set({ [part]: v })} />
            ))}
          </section>

          <section className="theme-group" aria-labelledby="theme-font">
            <h3 id="theme-font">Font</h3>
            <p className="muted small">Text comes in three sizes and three weights, set by the portal; only the font can be chosen.</p>
            <div className="seg" role="radiogroup" aria-labelledby="theme-font">
              {FONT_CHOICES.map((f) => {
                // a look saved when Roboto was a choice of its own shows as the default it now is
                const on = (look.font === "roboto" ? undefined : look.font) === f.id;
                return (
                  <button key={f.label} type="button" role="radio" aria-checked={on} className={`seg-item ${on ? "on" : ""}`} style={{ fontFamily: f.family }}
                    onClick={() => set({ font: f.id })}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            {look.font && look.font !== "roboto" && <button type="button" className="btn small ghost theme-font-default" onClick={() => set({ font: undefined })}>Back to the default</button>}
          </section>

          <section className="theme-group" aria-labelledby="theme-appearance">
            <h3 id="theme-appearance">Light or dark</h3>
            <p className="muted small">For people who have not chosen light or dark with the switch in the top bar. Their own choice always wins.</p>
            <div className="seg" role="radiogroup" aria-labelledby="theme-appearance">
              {APPEARANCES.map((a) => {
                const on = (look.appearance ?? DEFAULT_APPEARANCE) === a.id;
                return (
                  <button key={a.id} type="button" role="radio" aria-checked={on} className={`seg-item ${on ? "on" : ""}`}
                    onClick={() => set({ appearance: a.id === DEFAULT_APPEARANCE ? undefined : a.id })}>
                    {a.icon && <a.icon size={14} aria-hidden="true" />}{a.label}
                  </button>
                );
              })}
            </div>
            <OwnChoiceNote own={own} appearance={saved.look.appearance} />
          </section>
        </div>

        <LookPreview look={look} processes={processes} standards={standards} />
      </div>

      {(d.dirty || d.error) && (
        <div ref={bar} className="theme-save" role="region" aria-label="Unsaved changes">
          {d.error
            ? <span className="theme-save-text bad" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span><b>Not saved.</b> {d.error}</span></span>
            : problems.length
              ? <span className="theme-save-text bad" role="status"><TriangleAlert size={16} aria-hidden="true" /><span>{problems.join(" ")}</span></span>
              : <span className="theme-save-text" role="status"><span><b>Unsaved changes</b> to the look. Everyone sees them once you save.
                {warnings > 0 && <> <button type="button" className="link-btn theme-warnings" onClick={toFirstWarning}><TriangleAlert size={14} aria-hidden="true" />{warningsText(warnings)}</button></>}</span></span>}
          <span className="spacer" />
          {d.dirty && <button type="button" className="btn" onClick={() => { d.discard(); d.clearError(); }}>Discard</button>}
          {d.dirty && (
            <button type="button" className="btn primary" disabled={d.saving || problems.length > 0} onClick={() => { void save(); }}>
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
          <p className="muted small">“Show theirs” puts their look on screen; Undo, at the top of the settings, brings yours back.</p>
        </Modal>
      )}
    </div>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const n = value.trim().length;
  const over = n - MAX_NAME;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>Name of the portal<em>In the top bar, the browser tab, the sign-in page and shared links</em></label>
      <div className="theme-name">
        <input id={id} value={value} placeholder={`${DEFAULT_NAME} (the default)`} onChange={(e) => onChange(e.target.value)}
          aria-invalid={over > 0 || undefined} aria-describedby={n > 0 ? `${id}-n${over > 0 ? ` ${id}-e` : ""}` : `${id}-d`} className={over > 0 ? "invalid" : ""} />
        {n > 0 && <span id={`${id}-n`} className={`theme-count ${over > 0 ? "over" : ""}`}>{n}/{MAX_NAME}</span>}
      </div>
      {over > 0
        ? <span className="field-error" id={`${id}-e`} role="alert">The name can have at most {MAX_NAME} characters: remove {over === 1 ? "one" : over}.</span>
        : !value.trim() && <span className="muted small" id={`${id}-d`}>Left empty, the portal is called “{DEFAULT_NAME}”. At most {MAX_NAME} characters.</span>}
    </div>
  );
}

function LogoField({ look, onChange }: { look: Look; onChange: (logo: string | undefined) => void }) {
  const logo = look.logo;
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
        <span className="theme-logo-tiles">
          {(["light", "dark"] as const).map((m) => (
            <span key={m} className={`theme-logo-tile look-${m}`} style={lookProperties(look) as React.CSSProperties} title={m === "light" ? "On the light top bar" : "On the dark top bar"}>
              <BrandLogo look={look} big src={logo ? iconUrl(logo) : undefined} />
            </span>
          ))}
        </span>
        <div className="theme-logo-actions">
          <div className="btn-row">
            <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 size={14} className="icon-spin" aria-hidden="true" /> : <ImageUp size={14} aria-hidden="true" />}{busy ? "Uploading…" : logo ? "Choose another image…" : "Choose image…"}
            </button>
            {logo && <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setProblem(""); onChange(undefined); }}><Trash2 size={14} aria-hidden="true" />Use the default mark</button>}
          </div>
          <span className="muted small">A square image: PNG, JPEG, WebP or SVG, at most 64 KB and 512 × 512 pixels. In the dark look it stands on a light plate.</span>
          <input ref={input} type="file" hidden accept={[...ICON_TYPES, ".svg"].join(",")} aria-label="Logo image" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </div>
  );
}

function ColorField({ part, value, fallback, use, onChange }: { part: ColorPart; value?: string; fallback?: string; use?: ColorUse; onChange: (v: string | undefined) => void }) {
  const id = useId();
  // a part that follows another (the brand) shows that colour while it has none of its own
  const shown = value ?? fallback ?? DEFAULT_COLOR[part];
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
        {!value && <span className="color-default">{DEFAULT_TEXT[part] ?? `Default${paletteName(DEFAULT_COLOR[part]) ? `: ${paletteName(DEFAULT_COLOR[part])}` : ""}`}</span>}
      </div>
      <div className="color-inputs">
        <input type="color" className="color-swatch" value={shown} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={`${label}: pick a colour`} />
        <input className={`color-hex mono ${wrong ? "invalid" : ""}`} value={text} spellCheck={false} maxLength={9} aria-label={`${label} as a code, e.g. #0055aa`}
          aria-invalid={wrong || undefined} aria-describedby={wrong ? `${id}-e` : undefined}
          onChange={(e) => typed(e.target.value)} onBlur={() => { if (!normalizeHex(text)) setWrong(true); else setText(normalizeHex(text)!); }} />
        {value && <button type="button" className="btn small ghost" onClick={() => onChange(undefined)} aria-label={`${label}: back to the default`}>Back to the default</button>}
      </div>
      {wrong && <span className="field-error" id={`${id}-e`}>Write the colour as # and six digits or letters a-f, e.g. #0055aa.</span>}
      {(part === "brand" || part === "secondary") && <Tints color={shown} />}
      {use && !NO_TEXT.includes(part) && (
        <div className="color-used">
          <span className="muted">In use:</span>
          <span className="color-chip"><i style={{ background: use.used.light }} />Light <code>{use.used.light}</code></span>
          <span className="color-chip"><i style={{ background: use.used.dark }} />Dark <code>{use.used.dark}</code></span>
        </div>
      )}
      {adjusted && part !== "ink" && <p className="color-note"><Info size={14} aria-hidden="true" /><span>{adjustedText(use!)}</span></p>}
      {use && (part === "brand" || part === "process" || part === "standard") && use.like.map((k) => (
        <p key={k} className="color-note warn" tabIndex={-1}><TriangleAlert size={14} aria-hidden="true" /><span>{confusion(part, k)}</span></p>
      ))}
      {use?.warnings.map((w) => (
        <p key={w} className="color-note warn" tabIndex={-1}><TriangleAlert size={14} aria-hidden="true" /><span>{w}</span></p>
      ))}
    </div>
  );
}

/** Parts that are never text: their "In use" line would say nothing. */
const NO_TEXT: ColorPart[] = ["secondary", "highlight", "quiet"];

/** The designer's four tints of a colour (10, 35, 75 and 100 %), for backgrounds only. */
function Tints({ color }: { color: string }) {
  return (
    <div className="color-tints" aria-label="Its tints, for backgrounds only">
      {TINT_STEPS.map((n) => <span key={n} className="color-tint"><i style={{ background: `color-mix(in srgb, ${color} ${n}%, ${DESIGNER.snow})` }} aria-hidden="true" />{n} %</span>)}
    </div>
  );
}

/** The admin's own light / dark switch hides the appearance chosen for new visitors: says so, with a way to see it. */
function OwnChoiceNote({ own, appearance }: { own: "light" | "dark" | null; appearance?: Appearance }) {
  const deviceDark = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  if (!own || isDark(own, appearance, deviceDark) === isDark(null, appearance, deviceDark)) return null;
  const theirs = isDark(null, appearance, deviceDark) ? "dark" : "light";
  return (
    <div className="color-note own-note" role="status">
      <Info size={14} aria-hidden="true" />
      <span>You see the {own} look because you chose it with the switch in the top bar. New visitors see the saved look in {theirs}.</span>
      <button type="button" className="btn small" onClick={forgetOwnChoice}>Show me what new visitors see</button>
    </div>
  );
}

/** Says plainly that a colour was made lighter or darker to stay readable. */
export function adjustedText(u: ColorUse): string {
  const how = u.adjusted.light && u.adjusted.dark ? "darker in the light look and lighter in the dark look"
    : u.adjusted.light ? "darker in the light look" : "lighter in the dark look";
  return u.part === "mainButton" ? `Made ${how}, so that the buttons stand out from the page.` : `Made ${how}, so that text in this colour stays readable.`;
}

/**
 * The look as it would be, in light and dark next to each other, driven by the values being edited.
 * Built from the real parts: the top bar's markup and classes, the buttons, the segmented control
 * and the real cards of a process and a standard (DocCard). Nothing in it can be pressed (inert).
 */
function LookPreview({ look, processes, standards }: { look: Look; processes: Process[]; standards: Standard[] }) {
  const style = lookProperties(look) as React.CSSProperties;
  const name = nameOf(look);
  const { catalog } = useCatalog();
  const sample = useMemo(() => {
    const p = processes.find((x) => x.status !== "draft") ?? processes[0];
    const s = standards.find((x) => x.status !== "draft") ?? standards[0];
    return search({ processes: p ? [p] : [], standards: s ? [s] : [], catalog, drafts: false }).results;
  }, [processes, standards, catalog]);
  return (
    <section className="theme-preview" aria-label="Preview">
      <div className="theme-preview-head">
        <h3>Preview</h3>
        <span className="muted small">{same(look, {}) ? "The default look. " : ""}Nothing changes for anyone until you save.</span>
      </div>
      <div className="preview-panes">
        {(["light", "dark"] as const).map((mode) => (
          <figure key={mode} className="preview-frame">
          <figcaption className="pv-caption"><Eye size={14} aria-hidden="true" />Preview, {mode}: a sample, nothing in it can be pressed</figcaption>
          <div className={`preview-pane look-${mode} ${underlineLinks(look) ? "pv-lines" : ""}`} style={style} aria-label={`Preview, ${mode}`} role="group" {...{ inert: true }}>
            <header className="topbar pv-topbar">
              <span className="brand" title={name}>
                <BrandLogo look={look} src={look.logo ? iconUrl(look.logo) : undefined} />
                <span className="brand-name">{name}</span>
              </span>
              <nav className="nav pv-nav">
                <span className="nav-link on"><Search size={15} /><span>Home</span></span>
                <span className="nav-link"><LayoutGrid size={15} /><span>Processes</span></span>
              </nav>
              <span className="spacer" />
              <span className="icon-btn">{mode === "light" ? <Moon size={16} /> : <Sun size={16} />}</span>
            </header>
            <div className="pv-body">
              <div className="pv-row">
                <span className="btn small primary">Main button</span>
                <span className="btn small">Other button</span>
                <span className="btn small danger">Delete</span>
                <span className="pv-link">A link</span>
              </div>
              <div className="pv-states">
                <div className="check good"><CircleCheck size={15} /><span><b>Success:</b> published, everything is saved.</span></div>
                <div className="check warn"><TriangleAlert size={15} /><span><b>Warning:</b> review due in 5 days.</span></div>
                <div className="check info"><Info size={15} /><span><b>Information:</b> readers still see version 3.</span></div>
                <div className="check bad"><CircleAlert size={15} /><span><b>Problem:</b> review overdue.</span></div>
              </div>
              <div className="pv-row pv-marks">
                <span className="status good"><CircleCheck size={14} />Nothing to fix</span>
                <span className="status warn">Review due</span>
                <span className="status bad">2 to fix</span>
                <span className="pv-count">Requests<span className="nav-count">3</span></span>
              </div>
              <div className="edit-bar state-changes pv-edit-bar">
                <span className="state-pill changes">Unpublished changes</span>
                <span className="eb-status bad"><CircleAlert size={14} />1 to fix</span>
                <span className="spacer" />
                <span className="eb-btn eb-save">Save draft</span>
                <span className="eb-btn eb-publish">Publish…</span>
              </div>
              <div className="field pv-field">
                <span className="field-label">A field, selected</span>
                <span className="pv-input pv-focused">Text someone typed</span>
              </div>
              <p className="pv-found">A word <mark className="search-mark">found</mark> by the search</p>
              <p className="pv-quiet">A note on the quiet surface.</p>
              <div className="seg" aria-hidden="true">
                <span className="seg-item on">Chosen</span>
                <span className="seg-item">Other</span>
                <span className="seg-item">Other</span>
              </div>
              <div className="pv-cards">
                {sample.map((r) => (
                  <DocCard key={`${r.kind}:${r.doc.id}`} kind={r.kind} doc={r.doc} rigour={r.rigour} rules={r.rules} openFeedback={0} mayEdit={false} level={3} />
                ))}
              </div>
            </div>
          </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
