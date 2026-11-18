-- Icons of tools and languages in the lists. An icon is stored once, under the SHA-256 of its
-- bytes; the server checks it before storing it (kind, size, square, plain drawing for SVG).
create table icons (
  id           text primary key check (id ~ '^[a-f0-9]{64}$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  width        int  not null check (width > 0),
  height       int  not null check (height > 0),
  data         bytea not null check (octet_length(data) between 1 and 65536),
  created_by   text not null default '',
  created_at   timestamptz not null default now()
);

-- The names of people in Admin > Access come from what they last did: one index lookup per person.
create index audit_log_actor on audit_log (actor_email, id desc);
