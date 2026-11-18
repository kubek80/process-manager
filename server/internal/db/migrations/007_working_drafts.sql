-- Unpublished changes to a published process or standard: one shared working draft per
-- document, kept beside it. The document, its versions, skills and the search index are not
-- touched until the draft is published. body is `json`, like the documents, so the order of the
-- keys is kept. base is the version of the document the draft was started from; revision grows
-- with every save of the draft, so that two people cannot overwrite each other's changes.
-- The draft goes with its document: deleting the document deletes it in the same transaction.
create table working_drafts (
  kind       text not null check (kind in ('process', 'standard')),
  id         text not null,
  body       json not null,
  base       int  not null,
  revision   int  not null check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (kind, id),
  foreign key (kind, id) references documents (kind, id) on delete cascade
);

-- When a document was added: when the first version of it (since it was last deleted, if it
-- ever was) was saved. Kept on the document, so that a list of every document reads it without
-- going through the versions.
alter table documents add column created_at timestamptz;
update documents d set created_at = coalesce((
  select min(v.saved_at) from document_versions v
  where v.kind = d.kind and v.id = d.id and v.body is not null
    and v.version > coalesce((select max(x.version) from document_versions x where x.kind = d.kind and x.id = d.id and x.body is null), 0)
), d.updated_at);
alter table documents alter column created_at set default now();
alter table documents alter column created_at set not null;
