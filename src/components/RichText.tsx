import { createElement, type ReactNode } from "react";
import { parseRich, type RichNode } from "../lib/richText";

/**
 * Shows stored rich text (a service's description). It never trusts what is stored: the text is
 * parsed into an inert document (nothing in it runs or loads) and rebuilt as React elements from
 * the allow-list alone (`richTree`), so nothing else ever reaches the page; links open in a new
 * tab without telling the other page where they came from. The one place rich text is shown.
 */
export function RichText({ html, className }: { html: string | undefined; className?: string }) {
  const nodes = parseRich(html);
  if (!nodes.length) return null;
  return <div className={`rich-text ${className ?? ""}`.trim()}>{render(nodes)}</div>;
}

function render(nodes: RichNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (typeof n === "string") return n;
    if (n.tag === "br") return <br key={i} />;
    if (n.tag === "a") return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{render(n.children)}</a>;
    return createElement(n.tag, { key: i }, ...render(n.children));
  });
}
