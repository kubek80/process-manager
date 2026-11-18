// Package icons keeps the square images that tools and languages in the lists can show next to
// their name. An icon is stored once under the SHA-256 of its bytes, which is its id; it is
// checked before it is stored: what it really is (never what the sender says), its size, and
// for SVG that it is nothing but a plain drawing.
package icons

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"mime"
	"regexp"
	"strings"

	"golang.org/x/image/webp"
)

// Limits of an icon.
const (
	MaxBytes = 64 << 10 // 64 KB, for every kind
	MaxSide  = 512      // pixels, for PNG, JPEG and WebP
)

// The kinds of image an icon may be.
const (
	PNG  = "image/png"
	JPEG = "image/jpeg"
	WebP = "image/webp"
	SVG  = "image/svg+xml"
)

var (
	// ErrInvalid marks an image that is refused; the message is a plain sentence after "invalid: ".
	ErrInvalid = errors.New("invalid")
	// ErrNotFound: no icon with that id is stored.
	ErrNotFound = errors.New("not found")

	idPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// ValidID reports whether id has the form of an icon id: 64 lowercase hex characters.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ID is the id of an icon with these bytes.
func ID(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Icon is a checked image.
type Icon struct {
	ID          string `json:"id"`
	ContentType string `json:"contentType"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Data        []byte `json:"-"`
}

// Ext is the file extension of a kind of image, without the dot.
func Ext(contentType string) string {
	switch contentType {
	case PNG:
		return "png"
	case JPEG:
		return "jpg"
	case WebP:
		return "webp"
	case SVG:
		return "svg"
	}
	return ""
}

// TypeOfExt is the kind of image of a file extension (without the dot); "" when it is none.
func TypeOfExt(ext string) string {
	for _, t := range []string{PNG, JPEG, WebP, SVG} {
		if Ext(t) == ext {
			return t
		}
	}
	return ""
}

// friendly names the kinds of image in messages.
var friendly = map[string]string{PNG: "a PNG image", JPEG: "a JPEG image", WebP: "a WebP image", SVG: "an SVG image"}

func refuse(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, args...)...)
}

// MessageOf is the plain sentence of a refusal.
func MessageOf(err error) string { return strings.TrimPrefix(err.Error(), "invalid: ") }

// Sniff says what the bytes really are: one of the kinds of image, or "".
func Sniff(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return PNG
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return JPEG
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return WebP
	}
	// SVG is text: after an optional byte order mark and white space, an XML declaration, a
	// comment or the svg element itself
	text := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF")), " \t\r\n")
	for _, start := range []string{"<?xml", "<svg", "<!--", "<!doctype svg"} {
		if len(text) >= len(start) && strings.EqualFold(string(text[:len(start)]), start) {
			return SVG
		}
	}
	return ""
}

// Inspect checks an image before it is stored. declared is the content type the sender gave
// (parameters such as a charset are ignored); it must be what the bytes really are.
func Inspect(declared string, data []byte) (Icon, error) {
	if len(data) == 0 {
		return Icon{}, refuse("The file is empty.")
	}
	if len(data) > MaxBytes {
		return Icon{}, refuse("The image is larger than 64 KB. Make it smaller and try again.")
	}
	want, _, err := mime.ParseMediaType(declared)
	if err != nil {
		want = ""
	}
	want = strings.ToLower(want)
	if friendly[want] == "" {
		return Icon{}, refuse("Only PNG, JPEG, WebP and SVG images can be used as icons.")
	}
	got := Sniff(data)
	if got == "" {
		return Icon{}, refuse("This file is not a PNG, JPEG, WebP or SVG image.")
	}
	if got != want {
		return Icon{}, refuse("The file was sent as %s, but it is %s.", friendly[want], friendly[got])
	}
	ic := Icon{ID: ID(data), ContentType: got, Data: data}
	if got == SVG {
		ic.Width, ic.Height, err = checkSVG(data)
		return ic, err
	}
	ic.Width, ic.Height, err = checkBitmap(got, data)
	return ic, err
}

// checkBitmap reads the size from the header first, so that an image that claims to be huge
// is refused before any memory is spent on its pixels; only then is it decoded completely
// (at most 512 x 512), so that a damaged file is refused too.
func checkBitmap(kind string, data []byte) (int, int, error) {
	decodeConfig, decode := png.DecodeConfig, png.Decode
	switch kind {
	case JPEG:
		decodeConfig, decode = jpeg.DecodeConfig, jpeg.Decode
	case WebP:
		decodeConfig, decode = webp.DecodeConfig, webp.Decode
	}
	name := strings.TrimPrefix(friendly[kind], "a ")
	cfg, err := decodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0, refuse("The %s is damaged and cannot be read.", name)
	}
	w, h := cfg.Width, cfg.Height
	if w <= 0 || h <= 0 {
		return 0, 0, refuse("The %s is damaged and cannot be read.", name)
	}
	if w != h {
		return 0, 0, refuse("The image must be square: this one is %d × %d pixels.", w, h)
	}
	if w > MaxSide {
		return 0, 0, refuse("The image must be at most %d × %d pixels: this one is %d × %d.", MaxSide, MaxSide, w, h)
	}
	var img image.Image
	if img, err = decode(bytes.NewReader(data)); err != nil || img.Bounds().Dx() != w || img.Bounds().Dy() != h {
		return 0, 0, refuse("The %s is damaged and cannot be read.", name)
	}
	return w, h, nil
}
