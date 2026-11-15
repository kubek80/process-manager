create table feedback (
  id           uuid primary key default gen_random_uuid(),
  process_id   text not null,
  step_id      text,
  kind         text not null check (kind in ('broken', 'outdated', 'unclear', 'idea')),
  body         text not null,
  author_email text not null,
  author_name  text not null,
  -- fingerprint of the step when the feedback was written; lets us tell that the step changed since
  step_hash    text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text
);
create index feedback_process on feedback (process_id);

-- "I hit this as well": one row per person per feedback item
create table feedback_also_hit (
  feedback_id uuid not null references feedback (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, email)
);
