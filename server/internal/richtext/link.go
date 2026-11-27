package richtext

import (
	"strings"
	"unicode/utf8"
)

// One rule for every link people follow, the same in the app (validWebLink, validHref in
// src/lib/richText.ts) and in the schema's patterns: http:// or https:// and then at least one
// character, none of them white space of any kind (also the Unicode ones), a control character,
// a quote, "<", ">" or a backslash. Lengths are counted in characters, as the app counts them.

// linkChar reports whether a link may hold the character.
func linkChar(r rune) bool {
	switch {
	case r <= 0x20, r >= 0x7f && r <= 0xa0, r == 0x1680, r >= 0x2000 && r <= 0x200a,
		r == 0x2028, r == 0x2029, r == 0x202f, r == 0x205f, r == 0x3000, r == 0xfeff:
		return false
	case r == '"', r == '<', r == '>', r == '\\':
		return false
	}
	return true
}

func linkChars(s string) bool {
	if s == "" || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if !linkChar(r) {
			return false
		}
	}
	return true
}

// WebLink reports whether s is a web link by the rule above (its length is the caller's).
func WebLink(s string) bool {
	rest, ok := strings.CutPrefix(s, "https://")
	if !ok {
		rest, ok = strings.CutPrefix(s, "http://")
	}
	return ok && linkChars(rest)
}

// mailLink: mailto: and an address, name@domain.part, by the same characters.
func mailLink(s string) bool {
	rest, ok := strings.CutPrefix(s, "mailto:")
	if !ok || !linkChars(rest) || strings.Count(rest, "@") != 1 {
		return false
	}
	name, domain, _ := strings.Cut(rest, "@")
	dot := strings.LastIndexByte(domain, '.')
	return name != "" && strings.IndexByte(domain, '.') > 0 && dot < len(domain)-1
}

// ValidHref reports whether a link in rich text may lead there: a web page or an email address
// (mailto:), at most 2000 characters.
func ValidHref(s string) bool {
	return utf8.RuneCountInString(s) <= 2000 && (WebLink(s) || mailLink(s))
}
