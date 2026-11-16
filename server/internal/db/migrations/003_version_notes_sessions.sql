-- A short note with every saved version: what changed and why.
alter table document_versions add column note text not null default '';

-- Signing out ends every session of that person that was issued before this moment.
create table signed_out (
  email text primary key,
  at    timestamptz not null
);
