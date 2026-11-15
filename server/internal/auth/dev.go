package auth

// DevUser is a built-in identity for local development (PM_AUTH=dev).
type DevUser struct {
	User
	About string `json:"about"`
}

// DevUsers match the sample config/access.json, so each one exercises a different set of rights.
var DevUsers = []DevUser{
	{User{"sam@example.com", "Sam Consumer"}, "Follows processes and reports problems"},
	{User{"alex@example.com", "Alex Editor"}, "Editor: can change processes and the lists"},
	{User{"casey@example.com", "Casey Owner"}, "Member of the Cloud Platform team, which owns “Request a GCP project”"},
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
