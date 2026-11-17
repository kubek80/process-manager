import { describe, expect, it } from "vitest";
import { escapeHtml, googleChatMessage, mailtoLink, oneLine, plainMessage, shareUrl, slackMessage } from "../share";

const gcp = { kind: "process" as const, id: "request-gcp-project", title: "Request a GCP project", summary: "Get a new Google Cloud project\n created by the project factory." };
const URL_ = "https://pm.example.com/#/p/request-gcp-project";

describe("the shared address", () => {
  it("points at the process or standard itself, not at the tab or step open", () => {
    expect(shareUrl("https://pm.example.com/", "process", "request-gcp-project")).toBe(URL_);
    expect(shareUrl("https://pm.example.com/#/p/request-gcp-project/feedback/raise", "process", "request-gcp-project")).toBe(URL_);
    expect(shareUrl("https://pm.example.com/app/?x=1", "standard", "iac")).toBe("https://pm.example.com/app/#/s/iac");
  });
});

describe("one line of summary", () => {
  it("folds whitespace and keeps short text as it is", () => {
    expect(oneLine("  a\n b\t c ")).toBe("a b c");
    expect(oneLine(undefined)).toBe("");
  });
  it("cuts a very long summary at a word, with an ellipsis", () => {
    const long = "word ".repeat(100);
    const s = oneLine(long, 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith("word…")).toBe(true);
    expect(oneLine("A sentence, then more words here", 20)).toBe("A sentence, then…");
  });
  it("cuts a single endless word where it must", () => {
    const s = oneLine("x".repeat(300), 40);
    expect(s).toHaveLength(40);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("messages", () => {
  it("plain text has the title, the summary and the link on its own line", () => {
    expect(plainMessage(gcp, URL_)).toBe(`Request a GCP project\nGet a new Google Cloud project created by the project factory.\n${URL_}`);
    expect(plainMessage({ ...gcp, summary: "" }, URL_)).toBe(`Request a GCP project\n${URL_}`);
  });
  it("Slack: bold title in plain text, and HTML with a real link and escaped text", () => {
    const m = slackMessage({ ...gcp, title: "Tom & Jerry <b>" }, URL_);
    expect(m.text.split("\n")[0]).toBe("*Tom & Jerry <b>*");
    expect(m.text.split("\n")[2]).toBe(URL_);
    expect(m.html).toContain("<b>Tom &amp; Jerry &lt;b&gt;</b>");
    expect(m.html).toContain(`<a href="${URL_}">${URL_}</a>`);
  });
  it("Google Chat: bold title, link as it is", () => {
    expect(googleChatMessage(gcp, URL_)).toBe(`*Request a GCP project*\nGet a new Google Cloud project created by the project factory.\n${URL_}`);
  });
  it("e-mail: subject and text encoded, spaces as %20, lines as CRLF", () => {
    const link = mailtoLink({ ...gcp, title: "Q&A: 100% sure? #1" }, URL_);
    expect(link.startsWith("mailto:?subject=Q%26A%3A%20100%25%20sure%3F%20%231&body=")).toBe(true);
    expect(link).not.toContain("+");
    const body = decodeURIComponent(link.split("&body=")[1]);
    expect(body).toContain("“Q&A: 100% sure? #1”");
    expect(body).toContain("\r\n\r\nGet a new Google Cloud project created by the project factory.\r\n\r\n");
    expect(body.endsWith(URL_)).toBe(true);
    // no summary: no empty lines piled up
    expect(decodeURIComponent(mailtoLink({ ...gcp, summary: "" }, URL_).split("&body=")[1])).not.toContain("\r\n\r\n\r\n");
  });
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
