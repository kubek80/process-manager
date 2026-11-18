-- What a process or standard belongs to, and its status, read from the body once when it is
-- stored, so that "which documents are drafts" is answered without reading every body.
alter table documents add column status   text generated always as (coalesce(body->>'status', '')) stored;
alter table documents add column owner    text generated always as (coalesce(body->>'owner', '')) stored;
alter table documents add column platform text generated always as (coalesce(body->>'platform', '')) stored;
alter table documents add column practice text generated always as (coalesce(body->>'practice', '')) stored;
create index documents_drafts on documents (kind, id) where status = 'draft';

-- Views: the key starts with the person within a document, so that "has this person viewed it
-- before" is one index lookup; the period queries read (day, kind, id, email) from an index alone.
alter table document_views drop constraint document_views_pkey;
alter table document_views add primary key (kind, id, email, day);
drop index document_views_day;
create index document_views_day on document_views (day, kind, id, email);

-- Skill downloads: one per person per skill per day, like views. The person is kept only to
-- count; an export has no person (''). Downloads stored before this have no person either and
-- are kept as they were counted.
alter table skill_downloads add column email text not null default '';
alter table skill_downloads add column day date;
update skill_downloads set day = (at at time zone 'UTC')::date;
alter table skill_downloads alter column day set not null;
drop index skill_downloads_at;
create index skill_downloads_day on skill_downloads (day);
create unique index skill_downloads_once_a_day on skill_downloads (skill_id, email, day) where via = 'download' and email <> '';

-- All-time numbers per document, kept up to date in the transaction that records a view or a
-- download, so that reading them never depends on how many were ever recorded. Rows of deleted
-- documents are removed with them.
create table document_counts (
  kind      text not null check (kind in ('process', 'standard')),
  id        text not null,
  views     int  not null default 0,
  people    int  not null default 0,
  downloads int  not null default 0,
  primary key (kind, id)
);
insert into document_counts (kind, id, views, people)
  select kind, id, count(*), count(distinct email) from document_views where id not like '%@deleted-%' group by kind, id;
insert into document_counts (kind, id, downloads)
  select source_kind, source_id, count(*) from skill_downloads where source_id not like '%@deleted-%' group by source_kind, source_id
  on conflict (kind, id) do update set downloads = excluded.downloads;

-- Requests: the answer of a done request that was deleted afterwards.
alter table requests add column linked_gone boolean not null default false;
-- Requests that were withdrawn or removed still count for the brake of the hour they were made in.
create table requests_removed (
  email      text not null,
  created_at timestamptz not null
);
create index requests_removed_email on requests_removed (email, created_at);
