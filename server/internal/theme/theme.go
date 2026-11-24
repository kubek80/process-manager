// Package theme keeps the look of the portal that an admin sets in Admin > Theming: the name,
// the logo, the brand colour, the second colour, the ink, the colours of processes and standards,
// of the buttons and of the states (success, warning, information, problem), the highlight, the
// quiet surface, the font and the appearance for people who have not chosen light or dark
// themselves. The default look is the designer's palette (Ocean, Sky, Snow, Midnight, Sun, Earth,
// Grain, Land, Berry); it lives in the app (src/lib/theme.ts), nothing of it is stored. Only what the admin chose is stored; the
// app works out the readable variants of the colours for light and for dark itself.
package theme

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/icons"
)

// DefaultName is the portal's name when the admin has not given one.
const DefaultName = "Process Manager"

// MaxName is the most characters the name may have.
const MaxName = 40

// Look is what the admin chose. An empty field is the default look of that part.
type Look struct {
	Name  string `json:"name,omitempty"`
	Logo  string `json:"logo,omitempty"`  // an uploaded icon (see package icons)
	Brand string `json:"brand,omitempty"` // #rrggbb
	// The second primary colour (default Sky) and the ink of text and dark surfaces (default Midnight).
	Secondary string `json:"secondary,omitempty"` // #rrggbb
	Ink       string `json:"ink,omitempty"`       // #rrggbb
	Process   string `json:"process,omitempty"`   // #rrggbb
	Standard  string `json:"standard,omitempty"`  // #rrggbb
	// The colour of the one main button of a view, and of the other (outlined) buttons.
	MainButton   string `json:"mainButton,omitempty"`   // #rrggbb
	OtherButtons string `json:"otherButtons,omitempty"` // #rrggbb
	// The colours of the states: success, warning, information and problem.
	Success string `json:"success,omitempty"` // #rrggbb
	Warning string `json:"warning,omitempty"` // #rrggbb
	Info    string `json:"info,omitempty"`    // #rrggbb
	Problem string `json:"problem,omitempty"` // #rrggbb
	// The highlight (default Sun: the words a search found) and the quiet surface (default Grain).
	Highlight string `json:"highlight,omitempty"` // #rrggbb
	Quiet     string `json:"quiet,omitempty"`     // #rrggbb
	// Font of the portal: one of Fonts; empty is the default font (Roboto).
	Font string `json:"font,omitempty"`
	// Appearance for people who have not chosen light or dark themselves: light, dark or device.
	Appearance string `json:"appearance,omitempty"`
}

// Appearances are the values Appearance may have.
var Appearances = []string{"light", "dark", "device"}

// Fonts are the values Font may have besides the default (empty: Roboto). "roboto" is what looks
// saved while Roboto was a choice of its own; it stays valid and means the default font.
var Fonts = []string{"roboto", "inter"}

// fields are the parts of a look in the order they are checked and described, with what to
// call them in a sentence.
var fields = []struct{ key, what string }{
	{"name", "The name"},
	{"logo", "The logo"},
	{"brand", "The brand colour"},
	{"secondary", "The second colour"},
	{"ink", "The ink"},
	{"process", "The colour of processes"},
	{"standard", "The colour of standards"},
	{"mainButton", "The colour of main buttons"},
	{"otherButtons", "The colour of other buttons"},
	{"success", "The colour of success"},
	{"warning", "The colour of warnings"},
	{"info", "The colour of information"},
	{"problem", "The colour of problems"},
	{"highlight", "The highlight"},
	{"quiet", "The quiet surface"},
	{"appearance", "The appearance"},
	{"font", "The font"},
}

// colorFields are the keys of fields that hold a colour.
var colorFields = map[string]bool{"brand": true, "secondary": true, "ink": true, "process": true, "standard": true, "mainButton": true, "otherButtons": true,
	"success": true, "warning": true, "info": true, "problem": true, "highlight": true, "quiet": true}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Parse reads a look sent by the app. Every problem is one plain sentence; a look with
// problems is not stored. Colours are kept in lower case.
func Parse(body []byte) (Look, []string) {
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(&raw); err != nil || raw == nil || dec.More() {
		return Look{}, []string{"The look must be sent as one JSON object, e.g. {\"brand\": \"#0055aa\"}."}
	}
	var problems []string
	known := map[string]bool{}
	for _, f := range fields {
		known[f.key] = true
	}
	var unknown []string
	for k := range raw {
		if !known[k] {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	for _, k := range unknown {
		problems = append(problems, fmt.Sprintf("The look has no setting “%s”. Remove it and try again.", shorten(k)))
	}
	values := map[string]string{}
	for _, f := range fields {
		v, ok := raw[f.key]
		if !ok {
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			problems = append(problems, f.what+" must be a text.")
			continue
		}
		values[f.key] = s
	}
	lower := func(k string) string { return strings.ToLower(values[k]) }
	look := Look{Name: values["name"], Logo: values["logo"], Brand: lower("brand"), Secondary: lower("secondary"), Ink: lower("ink"), Process: lower("process"), Standard: lower("standard"),
		MainButton: lower("mainButton"), OtherButtons: lower("otherButtons"), Success: lower("success"), Warning: lower("warning"), Info: lower("info"), Problem: lower("problem"),
		Highlight: lower("highlight"), Quiet: lower("quiet"), Appearance: values["appearance"], Font: values["font"]}
	if _, ok := values["name"]; ok {
		name, problem := docs.CheckText(look.Name, "The name", false)
		look.Name = name
		switch {
		case problem != "":
			problems = append(problems, problem)
		case name == "":
			problems = append(problems, "The name cannot be empty. Leave it out to use “"+DefaultName+"”.")
		case utf8.RuneCountInString(name) > MaxName:
			problems = append(problems, fmt.Sprintf("The name is %d characters long; it can be at most %d.", utf8.RuneCountInString(name), MaxName))
		}
	}
	if _, ok := values["logo"]; ok && !icons.ValidID(look.Logo) {
		problems = append(problems, "The logo is not an image that was uploaded here. Choose the image again.")
	}
	for _, f := range fields {
		if v, ok := values[f.key]; ok && colorFields[f.key] && !hexColor.MatchString(v) {
			problems = append(problems, f.what+" must be written as # and six digits or letters a-f, e.g. #4f46e5.")
		}
	}
	if v, ok := values["appearance"]; ok && v != "light" && v != "dark" && v != "device" {
		problems = append(problems, "The appearance must be “light”, “dark” or “device” (follow the device's setting).")
	}
	if v, ok := values["font"]; ok && v != "roboto" && v != "inter" {
		problems = append(problems, "The font must be “inter”; leave it out to use the default font (Roboto).")
	}
	return look, problems
}

// shorten keeps a name from the request short enough to quote in a message.
func shorten(s string) string {
	if utf8.RuneCountInString(s) <= 40 {
		return s
	}
	return string([]rune(s)[:39]) + "…"
}

// Describe says in plain words what changed from old to the new look, for the activity log,
// e.g. "name “Acme Portal”; brand colour #0055aa; logo added".
func Describe(old, new Look) string {
	if new == (Look{}) && old != (Look{}) {
		return "back to the default look"
	}
	var parts []string
	text := func(what, was, now, def string) {
		switch {
		case was == now:
		case now == "":
			parts = append(parts, what+" back to the default ("+def+")")
		default:
			parts = append(parts, what+" "+now)
		}
	}
	text("name", quote(old.Name), quote(new.Name), "“"+DefaultName+"”")
	switch {
	case old.Logo == new.Logo:
	case new.Logo == "":
		parts = append(parts, "logo removed")
	case old.Logo == "":
		parts = append(parts, "logo added")
	default:
		parts = append(parts, "logo replaced")
	}
	text("brand colour", old.Brand, new.Brand, "Ocean")
	text("second colour", old.Secondary, new.Secondary, "Sky")
	text("ink", old.Ink, new.Ink, "Midnight")
	text("colour of processes", old.Process, new.Process, "teal")
	text("colour of standards", old.Standard, new.Standard, "Berry")
	text("colour of main buttons", old.MainButton, new.MainButton, "the brand colour")
	text("colour of other buttons", old.OtherButtons, new.OtherButtons, "neutral")
	text("colour of success", old.Success, new.Success, "Land")
	text("colour of warnings", old.Warning, new.Warning, "Earth")
	text("colour of information", old.Info, new.Info, "Sky, the second colour")
	text("colour of problems", old.Problem, new.Problem, "red")
	text("highlight", old.Highlight, new.Highlight, "Sun")
	text("quiet surface", old.Quiet, new.Quiet, "Grain")
	// a look that stored "roboto" has the default font: going from it to nothing changes nothing people see
	font := map[string]string{"inter": "Inter"}
	text("font", font[old.Font], font[new.Font], "Roboto")
	appearance := map[string]string{"light": "light", "dark": "dark", "device": "as the device is set"}
	text("appearance for new visitors", appearance[old.Appearance], appearance[new.Appearance], "light")
	if len(parts) == 0 {
		return "nothing changed"
	}
	return strings.Join(parts, "; ")
}

func quote(s string) string {
	if s == "" {
		return ""
	}
	return "“" + s + "”"
}

// Saved is the stored look with its revision. Revision 0: nothing was ever saved (the default look).
type Saved struct {
	Look          Look       `json:"look"`
	Revision      int        `json:"revision"`
	UpdatedAt     *time.Time `json:"updatedAt,omitempty"`
	UpdatedBy     string     `json:"updatedBy,omitempty"`
	UpdatedByName string     `json:"updatedByName,omitempty"`
}

// Conflict: the look was saved by somebody else since the revision a change was made from.
type Conflict struct{ Current Saved }

func (c *Conflict) Error() string {
	return fmt.Sprintf("the look is at revision %d", c.Current.Revision)
}

// Store keeps the look in the database (table portal_settings, key 'theme').
type Store struct{ Pool *pgxpool.Pool }

const key = "theme"

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func get(ctx context.Context, q querier, lock bool) (Saved, error) {
	var s Saved
	var body []byte
	var at time.Time
	sql := `select value, revision, updated_by, updated_by_name, updated_at from portal_settings where key = $1`
	if lock {
		sql += ` for update`
	}
	err := q.QueryRow(ctx, sql, key).Scan(&body, &s.Revision, &s.UpdatedBy, &s.UpdatedByName, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return Saved{}, nil
	}
	if err != nil {
		return Saved{}, err
	}
	s.UpdatedAt = &at
	// what is stored was checked when it was saved
	look, _ := Parse(body)
	s.Look = look
	return s, nil
}

// Get returns the stored look; Revision 0 when none was ever saved.
func (s *Store) Get(ctx context.Context) (Saved, error) { return get(ctx, s.Pool, false) }

// Save stores a look made from revision base (0: from the default look, nothing saved yet). It
// refuses with *Conflict when somebody else saved since. It returns what is stored now and what
// was stored before.
func (s *Store) Save(ctx context.Context, look Look, base int, by, byName string) (now, before Saved, err error) {
	body, err := json.Marshal(look)
	if err != nil {
		return Saved{}, Saved{}, err
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		cur, err := get(ctx, tx, true)
		if err != nil {
			return err
		}
		if cur.Revision != base {
			return &Conflict{Current: cur}
		}
		before = cur
		var at time.Time
		if cur.Revision == 0 {
			tag, err := tx.Exec(ctx, `insert into portal_settings (key, value, revision, updated_by, updated_by_name) values ($1, $2, 1, $3, $4) on conflict (key) do nothing`,
				key, body, by, byName)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 { // saved by somebody else at the same moment
				cur, err := get(ctx, tx, false)
				if err != nil {
					return err
				}
				return &Conflict{Current: cur}
			}
		} else if _, err := tx.Exec(ctx, `update portal_settings set value = $2, revision = revision + 1, updated_by = $3, updated_by_name = $4, updated_at = now() where key = $1`,
			key, body, by, byName); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `select updated_at from portal_settings where key = $1`, key).Scan(&at); err != nil {
			return err
		}
		now = Saved{Look: look, Revision: base + 1, UpdatedAt: &at, UpdatedBy: by, UpdatedByName: byName}
		return nil
	})
	return now, before, err
}
