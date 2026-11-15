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

func describe(in accessInput) string {
	if in.Scope != "" {
		return in.Role + " for " + in.Scope
	}
	return in.Role
}

func (a *api) grantAccess(w http.ResponseWriter, r *http.Request) {
	var in accessInput
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	// a role limited to a team must name a team that exists
	if in.Scope != "" {
		lists, err := a.Docs.Lists(r.Context())
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if _, ok := lists.Team(in.Scope); !ok {
			writeError(w, 400, "There is no team or unit “"+in.Scope+"” in the lists.")
			return
		}
	}
	if err := a.Roles.Grant(r.Context(), rbac.Assignment{Email: in.Email, Role: in.Role, Scope: in.Scope, GrantedBy: who(r).Email}); err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "access.grant", in.Email, describe(in))
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
	a.record(r, "access.revoke", strings.ToLower(strings.TrimSpace(in.Email)), describe(in))
	a.listAccess(w, r)
}

func (a *api) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := a.Audit.Recent(r.Context(), limit)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"entries": entries})
}

func (a *api) system(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	count := func(kind string) int {
		list, _ := a.Docs.List(ctx, kind)
		return len(list)
	}
	all, _ := a.Skills.List(ctx)
	activeSkills := 0
	for _, sk := range all {
		if sk.Active {
			activeSkills++
		}
	}
	assignments, _ := a.Roles.Count(ctx)
	open, _ := a.Feedback.OpenCount(ctx)
	writeJSON(w, 200, map[string]any{
		"provider": a.Cfg.Auth, "baseUrl": a.Cfg.BaseURL, "notify": a.Cfg.Notify,
		"processes": count(docs.Process), "standards": count(docs.Standard), "skills": activeSkills,
		"assignments": assignments, "openFeedback": open,
	})
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
	owner := ""
	if d, err := a.Docs.Get(r.Context(), sk.SourceKind, sk.SourceID); err == nil {
		owner = ownerOf(d.Body)
	}
	return who(r).CanEdit(sk.SourceKind, owner)
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
	if d, err := a.Docs.Get(r.Context(), sk.SourceKind, sk.SourceID); err == nil {
		a.syncSkills(r, sk.SourceKind, sk.SourceID, &d)
	}
	a.writeSkill(w, r, sk.ID)
}
