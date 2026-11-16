package docs

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// WithReview returns the document with its review recorded: who confirmed on which day that it
// is still correct. The rhythm stays as it is; a document that had none gets defaultMonths.
// Nothing else changes - not even the order of the fields, which is the order the author wrote.
func WithReview(body []byte, date, by string, defaultMonths int) ([]byte, error) {
	type pair struct {
		key   string
		value json.RawMessage
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, fmt.Errorf("%w: not a JSON object", ErrInvalid)
	}
	var pairs []pair
	for dec.More() {
		tok, err := dec.Token()
		key, ok := tok.(string)
		if err != nil || !ok {
			return nil, fmt.Errorf("%w: not a JSON object", ErrInvalid)
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, fmt.Errorf("%w: not valid JSON: %v", ErrInvalid, err)
		}
		pairs = append(pairs, pair{key, value})
	}

	months := defaultMonths
	at := -1
	for i, p := range pairs {
		if p.key != "review" {
			continue
		}
		at = i
		var old struct {
			IntervalMonths int `json:"intervalMonths"`
		}
		if json.Unmarshal(p.value, &old) == nil && old.IntervalMonths > 0 {
			months = old.IntervalMonths
		}
	}
	// the three fields in the order the app writes them
	var value bytes.Buffer
	value.WriteString(fmt.Sprintf(`{"intervalMonths": %d, "lastReviewedAt": %s`, months, quote(date)))
	if by != "" {
		value.WriteString(`, "reviewedBy": ` + quote(by))
	}
	value.WriteString("}")
	if at >= 0 {
		pairs[at].value = value.Bytes()
	} else {
		// next to the status when there is one, otherwise at the end
		insert := len(pairs)
		for i, p := range pairs {
			if p.key == "status" {
				insert = i + 1
			}
		}
		pairs = append(pairs[:insert], append([]pair{{"review", value.Bytes()}}, pairs[insert:]...)...)
	}

	var out bytes.Buffer
	out.WriteString("{")
	for i, p := range pairs {
		if i > 0 {
			out.WriteString(",")
		}
		out.WriteString(quote(p.key) + ":")
		out.Write(p.value)
	}
	out.WriteString("}")
	return Pretty(out.Bytes())
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
