-- Members of a platform or a practice: they write drafts of what belongs to it, an owner
-- publishes. Scope is the id of the platform or practice.
alter table role_assignments drop constraint role_assignments_role_check;
alter table role_assignments add constraint role_assignments_role_check
  check (role in ('admin', 'catalog-manager', 'process-editor', 'standards-editor', 'owner', 'platform-owner', 'practice-owner',
                  'platform-member', 'practice-member'));
