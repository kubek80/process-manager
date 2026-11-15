package auth

// DevUser is a built-in identity for local development (PM_AUTH=dev).
type DevUser struct {
	User
	About string `json:"about"`
}

// DevUsers each exercise a different set of rights. DevRoles gives them their roles the
// first time a local database is started; Dana is admin through the server settings.
var DevUsers = []DevUser{
	{User{"sam@example.com", "Sam Consumer"}, "Follows processes and reports problems"},
	{User{"alex@example.com", "Alex Editor"}, "Edits processes and the lists"},
	{User{"casey@example.com", "Casey Owner"}, "Member of the Cloud Platform team: closes feedback on what it owns"},
	{User{"riley@example.com", "Riley Security"}, "Cyber Security: edits that unit's standards"},
	{User{"dana@example.com", "Dana Admin"}, "Admin: everything, including who has access"},
}

// DevRole is a role given to a built-in user.
type DevRole struct{ Email, Role, Scope string }

// DevRoles are stored when a development database has no roles yet.
var DevRoles = []DevRole{
	{"alex@example.com", "process-editor", ""},
	{"alex@example.com", "catalog-manager", ""},
	{"casey@example.com", "owner", "cloud-platform-team"},
	{"riley@example.com", "standards-editor", "security"},
	{"riley@example.com", "owner", "security"},
}

// DevUserByEmail finds a built-in user.
func DevUserByEmail(email string) (User, bool) {
	for _, u := range DevUsers {
		if u.Email == email {
			return u.User, true
		}
	}
	return User{}, false
}
