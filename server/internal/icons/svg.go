package icons

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// An SVG icon may be nothing but a plain drawing. What it may contain is an allow-list: the
// elements and settings (attributes) below, in the SVG namespace. Everything else is refused,
// among it scripts, event handlers (on…), <foreignObject>, <iframe>, <embed>, <object>,
// <image>, links (<a>), animation (<animate>, <set>, …), a DOCTYPE or ENTITY declaration and
// elements or settings of other namespaces (editor metadata included). References (href,
// xlink:href and url(…) in values and styles) may only point to an id inside the same file;
// "javascript:" and "data:" are refused in every value, and styles may not import anything.

const (
	svgNS   = "http://www.w3.org/2000/svg"
	xlinkNS = "http://www.w3.org/1999/xlink"
	xmlNS   = "http://www.w3.org/XML/1998/namespace"

	maxDepth    = 64
	maxElements = 5000
)

// allowedElements are the plain drawing elements.
var allowedElements = set(
	"svg", "g", "defs", "title", "desc", "symbol", "use", "style",
	"path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
	"text", "tspan", "textPath",
	"linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
	"filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feDropShadow",
	"feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feMerge",
	"feMergeNode", "feMorphology", "feOffset",
)

// allowedAttributes are geometry, presentation and the settings of the elements above.
var allowedAttributes = set(
	"id", "class", "style", "lang", "version", "viewBox", "preserveAspectRatio", "transform",
	"x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height",
	"d", "points", "pathLength",
	"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
	"stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity",
	"color", "display", "visibility", "overflow", "isolation", "paint-order", "vector-effect",
	"shape-rendering", "text-rendering", "image-rendering", "color-interpolation", "color-interpolation-filters",
	"clip-path", "clip-rule", "mask", "filter", "marker-start", "marker-mid", "marker-end",
	"font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch",
	"text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift", "letter-spacing",
	"word-spacing", "text-decoration", "writing-mode", "direction", "dx", "dy", "rotate",
	"textLength", "lengthAdjust", "startOffset", "method", "spacing", "side",
	"gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity",
	"patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits",
	"maskContentUnits", "filterUnits", "primitiveUnits", "in", "in2", "result", "stdDeviation",
	"mode", "operator", "k1", "k2", "k3", "k4", "values", "type", "tableValues", "slope",
	"intercept", "amplitude", "exponent", "flood-color", "flood-opacity", "radius",
	"markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient", "media",
	"href", // only to an id in the file: checked below
)

func set(names ...string) map[string]bool {
	m := map[string]bool{}
	for _, n := range names {
		m[n] = true
	}
	return m
}

var (
	internalRef = regexp.MustCompile(`^#([A-Za-z_][A-Za-z0-9_.:-]*)$`)
	number      = regexp.MustCompile(`^\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*(px)?\s*$`)
	// what may not appear in any value or style, once white space and control characters are
	// taken out and letters are lowercase
	forbiddenSchemes = []string{"javascript:", "vbscript:", "data:"}
)

const plain = " Only plain drawings can be used as icons."

// clip shortens a value for a message.
func clip(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 60 {
		return string(r[:59]) + "…"
	}
	return s
}

// squeeze takes out white space and control characters and lowercases: "java\tscript:" is
// "javascript:" to a browser.
func squeeze(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r <= ' ' || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// checkValue refuses a value that runs or loads something: a script or data address, or a
// url(…) that points outside the file. refs collects the ids it points to.
func checkValue(v string, refs map[string]bool) error {
	s := squeeze(v)
	for _, scheme := range forbiddenSchemes {
		if strings.Contains(s, scheme) {
			return refuse("The SVG file contains “%s”, which could run a script or load something."+plain, strings.TrimSuffix(scheme, ":"))
		}
	}
	for rest := s; ; {
		i := strings.Index(rest, "url(")
		if i < 0 {
			break
		}
		rest = rest[i+4:]
		target := strings.TrimLeft(rest, `"'`)
		end := strings.IndexAny(target, `"')`)
		if end < 0 {
			end = len(target)
		}
		m := internalRef.FindStringSubmatch(target[:end])
		if m == nil {
			return refuse("The SVG file points to something outside itself (%s)."+plain, clip(v))
		}
		refs[m[1]] = true
	}
	return nil
}

// checkStyle refuses styles that import or load anything, or hide what they say behind escapes.
func checkStyle(css string, refs map[string]bool) error {
	s := squeeze(css)
	for _, bad := range []string{"@import", "\\", "expression(", "behavior:", "-moz-binding", "image-set(", "image(", "</"} {
		if strings.Contains(s, bad) {
			return refuse("The styles of the SVG file load or run something (%s)."+plain, clip(bad))
		}
	}
	return checkValue(css, refs)
}

// checkSVG parses an SVG icon and checks it against the allow-list. It returns its size.
func checkSVG(data []byte) (int, int, error) {
	upper := bytes.ToUpper(data)
	if bytes.Contains(upper, []byte("<!DOCTYPE")) || bytes.Contains(upper, []byte("<!ENTITY")) {
		return 0, 0, refuse("The SVG file contains a document type or entity declaration (DOCTYPE, ENTITY), which is not allowed." + plain)
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = true
	dec.Entity = nil // only the five predefined entities and character references
	var (
		depth, elements int
		stack           []string
		ids             = map[string]bool{}
		refs            = map[string]bool{}
		width, height   int
		rootSeen        bool
		seenAny         bool
	)
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var se *xml.SyntaxError
			if errors.As(err, &se) {
				return 0, 0, refuse("The SVG file is not well-formed, so it cannot be checked (line %d).", se.Line)
			}
			return 0, 0, refuse("The SVG file is not well-formed, so it cannot be checked.")
		}
		switch t := tok.(type) {
		case xml.ProcInst:
			if t.Target != "xml" || seenAny {
				return 0, 0, refuse("The SVG file contains a processing instruction (<?%s …?>), which is not allowed."+plain, clip(t.Target))
			}
		case xml.Directive:
			return 0, 0, refuse("The SVG file contains a declaration (<!…>), which is not allowed." + plain)
		case xml.Comment:
		case xml.CharData:
			if depth == 0 {
				if len(bytes.Trim(t, " \t\r\n\uFEFF")) > 0 { // white space and a byte order mark
					return 0, 0, refuse("The SVG file has text outside its drawing.")
				}
				continue
			}
			if stack[len(stack)-1] == "style" {
				if err := checkStyle(string(t), refs); err != nil {
					return 0, 0, err
				}
			}
		case xml.StartElement:
			seenAny = true
			if depth == 0 && rootSeen {
				return 0, 0, refuse("The SVG file has more than one drawing at the top.")
			}
			depth++
			elements++
			if depth > maxDepth || elements > maxElements {
				return 0, 0, refuse("The SVG file is too complex for an icon.")
			}
			name := t.Name.Local
			if err := checkElement(t); err != nil {
				return 0, 0, err
			}
			if depth == 1 {
				if name != "svg" {
					return 0, 0, refuse("This file is not an SVG drawing.")
				}
				rootSeen = true
				var err error
				if width, height, err = squareOf(t); err != nil {
					return 0, 0, err
				}
			}
			for _, a := range t.Attr {
				if err := checkAttribute(name, a, ids, refs); err != nil {
					return 0, 0, err
				}
			}
			stack = append(stack, name)
		case xml.EndElement:
			depth--
			stack = stack[:len(stack)-1]
		}
	}
	if !rootSeen {
		return 0, 0, refuse("This file is not an SVG drawing.")
	}
	for id := range refs {
		if !ids[id] {
			return 0, 0, refuse("The SVG file points to “#%s”, which is not in the file."+plain, clip(id))
		}
	}
	return width, height, nil
}

func checkElement(t xml.StartElement) error {
	name := t.Name.Local
	switch {
	case t.Name.Space == "":
		return refuse(`The SVG file does not declare itself as SVG (xmlns="http://www.w3.org/2000/svg" is missing).`)
	case t.Name.Space != svgNS:
		return refuse("The SVG file contains <%s>, which belongs to another program and is not plain drawing."+plain, clip(name))
	}
	switch strings.ToLower(name) {
	case "script":
		return refuse("The SVG file contains a script." + plain)
	case "foreignobject":
		return refuse("The SVG file embeds other content (<foreignObject>)." + plain)
	case "iframe", "embed", "object", "image", "a", "audio", "video":
		return refuse("The SVG file embeds or links to other content (<%s>)."+plain, name)
	}
	if !allowedElements[name] {
		return refuse("The SVG file contains <%s>, which is not plain drawing."+plain, clip(name))
	}
	return nil
}

func checkAttribute(element string, a xml.Attr, ids, refs map[string]bool) error {
	local := a.Name.Local
	switch {
	case a.Name.Space == "" && local == "xmlns", a.Name.Space == "xmlns":
		return nil // declarations of namespaces; what uses them is checked
	case strings.HasPrefix(strings.ToLower(local), "on"):
		return refuse("The SVG file reacts to events (%s)."+plain, clip(local))
	case a.Name.Space == xmlNS && (local == "space" || local == "lang"):
		return nil
	case a.Name.Space == xlinkNS && local == "href", a.Name.Space == "" && local == "href":
		m := internalRef.FindStringSubmatch(strings.TrimSpace(a.Value))
		if m == nil {
			return refuse("The SVG file points to something outside itself (%s)."+plain, clip(a.Value))
		}
		refs[m[1]] = true
		return nil
	case a.Name.Space != "" || !allowedAttributes[local]:
		name := local
		if a.Name.Space != "" {
			name = clip(a.Name.Space) + ":" + local
		}
		return refuse("The SVG file has the setting “%s” on <%s>, which is not plain drawing."+plain, clip(name), element)
	}
	if local == "id" {
		ids[a.Value] = true
	}
	if local == "style" {
		return checkStyle(a.Value, refs)
	}
	return checkValue(a.Value, refs)
}

// squareOf is the size of the drawing: square by its viewBox, or else by width and height.
func squareOf(t xml.StartElement) (int, int, error) {
	var viewBox, width, height string
	for _, a := range t.Attr {
		if a.Name.Space != "" {
			continue
		}
		switch a.Name.Local {
		case "viewBox":
			viewBox = a.Value
		case "width":
			width = a.Value
		case "height":
			height = a.Value
		}
	}
	w, wok := length(width)
	h, hok := length(height)
	if viewBox != "" {
		f := strings.FieldsFunc(viewBox, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r' })
		var vw, vh float64
		var err1, err2 error
		if len(f) == 4 {
			vw, err1 = strconv.ParseFloat(f[2], 64)
			vh, err2 = strconv.ParseFloat(f[3], 64)
		}
		if len(f) != 4 || err1 != nil || err2 != nil || vw <= 0 || vh <= 0 || math.IsInf(vw, 0) || math.IsInf(vh, 0) {
			return 0, 0, refuse("The drawing area of the SVG file (viewBox) cannot be read.")
		}
		if vw != vh {
			return 0, 0, refuse("The image must be square: its drawing area (viewBox) is %s × %s.", f[2], f[3])
		}
		if wok && hok && w != h {
			return 0, 0, refuse("The image must be square: it is %s × %s.", clip(width), clip(height))
		}
		if wok && hok {
			return size(w), size(h), nil
		}
		return size(vw), size(vh), nil
	}
	if !wok || !hok {
		return 0, 0, refuse("The SVG file does not say how large it is: give it a square drawing area (viewBox) or the same width and height.")
	}
	if w != h {
		return 0, 0, refuse("The image must be square: it is %s × %s.", clip(width), clip(height))
	}
	return size(w), size(h), nil
}

// length reads a width or height in pixels ("64" or "64px").
func length(v string) (float64, bool) {
	m := number.FindStringSubmatch(v)
	if m == nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(m[1], 64)
	return f, err == nil && f > 0 && !math.IsInf(f, 0)
}

func size(f float64) int {
	n := int(math.Round(f))
	if n < 1 {
		return 1
	}
	if n > 1<<20 {
		return 1 << 20
	}
	return n
}
