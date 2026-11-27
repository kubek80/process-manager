package richtext

import (
	"strings"

	"golang.org/x/net/html"
)

// block elements end a line in the plain text
var block = map[string]bool{"p": true, "h3": true, "h4": true, "li": true, "br": true, "blockquote": true, "pre": true, "ul": true, "ol": true}

// PlainText is the text of a description without its formatting, for the search, skills and
// agents: one line per paragraph, heading or item, links as their words; entities decoded; no
// control character, whatever is stored.
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
			b.WriteString(strings.Map(func(r rune) rune {
				if Control(r) {
					return -1
				}
				return r
			}, string(z.Text())))
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
