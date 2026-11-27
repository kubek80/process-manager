import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainOfHtml, RICH_ATTRIBUTES, RICH_ELEMENTS, RICH_MAX, richEmpty, richHtml, richPlain, richTree, validHref, type DomLike } from "../richText";

// a stand-in for a parsed document: elements with attributes, text and comments
type Fake = { tag: string; attrs?: Record<string, string>; kids?: (Fake | string | { comment: string })[] };
const node = (x: Fake | string | { comment: string }): DomLike => {
  if (typeof x === "string") return { nodeType: 3, nodeName: "#text", nodeValue: x, childNodes: [] };
  if ("comment" in x) return { nodeType: 8, nodeName: "#comment", nodeValue: x.comment, childNodes: [] };
  return { nodeType: 1, nodeName: x.tag.toUpperCase(), nodeValue: null, childNodes: (x.kids ?? []).map(node), getAttribute: (n) => x.attrs?.[n] ?? null };
};
const body = (...kids: (Fake | string | { comment: string })[]) => node({ tag: "body", kids });
const clean = (...kids: (Fake | string | { comment: string })[]) => richHtml(richTree(body(...kids)));

describe("the allow-list of rich text", () => {
  it("is the same as the server's, the gate (server/internal/richtext)", () => {
    const go = readFileSync(new URL("../../../server/internal/richtext/richtext.go", import.meta.url), "utf8");
    const elements = go.match(/var Elements = \[\]string\{([^}]*)\}/)![1].match(/"([a-z0-9]+)"/g)!.map((s) => s.slice(1, -1));
    expect([...RICH_ELEMENTS].sort()).toEqual(elements.sort());
    const attrs = go.match(/var Attributes = map\[string\]\[\]string\{([^\n]*)\}\n/)![1];
    expect(attrs).toBe(Object.entries(RICH_ATTRIBUTES).map(([el, list]) => `"${el}": {${list!.map((a) => `"${a}"`).join(", ")}}`).join(", "));
    expect(go).toContain(`const MaxLength = ${RICH_MAX}`);
  });
  it("lets links lead only to web pages and email addresses, as the server does", () => {
    for (const ok of ["https://wiki.example.com/dns", "http://x.example", "mailto:dns@example.com"]) expect(validHref(ok)).toBe(true);
    for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.example", "https://a b", "mailto:nobody", "ftp://x.example", "", "HTTPS://X.EXAMPLE"]) expect(validHref(bad)).toBe(false);
  });
});

describe("cleaning rich text", () => {
  it("keeps the allowed formatting exactly", () => {
    const kept = clean({ tag: "h3", kids: ["What you get"] }, { tag: "p", kids: ["A ", { tag: "strong", kids: ["record"] }, " in ", { tag: "em", kids: ["a day"] }, { tag: "br" }, "and ", { tag: "a", attrs: { href: "https://x.example/a?b=1&c=2" }, kids: ["a link"] }] },
      { tag: "ul", kids: [{ tag: "li", kids: [{ tag: "p", kids: ["one"] }] }] }, { tag: "ol", kids: [{ tag: "li", kids: ["two"] }] }, { tag: "blockquote", kids: [{ tag: "p", kids: ["q"] }] },
      { tag: "pre", kids: [{ tag: "code", kids: ["a < b && c"] }] }, { tag: "h4", kids: ["Sub"] });
    expect(kept).toBe("<h3>What you get</h3><p>A <strong>record</strong> in <em>a day</em><br>and <a href=\"https://x.example/a?b=1&amp;c=2\">a link</a></p><ul><li><p>one</p></li></ul><ol><li>two</li></ol><blockquote><p>q</p></blockquote><pre><code>a &lt; b &amp;&amp; c</code></pre><h4>Sub</h4>");
  });
  it("turns what a paste uses for the same formatting into the allowed elements", () => {
    expect(clean({ tag: "h1", kids: ["T"] }, { tag: "h2", kids: ["U"] }, { tag: "h6", kids: ["V"] }, { tag: "p", kids: [{ tag: "b", kids: ["b"] }, { tag: "i", kids: ["i"] }] }))
      .toBe("<h3>T</h3><h3>U</h3><h4>V</h4><p><strong>b</strong><em>i</em></p>");
    // Word and Google Docs: spans with styles, a div per paragraph, a table of words
    expect(clean({ tag: "div", kids: [{ tag: "span", attrs: { style: "font-weight:700" }, kids: ["Plain "] }, { tag: "font", kids: ["words"] }] }, { tag: "table", kids: [{ tag: "tr", kids: [{ tag: "td", kids: ["cell"] }] }] }))
      .toBe("<p>Plain words</p><p>cell</p>");
  });
  it("drops everything that could run, load or hide something, attributes included", () => {
    const out = clean(
      { tag: "script", kids: ["alert(1)"] }, { tag: "style", kids: ["p{}"] }, { tag: "iframe", attrs: { src: "https://x.example" } }, { tag: "svg", kids: [{ tag: "script", kids: ["x"] }] },
      { tag: "math", kids: ["m"] }, { tag: "template", kids: [{ tag: "p", kids: ["t"] }] }, { tag: "noscript", kids: ["n"] }, { tag: "img", attrs: { src: "x", onerror: "alert(1)" } },
      { tag: "form", kids: [{ tag: "input" }] }, { tag: "base", attrs: { href: "https://evil.example" } }, { tag: "meta" }, { tag: "link" }, { tag: "title", kids: ["t"] }, { comment: "hidden" },
      { tag: "p", attrs: { onclick: "alert(1)", style: "color:red", class: "x", id: "y", "data-x": "1" }, kids: ["safe ", { tag: "a", attrs: { href: "javascript:alert(1)", onclick: "x" }, kids: ["words"] }, { tag: "a", attrs: { href: "https://ok.example", target: "_blank" }, kids: ["ok"] }] },
    );
    expect(out).toBe("<p>safe words<a href=\"https://ok.example\">ok</a></p>");
  });
  it("escapes words so that they stay words", () => {
    expect(clean({ tag: "p", kids: ["<script>alert(1)</script> & \"q\""] })).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; \"q\"</p>");
    expect(richHtml([{ tag: "a", href: "https://x.example/\"><script>", children: ["x"] }])).toBe("<a href=\"https://x.example/&quot;&gt;&lt;script&gt;\">x</a>");
  });
  it("leaves out empty paragraphs and headings, as an editor's last line", () => {
    expect(clean({ tag: "p", kids: ["x"] }, { tag: "p", kids: [] }, { tag: "h3", kids: [" "] }, { tag: "p", kids: [{ tag: "br" }] })).toBe("<p>x</p>");
  });
  it("knows an editor's empty paragraph from words", () => {
    expect(richEmpty(richTree(body({ tag: "p", kids: [] })))).toBe(true);
    expect(richEmpty(richTree(body({ tag: "p", kids: [" "] })))).toBe(true);
    expect(richEmpty(richTree(body({ tag: "p", kids: ["x"] })))).toBe(false);
  });
});

describe("the plain words of rich text", () => {
  it("are one line per block, for search and agents", () => {
    expect(richPlain(richTree(body({ tag: "h3", kids: ["Get"] }, { tag: "p", kids: ["A ", { tag: "strong", kids: ["b"] }] }, { tag: "ul", kids: [{ tag: "li", kids: ["one"] }, { tag: "li", kids: ["two"] }] })))).toBe("Get\nA b\none\ntwo");
  });
  it("can be read from stored HTML without a parser", () => {
    expect(plainOfHtml("<h3>What you get</h3><p>A <strong>record</strong> &amp; &#169; &#x41;&nbsp;b</p><ul><li>one</li></ul>")).toBe("What you get\nA record & © A b\none");
    expect(plainOfHtml("<script>secret()</script><p>ok</p>")).toBe("ok");
    expect(plainOfHtml(undefined)).toBe("");
  });
});
