import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { AnyExtension } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Heading from "@tiptap/extension-heading";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import Blockquote from "@tiptap/extension-blockquote";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { Dropcursor, Gapcursor, UndoRedo } from "@tiptap/extensions";
import { Bold as BoldIcon, Code as CodeIcon, Heading3, Heading4, Italic as ItalicIcon, Link2, List, ListOrdered, Quote, Redo2, SquareCode, Undo2 } from "lucide-react";
import { cleanRichHtml, validHref } from "../lib/richText";
import "../services.css";

/**
 * No shortcut with Ctrl and Alt together: on Windows that is AltGr, which types characters on
 * many keyboards (Ctrl+Alt+C is "ć" on a Polish one). Every extension's shortcuts go through here;
 * headings, a code block and back to a paragraph are then reached by their buttons only.
 */
export const withoutCtrlAlt = <E extends AnyExtension>(ext: E): E => ext.extend({
  addKeyboardShortcuts() {
    const keys = (this.parent?.() ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(keys).filter(([k]) => !(/(^|-)Alt-/.test(k) && /(^|-)(Mod|Ctrl)-/.test(k))));
  },
}) as E;

/** The shortcut keys as this computer names them: ⌘ on a Mac, Ctrl elsewhere. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keys = (k: string) => (MAC ? k.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧") : k);

/**
 * The editor of a service's description (Admin › Services): formatting without writing HTML, from
 * the same allow-list as everything else (`src/lib/richText.ts`): paragraphs, two levels of
 * headings, bold, italic, lists, links (web pages and email addresses), quotes and code. Built on
 * Tiptap (ProseMirror, MIT): it builds no code at run time and loads nothing from elsewhere, and
 * its own styles are left out (`injectCSS: false`; ours are on tokens in services.css). What it
 * holds is cleaned before it reaches the lists' one draft (`cleanRichHtml`), and so is what is
 * pasted: from Word, Google Docs or a web page the allowed formatting stays and the rest goes. Its
 * own Undo and Redo work inside it; the page's Undo, Redo and Discard change what it shows.
 */
export default function RichEditor({ value, onChange, labelledBy, max }: { value: string; onChange: (html: string) => void; labelledBy: string; max: number }) {
  const sent = useRef(value); // what this editor last gave the page
  const editor = useEditor({
    injectCSS: false,
    extensions: [
      Document, Paragraph, Text, Bold, Italic, Heading.configure({ levels: [3, 4] }), BulletList, OrderedList, ListItem, ListKeymap,
      Blockquote, Code, CodeBlock, HardBreak, Dropcursor, Gapcursor, UndoRedo,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["mailto"], defaultProtocol: "https", isAllowedUri: (url) => validHref(url), HTMLAttributes: { target: null, rel: null, class: null } }),
    ].map((e) => withoutCtrlAlt(e as AnyExtension)),
    content: value,
    editorProps: {
      attributes: { class: "rich-edit-area", "data-field": "description", role: "textbox", "aria-multiline": "true", "aria-labelledby": labelledBy },
      // a paste keeps only the allowed formatting, whatever it came from
      transformPastedHTML: (html) => cleanRichHtml(html),
    },
    onUpdate: ({ editor: e }) => {
      const html = cleanRichHtml(e.getHTML());
      sent.current = html;
      onChange(html);
    },
  });
  // the page's Undo, Redo or Discard changed the description: show it, and start the editor's own
  // history afresh, so that its Undo never reaches back across the page's
  useEffect(() => {
    if (!editor || value === sent.current) return;
    sent.current = value;
    editor.commands.setContent(value || "", { emitUpdate: false });
    const now = editor.state;
    editor.view.updateState(EditorState.create({ doc: now.doc, plugins: now.plugins, selection: now.selection }));
  }, [editor, value]);
  // what the editor shows as on (bold, a heading…) only while it, or its toolbar, has the keyboard
  const [within, setWithin] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState(0); // the toolbar's one Tab stop
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? {
      bold: e.isActive("bold"), italic: e.isActive("italic"), h3: e.isActive("heading", { level: 3 }), h4: e.isActive("heading", { level: 4 }),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), code: e.isActive("code"), block: e.isActive("codeBlock"),
      href: (e.getAttributes("link").href as string | undefined) ?? "", undo: e.can().undo(), redo: e.can().redo(),
    } : null),
  });
  const [linking, setLinking] = useState<string | null>(null); // the address being typed, null: closed
  if (!editor || !state) return <p className="muted small">Loading the editor…</p>;
  const chain = () => editor.chain().focus();
  let index = 0;
  // the Tab stop is never a button that cannot be pressed (Undo with nothing to undo): then Bold
  const stopOff = (stop === 10 && !state.undo) || (stop === 11 && !state.redo);
  const tool = (label: string, shortcut: string, Icon: typeof BoldIcon, on: boolean | null, run: () => void, disabled = false, expanded?: boolean) => {
    const at = index++;
    const name = `${label}${shortcut ? ` (${keys(shortcut)})` : ""}`;
    return (
      <button type="button" className="icon-btn" aria-label={name} title={name} tabIndex={at === (stopOff ? 0 : stop) ? 0 : -1} data-at={at}
        {...(on === null ? {} : { "aria-pressed": within && on })} {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
        disabled={disabled} onFocus={() => setStop(at)} onMouseDown={(e) => e.preventDefault()} onClick={run}><Icon size={16} aria-hidden="true" /></button>
    );
  };
  // one Tab stop: the arrows go through the buttons that can be pressed, Home and End to the first and last
  const roam = (e: KeyboardEvent) => {
    const all = [...(toolbar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowRight" ? all[(i + 1) % all.length] : e.key === "ArrowLeft" ? all[(i - 1 + all.length) % all.length]
      : e.key === "Home" ? all[0] : e.key === "End" ? all[all.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    to.focus();
  };
  const applyLink = () => {
    const url = (linking ?? "").trim();
    if (!url) chain().extendMarkRange("link").unsetLink().run();
    else if (validHref(url)) chain().extendMarkRange("link").setLink({ href: url }).run();
    else return;
    setLinking(null);
  };
  const length = cleanRichHtml(editor.getHTML()).length;
  return (
    <div className="rich-editor" onFocus={() => setWithin(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setWithin(false); }}>
      <div ref={toolbar} className="rich-tools" role="toolbar" aria-label="Formatting" onKeyDown={roam}>
        {tool("Bold", "Ctrl+B", BoldIcon, state.bold, () => chain().toggleBold().run())}
        {tool("Italic", "Ctrl+I", ItalicIcon, state.italic, () => chain().toggleItalic().run())}
        <span className="sep" aria-hidden="true" />
        {tool("Heading", "", Heading3, state.h3, () => chain().toggleHeading({ level: 3 }).run())}
        {tool("Subheading", "", Heading4, state.h4, () => chain().toggleHeading({ level: 4 }).run())}
        {tool("Bulleted list", "Ctrl+Shift+8", List, state.bullet, () => chain().toggleBulletList().run())}
        {tool("Numbered list", "Ctrl+Shift+7", ListOrdered, state.ordered, () => chain().toggleOrderedList().run())}
        {tool("Quote", "Ctrl+Shift+B", Quote, state.quote, () => chain().toggleBlockquote().run())}
        <span className="sep" aria-hidden="true" />
        {tool("Code", "Ctrl+E", CodeIcon, state.code, () => chain().toggleCode().run())}
        {tool("Code block", "", SquareCode, state.block, () => chain().toggleCodeBlock().run())}
        {tool("Link", "", Link2, null, () => setLinking(linking === null ? state.href : null), false, linking !== null)}
        <span className="sep" aria-hidden="true" />
        {tool("Undo", "Ctrl+Z", Undo2, null, () => chain().undo().run(), !state.undo)}
        {tool("Redo", "Ctrl+Shift+Z", Redo2, null, () => chain().redo().run(), !state.redo)}
      </div>
      {linking !== null && (
        <form className="rich-link" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
          <input autoFocus value={linking} placeholder="https://… or mailto:team@company.com" aria-label="Address of the link"
            onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setLinking(null); editor.commands.focus(); } }} />
          <button type="submit" className="btn small" disabled={!!linking.trim() && !validHref(linking.trim())}>{linking.trim() ? "Apply" : "Remove the link"}</button>
          <button type="button" className="btn small ghost" onClick={() => { setLinking(null); editor.commands.focus(); }}>Cancel</button>
          {!!linking.trim() && !validHref(linking.trim()) && <span className="muted small">Write the whole address, starting with https:// (or mailto: for an email).</span>}
        </form>
      )}
      <EditorContent editor={editor} />
      <span className={`rich-count ${length > max ? "over" : ""}`.trim()}>{length > max ? `${length} of ${max} characters with the formatting: shorten it` : `${length} of ${max} characters with the formatting`}</span>
    </div>
  );
}
