/**
 * Rich text: the description of a service, stored as HTML of a small allow-list. One rule in
 * three places: the server refuses anything else (`server/internal/richtext`, the gate), the app
 * cleans what a person pastes or the editor writes before it is saved (`cleanRichHtml`), and the
 * one component that shows it (`RichText`) rebuilds it from the same list, never trusting what is
 * stored. A unit test reads the server's file and fails when the two lists differ.
 */

/** The only elements: paragraphs, two levels of headings (below the page's own), bold, italic, lists, links, line breaks, a block quote, inline code and a code block. */
export const RICH_ELEMENTS = ["p", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "br", "blockquote", "code", "pre"] as const;
export type RichTag = (typeof RICH_ELEMENTS)[number];
/** The only attributes, by element: a link's address. */
export const RICH_ATTRIBUTES: Partial<Record<RichTag, readonly string[]>> = { a: ["href"] };
/** The most characters a description may have, its formatting included (the server's `richtext.MaxLength`). */
export const RICH_MAX = 20000;

const ALLOWED = new Set<string>(RICH_ELEMENTS);
/** Elements whose content is never words of the description: dropped whole, never shown. */
const DROP = new Set(["script", "style", "template", "noscript", "title", "head", "meta", "link", "base", "iframe", "frame", "frameset", "object", "embed", "applet",
  "svg", "math", "img", "picture", "video", "audio", "source", "track", "canvas", "map", "form", "input", "button", "select", "option", "textarea", "xmp", "plaintext", "noembed", "noframes"]);
/** What a pasted text uses for the same formatting. */
const RENAME: Record<string, RichTag> = { b: "strong", i: "em", h1: "h3", h2: "h3", h5: "h4", h6: "h4" };
/** Elements that are a block of their own: an unknown one (a div, a table's row) becomes a paragraph, so its words keep their own line. */
const BLOCKS = new Set(["div", "section", "article", "header", "footer", "aside", "main", "nav", "figure", "figcaption", "table", "tr", "dl", "dt", "dd", "address", "center", "details", "summary"]);

/** A link may lead to a web page (http, https) or an email address (mailto), written exactly so. */
export const validHref = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 2000 && (/^https?:\/\/\S+$/.test(s) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

/** Rich text as a tree: words, or an element of the list with its children (a link with its address). */
export type RichNode = string | { tag: RichTag; href?: string; children: RichNode[] };

/** What `richTree` reads: a node of a parsed document (the browser's DOM, or a stand-in in tests). */
export interface DomLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomLike>;
  getAttribute?: (name: string) => string | null;
}

/** Whether rich text holds any words (a line break alone is none). */
const words = (nodes: RichNode[]): boolean => nodes.some((n) => (typeof n === "string" ? !!n.trim() : words(n.children)));
const isBlock = (n: RichNode) => typeof n !== "string" && ["p", "h3", "h4", "ul", "ol", "blockquote", "pre"].includes(n.tag);

/**
 * The children of a parsed node as rich text: only elements of the list, only a link's valid
 * address; an unknown element gives its words (a block of its own as a paragraph), a dangerous
 * one (script, style, svg…) nothing; comments are left out.
 */
export function richTree(node: DomLike): RichNode[] {
  const out: RichNode[] = [];
  const kids = Array.from(node.childNodes);
  for (const k of kids) {
    if (k.nodeType === 3) { if (k.nodeValue) out.push(k.nodeValue); continue; }
    if (k.nodeType !== 1) continue; // comments, processing instructions
    const name = k.nodeName.toLowerCase();
    if (DROP.has(name)) continue;
    const tag = RENAME[name] ?? name;
    const children = richTree(k);
    if (ALLOWED.has(tag)) {
      if (tag === "a") {
        const href = k.getAttribute?.("href") ?? "";
        if (validHref(href)) out.push({ tag: "a", href, children });
        else out.push(...children);
      } else if ((tag === "p" || tag === "h3" || tag === "h4") && !words(children)) {
        // an empty paragraph or heading (an editor's last line, a paste's spacing) says nothing
      } else out.push({ tag: tag as RichTag, children });
    } else if (BLOCKS.has(name) && children.length) {
      // a block of its own: its blocks stay blocks, its words become a paragraph
      out.push(...(children.some(isBlock) ? children : [{ tag: "p" as const, children }]));
    } else out.push(...children);
  }
  return out;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** Rich text written out as the HTML that is stored. */
export function richHtml(nodes: RichNode[]): string {
  return nodes.map((n) => {
    if (typeof n === "string") return escapeText(n);
    if (n.tag === "br") return "<br>";
    const open = n.tag === "a" && n.href ? `<a href="${escapeAttr(n.href)}">` : `<${n.tag}>`;
    return `${open}${richHtml(n.children)}</${n.tag}>`;
  }).join("");
}

/** Whether rich text holds no words at all (an editor's empty paragraph). */
export const richEmpty = (nodes: RichNode[]): boolean => nodes.every((n) => (typeof n === "string" ? !n.trim() : n.tag !== "br" && richEmpty(n.children)));

/** The plain words of rich text: one line per block, for search and for agents. */
export function richPlain(nodes: RichNode[]): string {
  const lines: string[] = [];
  let line = "";
  const walk = (ns: RichNode[]) => {
    for (const n of ns) {
      if (typeof n === "string") { line += n; continue; }
      const block = n.tag === "br" || n.tag === "li" || isBlock(n);
      if (block) { lines.push(line); line = ""; }
      walk(n.children);
      if (block) { lines.push(line); line = ""; }
    }
  };
  walk(nodes);
  lines.push(line);
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/**
 * The plain words of stored HTML without a parser, for the search where no document can be built
 * (the list of services is searched in the page and in tests alike): tags become breaks, the
 * usual entities their characters. Only ever used as text, never shown as HTML.
 */
export function plainOfHtml(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(p|h3|h4|li|br|blockquote|pre|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Parses HTML into an inert document (nothing in it runs or loads) and gives its rich text. Browser only. */
export function parseRich(html: unknown): RichNode[] {
  if (typeof html !== "string" || !html.trim() || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  return richTree(doc.body as unknown as DomLike);
}

/**
 * What is saved for a description: the allowed formatting of what the editor or a paste holds,
 * nothing else; empty when it holds no words. Browser only.
 */
export function cleanRichHtml(html: unknown): string {
  const nodes = parseRich(html);
  return richEmpty(nodes) ? "" : richHtml(nodes);
}
