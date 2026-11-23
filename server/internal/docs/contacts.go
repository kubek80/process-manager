package docs

import (
	"fmt"
	"regexp"
	"strings"
)

// How to reach a team, platform or practice: checked here as the schema checks it, so that a
// link is never anything but http:// or https://, and written out in one compact, repeatable form
// for skills, the search index and agents.

var (
	linkPattern  = regexp.MustCompile(`^https?://\S+$`)
	emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

// ValidLink reports whether s is a link people may follow: http:// or https:// and no spaces.
func ValidLink(s string) bool { return linkPattern.MatchString(s) }

// ValidEmail reports whether s looks like an email address.
func ValidEmail(s string) bool { return emailPattern.MatchString(s) }

// Problems lists what is wrong with the contact details, each a plain sentence in the app's words
// for the same problem (issueText for the lists, src/lib/editing.ts). what names the entry, e.g.
// `the platform “Google Cloud”` (EntryWords).
func (c *Contacts) Problems(what string) []string {
	if c == nil {
		return nil
	}
	var out []string
	switch {
	case c.Email == "":
	case len(c.Email) > 120:
		out = append(out, fmt.Sprintf("Shorten the group email of %s to at most 120 characters.", what))
	case !ValidEmail(c.Email):
		out = append(out, fmt.Sprintf("The group email of %s is not an email address: write one, like team@company.com.", what))
	}
	links := []struct{ label, value string }{
		{"link to the Slack channel", c.SlackURL}, {"link to the Chat space", c.ChatURL}, {"Confluence page", c.Confluence},
		{"page link", c.Page}, {"request form", c.Form},
	}
	for _, l := range links {
		switch {
		case l.value == "":
		case len(l.value) > 300:
			out = append(out, fmt.Sprintf("Shorten the %s of %s to at most 300 characters.", l.label, what))
		case !ValidLink(l.value):
			spaces := ""
			if strings.ContainsAny(strings.TrimSpace(l.value), " \t\n") {
				spaces = " and have no spaces"
			}
			out = append(out, fmt.Sprintf("The %s of %s must start with https://%s.", l.label, what, spaces))
		}
	}
	return out
}

// Parts are the ways to reach them in a fixed order, each "<label>: <value>".
func (c *Contacts) Parts() []string {
	if c.Empty() {
		return nil
	}
	var out []string
	named := func(label, name, link string) {
		switch {
		case name != "" && link != "":
			out = append(out, fmt.Sprintf("%s: %s (%s)", label, name, link))
		case name != "":
			out = append(out, label+": "+name)
		case link != "":
			out = append(out, label+": "+link)
		}
	}
	if c.Email != "" {
		out = append(out, "Group email: "+c.Email)
	}
	named("Slack", c.Slack, c.SlackURL)
	named("Google Chat", c.Chat, c.ChatURL)
	if c.Confluence != "" {
		out = append(out, "Confluence: "+c.Confluence)
	}
	if c.Page != "" {
		out = append(out, "Their page: "+c.Page)
	}
	if c.Form != "" {
		out = append(out, "Request form: "+c.Form)
	}
	return out
}

// Reach is everything known about how to reach an entry of the lists, in one line: the contact
// details in a fixed order, then the free line. "" when nothing is given.
func (n Named) Reach() string {
	parts := n.Contacts.Parts()
	if c := strings.TrimSpace(n.Contact); c != "" {
		if len(parts) > 0 {
			c = "Other: " + c
		}
		parts = append(parts, c)
	}
	return strings.Join(parts, "; ")
}
