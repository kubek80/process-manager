// Package richtext is the one gate for the rich text a service's description is stored as: a
// small HTML allow-list, checked token by token, the way a browser reads it. Nothing outside the
// list is stored: a save or an import with anything else is refused in words (the app cleans what
// a person pastes before it sends it, so nothing is changed silently after Save). The app shows
// stored text through one component that rebuilds it from the same list (src/lib/richText.ts,
// `RICH_ELEMENTS`; a unit test there reads this file and fails when the two lists differ).
package richtext

import (
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
)

// MaxLength is the most characters a description may have, markup included.
const MaxLength = 20000

// Elements are the only elements a description may contain: paragraphs, two levels of
// headings (below the page's own), bold, italic, bulleted and numbered lists, links, line
// breaks, a block quote, inline code and a code block.
var Elements = []string{"p", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "br", "blockquote", "code", "pre"}

// Attributes are the only attributes, by element: a link's address and nothing else.
var Attributes = map[string][]string{"a": {"href"}}

var (
	webLink   = regexp.MustCompile(`^https?://\S+$`) // as docs.ValidLink: http:// or https://, no spaces
	emailLink = regexp.MustCompile(`^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

// ValidHref reports whether a link may lead there: a web page (http:// or https://) or an email
// address (mailto:), nothing else; written exactly so, without spaces or other schemes.
func ValidHref(s string) bool {
	return len(s) <= 2000 && (webLink.MatchString(s) || emailLink.MatchString(s))
}

func allowed(name string) bool {
	for _, e := range Elements {
		if e == name {
			return true
		}
	}
	return false
}

func allowedAttr(el, attr string) bool {
	for _, a := range Attributes[el] {
		if a == attr {
			return true
		}
	}
	return false
}

// Problem says, in a few plain words, the first thing in the text that may not be stored ("a
// script", "the attribute “onclick”", "a link to “javascript:alert(1)”"), or "" when the
// text is fine. Its length is checked by Check.
func Problem(in string) string {
	if strings.ContainsRune(in, 0) {
		return "an invisible control character"
	}
	if !utf8.ValidString(in) {
		return "characters that are not text"
	}
	z := html.NewTokenizer(strings.NewReader(in))
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			if z.Err() == io.EOF {
				return ""
			}
			return "something that is not text or formatting"
		case html.TextToken:
			continue
		case html.CommentToken:
			return "a hidden comment"
		case html.DoctypeToken:
			return "a document type"
		case html.StartTagToken, html.EndTagToken, html.SelfClosingTagToken:
			name, more := z.TagName()
			el := string(name)
			if !allowed(el) {
				return elementWords(el)
			}
			seen := map[string]bool{}
			for more {
				var key, val []byte
				key, val, more = z.TagAttr()
				attr := string(key)
				if !allowedAttr(el, attr) {
					return fmt.Sprintf("the attribute “%s”", attr)
				}
				if seen[attr] {
					return fmt.Sprintf("the attribute “%s” twice", attr)
				}
				seen[attr] = true
				if attr == "href" && !ValidHref(string(val)) {
					return fmt.Sprintf("a link to “%s”", shorten(string(val)))
				}
			}
		}
	}
}

// elementWords names an element that may not be stored, for a person.
func elementWords(el string) string {
	switch el {
	case "script", "noscript":
		return "a script"
	case "style":
		return "a style sheet"
	case "img", "picture", "svg", "image":
		return "a picture"
	case "iframe", "frame", "frameset", "object", "embed", "applet":
		return "an embedded page"
	case "form", "input", "button", "select", "textarea", "option":
		return "a form"
	case "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col":
		return "a table"
	case "video", "audio", "source", "track":
		return "a video or a sound"
	}
	return fmt.Sprintf("the element “%s”", shorten(el))
}

func shorten(s string) string {
	if utf8.RuneCountInString(s) <= 40 {
		return s
	}
	return string([]rune(s)[:40]) + "…"
}

// Check is the rule for one stored description, as a sentence in the lists' family (issueText
// in src/lib/editing.ts): what names the entry (`the service “DNS record change”`).
func Check(in, what string) string {
	if n := utf8.RuneCountInString(in); n > MaxLength {
		return fmt.Sprintf("Shorten the description of %s to at most %d characters (with its formatting): it has %d.", what, MaxLength, n)
	}
	if p := Problem(in); p != "" {
		return fmt.Sprintf("The description of %s contains %s, which cannot be shown: remove it, or paste the text again.", what, p)
	}
	return ""
}

// block elements end a line in the plain text
var block = map[string]bool{"p": true, "h3": true, "h4": true, "li": true, "br": true, "blockquote": true, "pre": true, "ul": true, "ol": true}

// PlainText is the text of a description without its formatting, for the search, skills and
// agents: one line per paragraph, heading or item, links as their words; entities decoded.
func PlainText(in string) string {
	z := html.NewTokenizer(strings.NewReader(in))
	var b strings.Builder
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			lines := strings.Split(b.String(), "\n")
			out := lines[:0]
			for _, l := range lines {
				if l = strings.Join(strings.Fields(l), " "); l != "" {
					out = append(out, l)
				}
			}
			return strings.Join(out, "\n")
		case html.TextToken:
			b.Write(z.Text())
		case html.StartTagToken, html.EndTagToken, html.SelfClosingTagToken:
			name, _ := z.TagName()
			if block[string(name)] {
				b.WriteByte('\n')
			}
			if tt == html.StartTagToken && (string(name) == "script" || string(name) == "style") {
				z.Next() // their text is no text of the description
			}
		}
	}
}
