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

/**
 * One rule for every link people follow, the same on the server (`richtext.WebLink`,
 * `docs.ValidLink`) and in the schema's patterns: http:// or https:// and then at least one
 * character, none of them white space of any kind (also the Unicode ones), a control character,
 * a quote, "<", ">" or a backslash. Lengths are counted in characters (code points), as there.
 * The shared cases in server/internal/richtext/testdata/links.json hold both sides to it.
 */
const linkChar = (c: number) => !(c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029
  || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff || c === 0x22 || c === 0x3c || c === 0x3e || c === 0x5c);
const linkChars = (s: string) => s.length > 0 && [...s].every((ch) => linkChar(ch.codePointAt(0)!)) && !/[\ud800-\udfff]/u.test(s);
/** The length of a text in characters (code points), as the server counts it. */
export const charCount = (s: string) => [...s].length;
/** A web link by the rule above (its length is the caller's). */
export const validWebLink = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const rest = s.startsWith("https://") ? s.slice(8) : s.startsWith("http://") ? s.slice(7) : null;
  return rest !== null && linkChars(rest);
};
const mailLink = (s: string) => {
  if (!s.startsWith("mailto:")) return false;
  const rest = s.slice(7);
  if (!linkChars(rest) || rest.split("@").length !== 2) return false;
  const [name, domain] = rest.split("@");
  return name !== "" && domain.indexOf(".") > 0 && domain.lastIndexOf(".") < domain.length - 1;
};
/** A link in rich text may lead to a web page or an email address (mailto:), at most 2000 characters. */
export const validHref = (s: unknown): s is string => typeof s === "string" && charCount(s) <= 2000 && (validWebLink(s) || mailLink(s));

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
/** The characters a description may not hold: the C0 controls other than tab, line feed and carriage return, and DEL (the server's `richtext.Control`). */
export const richControl = (c: number) => (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f;
/** Words as they are kept: without control characters, a non-breaking space as an ordinary one. */
const keptWords = (s: string) => [...s].filter((ch) => !richControl(ch.codePointAt(0)!)).join("").replace(/\u00a0/g, " ");

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
    if (k.nodeType === 3) { const words = keptWords(k.nodeValue ?? ""); if (words) out.push(words); continue; }
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

// ---------- the check: the server's gate, written again (richtext.Problem)

const ENTITY_NAMES = new Set(["amp", "lt", "gt", "quot", "apos", "nbsp"]);
const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isDigit = (c: string) => c >= "0" && c <= "9";
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
const shorten = (s: string) => { const cs = [...s]; return cs.length <= 40 ? s : `${cs.slice(0, 40).join("")}…`; };
const P = {
  notText: "characters that are not text", control: "an invisible control character", unfinished: "a tag that is not finished",
  unreadable: "a tag the portal cannot read", ampersand: "an “&” that is not written as &amp;", lessThan: "a “<” that does not start a tag (write it as &lt;)",
  comment: "a hidden comment", doctype: "a document type", unquoted: "an attribute without quotes", endAttr: "a closing tag with attributes",
};
function elementWords(el: string): string {
  if (["script", "noscript"].includes(el)) return "a script";
  if (el === "style") return "a style sheet";
  if (["img", "picture", "svg", "image"].includes(el)) return "a picture";
  if (["iframe", "frame", "frameset", "object", "embed", "applet"].includes(el)) return "an embedded page";
  if (["form", "input", "button", "select", "textarea", "option"].includes(el)) return "a form";
  if (["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"].includes(el)) return "a table";
  if (["video", "audio", "source", "track"].includes(el)) return "a video or a sound";
  return `the element “${shorten(el)}”`;
}
/** A character reference at the start of s: its length, or 0 when the text may not hold it. */
function entityAt(s: string): number {
  const end = s.indexOf(";");
  if (end < 2 || end > 10) return 0;
  const body = s.slice(1, end);
  if (body[0] !== "#") return ENTITY_NAMES.has(body) ? end + 1 : 0;
  let digits = body.slice(1), base = 10;
  if (digits[0] === "x" || digits[0] === "X") { base = 16; digits = digits.slice(1); }
  if (!digits || digits.length > 7 || !(base === 16 ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return 0;
  const r = parseInt(digits, base);
  return r > 0 && r <= 0x10ffff && !(r >= 0xd800 && r <= 0xdfff) && !richControl(r) ? end + 1 : 0;
}
function tagName(s: string, i: number): [number, string] {
  const start = i;
  if (i >= s.length || !isLetter(s[i])) return [i, ""];
  while (i < s.length && (isLetter(s[i]) || isDigit(s[i]))) i++;
  return [i, s.slice(start, i).toLowerCase()];
}
const ALLOWED_ATTRS = RICH_ATTRIBUTES as Record<string, readonly string[] | undefined>;
/** The tag at the start of s: its length, or the problem with it. */
function tagAt(s: string): [number, string] {
  if (s.length < 2) return [0, P.lessThan];
  if (s[1] === "!") return [0, s.length >= 9 && s.slice(2, 9).toLowerCase() === "doctype" ? P.doctype : P.comment];
  if (s[1] === "?") return [0, P.unreadable];
  if (s[1] === "/") {
    let [i, name] = tagName(s, 2);
    if (!name) return [0, i >= s.length ? P.unfinished : P.unreadable];
    if (!ALLOWED.has(name)) return [0, elementWords(name)];
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) return [0, P.unfinished];
    return s[i] === ">" ? [i + 1, ""] : [0, P.endAttr];
  }
  if (!isLetter(s[1])) return [0, P.lessThan];
  let [i, name] = tagName(s, 1);
  if (i >= s.length) return [0, P.unfinished];
  if (!ALLOWED.has(name)) return [0, elementWords(name)];
  const seen = new Set<string>();
  for (;;) {
    let spaced = false;
    while (i < s.length && isSpace(s[i])) { i++; spaced = true; }
    if (i >= s.length) return [0, P.unfinished];
    if (s[i] === ">") return [i + 1, ""];
    if (s[i] === "/") {
      if (i + 1 >= s.length) return [0, P.unfinished];
      return s[i + 1] !== ">" || name !== "br" ? [0, P.unreadable] : [i + 2, ""];
    }
    if (!spaced) return [0, P.unreadable];
    const start = i;
    while (i < s.length && !isSpace(s[i]) && !"=>/\"'<".includes(s[i])) i++;
    const attr = s.slice(start, i).toLowerCase();
    if (!attr) return [0, i >= s.length ? P.unfinished : P.unreadable];
    if (!(ALLOWED_ATTRS[name] ?? []).includes(attr)) return [0, `the attribute “${shorten(attr)}”`];
    if (seen.has(attr)) return [0, `the attribute “${attr}” twice`];
    seen.add(attr);
    if (i >= s.length) return [0, P.unfinished];
    if (s[i] !== "=") return [0, P.unquoted];
    i++;
    if (i >= s.length) return [0, P.unfinished];
    if (s[i] !== "\"") return [0, P.unquoted];
    const end = s.indexOf("\"", i + 1);
    if (end < 0) return [0, P.unfinished];
    const value = s.slice(i + 1, end);
    i = end + 1;
    if (attr === "href" && (value.split("&amp;").join("").includes("&") || !validHref(value.split("&amp;").join("&")))) return [0, `a link to “${shorten(value)}”`];
  }
}

/**
 * The first thing in stored rich text that may not be stored, in a few words ("a script"), or ""
 * when it is fine: the server's gate (`richtext.Problem`) written again, so that the checker and
 * `npm run validate` refuse what the server refuses, in its words. It refuses; it never cleans.
 */
export function richProblem(html: string): string {
  if (/[\ud800-\udfff]/u.test(html)) return P.notText;
  for (const ch of html) if (richControl(ch.codePointAt(0)!)) return P.control;
  for (let i = 0; i < html.length;) {
    const c = html[i];
    if (c === "&") { const n = entityAt(html.slice(i)); if (!n) return P.ampersand; i += n; }
    else if (c === "<") { const [n, p] = tagAt(html.slice(i)); if (p) return p; i += n; }
    else i++;
  }
  return "";
}

/** The rule for one stored description as a sentence of the lists (the server's `richtext.Check`); `what` names the service. */
export function richCheck(html: string, what: string): string {
  const n = charCount(html);
  if (n > RICH_MAX) return `Shorten the description of ${what} to at most ${RICH_MAX} characters (with its formatting): it has ${n}.`;
  const p = richProblem(html);
  return p ? `The description of ${what} contains ${p}, which cannot be shown: remove it, or paste the text again.` : "";
}
