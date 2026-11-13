import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { foldAll, HighlightStyle, syntaxHighlighting, syntaxTree, unfoldAll } from "@codemirror/language";
import { forceLinting, linter, lintGutter, nextDiagnostic, type Diagnostic } from "@codemirror/lint";
import { openSearchPanel } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import type { SyntaxNode } from "@lezer/common";
import type { Issue } from "../types";

const VALUES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);

/** Find where a checker path such as `steps[2].next[0].to` sits in the text. */
export function locate(state: EditorState, path: string): { from: number; to: number } | null {
  let node: SyntaxNode | null = syntaxTree(state).topNode.firstChild;
  if (!node) return null;
  let mark: SyntaxNode = node;
  const parts = path === "(root)" ? [] : path.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  for (const part of parts) {
    if (!node) break;
    if (part.startsWith("[")) {
      if (node.name !== "Array") break;
      let i = Number(part.slice(1, -1));
      let found: SyntaxNode | null = null;
      for (let child: SyntaxNode | null = node.firstChild; child; child = child.nextSibling) if (VALUES.has(child.name) && i-- === 0) { found = child; break; }
      if (!found) break;
      node = mark = found;
    } else {
      if (node.name !== "Object") break;
      let found: SyntaxNode | null = null;
      for (let prop: SyntaxNode | null = node.firstChild; prop; prop = prop.nextSibling) {
        const name: SyntaxNode | null = prop.name === "Property" ? prop.firstChild : null;
        if (name && state.sliceDoc(name.from, name.to) === JSON.stringify(part)) { found = prop; break; }
      }
      if (!found) break;
      node = found.lastChild;
      // for a whole object or list, underline the key rather than many lines
      mark = node && (node.name === "Object" || node.name === "Array") ? found.firstChild! : node ?? found;
    }
  }
  if (mark.name === "Object" || mark.name === "Array") return { from: mark.from, to: mark.from + 1 };
  return { from: mark.from, to: mark.to };
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", color: "var(--text)", backgroundColor: "var(--surface)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--accent)", padding: "12px 0" },
  ".cm-gutters": { backgroundColor: "var(--surface-2)", color: "var(--text-3)", border: "none", borderRight: "1px solid var(--line)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 24%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)", outline: "none" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--accent-soft)", border: "none", color: "var(--accent)", padding: "0 6px", borderRadius: "6px" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "8px", boxShadow: "var(--shadow-2)", color: "var(--text)" },
  ".cm-tooltip-lint": { padding: "2px 0" },
  ".cm-diagnostic": { padding: "5px 10px", fontFamily: "inherit" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--bad)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--warn)" },
  ".cm-lintRange-error": { backgroundImage: "none", borderBottom: "2px solid var(--bad)", backgroundColor: "var(--bad-bg)" },
  ".cm-lintRange-warning": { backgroundImage: "none", borderBottom: "2px dotted var(--warn)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)", borderColor: "var(--line)" },
  ".cm-panels input, .cm-panels button": { font: "inherit", width: "auto", height: "auto" },
  ".cm-textfield": { backgroundColor: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "6px" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "6px" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warn) 30%, transparent)" },
  ".cm-flash": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
});

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--json-key)" },
  { tag: t.string, color: "var(--json-string)" },
  { tag: t.number, color: "var(--json-number)" },
  { tag: [t.bool, t.null], color: "var(--json-atom)", fontWeight: "600" },
  { tag: [t.separator, t.squareBracket, t.brace], color: "var(--text-3)" },
]);

export interface JsonEditorHandle { nextProblem: () => void; reveal: (path: string) => void; format: () => void; foldAll: () => void; unfoldAll: () => void; search: () => void }

export const JsonEditor = forwardRef<JsonEditorHandle, {
  value: string; onChange: (text: string) => void; check: (value: unknown) => Issue[]; readOnly?: boolean;
}>(function JsonEditor({ value, onChange, check, readOnly }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, check });
  cb.current = { onChange, check };

  useEffect(() => {
    const parseLint = jsonParseLinter();
    // syntax errors first; once it parses, the schema and reference checks
    const lint = linter((v): Diagnostic[] => {
      let parsed: unknown;
      try { parsed = JSON.parse(v.state.doc.toString()); } catch { return parseLint(v); }
      return cb.current.check(parsed).map((i) => {
        const at = locate(v.state, i.path) ?? { from: 0, to: 1 };
        return { ...at, severity: i.level, message: `${i.path}: ${i.message}` };
      });
    }, { delay: 250 });
    const extensions: Extension[] = [
      basicSetup, json(), syntaxHighlighting(highlight), theme, lint, lintGutter(),
      keymap.of([indentWithTab]), EditorState.tabSize.of(2), EditorView.editable.of(!readOnly), EditorState.readOnly.of(!!readOnly),
      EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
    ];
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions }) });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // take changes made elsewhere (map, details) while the editor is not being typed in
  useEffect(() => {
    const v = view.current;
    if (!v || v.hasFocus || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useImperativeHandle(ref, () => ({
    reveal(path) {
      const v = view.current;
      if (!v) return;
      const at = locate(v.state, path);
      if (!at) return;
      v.dispatch({ selection: { anchor: at.from, head: at.to }, effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
      v.focus();
    },
    format() {
      const v = view.current;
      if (!v) return;
      try {
        const pretty = JSON.stringify(JSON.parse(v.state.doc.toString()), null, 2);
        if (pretty !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: pretty } });
      } catch { /* not valid JSON yet: the gutter shows where */ }
    },
    nextProblem: () => { const v = view.current; if (v) { forceLinting(v); v.focus(); nextDiagnostic(v); } },
    foldAll: () => { if (view.current) foldAll(view.current); },
    unfoldAll: () => { if (view.current) unfoldAll(view.current); },
    search: () => { if (view.current) { view.current.focus(); openSearchPanel(view.current); } },
  }), []);

  return <div className="json-cm" ref={host} />;
});
