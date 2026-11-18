package docs

import (
	"strings"
	"unicode"
)

// CheckText prepares a text people type (a request, feedback, a note) for storing. It trims
// surrounding white space and says, in plain words starting with what (e.g. "The title"), why
// the text cannot be stored: characters that cannot be stored at all, control characters (line
// breaks are allowed where lineBreaks is true), characters that change the reading direction
// (which can make a text read differently from what is stored), or no visible character at all.
// An empty text is returned as it is: the caller says what is missing.
func CheckText(text, what string, lineBreaks bool) (string, string) {
	if !Storable(text) {
		return text, what + " contains characters that cannot be stored."
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", ""
	}
	visible := false
	for _, r := range text {
		switch {
		case lineBreaks && (r == '\n' || r == '\r'):
		case unicode.IsControl(r):
			return text, what + " contains control characters. Remove them and try again."
		case directional(r):
			return text, what + " contains characters that change the reading direction. Remove them and try again."
		case !visible && seen(r):
			visible = true
		}
	}
	if !visible {
		return text, what + " has no visible characters."
	}
	return text, ""
}

// directional: the embedding, override and isolate characters of bidirectional text.
func directional(r rune) bool {
	return (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069)
}

// seen: a character that shows something - not a space, not an invisible format character
// (zero-width space, joiners, word joiner, byte order mark) and not one of the blank fillers.
func seen(r rune) bool {
	switch r {
	case 0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800, 0x180E:
		return false
	}
	return unicode.IsGraphic(r) && !unicode.IsSpace(r) && !unicode.Is(unicode.Cf, r) && !unicode.Is(unicode.Mn, r)
}
