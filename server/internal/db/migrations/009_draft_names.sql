-- The name of whoever saved a working draft last, as the sign-in gave it at that moment ('' when
-- it was not known), so that the app can show a name instead of an email address.
alter table working_drafts add column updated_by_name text not null default '';
