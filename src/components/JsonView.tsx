import { useCallback, useMemo, useRef, useState } from "react";
import { AlignLeft, CircleAlert, CircleCheck, Download, FoldVertical, Search, TriangleAlert, UnfoldVertical } from "lucide-react";
import type { Issue, Process } from "../types";
import { hasErrors, processSchema, validateProcess } from "../lib/validate";
import { download } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { CopyButton } from "./ui";
import { JsonEditor, type JsonEditorHandle } from "./JsonEditor";

type Parsed = { value?: unknown; error?: string };
const parse = (text: string): Parsed => {
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: (e as Error).message }; }
};

export function JsonView({ process, knownIds, onChange }: { process: Process; knownIds: string[]; onChange: (p: Process) => void }) {
  const { catalog } = useCatalog();
  const ctx = useMemo(() => ({ processIds: knownIds, catalog }), [knownIds, catalog]);
  const canonical = useMemo(() => JSON.stringify(process, null, 2), [process]);
  const [text, setText] = useState(canonical);
  const editor = useRef<JsonEditorHandle>(null);

  const check = useCallback((value: unknown): Issue[] => {
    const issues = validateProcess(value, ctx);
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id !== process.id)
      issues.unshift({ level: "error", path: "id", message: `must stay "${process.id}" - it is the file name` });
    return issues;
  }, [ctx, process.id]);

  const parsed = useMemo(() => parse(text), [text]);
  const issues = useMemo(() => (parsed.error ? [] : check(parsed.value)), [parsed, check]);
  const ok = !parsed.error && !hasErrors(issues);
  const lines = text.split("\n").length;

  const edit = (t: string) => {
    setText(t);
    const r = parse(t);
    if (!r.error && !hasErrors(check(r.value))) onChange(r.value as Process);
  };

  return (
    <div className="json-view">
      <div className="json-editor">
        <div className="json-bar">
          <span className="json-file"><code>processes/{process.id}.json</code><em>{lines} lines</em></span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => editor.current?.search()} title="Find (Ctrl/Cmd+F)"><Search size={14} />Find</button>
          <button className="btn small ghost" onClick={() => editor.current?.foldAll()} title="Collapse everything"><FoldVertical size={14} />Fold</button>
          <button className="btn small ghost" onClick={() => editor.current?.unfoldAll()} title="Expand everything"><UnfoldVertical size={14} />Unfold</button>
          <button className="btn small ghost" onClick={() => editor.current?.format()} title="Re-indent the JSON"><AlignLeft size={14} />Format</button>
        </div>
        <JsonEditor ref={editor} value={canonical} onChange={edit} check={check} />
      </div>

      <div className="json-side">
        <div className={`check ${ok ? "good" : "bad"}`}>
          {ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          <span>{parsed.error
            ? <>Not valid JSON yet. The red marker in the margin shows where: {parsed.error}</>
            : ok ? "Valid against the schema. Edits are applied to the draft as you type."
              : "Not applied to the draft until the problems below are fixed."}</span>
        </div>
        {parsed.error && <button className="btn small" onClick={() => editor.current?.nextProblem()}><CircleAlert size={14} />Go to the problem</button>}
        {issues.length > 0 && (
          <ul className="issues clickable">
            {issues.map((i, k) => (
              <li key={k} className={i.level}>
                <button onClick={() => editor.current?.reveal(i.path)} title="Show in the editor">
                  {i.level === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
                  <span><code>{i.path}</code> {i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="btn-col">
          <CopyButton label="Copy JSON" text={() => text} />
          <button className="btn" onClick={() => download(`${process.id}.json`, text + "\n")}><Download size={16} />Download JSON</button>
          <CopyButton label="Copy JSON schema" text={() => JSON.stringify(processSchema, null, 2)} />
        </div>
        <p className="muted small">Schema: <code>schema/process.schema.json</code><br />Command line check: <code>npm run validate</code></p>
      </div>
    </div>
  );
}
