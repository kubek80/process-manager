package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

func (a *api) listAccess(w http.ResponseWriter, r *http.Request) {
	list, err := a.Roles.All(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	bootstrap := a.Roles.Bootstrap
	if bootstrap == nil {
		bootstrap = []string{}
	}
	writeJSON(w, 200, map[string]any{"assignments": list, "bootstrapAdmins": bootstrap, "roles": rbac.Roles})
}

type accessInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	Scope string `json:"scope"`
}

// describe is the detail of an audit entry for a role, in the words of the Admin panel:
// "Practice owner for the practice Engineering". The name is the one in the lists at the time;
// the id stands in when it is not there.
func describe(in accessInput, lists docs.Lists) string {
	label := rbac.Label(in.Role)
	if in.Scope == "" {
		return label
	}
	noun := rbac.ScopeNoun(in.Role)
	if noun == "" { // a role of an earlier version that was limited
		return label + " (limited to " + in.Scope + ")"
	}
	name := in.Scope
	if n, ok := find(lists.ByKey(rbac.ScopeList(in.Role)), in.Scope); ok && n.Name != "" {
		name = n.Name
	}
	return label + " for the " + noun + " " + name
}

func find(list []docs.Named, id string) (docs.Named, bool) {
	for _, n := range list {
		if n.ID == id {
			return n, true
		}
	}
	return docs.Named{}, false
}

func (a *api) grantAccess(w http.ResponseWriter, r *http.Request) {
	var in accessInput
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if !docs.Storable(in.Email) {
		writeError(w, 400, "That is not an email address.")
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	// the format of the assignment first, then whether its team, platform or practice exists
	if err := rbac.Check(rbac.Assignment{Email: in.Email, Role: in.Role, Scope: in.Scope}); err != nil {
		a.fail(w, r, err)
		return
	}
	if key := rbac.ScopeList(in.Role); key != "" {
		if _, ok := find(lists.ByKey(key), in.Scope); !ok {
			writeError(w, 400, "There is no "+rbac.ScopeNoun(in.Role)+" “"+in.Scope+"” in the lists.")
			return
		}
	}
	if err := a.Roles.Grant(r.Context(), rbac.Assignment{Email: in.Email, Role: in.Role, Scope: in.Scope, GrantedBy: who(r).Email}); err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "access.grant", in.Email, describe(in, lists))
	a.listAccess(w, r)
}

func (a *api) revokeAccess(w http.ResponseWriter, r *http.Request) {
	var in accessInput
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	if err := a.Roles.Revoke(r.Context(), in.Email, in.Role, in.Scope); err != nil {
		a.fail(w, r, err)
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.Log.Error("lists not read for the activity log", "error", err) // the role is gone all the same
	}
	a.record(r, "access.revoke", strings.ToLower(strings.TrimSpace(in.Email)), describe(in, lists))
	a.listAccess(w, r)
}

// listMembers tells everyone who is signed in who belongs to which team, platform and
// practice: the people with a role limited to it. This is how a reader finds out who may
// change what belongs to a platform or a practice.
func (a *api) listMembers(w http.ResponseWriter, r *http.Request) {
	list, err := a.Roles.Members(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"members": list})
}

func (a *api) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if limit <= 0 {
		limit = 100
	}
	if limit > 499 { // the log returns at most 500 at a time, and one is used to look ahead
		limit = 499
	}
	// one more than asked for tells whether there is an older page
	entries, err := a.Audit.Before(r.Context(), before, limit+1)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	more := len(entries) > limit
	if more {
		entries = entries[:limit]
	}
	writeJSON(w, 200, map[string]any{"entries": entries, "more": more})
}

func (a *api) system(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// a number that could not be read is an error, not a zero
	var failed error
	count := func(n int, err error) int {
		if err != nil && failed == nil {
			failed = err
		}
		return n
	}
	out := map[string]any{
		"provider": a.Cfg.Auth, "baseUrl": a.Cfg.BaseURL, "notify": a.Cfg.Notify,
		"processes": count(a.Docs.CountKind(ctx, docs.Process)), "standards": count(a.Docs.CountKind(ctx, docs.Standard)),
		"skills": count(a.Skills.ActiveCount(ctx)), "assignments": count(a.Roles.Count(ctx)), "openFeedback": count(a.Feedback.OpenCount(ctx)),
	}
	if failed != nil {
		a.fail(w, r, failed)
		return
	}
	writeJSON(w, 200, out)
}

// ---------- skills and review agents

func (a *api) listSkills(w http.ResponseWriter, r *http.Request) {
	list, err := a.Skills.List(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"skills": list})
}

func (a *api) getSkill(w http.ResponseWriter, r *http.Request) {
	a.writeSkill(w, r, r.PathValue("id"))
}

func (a *api) writeSkill(w http.ResponseWriter, r *http.Request, id string) {
	sk, err := a.Skills.Get(r.Context(), id)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	content, err := a.Skills.Content(r.Context(), id, 0)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	versions, err := a.Skills.Versions(r.Context(), id)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"skill": sk, "content": content, "versions": versions, "canEdit": a.canEditSkill(r, sk)})
}

func (a *api) getSkillVersion(w http.ResponseWriter, r *http.Request) {
	n, err := strconv.Atoi(r.PathValue("version"))
	if err != nil || n < 1 {
		writeError(w, 404, "That does not exist.")
		return
	}
	content, err := a.Skills.Content(r.Context(), r.PathValue("id"), n)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"version": n, "content": content})
}

func (a *api) downloadSkill(w http.ResponseWriter, r *http.Request) {
	sk, err := a.Skills.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	content, err := a.Skills.Content(r.Context(), sk.ID, 0)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	name := "SKILL.md"
	if sk.Kind == skills.KindReview {
		name = sk.ID + ".md"
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(content))
}

// canEditSkill: whoever may edit the process or standard the skill is generated from.
func (a *api) canEditSkill(r *http.Request, sk skills.Skill) bool {
	var b rbac.Belongs
	if d, err := a.Docs.Get(r.Context(), sk.SourceKind, sk.SourceID); err == nil {
		b = belongsOf(d.Body)
	}
	return who(r).CanEdit(sk.SourceKind, b)
}

func (a *api) putSkillExtra(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Extra string `json:"extra"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	if len(in.Extra) > 8000 {
		writeError(w, 400, "Keep the extra guidance under 8000 characters.")
		return
	}
	if !docs.Storable(in.Extra) {
		writeError(w, 400, "The text contains characters that cannot be stored.")
		return
	}
	sk, err := a.Skills.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !a.canEditSkill(r, sk) {
		writeError(w, 403, "Only people who can edit the source of this skill can change it.")
		return
	}
	if err := a.Skills.SetExtra(r.Context(), sk.ID, strings.TrimSpace(in.Extra)); err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "skill.guidance", sk.ID, "")
	a.syncSkills(r.Context(), sk.SourceKind, sk.SourceID)
	a.writeSkill(w, r, sk.ID)
}
