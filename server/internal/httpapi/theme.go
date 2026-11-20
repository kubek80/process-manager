package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/kubek80/process-manager/server/internal/icons"
	"github.com/kubek80/process-manager/server/internal/theme"
)

// The look of the portal (Admin > Theming). Everyone may read it, also before signing in: the
// sign-in page shows the name, the logo and the colours, and nothing in it is secret. Who
// changed it last is told to admins only.

func (a *api) themes() *theme.Store { return &theme.Store{Pool: a.Docs.Pool} }

// themeTag is the ETag of a revision of the look.
func themeTag(rev int) string { return `"theme-` + strconv.Itoa(rev) + `"` }

// getTheme answers the look, to everyone. It is kept by the browser but asked again every time
// (no-cache): a new look reaches everyone at their next page load, and an unchanged one costs a
// 304 without a body.
func (a *api) getTheme(w http.ResponseWriter, r *http.Request) {
	s, err := a.themes().Get(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	tag := themeTag(s.Revision)
	h := w.Header()
	h.Set("Cache-Control", "no-cache")
	h.Set("ETag", tag)
	if matches(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(map[string]any{"look": s.Look, "revision": s.Revision})
	}
}

// getThemeLogo serves the image that is the logo now, to everyone, with the safe headers of an
// icon. Any other icon stays behind sign-in.
func (a *api) getThemeLogo(w http.ResponseWriter, r *http.Request) {
	s, err := a.themes().Get(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if s.Look.Logo == "" {
		writeError(w, 404, "No logo has been set.")
		return
	}
	ic, err := a.icons().Get(r.Context(), s.Look.Logo)
	if errors.Is(err, icons.ErrNotFound) {
		writeError(w, 404, "No logo has been set.")
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	h := w.Header()
	tag := `"` + ic.ID + `"`
	h.Set("Content-Security-Policy", iconPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	// the address stays the same when the logo changes: asked again every time, 304 when unchanged
	h.Set("Cache-Control", "no-cache")
	h.Set("ETag", tag)
	if matches(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", ic.ContentType)
	h.Set("Content-Length", strconv.Itoa(len(ic.Data)))
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		_, _ = w.Write(ic.Data)
	}
}

// getAdminTheme is the look with who changed it last and when: Admin > Theming.
func (a *api) getAdminTheme(w http.ResponseWriter, r *http.Request) {
	s, err := a.themes().Get(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, s)
}

// putTheme stores a new look, made from revision rev. It is refused when somebody else saved
// since (409, with what is stored now), and when anything in it does not fit (400, one plain
// sentence per problem).
func (a *api) putTheme(w http.ResponseWriter, r *http.Request) {
	rev, err := strconv.Atoi(r.URL.Query().Get("rev"))
	if err != nil || rev < 0 {
		writeError(w, 400, "Say which version of the look the change was made from (rev=0 when it was never changed).")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	look, problems := theme.Parse(body)
	if len(problems) == 0 && look.Logo != "" {
		stored, err := a.icons().Stored(r.Context(), []string{look.Logo})
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if !stored[look.Logo] {
			problems = append(problems, "The logo has not been uploaded. Choose the image again.")
		}
	}
	if len(problems) > 0 {
		writeJSON(w, 400, map[string]any{"error": strings.Join(problems, " "), "problems": problems})
		return
	}
	s := who(r)
	now, before, err := a.themes().Save(r.Context(), look, rev, s.Email, s.Name)
	var conflict *theme.Conflict
	if errors.As(err, &conflict) {
		c := conflict.Current
		name := c.UpdatedByName
		if name == "" {
			name = c.UpdatedBy
		}
		if name == "" {
			name = "Another admin"
		}
		out := map[string]any{"exists": true, "version": c.Revision, "updatedBy": c.UpdatedBy, "updatedByName": c.UpdatedByName}
		if c.UpdatedAt != nil {
			out["updatedAt"] = c.UpdatedAt
		}
		writeJSON(w, 409, map[string]any{
			"error":    fmt.Sprintf("%s changed the look while you were editing it. Your changes are still here: look at theirs, then save yours over it or keep theirs.", name),
			"conflict": out,
		})
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if before.Look != now.Look {
		a.record(r, "theme.change", "look", theme.Describe(before.Look, now.Look))
	}
	writeJSON(w, 200, now)
}
