import { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Download } from "lucide-react";
import type { Issue, Process } from "../types";
import { extractJson, hasErrors, processSchema, validateProcess } from "../lib/validate";
import { download } from "../lib/store";
import { CopyButton } from "./ui";
import { useCatalog } from "../lib/catalog";
import { IssueList } from "./AiDialog";

export function JsonView({ process, knownIds, onChange }: { process: Process; knownIds: string[]; onChange: (p: Process) => void }) {
  const { catalog } = useCatalog();
  const ctx = useMemo(() => ({ processIds: knownIds, catalog }), [knownIds, catalog]);
  const canonical = useMemo(() => JSON.stringify(process, null, 2), [process]);
  const [text, setText] = useState(canonical);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(canonical); }, [canonical, focused]);

  const parsed = useMemo(() => extractJson(text), [text]);
  const issues: Issue[] = useMemo(() => (parsed.value ? validateProcess(parsed.value, ctx) : []), [parsed, ctx]);
  const ok = !!parsed.value && !hasErrors(issues);

  const edit = (t: string) => {
    setText(t);
    const r = extractJson(t);
    if (r.value && !hasErrors(validateProcess(r.value, ctx)) && (r.value as Process).id === process.id) onChange(r.value as Process);
  };
  const idChanged = ok && (parsed.value as Process).id !== process.id;

  return (
    <div className="json-view">
      <div className="json-editor">
        <textarea className="mono" spellCheck={false} value={text} onChange={(e) => edit(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      </div>
      <div className="json-side">
        <div className={`check ${ok && !idChanged ? "good" : "bad"}`}>
          {ok && !idChanged ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          <span>{parsed.error ?? (idChanged ? "The id cannot be changed here - it is the file name." : ok ? "Valid against the schema. Edits are applied to the draft as you type." : "Not applied until the problems below are fixed.")}</span>
        </div>
        {issues.length > 0 && <IssueList issues={issues} />}
        <div className="btn-col">
          <CopyButton label="Copy JSON" text={() => text} />
          <button className="btn" onClick={() => download(`${process.id}.json`, text + "\n")}><Download size={16} />Download JSON</button>
          <CopyButton label="Copy JSON schema" text={() => JSON.stringify(processSchema, null, 2)} />
        </div>
        <p className="muted small">File: <code>processes/{process.id}.json</code><br />Schema: <code>schema/process.schema.json</code><br />Command line check: <code>npm run validate</code></p>
      </div>
    </div>
  );
}
