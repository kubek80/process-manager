import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainOfHtml, RICH_ATTRIBUTES, RICH_ELEMENTS, RICH_MAX, richCheck, richEmpty, richHtml, richPlain, richProblem, richTree, validHref, validWebLink, type DomLike } from "../richText";
import { isWebLink } from "../groups";
import { validateCatalog } from "../validate";
import { issueText } from "../editing";
import { catalog } from "./fixtures";

const shared = <T,>(file: string): T[] => JSON.parse(readFileSync(new URL(`../../../server/internal/richtext/testdata/${file}`, import.meta.url), "utf8")).cases;

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
  it("lets links lead only where the server lets them: the shared cases, case by case", () => {
    const cases = shared<{ link: string; web: boolean; href: boolean }>("links.json");
    expect(cases.length).toBeGreaterThan(30);
    for (const c of cases) {
      expect(validWebLink(c.link), `web ${JSON.stringify(c.link)}`).toBe(c.web);
      expect(validHref(c.link), `href ${JSON.stringify(c.link)}`).toBe(c.href);
      expect(isWebLink(c.link), `contact ${JSON.stringify(c.link)}`).toBe(c.web);
      // the schema's pattern says the same, for a front-door form
      if (c.link) {
        const c2 = { ...catalog, services: [{ id: "s", name: "S", team: catalog.teams[0].id, form: c.link }] };
        expect(validateCatalog(c2).length === 0, `schema ${JSON.stringify(c.link)}`).toBe(c.web);
      }
    }
    // lengths are characters, not UTF-16 units
    const long = `https://x.example/${"é".repeat(1982)}`;
    expect(validHref(long)).toBe(true);
    expect(validHref(`${long}é`)).toBe(false);
    expect(isWebLink(`https://x.example/${"😀".repeat(282)}`)).toBe(true); // 300 characters, 582 units
  });
});

describe("the check of rich text (the server's gate, written again)", () => {
  it("answers every shared case in the server's exact words", () => {
    const cases = shared<{ html: string; problem: string }>("html.json");
    expect(cases.length).toBeGreaterThan(60);
    for (const c of cases) expect(richProblem(c.html), JSON.stringify(c.html)).toBe(c.problem);
  });
  it("is a sentence of the lists, and the checker says it for a service (npm run validate too)", () => {
    expect(richCheck("<img src=x onerror=alert(1)>", "the service “X”")).toBe("The description of the service “X” contains a picture, which cannot be shown: remove it, or paste the text again.");
    const c = { ...catalog, services: [{ ...catalog.services![0], description: "<p>x</p><img src=x onerror=alert(1)>" }] };
    expect(validateCatalog(c).map((i) => issueText(i, "lists", c))).toEqual(["The description of the service “API key and developer portal access” contains a picture, which cannot be shown: remove it, or paste the text again."]);
  });
  it("accepts whatever the cleaner writes: controls removed, a non-breaking space an ordinary one", () => {
    const out = clean({ tag: "p", kids: ["a\u0001b\u001bc\u007fd e\u00a0f\tg & <h> \"q\""] }, { tag: "a", attrs: { href: "https://x.example/?a=1&b=2" }, kids: ["l\u0002"] }, { tag: "a", attrs: { href: "https://x.example/\u0001" }, kids: ["dropped link"] });
    expect(out).toBe("<p>abcd e f\tg &amp; &lt;h&gt; \"q\"</p><a href=\"https://x.example/?a=1&amp;b=2\">l</a>dropped link");
    expect(richProblem(out)).toBe("");
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
