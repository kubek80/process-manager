import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading3, Heading4, Italic, Link2, List, ListOrdered, Quote, Redo2, SquareCode, Undo2 } from "lucide-react";
import { cleanRichHtml, validHref } from "../lib/richText";
import "../services.css";

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
    extensions: [StarterKit.configure({
      heading: { levels: [3, 4] },
      strike: false, underline: false, horizontalRule: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["mailto"], defaultProtocol: "https", isAllowedUri: (url) => validHref(url), HTMLAttributes: { target: null, rel: null, class: null } },
    })],
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
  // the page's Undo, Redo or Discard changed the description: show it
  useEffect(() => {
    if (!editor || value === sent.current) return;
    sent.current = value;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? {
      bold: e.isActive("bold"), italic: e.isActive("italic"), h3: e.isActive("heading", { level: 3 }), h4: e.isActive("heading", { level: 4 }),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), code: e.isActive("code"), block: e.isActive("codeBlock"),
      link: e.isActive("link"), href: (e.getAttributes("link").href as string | undefined) ?? "", undo: e.can().undo(), redo: e.can().redo(),
    } : null),
  });
  const [linking, setLinking] = useState<string | null>(null); // the address being typed, null: closed
  if (!editor || !state) return <p className="muted small">Loading the editor…</p>;
  const chain = () => editor.chain().focus();
  const tool = (label: string, keys: string, Icon: typeof Bold, on: boolean | null, run: () => void, disabled = false) => (
    <button type="button" className="icon-btn" aria-label={`${label}${keys ? ` (${keys})` : ""}`} title={`${label}${keys ? ` (${keys})` : ""}`}
      {...(on === null ? {} : { "aria-pressed": on })} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}><Icon size={16} aria-hidden="true" /></button>
  );
  const applyLink = () => {
    const url = (linking ?? "").trim();
    if (!url) chain().extendMarkRange("link").unsetLink().run();
    else if (validHref(url)) chain().extendMarkRange("link").setLink({ href: url }).run();
    else return;
    setLinking(null);
  };
  const length = cleanRichHtml(editor.getHTML()).length;
  return (
    <div className="rich-editor">
      <div className="rich-tools" role="toolbar" aria-label="Formatting">
        {tool("Bold", "Ctrl+B", Bold, state.bold, () => chain().toggleBold().run())}
        {tool("Italic", "Ctrl+I", Italic, state.italic, () => chain().toggleItalic().run())}
        <span className="sep" aria-hidden="true" />
        {tool("Heading", "Ctrl+Alt+3", Heading3, state.h3, () => chain().toggleHeading({ level: 3 }).run())}
        {tool("Subheading", "Ctrl+Alt+4", Heading4, state.h4, () => chain().toggleHeading({ level: 4 }).run())}
        {tool("Bulleted list", "Ctrl+Shift+8", List, state.bullet, () => chain().toggleBulletList().run())}
        {tool("Numbered list", "Ctrl+Shift+7", ListOrdered, state.ordered, () => chain().toggleOrderedList().run())}
        {tool("Quote", "Ctrl+Shift+B", Quote, state.quote, () => chain().toggleBlockquote().run())}
        <span className="sep" aria-hidden="true" />
        {tool("Code", "Ctrl+E", Code, state.code, () => chain().toggleCode().run())}
        {tool("Code block", "Ctrl+Alt+C", SquareCode, state.block, () => chain().toggleCodeBlock().run())}
        {tool("Link", "", Link2, state.link, () => setLinking(linking === null ? state.href : null))}
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
