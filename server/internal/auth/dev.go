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
	{User{"casey@example.com", "Casey Owner"}, "Member of the Cloud Platform team: confirms reviews and closes feedback on what it owns"},
	{User{"riley@example.com", "Riley Security"}, "Owner of the Cyber security practice: edits what belongs to it; member of the Cyber Security team"},
	{User{"jordan@example.com", "Jordan Platform"}, "Owner of the Google Cloud platform and the Engineering practice: edits what belongs to them; member of the Cloud Platform team"},
	{User{"dana@example.com", "Dana Admin"}, "Admin: everything, including who has access"},
}

// DevRole is a role given to a built-in user.
type DevRole struct{ Email, Role, Scope string }

// DevRoles are given to a built-in user who has no role at all when a development server
// starts.
var DevRoles = []DevRole{
	{"alex@example.com", "process-editor", ""},
	{"alex@example.com", "catalog-manager", ""},
	{"casey@example.com", "owner", "cloud-platform-team"},
	{"riley@example.com", "practice-owner", "security"},
	{"riley@example.com", "owner", "security"},
	{"jordan@example.com", "platform-owner", "google-cloud"},
	{"jordan@example.com", "practice-owner", "engineering"},
	{"jordan@example.com", "owner", "cloud-platform-team"},
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
