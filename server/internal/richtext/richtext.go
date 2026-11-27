// Package richtext is the one gate for the rich text a service's description is stored as: a
// small HTML allow-list, read by a strict scanner that accepts only what it can read completely:
// every tag whole and quoted, every "&" an entity it knows, no control character. Anything else
// is refused in words; nothing is cleaned or dropped here, so what is stored is exactly what was
// checked. The app cleans what a person pastes or types before it sends it (`cleanRichHtml`), and
// checks with the same scanner written again (`richProblem` in src/lib/richText.ts): both read
// the shared cases in testdata/ and must answer each in the same words.
package richtext

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// MaxLength is the most characters a description may have, markup included.
const MaxLength = 20000

// Elements are the only elements a description may contain: paragraphs, two levels of
// headings (below the page's own), bold, italic, bulleted and numbered lists, links, line
// breaks, a block quote, inline code and a code block.
var Elements = []string{"p", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "br", "blockquote", "code", "pre"}

// Attributes are the only attributes, by element: a link's address and nothing else.
var Attributes = map[string][]string{"a": {"href"}}

// entities are the named character references the text may use (what the app writes, and the
// usual ones); numbers (&#169; &#xA9;) are read too.
var entities = map[string]rune{"amp": '&', "lt": '<', "gt": '>', "quot": '"', "apos": '\'', "nbsp": ' '}

// Control reports whether a character may not be in a description: the C0 controls other than
// tab, line feed and carriage return, and DEL.
func Control(r rune) bool { return (r < 0x20 && r != '\t' && r != '\n' && r != '\r') || r == 0x7f }

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

func letter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
func digit(c byte) bool  { return c >= '0' && c <= '9' }
func space(c byte) bool  { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

// Problems in words, the same in the app (richProblem).
const (
	notText    = "characters that are not text"
	control    = "an invisible control character"
	unfinished = "a tag that is not finished"
	unreadable = "a tag the portal cannot read"
	ampersand  = "an “&” that is not written as &amp;"
	lessThan   = "a “<” that does not start a tag (write it as &lt;)"
	comment    = "a hidden comment"
	doctype    = "a document type"
	unquoted   = "an attribute without quotes"
	endAttr    = "a closing tag with attributes"
)

// Problem says, in a few plain words, the first thing in the text that may not be stored ("a
// script", "the attribute “onclick”", "a link to “javascript:alert(1)”"), or "" when the
// text is fine. Its length is checked by Check.
func Problem(in string) string {
	if !utf8.ValidString(in) {
		return notText
	}
	for _, r := range in {
		if Control(r) {
			return control
		}
	}
	for i := 0; i < len(in); {
		switch in[i] {
		case '&':
			n, ok := entity(in[i:])
			if !ok {
				return ampersand
			}
			i += n
		case '<':
			n, p := tag(in[i:])
			if p != "" {
				return p
			}
			i += n
		default:
			i++
		}
	}
	return ""
}

// entity reads a character reference at the start of s: its length, and whether it is one the
// text may hold (a name of the list, or the number of a character that is no control).
func entity(s string) (int, bool) {
	end := strings.IndexByte(s, ';')
	if end < 2 || end > 10 {
		return 0, false
	}
	body := s[1:end]
	if body[0] != '#' {
		_, ok := entities[body]
		return end + 1, ok
	}
	r, ok := number(body[1:])
	return end + 1, ok && r > 0 && r <= utf8.MaxRune && !(r >= 0xd800 && r <= 0xdfff) && !Control(r)
}

func number(s string) (rune, bool) {
	base := 10
	if s != "" && (s[0] == 'x' || s[0] == 'X') {
		base, s = 16, s[1:]
	}
	if s == "" || len(s) > 7 {
		return 0, false
	}
	var r rune
	for i := 0; i < len(s); i++ {
		c := s[i]
		var d rune
		switch {
		case digit(c):
			d = rune(c - '0')
		case base == 16 && c >= 'a' && c <= 'f':
			d = rune(c-'a') + 10
		case base == 16 && c >= 'A' && c <= 'F':
			d = rune(c-'A') + 10
		default:
			return 0, false
		}
		r = r*rune(base) + d
	}
	return r, true
}

// tag reads the tag at the start of s ("<…>"): its length, or the problem with it.
func tag(s string) (int, string) {
	if len(s) < 2 {
		return 0, lessThan
	}
	switch {
	case s[1] == '!':
		if len(s) >= 9 && strings.EqualFold(s[2:9], "doctype") {
			return 0, doctype
		}
		return 0, comment
	case s[1] == '?':
		return 0, unreadable
	case s[1] == '/':
		i, name := tagName(s, 2)
		if name == "" {
			if i >= len(s) {
				return 0, unfinished
			}
			return 0, unreadable
		}
		if !allowed(name) {
			return 0, elementWords(name)
		}
		for i < len(s) && space(s[i]) {
			i++
		}
		switch {
		case i >= len(s):
			return 0, unfinished
		case s[i] == '>':
			return i + 1, ""
		default:
			return 0, endAttr
		}
	case !letter(s[1]):
		return 0, lessThan
	}
	i, name := tagName(s, 1)
	if i >= len(s) {
		return 0, unfinished
	}
	if !allowed(name) {
		return 0, elementWords(name)
	}
	seen := map[string]bool{}
	for {
		spaced := false
		for i < len(s) && space(s[i]) {
			i, spaced = i+1, true
		}
		switch {
		case i >= len(s):
			return 0, unfinished
		case s[i] == '>':
			return i + 1, ""
		case s[i] == '/':
			if i+1 >= len(s) {
				return 0, unfinished
			}
			if s[i+1] != '>' || name != "br" {
				return 0, unreadable
			}
			return i + 2, ""
		case !spaced:
			return 0, unreadable
		}
		// an attribute: name="value"
		start := i
		for i < len(s) && !space(s[i]) && s[i] != '=' && s[i] != '>' && s[i] != '/' && s[i] != '"' && s[i] != '\'' && s[i] != '<' {
			i++
		}
		attr := strings.ToLower(s[start:i])
		if attr == "" {
			if i >= len(s) {
				return 0, unfinished
			}
			return 0, unreadable
		}
		if !allowedAttr(name, attr) {
			return 0, fmt.Sprintf("the attribute “%s”", shorten(attr))
		}
		if seen[attr] {
			return 0, fmt.Sprintf("the attribute “%s” twice", attr)
		}
		seen[attr] = true
		if i >= len(s) {
			return 0, unfinished
		}
		if s[i] != '=' {
			return 0, unquoted
		}
		i++
		if i >= len(s) {
			return 0, unfinished
		}
		if s[i] != '"' {
			return 0, unquoted
		}
		end := strings.IndexByte(s[i+1:], '"')
		if end < 0 {
			return 0, unfinished
		}
		value := s[i+1 : i+1+end]
		i += end + 2
		if attr == "href" {
			// "&" only as &amp;: the address checked is the address followed
			if strings.Contains(strings.ReplaceAll(value, "&amp;", ""), "&") || !ValidHref(strings.ReplaceAll(value, "&amp;", "&")) {
				return 0, fmt.Sprintf("a link to “%s”", shorten(value))
			}
		}
	}
}

// tagName reads a tag's name from s[i]: letters and digits, starting with a letter; lower case.
func tagName(s string, i int) (int, string) {
	start := i
	if i >= len(s) || !letter(s[i]) {
		return i, ""
	}
	for i < len(s) && (letter(s[i]) || digit(s[i])) {
		i++
	}
	return i, strings.ToLower(s[start:i])
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
