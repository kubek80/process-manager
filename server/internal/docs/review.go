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
	pairs, err := fieldsOf(body)
	if err != nil {
		return nil, err
	}
	months := defaultMonths
	if old := pairs.get("review"); old != nil {
		var r struct {
			IntervalMonths float64 `json:"intervalMonths"` // the format also accepts 24.0 or 2.4e1 for 24
		}
		if json.Unmarshal(old, &r) == nil && r.IntervalMonths >= 1 {
			months = int(r.IntervalMonths)
		}
	}
	// the three fields in the order the app writes them
	var value bytes.Buffer
	value.WriteString(fmt.Sprintf(`{"intervalMonths": %d, "lastReviewedAt": %s`, months, quote(date)))
	if by != "" {
		value.WriteString(`, "reviewedBy": ` + quote(by))
	}
	value.WriteString("}")
	// next to the status when there is one, otherwise at the end
	return pairs.set("review", value.Bytes(), "", "status").join()
}

// fields are the top-level fields of a JSON object in the order they were written.
type fields []field

type field struct {
	key   string
	value json.RawMessage
}

func fieldsOf(body []byte) (fields, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, fmt.Errorf("%w: not a JSON object", ErrInvalid)
	}
	var out fields
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
		out = append(out, field{key, value})
	}
	return out, nil
}

// get returns the value of the last field of that name, nil when there is none.
func (f fields) get(key string) json.RawMessage {
	var v json.RawMessage
	for _, p := range f {
		if p.key == key {
			v = p.value
		}
	}
	return v
}

// set replaces the value of a field (every field of that name), or removes it when value is nil.
// A new field goes before the field named before, else after the last field named after, else
// at the end.
func (f fields) set(key string, value json.RawMessage, before, after string) fields {
	out := make(fields, 0, len(f)+1)
	found := false
	for _, p := range f {
		if p.key != key {
			out = append(out, p)
			continue
		}
		found = true
		if value != nil {
			out = append(out, field{key, value})
		}
	}
	if found || value == nil {
		return out
	}
	insert := len(out)
	at := -1
	for i, p := range out {
		if before != "" && p.key == before && at < 0 {
			at = i
		}
		if after != "" && p.key == after {
			insert = i + 1
		}
	}
	if at >= 0 {
		insert = at
	}
	return append(out[:insert], append(fields{{key, value}}, out[insert:]...)...)
}

func (f fields) join() ([]byte, error) {
	var out bytes.Buffer
	out.WriteString("{")
	for i, p := range f {
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
