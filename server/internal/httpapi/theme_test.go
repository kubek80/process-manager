package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/icons"
)

func TestTheLookIsReadWithoutSignInAndSetByAdmins(t *testing.T) {
	e := setup(t, nil)
	anon := e.anonymous()

	// nothing set: the default look, revision 0, with an ETag and asked again every time
	status, raw, h := anon.raw("GET", "/api/theme", nil, false)
	wantStatus(t, status, 200, string(raw))
	if strings.TrimSpace(string(raw)) != `{"look":{},"revision":0}` || h.Get("ETag") != `"theme-0"` || h.Get("Cache-Control") != "no-cache" {
		t.Fatalf("default look: %s %v", raw, h)
	}
	if status, _, _ := anon.fetch("/api/theme", map[string]string{"If-None-Match": `"theme-0"`}); status != 304 {
		t.Fatalf("unchanged: %d", status)
	}

	look := map[string]string{"name": "  Acme Hub ", "brand": "#0055AA", "process": "#0f766e", "standard": "#6d28d9", "appearance": "dark"}
	// only admins
	for _, who := range []string{sam, alex, jordan} {
		status, out := e.as(who).do("PUT", "/api/admin/theme?rev=0", look)
		wantError(t, status, out, 403, "Only admins can do that.")
	}
	status, out := anon.do("PUT", "/api/admin/theme?rev=0", look)
	wantStatus(t, status, 401, out)
	if status, out := e.as(sam).do("GET", "/api/admin/theme", nil); status != 403 {
		t.Fatalf("a reader reads who changed the look: %d %v", status, out)
	}

	d := e.as(dana)
	status, out = d.do("PUT", "/api/admin/theme?rev=0", look)
	wantStatus(t, status, 200, out)
	saved := out["look"].(map[string]any)
	if out["revision"] != 1.0 || saved["name"] != "Acme Hub" || saved["brand"] != "#0055aa" || saved["appearance"] != "dark" || out["updatedBy"] != dana {
		t.Fatalf("saved: %v", out)
	}
	// everyone sees it, also before signing in; who changed it only in the Admin panel
	status, raw, h = anon.raw("GET", "/api/theme", nil, false)
	if status != 200 || h.Get("ETag") != `"theme-1"` || strings.Contains(string(raw), "dana") || !strings.Contains(string(raw), `"name":"Acme Hub"`) {
		t.Fatalf("read back: %d %s %v", status, raw, h)
	}
	status, out = d.do("GET", "/api/admin/theme", nil)
	if status != 200 || out["revision"] != 1.0 || out["updatedBy"] != dana || out["updatedAt"] == nil {
		t.Fatalf("admin read: %d %v", status, out)
	}

	// an outdated revision is refused, saying who changed it
	status, out = d.do("PUT", "/api/admin/theme?rev=0", map[string]string{"brand": "#112233"})
	if status != 409 || !strings.Contains(out["error"].(string), "changed the look while you were editing it") {
		t.Fatalf("outdated: %d %v", status, out)
	}
	if c := out["conflict"].(map[string]any); c["version"] != 1.0 || c["exists"] != true || c["updatedBy"] != dana {
		t.Fatalf("conflict: %v", c)
	}
	for _, rev := range []string{"", "x", "-1"} {
		status, out := d.do("PUT", "/api/admin/theme?rev="+rev, look)
		wantError(t, status, out, 400, "Say which version of the look the change was made from (rev=0 when it was never changed).")
	}

	// back to the default look
	status, out = d.do("PUT", "/api/admin/theme?rev=1", map[string]string{})
	if status != 200 || out["revision"] != 2.0 || len(out["look"].(map[string]any)) != 0 {
		t.Fatalf("default again: %d %v", status, out)
	}

	// the activity log says what changed, in plain words
	entries, err := e.deps.Audit.Recent(bg, 5)
	must(t, err)
	var details []string
	for _, en := range entries {
		if en.Action == "theme.change" {
			details = append(details, en.Detail)
		}
	}
	if len(details) != 2 || details[0] != "back to the default look" ||
		details[1] != "name “Acme Hub”; brand colour #0055aa; colour of processes #0f766e; colour of standards #6d28d9; appearance for new visitors dark" {
		t.Fatalf("activity: %q", details)
	}
}

func TestALookThatDoesNotFitIsRefusedWithAReasonPerProblem(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	status, out := d.do("PUT", "/api/admin/theme?rev=0", map[string]any{
		"name": "A‮B", "brand": "blue", "process": "#12345", "standard": 7, "appearance": "sepia", "size": "large", "font": "Comic Sans", "problem": "red",
	})
	if status != 400 {
		t.Fatalf("status %d %v", status, out)
	}
	var problems []string
	for _, p := range out["problems"].([]any) {
		problems = append(problems, p.(string))
	}
	want := []string{
		"The look has no setting “size”. Remove it and try again.",
		"The colour of standards must be a text.",
		"The name contains characters that change the reading direction. Remove them and try again.",
		"The brand colour must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The colour of processes must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The colour of problems must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The appearance must be “light”, “dark” or “device” (follow the device's setting).",
		"The font must be “roboto”; leave it out to use the default font (Inter).",
	}
	if strings.Join(problems, "\n") != strings.Join(want, "\n") || out["error"] != strings.Join(want, " ") {
		t.Fatalf("problems:\n%s", strings.Join(problems, "\n"))
	}
	for body, msg := range map[string]string{
		`{"name": ""}`: "The name cannot be empty. Leave it out to use “Process Manager”.",
		`{"name": "` + strings.Repeat("x", 41) + `"}`: "The name is 41 characters long; it can be at most 40.",
		`{"name": "a\nb"}`:                            "The name contains control characters. Remove them and try again.",
		`{"logo": "nope"}`:                            "The logo is not an image that was uploaded here. Choose the image again.",
		`{"logo": "` + strings.Repeat("a", 64) + `"}`: "The logo has not been uploaded. Choose the image again.",
		`[1]`:      "The look must be sent as one JSON object, e.g. {\"brand\": \"#0055aa\"}.",
		`not json`: "The look must be sent as one JSON object, e.g. {\"brand\": \"#0055aa\"}.",
	} {
		status, out := d.do("PUT", "/api/admin/theme?rev=0", body)
		wantError(t, status, out, 400, msg)
	}
	// nothing was stored
	if status, out := e.anonymous().do("GET", "/api/theme", nil); status != 200 || out["revision"] != 0.0 {
		t.Fatalf("after refusals: %d %v", status, out)
	}
}

func TestButtonsStatesAndFontAreStoredAndServedToEveryone(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	look := map[string]string{"mainButton": "#15803D", "otherButtons": "#0369a1", "success": "#166534", "warning": "#ea580c", "info": "#2563eb", "problem": "#b91c1c", "font": "roboto"}
	if status, out := d.do("PUT", "/api/admin/theme?rev=0", look); status != 200 {
		t.Fatalf("%d %v", status, out)
	}
	status, out := e.anonymous().do("GET", "/api/theme", nil)
	got, _ := out["look"].(map[string]any)
	if status != 200 || got["mainButton"] != "#15803d" || got["otherButtons"] != "#0369a1" || got["success"] != "#166534" || got["warning"] != "#ea580c" ||
		got["info"] != "#2563eb" || got["problem"] != "#b91c1c" || got["font"] != "roboto" || len(got) != 7 {
		t.Fatalf("%d %v", status, out)
	}
	// back to the default for some parts: they are left out
	if status, out := d.do("PUT", "/api/admin/theme?rev=1", map[string]string{"warning": "#ea580c"}); status != 200 {
		t.Fatalf("%d %v", status, out)
	}
	_, out = e.anonymous().do("GET", "/api/theme", nil)
	if got, _ := out["look"].(map[string]any); len(got) != 1 || got["warning"] != "#ea580c" {
		t.Fatalf("%v", out)
	}
	var details []string
	entries, err := e.deps.Audit.Recent(bg, 5)
	must(t, err)
	for _, en := range entries {
		if en.Action == "theme.change" {
			details = append(details, en.Detail)
		}
	}
	if len(details) != 2 || !strings.Contains(strings.Join(details, "|"), "font back to the default (Inter)") {
		t.Fatalf("%q", details)
	}
}

func TestTheLogoIsServedToEveryoneAndKeptByTheCleanUp(t *testing.T) {
	e := setup(t, nil)
	anon := e.anonymous()
	status, out := anon.do("GET", "/api/theme/logo", nil)
	wantError(t, status, out, 404, "No logo has been set.")

	d := e.as(dana)
	status, out = d.upload("image/svg+xml", []byte(plainSVG))
	wantStatus(t, status, 200, out)
	logo := out["id"].(string)
	other := pngIcon(t, 32, 32)
	status, out = d.upload("image/png", other)
	wantStatus(t, status, 200, out)

	// a wide image is not a logo: the same rules as icons
	status, out = d.upload("image/png", pngIcon(t, 64, 32))
	if status != 400 {
		t.Fatalf("wide: %d %v", status, out)
	}

	status, out = d.do("PUT", "/api/admin/theme?rev=0", map[string]string{"logo": logo})
	wantStatus(t, status, 200, out)
	status, data, h := anon.fetch("/api/theme/logo", nil)
	if status != 200 || string(data) != plainSVG || h.Get("Content-Type") != "image/svg+xml" || h.Get("Content-Security-Policy") != iconPolicy ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("ETag") != `"`+logo+`"` || h.Get("Cache-Control") != "no-cache" {
		t.Fatalf("logo: %d %s %v", status, data, h)
	}
	if status, _, _ := anon.fetch("/api/theme/logo", map[string]string{"If-None-Match": `"` + logo + `"`}); status != 304 {
		t.Fatalf("unchanged logo: %d", status)
	}
	// any other icon stays behind sign-in
	if status, _, _ := anon.fetch("/api/icons/"+icons.ID(other), nil); status != 401 {
		t.Fatalf("other icon without sign-in: %d", status)
	}

	// the clean-up removes icons nobody names, never the logo
	_, err := e.deps.Docs.Pool.Exec(bg, `update icons set created_at = now() - interval '2 days'`)
	must(t, err)
	removed, err := e.icons().Clean(bg)
	must(t, err)
	stored, err := e.icons().Stored(bg, []string{logo, icons.ID(other)})
	must(t, err)
	if removed != 1 || !stored[logo] || stored[icons.ID(other)] {
		t.Fatalf("clean-up removed %d: %v", removed, stored)
	}

	entries, _ := e.deps.Audit.Recent(bg, 3)
	if entries[0].Action != "theme.change" || entries[0].Detail != "logo added" {
		b, _ := json.Marshal(entries)
		t.Fatalf("activity: %s", b)
	}
}

func (e *env) icons() *icons.Store { return &icons.Store{Pool: e.deps.Docs.Pool} }
