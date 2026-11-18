package embedding

import (
	"context"
	"hash/fnv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// The builtin embedder is a "hashing" embedder. It does not understand language: it puts each
// word, and each run of three characters inside a word, into one of the vector's positions
// (chosen by a hash, with a sign from the hash) and adds them up. Two texts end up close when
// they share words or parts of words: "projects" finds "project", "approve" finds "approval",
// "GCP project" finds "Google Cloud project" through "project". It does NOT know that
// "GCP" and "Google Cloud", or "leaked" and "exposed", mean the same thing; that needs a real
// model (vertex).
//
// Text is lower-cased, accents are removed ("café" = "cafe") and it is split on anything that
// is not a letter or digit. Longer words and words with digits count a little more than short
// ones (a stand-in for "rarer", without any stored word list), so "a", "to", "of" hardly
// matter. Only integer hashing, + * / and square roots are used (with conversions that stop
// the compiler from fusing a multiply and an add on some processors), so the vectors are
// identical on every machine and Go version, as long as the Unicode tables used to remove
// accents do not change. The purpose (document or query) makes no difference.
type builtin struct{ dims int }

// Builtin returns the builtin embedder with vectors of the given size.
func Builtin(dims int) Embedder { return builtin{dims: dims} }

func (b builtin) Name() string    { return "builtin" }
func (b builtin) Dimensions() int { return b.dims }
func (b builtin) Outside() bool   { return false }

func (b builtin) Embed(ctx context.Context, texts []string, _ Purpose) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		out[i] = b.vector(t)
	}
	return out, nil
}

func (b builtin) vector(text string) []float32 {
	v := make([]float64, b.dims)
	words := Tokens(text)
	if len(words) == 0 {
		// Nothing to match on: a fixed vector, so the result still has length 1.
		b.add(v, "empty:", 1)
		return normalise(v)
	}
	for _, w := range words {
		weight := rarity(w)
		b.add(v, "w:"+w, weight)
		r := []rune("<" + w + ">")
		if len(r) < 5 { // words of one or two letters: the word alone is enough
			continue
		}
		grams := len(r) - 2
		// The parts of a word together count a little less than the word itself, and each
		// part counts less the more parts there are.
		each := 0.8 * weight / float64(grams)
		for i := 0; i < grams; i++ {
			b.add(v, "g:"+string(r[i:i+3]), each*2)
		}
	}
	return normalise(v)
}

// add puts a feature into the position its hash chooses, with the sign the hash chooses.
func (b builtin) add(v []float64, feature string, weight float64) {
	h := fnv.New64a()
	h.Write([]byte(feature))
	x := h.Sum64()
	i := int(x % uint64(b.dims))
	if x>>63 == 1 {
		weight = -weight
	}
	v[i] += weight
}

// rarity: longer words and words with digits are usually rarer, so they count more. From 0.6
// for one letter to 2.0 for eight letters or more, plus 0.5 with a digit.
func rarity(w string) float64 {
	n := 0
	digit := false
	for _, r := range w {
		n++
		if unicode.IsDigit(r) {
			digit = true
		}
	}
	x := 0.4 + float64(0.2*float64(n)) // no fused multiply-add: same bits everywhere
	if x > 2 {
		x = 2
	}
	if digit {
		x += 0.5
	}
	return x
}

// Tokens returns the words of a text: lower case, without accents, split on anything that is
// not a letter or a digit.
func Tokens(text string) []string {
	var sb strings.Builder
	for _, r := range norm.NFKD.String(text) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		sb.WriteRune(unicode.ToLower(r))
	}
	return strings.FieldsFunc(sb.String(), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}
