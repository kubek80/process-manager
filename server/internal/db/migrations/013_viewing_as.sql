-- An admin viewing the portal as another person: one row per session of the admin, named by
-- the session's id. It ends at `until`, when the admin stops or signs out, and when a request
-- finds that the admin is no longer an admin or the person no longer has a role. A row never
-- gives anybody a right: while it is there, the admin's session can only read.
create table if not exists viewing_as (
  email       text not null,                 -- the admin
  session     text not null,                 -- which session of the admin
  target      text not null,                 -- the person whose view it is
  target_name text not null default '',      -- their name where the portal knew it
  started_at  timestamptz not null,
  until       timestamptz not null,
  primary key (email, session)
);
