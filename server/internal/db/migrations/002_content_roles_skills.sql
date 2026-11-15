-- Feedback can now be about a process or a standard.
alter table feedback rename column process_id to target_id;
alter table feedback add column target_kind text not null default 'process' check (target_kind in ('process', 'standard'));
drop index feedback_process;
create index feedback_target on feedback (target_kind, target_id);

-- Content: processes, standards and the lists (one "catalog" document).
-- body is `json`, not `jsonb`, so the order of the keys is kept as the author wrote it.
create table documents (
  kind       text not null check (kind in ('process', 'standard', 'catalog')),
  id         text not null,
  version    int  not null,
  body       json not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (kind, id)
);

-- Every saved version, for history and restore. A null body records a deletion.
create table document_versions (
  kind     text not null,
  id       text not null,
  version  int  not null,
  body     json,
  saved_at timestamptz not null default now(),
  saved_by text not null,
  primary key (kind, id, version)
);

-- Who may do what. scope is a team or unit id where the role is limited to one, else ''.
create table role_assignments (
  email      text not null,
  role       text not null check (role in ('admin', 'catalog-manager', 'process-editor', 'standards-editor', 'owner')),
  scope      text not null default '',
  granted_by text not null,
  granted_at timestamptz not null default now(),
  primary key (email, role, scope)
);

create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_email text not null,
  actor_name  text not null,
  action      text not null,
  target      text not null,
  detail      text not null default ''
);
create index audit_log_at on audit_log (at desc);

-- Skills and review agents generated from processes and standards.
create table skills (
  id          text primary key,
  kind        text not null check (kind in ('skill', 'review-agent')),
  source_kind text not null check (source_kind in ('process', 'standard')),
  source_id   text not null,
  title       text not null,
  extra       text not null default '',   -- hand-written guidance, kept across versions
  active      boolean not null default true, -- false when the source is a draft, retired or deleted
  version     int not null default 0,
  updated_at  timestamptz not null default now()
);
create index skills_source on skills (source_kind, source_id);

create table skill_versions (
  skill_id       text not null references skills (id) on delete cascade,
  version        int  not null,
  content        text not null,
  content_hash   text not null,
  source_version int  not null,
  created_at     timestamptz not null default now(),
  primary key (skill_id, version)
);
