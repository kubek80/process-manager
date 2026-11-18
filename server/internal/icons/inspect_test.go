package icons

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, x%h, color.RGBA{200, 30, 30, 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// a 1 x 1 lossless WebP
var webp1, _ = base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")

// pngClaiming is a PNG whose header says it is w x h, followed by a little compressed data:
// a decompression bomb must be refused from the header alone.
func pngClaiming(w, h uint32) []byte {
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	chunk := func(kind string, data []byte) {
		_ = binary.Write(&b, binary.BigEndian, uint32(len(data)))
		b.WriteString(kind)
		b.Write(data)
		_ = binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(kind), data...)))
	}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 6 // 8 bits, RGBA
	chunk("IHDR", ihdr)
	chunk("IDAT", []byte{0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1})
	chunk("IEND", nil)
	return b.Bytes()
}

const okSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#123"/></svg>`

func wantRefused(t *testing.T, kind string, data []byte, part string) {
	t.Helper()
	_, err := Inspect(kind, data)
	if err == nil {
		t.Fatalf("accepted, want refused with %q", part)
	}
	if !strings.Contains(MessageOf(err), part) {
		t.Fatalf("refused with %q, want %q", MessageOf(err), part)
	}
}

func TestBitmaps(t *testing.T) {
	for _, c := range []struct {
		kind string
		data []byte
		side int
	}{{PNG, pngOf(t, 64, 64), 64}, {JPEG, jpegOf(t, 32, 32), 32}, {WebP, webp1, 1}, {PNG, pngOf(t, 512, 512), 512}} {
		ic, err := Inspect(c.kind, c.data)
		if err != nil {
			t.Fatalf("%s: %v", c.kind, err)
		}
		if ic.ContentType != c.kind || ic.Width != c.side || ic.Height != c.side || ic.ID != ID(c.data) || len(ic.ID) != 64 {
			t.Fatalf("%s: %+v", c.kind, ic)
		}
	}
	// a charset or other parameters of the type do not matter
	if _, err := Inspect("image/PNG; foo=bar", pngOf(t, 8, 8)); err != nil {
		t.Fatal(err)
	}
	wantRefused(t, PNG, pngOf(t, 64, 32), "The image must be square: this one is 64 × 32 pixels.")
	wantRefused(t, PNG, pngOf(t, 513, 513), "The image must be at most 512 × 512 pixels: this one is 513 × 513.")
	wantRefused(t, PNG, pngClaiming(1<<20, 1<<20), "at most 512 × 512 pixels")
	wantRefused(t, PNG, pngClaiming(1<<31-1, 1), "must be square")
	wantRefused(t, PNG, pngClaiming(16, 16), "The PNG image is damaged and cannot be read.")
	wantRefused(t, PNG, pngOf(t, 64, 64)[:60], "damaged")
	wantRefused(t, WebP, append([]byte("RIFF\x10\x00\x00\x00WEBPVP8 "), make([]byte, 10)...), "The WebP image is damaged and cannot be read.")
	wantRefused(t, PNG, nil, "The file is empty.")
	big := append(pngOf(t, 8, 8), make([]byte, MaxBytes)...)
	wantRefused(t, PNG, big, "The image is larger than 64 KB. Make it smaller and try again.")
}

func TestTheRealKindDecides(t *testing.T) {
	wantRefused(t, JPEG, pngOf(t, 8, 8), "The file was sent as a JPEG image, but it is a PNG image.")
	wantRefused(t, PNG, []byte(okSVG), "The file was sent as a PNG image, but it is an SVG image.")
	wantRefused(t, SVG, pngOf(t, 8, 8), "but it is a PNG image")
	wantRefused(t, "image/gif", []byte("GIF89a...."), "Only PNG, JPEG, WebP and SVG images can be used as icons.")
	wantRefused(t, "text/html", []byte("<html><script>alert(1)</script></html>"), "Only PNG, JPEG, WebP and SVG images")
	wantRefused(t, SVG, []byte("<html><script>alert(1)</script></html>"), "This file is not a PNG, JPEG, WebP or SVG image.")
	wantRefused(t, "", pngOf(t, 8, 8), "Only PNG, JPEG, WebP and SVG images")
}

func TestPlainSVGIsAccepted(t *testing.T) {
	for _, c := range []struct {
		svg  string
		side int
	}{
		{okSVG, 64},
		{`<?xml version="1.0" encoding="UTF-8"?>
<!-- drawn by hand -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48px" height="48" version="1.1">
  <title>Mark</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <clipPath id="c"><circle cx="24" cy="24" r="20"/></clipPath>
  </defs>
  <style>.a { fill: url(#g); stroke: #333 } text { font-family: sans-serif }</style>
  <g clip-path="url(#c)" style="fill: url('#g')"><rect class="a" width="48" height="48"/></g>
  <path d="M4 0h10" mask="url(#c)"/>
  <text x="24" y="30" text-anchor="middle" xml:space="preserve">A &amp; B</text>
</svg>`, 48},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,24.5,24.5" width="100" height="100"><circle cx="12" cy="12" r="10"/></svg>`, 100},
		{"\xEF\xBB\xBF  " + okSVG, 64},
	} {
		ic, err := Inspect("image/svg+xml; charset=utf-8", []byte(c.svg))
		if err != nil {
			t.Fatalf("%v\n%s", err, c.svg)
		}
		if ic.Width != c.side || ic.Height != c.side || ic.ContentType != SVG {
			t.Fatalf("%+v", ic)
		}
	}
}

func TestSVGThatIsNotPlainDrawingIsRefused(t *testing.T) {
	wrap := func(inner string) string {
		return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">` + inner + `</svg>`
	}
	for _, c := range []struct{ svg, part string }{
		{wrap(`<script>alert(1)</script>`), "The SVG file contains a script. Only plain drawings can be used as icons."},
		{wrap(`<SCRIPT>alert(1)</SCRIPT>`), "contains a script"},
		{wrap(`<script xlink:href="https://evil.example/x.js"/>`), "contains a script"},
		{wrap(`<rect onclick="alert(1)" width="1" height="1"/>`), "The SVG file reacts to events (onclick)."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"/>`, "reacts to events (onload)"},
		{wrap(`<rect ONMOUSEOVER="alert(1)"/>`), "reacts to events"},
		{wrap(`<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>`), "The SVG file embeds other content (<foreignObject>)."},
		{wrap(`<iframe src="https://evil.example"/>`), "(<iframe>)"},
		{wrap(`<embed src="x"/>`), "(<embed>)"},
		{wrap(`<object data="x"/>`), "(<object>)"},
		{wrap(`<image href="https://evil.example/a.png" width="10" height="10"/>`), "(<image>)"},
		{wrap(`<a href="https://evil.example"><rect/></a>`), "(<a>)"},
		{wrap(`<use href="https://evil.example/s.svg#x"/>`), "The SVG file repeats parts of its drawing (<use>)."},
		{wrap(`<g id="a"/><use href="#a"/>`), "repeats parts of its drawing (<use>)"},
		{wrap(`<symbol id="s"/>`), "(<symbol>)"},
		{wrap(`<pattern id="p" width="1" height="1"><rect width="1" height="1"/></pattern>`), "(<pattern>)"},
		{wrap(`<marker id="m"><path d="M0 0h1"/></marker>`), "(<marker>)"},
		{wrap(`<filter id="f"><feGaussianBlur stdDeviation="99"/></filter>`), "The SVG file contains effects (<filter>)."},
		{wrap(`<linearGradient id="a"/><linearGradient id="b" href="#a"/>`), "The SVG file links one part of its drawing to another (href on <linearGradient>)."},
		{wrap(`<linearGradient id="a"/><radialGradient id="b" xlink:href="#a"/>`), "links one part of its drawing to another (href on <radialGradient>)"},
		{wrap(`<g href="other.svg#x"/>`), "points to something outside itself (other.svg#x)"},
		{wrap(`<rect fill="url(#nowhere)"/>`), "points to “#nowhere”, which is not in the file"},
		{wrap(`<g xlink:href="javascript:alert(1)"/>`), "outside itself"},
		{wrap(`<rect fill="url(https://evil.example/p)"/>`), "outside itself"},
		{wrap(`<rect fill="url( 'https://evil.example/p' )"/>`), "outside itself"},
		{wrap(`<rect style="fill: url(//evil.example/p)"/>`), "outside itself"},
		{wrap(`<rect fill="&#106;avascript:alert(1)"/>`), "contains “javascript”"},
		{wrap(`<rect fill="java&#9;script:x"/>`), "contains “javascript”"},
		{wrap(`<rect fill="DATA:text/html,x"/>`), "contains “data”"},
		{wrap(`<style>@import url(https://evil.example/a.css);</style>`), "The styles of the SVG file load or run something (@import)."},
		{wrap(`<style><![CDATA[ rect { fill: url(https://evil.example) } ]]></style>`), "outside itself"},
		{wrap(`<style>rect { background: \75 rl(x) }</style>`), "load or run something"},
		{wrap(`<rect style="behavior: url(#x)"/>`), "load or run something"},
		{wrap(`<animate attributeName="href" to="javascript:alert(1)"/>`), "The SVG file contains <animate>, which is not plain drawing."},
		{wrap(`<set attributeName="href" to="https://evil.example"/>`), "<set>"},
		{wrap(`<rect requiredExtensions="x"/>`), "The SVG file has the setting “requiredExtensions” on <rect>, which is not plain drawing."},
		{`<svg xmlns="http://www.w3.org/2000/svg" xmlns:ink="http://www.inkscape.org/namespaces/inkscape" ink:version="1" viewBox="0 0 1 1"/>`, "setting “http://www.inkscape.org/namespaces/inkscape:version”"},
		{wrap(`<ink:grid xmlns:ink="urn:ink"/>`), "belongs to another program"},
		{wrap(`<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>`), "belongs to another program"},
		{`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&a;</text></svg>`, "document type or entity declaration"},
		{`<!doctype svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`, "document type"},
		{wrap(`<text>&nbsp;</text>`), "not well-formed"},
		{wrap(`<rect>`), "not well-formed"},
		{wrap(`<?php echo 1 ?>`), "processing instruction"},
		{`<svg viewBox="0 0 1 1"/>`, `does not declare itself as SVG`},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"/>`, "The image must be square: its drawing area (viewBox) is 20 × 10."},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>`, "The image must be square: it is 20 × 10."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="20" height="10"/>`, "must be square"},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>`, "does not say how large it is"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 x y"/>`, "“x” is not one"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`, "more than one drawing"},
		{`<!-- only a comment -->`, "not an SVG drawing"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>text after`, "text outside its drawing"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">` + strings.Repeat("<g>", 32) + strings.Repeat("</g>", 32) + `</svg>`, "The SVG file puts parts inside each other more than 32 levels deep: too deep for an icon."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">` + strings.Repeat("<g/>", 2000) + `</svg>`, "The SVG file has more than 2000 parts: too many for an icon."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e308 1e308"/>`, "The numbers of the drawing area of the SVG file (viewBox) must be at most 100000."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e400 1e400"/>`, "The drawing area of the SVG file (viewBox) must be four ordinary numbers: “1e400” is not one."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 NaN NaN"/>`, "“NaN” is not one"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="Infinity 0 1 1"/>`, "“Infinity” is not one"},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>`, "The width and height of the drawing area of the SVG file (viewBox) must be greater than 0."},
		{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1 1"/>`, "The drawing area of the SVG file (viewBox) must be four numbers."},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="NaN" height="NaN"/>`, "The width of the SVG file must be an ordinary number: “NaN” is not one."},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="1e999" height="1e999"/>`, "The width of the SVG file must be an ordinary number"},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="200000"/>`, "The width of the SVG file must be at most 100000."},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="-10"/>`, "The height of the SVG file must be greater than 0."},
	} {
		wantRefused(t, SVG, []byte(c.svg), c.part)
	}
}

// A small file that makes a browser draw a huge number of shapes: nine nested groups of ten
// <use> each (10^9 copies). It was once accepted; nothing that repeats parts is allowed now.
func TestAUseBombIsRefused(t *testing.T) {
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><path id="g0" d="M0 0h1v1z"/>`)
	for i := 1; i <= 9; i++ {
		fmt.Fprintf(&b, `<g id="g%d">`, i)
		for j := 0; j < 10; j++ {
			fmt.Fprintf(&b, `<use xlink:href="#g%d"/>`, i-1)
		}
		b.WriteString(`</g>`)
	}
	b.WriteString(`</defs><use href="#g9"/></svg>`)
	if b.Len() > 8<<10 {
		t.Fatalf("the bomb is %d bytes", b.Len())
	}
	wantRefused(t, SVG, []byte(b.String()), "repeats parts of its drawing (<use>)")
	// the same with gradients that inherit from each other through href
	g := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><linearGradient id="a"/><linearGradient id="b" href="#a"/><rect fill="url(#b)"/></svg>`
	wantRefused(t, SVG, []byte(g), "links one part of its drawing to another")
}

func TestMovingImagesAreRefused(t *testing.T) {
	still := pngOf(t, 8, 8)
	// an acTL chunk right after IHDR (8 bytes signature + 25 bytes IHDR) makes it an animated PNG
	actl := []byte{0, 0, 0, 8, 'a', 'c', 'T', 'L', 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0}
	apng := append(append(append([]byte{}, still[:33]...), actl...), still[33:]...)
	wantRefused(t, PNG, apng, "Moving images cannot be used as icons: this PNG image is animated.")
	if _, err := Inspect(PNG, still); err != nil {
		t.Fatal(err)
	}
	vp8x := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00")
	wantRefused(t, WebP, vp8x, "this WebP image is animated")
	anim := []byte("RIFF\x00\x00\x00\x00WEBPANIM\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00")
	wantRefused(t, WebP, anim, "this WebP image is animated")
	if _, err := Inspect(WebP, webp1); err != nil {
		t.Fatal(err)
	}
}
