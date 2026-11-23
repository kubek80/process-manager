import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, CircleAlert, CircleCheck, Download, FoldVertical, Search, UnfoldVertical } from "lucide-react";
import type { Issue } from "../types";
import { hasErrors } from "../lib/validate";
import { download } from "../lib/store";
import { issuePlace, issueText } from "../lib/editing";
import { CopyButton, IssueList } from "./ui";
import { JsonEditor, type JsonEditorHandle } from "./JsonEditor";

type Parsed = { value?: unknown; error?: string };
const parse = (text: string): Parsed => {
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: (e as Error).message }; }
};

/** The raw JSON of a process or a standard, with the checker's findings marked on the line. */
export function JsonView<T extends { id: string }>({ doc, noun, validate, schema, schemaFile, onChange, onPending }: {
  doc: T; noun: string; validate: (value: unknown) => Issue[]; schema: object; schemaFile: string; onChange: (d: T) => void;
  /** Told whether the editor holds text that could not be applied to the draft (it has problems). */
  onPending?: (pending: boolean) => void;
}) {
  const canonical = useMemo(() => JSON.stringify(doc, null, 2), [doc]);
  const [text, setText] = useState(canonical);
  const editor = useRef<JsonEditorHandle>(null);

  const check = useCallback((value: unknown): Issue[] => {
    const issues = validate(value);
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id !== doc.id)
      issues.unshift({ level: "error", path: "id", message: `The id must stay “${doc.id}”: the ${noun} is known by it.` });
    return issues;
  }, [validate, doc.id, noun]);

  const parsed = useMemo(() => parse(text), [text]);
  // a problem in the words of the editing screen, by its place in words; where it is in the JSON comes second
  const kind = noun === "standard" ? "standard" : "process";
  const words = useCallback((i: Issue, value: unknown) => `${issuePlace(kind, value, i.path)}: ${issueText(i, kind)}`, [kind]);
  const issues = useMemo(() => (parsed.error ? [] : check(parsed.value)), [parsed, check]);
  const ok = !parsed.error && !hasErrors(issues);
  const lines = text.split("\n").length;
  // text with problems is not part of the draft: the page must not save around it or drop it silently
  const pending = !ok && text !== canonical;
  useEffect(() => { onPending?.(pending); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPending?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (t: string) => {
    setText(t);
    const r = parse(t);
    if (!r.error && !hasErrors(check(r.value))) onChange(r.value as T);
  };

  return (
    <div className="json-view">
      <div className="json-editor">
        <div className="json-bar">
          <span className="json-file"><code>{doc.id}.json</code><em>{lines} lines</em></span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => editor.current?.search()} title="Find (Ctrl/Cmd+F)"><Search size={14} />Find</button>
          <button className="btn small ghost" onClick={() => editor.current?.foldAll()} title="Collapse everything"><FoldVertical size={14} />Fold</button>
          <button className="btn small ghost" onClick={() => editor.current?.unfoldAll()} title="Expand everything"><UnfoldVertical size={14} />Unfold</button>
          <button className="btn small ghost" onClick={() => editor.current?.format()} title="Re-indent the JSON"><AlignLeft size={14} />Format</button>
        </div>
        <JsonEditor ref={editor} value={canonical} onChange={edit} check={check} words={words} />
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
          <IssueList issues={issues} label="What the checker found" pickTitle="Show in the editor" onPick={(i) => editor.current?.reveal(i.path)}
            place={(i) => issuePlace(kind, parsed.value, i.path)} text={(i) => issueText(i, kind)} detail={(i) => i.path || undefined} />
        )}
        <div className="btn-col">
          <CopyButton label="Copy JSON" text={() => text} />
          <button className="btn" onClick={() => download(`${doc.id}.json`, text + "\n")}><Download size={16} />Download JSON</button>
          <CopyButton label="Copy JSON schema" text={() => JSON.stringify(schema, null, 2)} />
        </div>
        <p className="muted small">Schema: <code>{schemaFile}</code><br />Every save is kept as a version.</p>
      </div>
    </div>
  );
}
