-- How processes and standards are used, and what people ask for.
-- Emails are stored in lower case, like in role_assignments.

-- Views: one row per person per document per day (the server's date, UTC). Kept only to count
-- views and different people; never shown per person. Rows stay when the document is deleted,
-- so that the totals of a period do not change afterwards, but their id is marked
-- ("<id>@deleted-<n>"), so that a new document under the same id starts from nothing.
create table document_views (
  kind  text not null check (kind in ('process', 'standard')),
  id    text not null,
  day   date not null,
  email text not null,
  primary key (kind, id, day, email)
);
create index document_views_day on document_views (day);

-- Bookmarks and upvotes: one per person per document. They are removed with the document.
create table bookmarks (
  email      text not null,
  kind       text not null check (kind in ('process', 'standard')),
  id         text not null,
  created_at timestamptz not null default now(),
  primary key (email, kind, id)
);
create index bookmarks_target on bookmarks (kind, id);

create table upvotes (
  email      text not null,
  kind       text not null check (kind in ('process', 'standard')),
  id         text not null,
  created_at timestamptz not null default now(),
  primary key (email, kind, id)
);
create index upvotes_target on upvotes (kind, id);

-- Skill downloads: one row per download from the portal or skill written by an export. Who
-- downloaded is not kept. Rows stay when the document is deleted and are marked, like views.
create table skill_downloads (
  id          bigserial primary key,
  skill_id    text not null,
  source_kind text not null check (source_kind in ('process', 'standard')),
  source_id   text not null,
  via         text not null check (via in ('download', 'export')),
  at          timestamptz not null default now()
);
create index skill_downloads_source on skill_downloads (source_kind, source_id);
create index skill_downloads_at on skill_downloads (at);

-- Requests for a process or standard that does not exist yet. platform, practice and linked_id
-- are ids, without a foreign key: a request outlives the removal of what it names.
create table requests (
  id                 bigserial primary key,
  kind               text not null check (kind in ('process', 'standard')),
  title              text not null,
  description        text not null,
  platform           text not null default '',
  practice           text not null default '',
  requested_by_email text not null,
  requested_by_name  text not null,
  created_at         timestamptz not null default now(),
  state              text not null default 'open' check (state in ('open', 'planned', 'done', 'declined')),
  state_note         text not null default '',
  state_by           text not null default '',
  state_at           timestamptz,
  linked_id          text not null default ''
);
create index requests_created on requests (created_at desc);
create index requests_requester on requests (requested_by_email, created_at);

create table request_votes (
  request_id bigint not null references requests (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (request_id, email)
);
