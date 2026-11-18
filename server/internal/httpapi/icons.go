package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/icons"
)

// iconPolicy is the content security policy of a served icon: nothing in it may run or load
// anything, also when it is opened on its own in a browser tab.
const iconPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

func (a *api) icons() *icons.Store { return &icons.Store{Pool: a.Docs.Pool} }

// kindName is how the audit trail names a kind of image.
var kindName = map[string]string{icons.PNG: "PNG", icons.JPEG: "JPEG", icons.WebP: "WebP", icons.SVG: "SVG"}

// uploadIcon stores an icon for the lists. The body is the image itself; it is never read
// beyond the size an icon may have.
func (a *api) uploadIcon(w http.ResponseWriter, r *http.Request) {
	if !who(r).Catalog {
		writeError(w, 403, "Only people who manage the lists can add icons.")
		return
	}
	const tooLarge = "The image is larger than 64 KB. Make it smaller and try again."
	if r.ContentLength > icons.MaxBytes {
		writeError(w, 400, tooLarge)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, icons.MaxBytes+1))
	var limit *http.MaxBytesError
	if errors.As(err, &limit) || len(data) > icons.MaxBytes {
		writeError(w, 400, tooLarge)
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	ic, err := icons.Inspect(r.Header.Get("Content-Type"), data)
	if err != nil {
		writeError(w, 400, icons.MessageOf(err))
		return
	}
	created, err := a.icons().Put(r.Context(), ic, who(r).Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if created {
		a.record(r, "icon.upload", ic.ID, fmt.Sprintf("%s image, %d × %d", kindName[ic.ContentType], ic.Width, ic.Height))
	}
	writeJSON(w, 200, ic)
}

// getIcon serves an icon to everyone who is signed in. Its id is the fingerprint of its bytes,
// so it never changes and can be kept by the browser for good.
func (a *api) getIcon(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !icons.ValidID(id) {
		writeError(w, 404, "That does not exist.")
		return
	}
	ic, err := a.icons().Get(r.Context(), id)
	if errors.Is(err, icons.ErrNotFound) {
		writeError(w, 404, "That does not exist.")
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	h := w.Header()
	etag := `"` + id + `"`
	h.Set("Content-Security-Policy", iconPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("ETag", etag)
	if matches(r.Header.Get("If-None-Match"), etag) {
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

// matches reports whether an If-None-Match header names the etag (or is "*").
func matches(header, etag string) bool {
	for _, v := range strings.Split(header, ",") {
		v = strings.TrimPrefix(strings.TrimSpace(v), "W/")
		if v == etag || v == "*" {
			return true
		}
	}
	return false
}

// knownIcons refuses lists that name an icon that is not stored. An icon the stored lists
// already name is let through, so that an installation whose lists were imported without
// their icon files can still save its lists.
func (a *api) knownIcons(ctx context.Context, body []byte) error {
	missing, err := a.icons().Missing(ctx, body)
	if err != nil || len(missing) == 0 {
		return err
	}
	named := map[string]bool{}
	if cur, err := a.Docs.Get(ctx, docs.Catalog, docs.CatalogID); err == nil {
		uses, _ := icons.Uses(cur.Body)
		for _, u := range uses {
			named[u.List+"/"+u.ID+"/"+u.Icon] = true
		}
	} else if !errors.Is(err, docs.ErrNotFound) {
		return err
	}
	var problems []string
	for _, u := range missing {
		if !named[u.List+"/"+u.ID+"/"+u.Icon] {
			problems = append(problems, u.What())
		}
	}
	switch len(problems) {
	case 0:
		return nil
	case 1:
		return fmt.Errorf("%w: The icon of %s has not been uploaded. Choose the image again.", docs.ErrInvalid, problems[0])
	}
	return fmt.Errorf("%w: The icons of %s have not been uploaded. Choose the images again.", docs.ErrInvalid, joinAnd(problems))
}

// joinAnd joins "a", "b" and "c" as "a, b and c".
func joinAnd(list []string) string {
	if len(list) < 2 {
		return strings.Join(list, "")
	}
	return strings.Join(list[:len(list)-1], ", ") + " and " + list[len(list)-1]
}
