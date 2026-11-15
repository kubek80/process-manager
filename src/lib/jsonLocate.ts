import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

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
