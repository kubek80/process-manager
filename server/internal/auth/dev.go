package auth

// DevUser is a built-in identity for local development (PM_AUTH=dev).
type DevUser struct {
	User
	About string `json:"about"`
}

// DevUsers each exercise a different set of rights. Their lines name the roles as Admin > Access
// does ("Owner for Cloud Platform team"). DevRoles gives them their roles the
// first time a local database is started; Dana is admin through the server settings.
var DevUsers = []DevUser{
	{User{"sam@example.com", "Sam Consumer"}, "Reader: follows processes and reports problems"},
	{User{"alex@example.com", "Alex Editor"}, "Process editor and Lists manager: edits every process and the lists"},
	{User{"casey@example.com", "Casey Owner"}, "Owner for Cloud Platform team: confirms the reviews and answers the feedback of what the team maintains"},
	{User{"riley@example.com", "Riley Security"}, "Practice owner for Cyber security and Owner for Cyber Security: edits what belongs to the practice"},
	{User{"jordan@example.com", "Jordan Platform"}, "Platform owner for Google Cloud, Practice owner for Engineering and Owner for Cloud Platform team"},
	{User{"morgan@example.com", "Morgan Member"}, "Platform member for Google Cloud and Practice member for Engineering: drafts what belongs to them, an owner publishes"},
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
	{"morgan@example.com", "platform-member", "google-cloud"},
	{"morgan@example.com", "practice-member", "engineering"},
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
