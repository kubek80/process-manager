package richtext_test

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/richtext"
)

// What the editor writes, and what a person may format, passes.
func TestAllowedFormattingPasses(t *testing.T) {
	for _, ok := range []string{
		"",
		"Plain words, no formatting.",
		"<p>What you get: a <strong>new record</strong> within <em>one day</em>.</p>",
		"<h3>What to prepare</h3><h4>Names</h4><ul><li><p>the name</p></li><li>the target</li></ul><ol><li>first</li></ol>",
		`<p>See <a href="https://wiki.example.com/dns">the wiki</a> or write to <a href="mailto:dns@example.com">the team</a>.</p>`,
		"<blockquote><p>Quoted</p></blockquote><p>Line<br>break<br/>again</p><p><code>dig example.com</code></p><pre><code>a &lt; b &amp;&amp; c</code></pre>",
		"<p>5 &lt; 6 and &quot;quotes&quot; &#169; &nbsp;</p>",
		"<p>a < b, a stray less-than</p>",
	} {
		if p := richtext.Problem(ok); p != "" {
			t.Errorf("%q refused: %s", ok, p)
		}
	}
}

// A hostile set: everything that could run, load, hide or restyle something is refused, named in words.
func TestHostileContentIsRefused(t *testing.T) {
	for in, want := range map[string]string{
		"<script>alert(1)</script>":                                                  "a script",
		"<SCRIPT SRC=//x.example/a.js></SCRIPT>":                                     "a script",
		"<scr<script>ipt>alert(1)</script>":                                          "the element",
		"<p onclick=\"alert(1)\">x</p>":                                              "the attribute “onclick”",
		"<p ONMOUSEOVER=alert(1)>x</p>":                                              "the attribute “onmouseover”",
		"<a href=\"javascript:alert(1)\">x</a>":                                      "a link to “javascript:alert(1)”",
		"<a href=\" javascript:alert(1)\">x</a>":                                     "a link to",
		"<a href=\"JAVASCRIPT:alert(1)\">x</a>":                                      "a link to",
		"<a href=\"java&#x09;script:alert(1)\">x</a>":                                "a link to",
		"<a href=\"&#106;avascript:alert(1)\">x</a>":                                 "a link to “javascript:alert(1)”",
		"<a href=\"data:text/html;base64,PHNjcmlwdD4=\">x</a>":                       "a link to “data:",
		"<a href=\"https://ok.example\" target=\"_blank\">x</a>":                     "the attribute “target”",
		"<a href=\"https://a.example\" href=\"https://b.example\">x</a>":             "twice",
		"<a href=\"//evil.example\">x</a>":                                           "a link to",
		"<a href=\"https://ok.example/a b\">x</a>":                                   "a link to",
		"<p style=\"color:red\">x</p>":                                               "the attribute “style”",
		"<p class=\"x\">x</p>":                                                       "the attribute “class”",
		"<p id=\"x\">x</p>":                                                          "the attribute “id”",
		"<p data-x=\"1\">x</p>":                                                      "the attribute “data-x”",
		"<style>p{color:red}</style>":                                                "a style sheet",
		"<p>open <strong>nested <em>unclosed":                                        "",
		"<!-- a comment -->":                                                         "a hidden comment",
		"<!--><script>alert(1)</script>-->":                                          "a hidden comment",
		"<!DOCTYPE html>":                                                            "a document type",
		"<svg><script>alert(1)</script></svg>":                                       "a picture",
		"<svg onload=alert(1)>":                                                      "a picture",
		"<math><mtext><img src=x onerror=alert(1)>":                                  "the element “math”",
		"<iframe src=\"https://x.example\"></iframe>":                                "an embedded page",
		"<object data=x></object>":                                                   "an embedded page",
		"<embed src=x>":                                                              "an embedded page",
		"<base href=\"https://evil.example/\">":                                      "the element “base”",
		"<meta http-equiv=\"refresh\" content=\"0;url=x\">":                          "the element “meta”",
		"<link rel=\"stylesheet\" href=\"x.css\">":                                   "the element “link”",
		"<form action=\"https://x.example\"><input></form>":                          "a form",
		"<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\"></noscript>": "a script",
		"<template><script>alert(1)</script></template>":                             "the element “template”",
		"<p><title><img src=x onerror=alert(1)></title></p>":                         "the element “title”",
		"<img src=x onerror=alert(1)>":                                               "a picture",
		"<table><tr><td>x</td></tr></table>":                                         "a table",
		"<span>x</span>":                                                             "the element “span”",
		"<div>x</div>":                                                               "the element “div”",
		"<h1>x</h1>":                                                                 "the element “h1”",
		"<body onload=alert(1)>":                                                     "the element “body”",
		"<p>a\x00b</p>":                                                              "an invisible control character",
	} {
		got := richtext.Problem(in)
		if want == "" {
			if got != "" {
				t.Errorf("%q: unclosed allowed tags are no danger, got %q", in, got)
			}
			continue
		}
		if got == "" || !strings.Contains(got, want) {
			t.Errorf("%q: got %q, want it to say %q", in, got, want)
		}
	}
}

// The rule as a sentence of the lists, and the size.
func TestCheckSaysWhatAndWhere(t *testing.T) {
	what := "the service “DNS record change”"
	if got := richtext.Check("<script>x</script>", what); got != "The description of the service “DNS record change” contains a script, which cannot be shown: remove it, or paste the text again." {
		t.Fatalf("got %q", got)
	}
	long := "<p>" + strings.Repeat("a", richtext.MaxLength) + "</p>"
	if got := richtext.Check(long, what); !strings.HasPrefix(got, "Shorten the description of the service “DNS record change” to at most 20000 characters") {
		t.Fatalf("got %q", got)
	}
	if got := richtext.Check("<p>fine</p>", what); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestPlainText(t *testing.T) {
	in := `<h3>What you get</h3><p>A <strong>record</strong> &amp; a <a href="https://x.example">link</a>.</p><ul><li>one</li><li>two</li></ul><p>a<br>b</p>`
	if got := richtext.PlainText(in); got != "What you get\nA record & a link.\none\ntwo\na\nb" {
		t.Fatalf("got %q", got)
	}
	if got := richtext.PlainText("<script>alert(1)</script><p>ok</p>"); got != "ok" {
		t.Fatalf("got %q", got)
	}
}
