import { describe, expect, it } from "vitest";
import { canShareNatively, copiedStatus, linkAndTitle, mailtoLink, nativeShareData, oneLine, SHARE_HINT, shareCancelled, shareUrl } from "../share";

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
  it("link and title: the title on one line, the address on the next", () => {
    expect(linkAndTitle(gcp, URL_)).toBe(`Request a GCP project\n${URL_}`);
    expect(linkAndTitle({ ...gcp, title: " Two\n lines " }, URL_)).toBe(`Two lines\n${URL_}`);
  });
  it("the device's share sheet gets the title, the summary as text, and the address", () => {
    expect(nativeShareData(gcp, URL_)).toEqual({ title: "Request a GCP project", text: "Get a new Google Cloud project created by the project factory.", url: URL_ });
    expect(nativeShareData({ ...gcp, summary: undefined }, URL_).text).toBe("Request a GCP project");
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
});

describe("the device's own share sheet", () => {
  const data = nativeShareData(gcp, URL_);
  const share = async () => {};
  it("is offered only where the browser has one", () => {
    expect(canShareNatively(undefined, data)).toBe(false);
    expect(canShareNatively({}, data)).toBe(false);
    expect(canShareNatively({ share }, data)).toBe(true);
  });
  it("asks canShare where the browser has it", () => {
    expect(canShareNatively({ share, canShare: () => true }, data)).toBe(true);
    expect(canShareNatively({ share, canShare: () => false }, data)).toBe(false);
    expect(canShareNatively({ share, canShare: () => { throw new TypeError("no"); } }, data)).toBe(false);
  });
  it("a closed share sheet is not a failure", () => {
    expect(shareCancelled(new DOMException("closed", "AbortError"))).toBe(true);
    expect(shareCancelled({ name: "AbortError" })).toBe(true);
    expect(shareCancelled(new DOMException("denied", "NotAllowedError"))).toBe(false);
    expect(shareCancelled(null)).toBe(false);
  });
});

describe("the share dialog's words", () => {
  it("each way of sharing has its own hint and its own confirmation", () => {
    expect(new Set(Object.values(SHARE_HINT)).size).toBe(Object.keys(SHARE_HINT).length);
    expect(copiedStatus("link")).toBe("The link was copied. Paste it where you want to share it.");
    expect(copiedStatus("title")).toMatch(/^The link and title were copied/);
  });
});
