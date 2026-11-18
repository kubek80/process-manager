package docs

import "testing"

func TestCheckText(t *testing.T) {
	for _, c := range []struct {
		in         string
		lineBreaks bool
		out, want  string
	}{
		{"  Hello  ", false, "Hello", ""},
		{"", false, "", ""},
		{"   ", false, "", ""},
		{"two\nlines", true, "two\nlines", ""},
		{"two\r\nlines", true, "two\r\nlines", ""},
		{"two\nlines", false, "", "The title contains control characters. Remove them and try again."},
		{"tab\there", true, "", "The title contains control characters. Remove them and try again."},
		{"bell\x07", true, "", "The title contains control characters. Remove them and try again."},
		{"nul\x00", true, "", "The title contains characters that cannot be stored."},
		{"abc\u202Edef", false, "", "The title contains characters that change the reading direction. Remove them and try again."},
		{"abc\u2067def\u2069", false, "", "The title contains characters that change the reading direction. Remove them and try again."},
		{"\u200B\u200C\u200D\u2060\uFEFF", false, "", "The title has no visible characters."},
		{"\u3164\u3164", false, "", "The title has no visible characters."},
		{"\u200Bé\u200B", false, "\u200Bé\u200B", ""},
		{"日本語", false, "日本語", ""},
		{"a\u200Fb", false, "a\u200Fb", ""}, // a right-to-left mark only marks, it overrides nothing
	} {
		out, problem := CheckText(c.in, "The title", c.lineBreaks)
		if problem != c.want || (c.want == "" && out != c.out) {
			t.Errorf("%q: %q %q, want %q %q", c.in, out, problem, c.out, c.want)
		}
	}
}
