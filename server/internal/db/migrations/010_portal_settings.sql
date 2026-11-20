-- Settings of the portal that admins change in the Admin panel. One row per setting; today only
-- 'theme', the look of the portal (Admin > Theming): only what the admin chose (name, logo,
-- colours, appearance), as JSON; the colours derived from it are worked out by the app.
-- `revision` counts the saves: a save says which revision it was made from.
create table portal_settings (
  key             text primary key check (key in ('theme')),
  value           jsonb not null,
  revision        int not null check (revision > 0),
  updated_by      text not null default '',
  updated_by_name text not null default '',
  updated_at      timestamptz not null default now()
);
