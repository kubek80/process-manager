-- A version that published changes somebody else saved last remembers that person (the
-- publisher is saved_by), with their name as the sign-in gave it when known. Empty for every
-- other version, also for the versions stored before.
alter table document_versions add column if not exists changes_by text not null default '';
alter table document_versions add column if not exists changes_by_name text not null default '';
