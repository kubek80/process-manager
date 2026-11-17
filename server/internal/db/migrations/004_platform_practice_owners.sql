-- Owners of a platform or a practice: scope is the id of the platform or practice.
alter table role_assignments drop constraint role_assignments_role_check;
alter table role_assignments add constraint role_assignments_role_check
  check (role in ('admin', 'catalog-manager', 'process-editor', 'standards-editor', 'owner', 'platform-owner', 'practice-owner'));
