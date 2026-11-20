package icons

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store keeps the icons in the database.
type Store struct{ Pool *pgxpool.Pool }

// Put stores a checked icon. Storing the same image again changes nothing: created is false.
func (s *Store) Put(ctx context.Context, ic Icon, by string) (created bool, err error) {
	tag, err := s.Pool.Exec(ctx, `insert into icons (id, content_type, width, height, data, created_by) values ($1, $2, $3, $4, $5, $6)
		on conflict (id) do nothing`, ic.ID, ic.ContentType, ic.Width, ic.Height, ic.Data, by)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// Get returns one icon with its bytes.
func (s *Store) Get(ctx context.Context, id string) (Icon, error) {
	if !ValidID(id) {
		return Icon{}, ErrNotFound
	}
	ic := Icon{ID: id}
	err := s.Pool.QueryRow(ctx, `select content_type, width, height, data from icons where id = $1`, id).Scan(&ic.ContentType, &ic.Width, &ic.Height, &ic.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Icon{}, ErrNotFound
	}
	return ic, err
}

// Stored returns which of the ids are stored.
func (s *Store) Stored(ctx context.Context, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.Pool.Query(ctx, `select id from icons where id = any($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// CleanAfter is how long an icon nobody names is kept: an icon is uploaded before the lists
// that name it are saved, and the person may take their time.
const CleanAfter = 24 * time.Hour

// Clean removes the icons that neither the lists nor any stored version of them names and
// that were uploaded more than CleanAfter ago. Every icon a version names stays, so that
// restoring an older version of the lists keeps its icons, and so does the portal's logo (the
// look in portal_settings). It returns how many it removed.
func (s *Store) Clean(ctx context.Context) (int, error) {
	tag, err := s.Pool.Exec(ctx, `delete from icons i where i.created_at < now() - make_interval(secs => $1)
		and not exists (select 1 from document_versions v where v.kind = 'catalog' and v.body is not null and strpos(v.body::text, i.id) > 0)
		and not exists (select 1 from documents d where d.kind = 'catalog' and strpos(d.body::text, i.id) > 0)
		and not exists (select 1 from portal_settings s where strpos(s.value::text, i.id) > 0)`, CleanAfter.Seconds())
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// Use is an entry of the lists that names an icon.
type Use struct {
	List string // "tools" or "languages"
	ID   string // the entry
	Name string
	Icon string
}

// What says which entry it is, for messages: "the tool “GitHub”".
func (u Use) What() string {
	noun := "tool"
	if u.List == "languages" {
		noun = "language"
	}
	name := u.Name
	if name == "" {
		name = u.ID
	}
	return fmt.Sprintf("the %s “%s”", noun, name)
}

// Uses reads which tools and languages of a lists document name an icon, in their order.
func Uses(lists []byte) ([]Use, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(lists, &raw); err != nil {
		return nil, err
	}
	var out []Use
	for _, key := range []string{"tools", "languages"} {
		v, ok := raw[key]
		if !ok {
			continue
		}
		var list []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Icon string `json:"icon"`
		}
		if err := json.Unmarshal(v, &list); err != nil {
			return nil, err
		}
		for _, e := range list {
			if e.Icon != "" {
				out = append(out, Use{List: key, ID: e.ID, Name: e.Name, Icon: e.Icon})
			}
		}
	}
	return out, nil
}

// Missing returns the entries of a lists document whose icon is not stored.
func (s *Store) Missing(ctx context.Context, lists []byte) ([]Use, error) {
	uses, err := Uses(lists)
	if err != nil || len(uses) == 0 {
		return nil, err
	}
	ids := make([]string, 0, len(uses))
	for _, u := range uses {
		ids = append(ids, u.Icon)
	}
	stored, err := s.Stored(ctx, ids)
	if err != nil {
		return nil, err
	}
	var out []Use
	for _, u := range uses {
		if !stored[u.Icon] {
			out = append(out, u)
		}
	}
	return out, nil
}

// Folder is where icon files lie in an import or export folder.
func Folder(dir string) string { return filepath.Join(dir, "catalog", "icons") }

// ImportDir stores every icon file in catalog/icons/ of dir: <id>.<png|jpg|webp|svg>. A file
// whose name does not match its content, or that an upload would refuse, is reported and
// skipped. It returns how many icons were added.
func (s *Store) ImportDir(ctx context.Context, dir, by string) (added int, problems []string, err error) {
	folder := Folder(dir)
	info, err := os.Lstat(folder)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if !info.IsDir() {
		return 0, []string{folder + ": the icons folder must be a folder, not a link or a file; nothing in it was imported."}, nil
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return 0, nil, err
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		file := filepath.Join(folder, e.Name())
		ic, problem := readFile(file)
		if problem != "" {
			problems = append(problems, file+": "+problem)
			continue
		}
		created, err := s.Put(ctx, ic, by)
		if err != nil {
			return added, problems, err
		}
		if created {
			added++
		}
	}
	return added, problems, nil
}

// readFile reads and checks one icon file; problem is a plain sentence when it is refused.
func readFile(file string) (Icon, string) {
	base := filepath.Base(file)
	stem, ext, _ := strings.Cut(base, ".")
	kind := TypeOfExt(ext)
	if kind == "" || !ValidID(stem) {
		return Icon{}, "the name of an icon file must be its id (64 characters 0-9 and a-f) and .png, .jpg, .webp or .svg."
	}
	// Only an ordinary file is read: never a link, a folder, a pipe or a device (opening a pipe
	// would wait for ever). It is checked before it is opened and again once it is open, in case
	// it was swapped in between.
	info, err := os.Lstat(file)
	if err != nil {
		return Icon{}, err.Error()
	}
	if !info.Mode().IsRegular() {
		return Icon{}, "only ordinary files are imported, not links, folders or other special files."
	}
	if info.Size() > MaxBytes {
		return Icon{}, MessageOf(refuse("The image is larger than 64 KB. Make it smaller and try again."))
	}
	f, err := os.Open(file)
	if err != nil {
		return Icon{}, err.Error()
	}
	defer f.Close()
	if open, err := f.Stat(); err != nil || !open.Mode().IsRegular() || !os.SameFile(info, open) {
		return Icon{}, "the file changed while it was being read; import again."
	}
	data, err := io.ReadAll(io.LimitReader(f, MaxBytes+1)) // never more than an icon may be
	if err != nil {
		return Icon{}, err.Error()
	}
	ic, err := Inspect(kind, data)
	if err != nil {
		return Icon{}, MessageOf(err)
	}
	if ic.ID != stem {
		return Icon{}, fmt.Sprintf("the name does not match the content: this image is %s.%s.", ic.ID, ext)
	}
	return ic, ""
}

// ExportDir writes the icons that a lists document names to catalog/icons/ of dir, and removes
// icon files there that it does not name. It returns how many it wrote.
func (s *Store) ExportDir(ctx context.Context, dir string, lists []byte) (int, error) {
	uses, err := Uses(lists)
	if err != nil {
		return 0, err
	}
	folder := Folder(dir)
	keep := map[string]bool{}
	ids := []string{}
	for _, u := range uses {
		if !keep[u.Icon] {
			ids = append(ids, u.Icon)
		}
		keep[u.Icon] = true
	}
	sort.Strings(ids)
	written := map[string]bool{}
	for _, id := range ids {
		ic, err := s.Get(ctx, id)
		if errors.Is(err, ErrNotFound) {
			continue // named but not stored: nothing to write
		}
		if err != nil {
			return len(written), err
		}
		if err := ensureFolder(folder); err != nil {
			return len(written), err
		}
		name := id + "." + Ext(ic.ContentType)
		if err := writeNew(filepath.Join(folder, name), ic.Data); err != nil {
			return len(written), err
		}
		written[name] = true
	}
	if info, err := os.Lstat(folder); err != nil || !info.IsDir() {
		return len(written), nil // nothing written and no folder of ours to tidy
	}
	entries, _ := os.ReadDir(folder)
	for _, e := range entries {
		stem, ext, _ := strings.Cut(e.Name(), ".")
		if e.IsDir() || !ValidID(stem) || TypeOfExt(ext) == "" || written[e.Name()] {
			continue
		}
		if err := os.Remove(filepath.Join(folder, e.Name())); err != nil {
			return len(written), err
		}
	}
	return len(written), nil
}

// ensureFolder makes the icons folder; it refuses one that is a link, so that an export never
// writes somewhere else.
func ensureFolder(folder string) error {
	if err := os.MkdirAll(filepath.Dir(folder), 0o755); err != nil {
		return err
	}
	info, err := os.Lstat(folder)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return os.Mkdir(folder, 0o755)
	case err != nil:
		return err
	case !info.IsDir():
		return fmt.Errorf("%s is a link or a file, not a folder: the icons are not written through it", folder)
	}
	return nil
}

// writeNew writes a file that is created afresh: whatever was at the path before (a link
// included) is removed first, and the file is created exclusively, so the write never follows a
// link.
func writeNew(path string, data []byte) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
