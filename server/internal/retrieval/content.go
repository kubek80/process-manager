package retrieval

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// content is what a person reads as the text of each part of a document, without the
// metadata (who does a step, the tool, the level, tags, …) that the embedded text also carries.
type content struct {
	summary, scope string
	steps          map[string]string // step id -> description, else instructions, else outcome
	requirements   map[string]string // requirement id -> statement
	prerequisites  []string          // description only (empty when it has none)
}

func readContent(kind string, body []byte) content {
	var d struct {
		Summary       string `json:"summary"`
		Scope         string `json:"scope"`
		Prerequisites []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"prerequisites"`
		Steps []struct {
			ID           string   `json:"id"`
			Description  string   `json:"description"`
			Instructions []string `json:"instructions"`
			Outcome      string   `json:"outcome"`
		} `json:"steps"`
		Requirements []struct {
			ID        string `json:"id"`
			Statement string `json:"statement"`
		} `json:"requirements"`
	}
	_ = json.Unmarshal(body, &d)
	c := content{summary: d.Summary, steps: map[string]string{}, requirements: map[string]string{}}
	if kind == docs.Standard {
		c.scope = d.Scope
		for _, r := range d.Requirements {
			c.requirements[r.ID] = r.Statement
		}
		return c
	}
	for _, p := range d.Prerequisites {
		c.prerequisites = append(c.prerequisites, p.Description)
	}
	for _, s := range d.Steps {
		text := s.Description
		if strings.TrimSpace(text) == "" {
			text = strings.Join(s.Instructions, " ")
		}
		if strings.TrimSpace(text) == "" {
			text = s.Outcome
		}
		c.steps[s.ID] = text
	}
	return c
}

// of returns the readable text of one part, "" when it has none.
func (c content) of(part, item string) string {
	var s string
	switch part {
	case "summary":
		s = c.summary
	case "scope":
		s = c.scope
	case "step":
		s = c.steps[item]
	case "requirement":
		s = c.requirements[item]
	case "prerequisite":
		if i, err := strconv.Atoi(item); err == nil && i >= 0 && i < len(c.prerequisites) {
			s = c.prerequisites[i]
		}
	}
	return strings.Join(strings.Fields(s), " ")
}

// SnippetLength is about the longest snippet, in characters.
const SnippetLength = 200

// Snippet is what a person reads under a search result for one part: of its readable text, the
// sentence that shares the most words with the question (the first one on a tie), cut at a word
// near SnippetLength characters. "" when the part has no readable text.
func Snippet(text, query string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	sentences := splitSentences(text)
	best := sentences[0]
	if len(sentences) > 1 {
		asked := words(query)
		top := 0
		for _, s := range sentences {
			n := 0
			for w := range words(s) {
				if asked[w] {
					n++
				}
			}
			if n > top {
				top, best = n, s
			}
		}
	}
	return cut(best)
}

// splitSentences cuts after ".", "!" or "?" followed by a space.
func splitSentences(text string) []string {
	var out []string
	start := 0
	for i := 0; i < len(text)-1; i++ {
		if (text[i] == '.' || text[i] == '!' || text[i] == '?') && text[i+1] == ' ' {
			out = append(out, strings.TrimSpace(text[start:i+1]))
			start = i + 1
		}
	}
	if rest := strings.TrimSpace(text[start:]); rest != "" {
		out = append(out, rest)
	}
	return out
}

// words are the lower-case words of a text with three letters or more.
func words(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len([]rune(w)) >= 3 {
			out[w] = true
		}
	}
	return out
}

func cut(s string) string {
	r := []rune(s)
	if len(r) <= SnippetLength {
		return s
	}
	c := string(r[:SnippetLength])
	if i := strings.LastIndex(c, " "); i > SnippetLength/2 {
		c = c[:i]
	}
	return strings.TrimRight(c, " ,;:.-–—") + "…"
}
