import { useId, useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { EntryIcon } from "./EntryIcon";
import { ICON_RULES, ICON_TYPES, iconContentType, iconFileProblem } from "../lib/icons";
import { uploadIcon } from "../lib/store";
import "../icons.css";

/**
 * The "Icon" field of a tool or language in the lists: the current icon, large enough to judge,
 * "Choose image…" (sent at once; the returned id goes into the entry) and "Remove icon". The
 * lists are saved as a whole, so a changed icon is an unsaved change like any other.
 */
export function IconField({ icon, name, onChange }: { icon?: string; name: string; onChange: (icon: string | undefined) => void }) {
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
      setProblem((e as Error).message); // the server's own sentence
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="field icon-field" role="group" aria-labelledby={labelId}>
      <span className="field-label" id={labelId}>Icon<em>Optional. Shown next to the name.</em></span>
      <div className="icon-field-row">
        <span className="icon-field-preview">
          <EntryIcon icon={icon} size={56} fallback={<span className="icon-field-none">No icon</span>} />
        </span>
        <div className="icon-field-actions">
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 size={15} className="icon-spin" aria-hidden="true" /> : <ImageUp size={15} aria-hidden="true" />}{busy ? "Uploading…" : "Choose image…"}
            </button>
            {icon && <button type="button" className="btn ghost" disabled={busy} onClick={() => { setProblem(""); onChange(undefined); }}><Trash2 size={15} aria-hidden="true" />Remove icon</button>}
          </div>
          <span className="muted small icon-field-rules">{ICON_RULES}</span>
          <input ref={input} type="file" hidden accept={[...ICON_TYPES, ".svg"].join(",")} aria-label={`Icon for ${name || "this entry"}`} onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
      {problem && <p className="icon-field-problem" role="alert">{problem}</p>}
    </div>
  );
}
