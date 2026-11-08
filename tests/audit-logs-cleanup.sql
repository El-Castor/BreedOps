-- Disposable local test fixtures only. Everything is rolled back.
-- Regression for migration 000024: audit_logs had an invalid
-- update_updated_at_column() trigger attached (audit_logs has no
-- updated_at column) that only ever fired via a referential action - e.g.
-- deleting an organization that still has audit_logs rows cascades
-- ON DELETE SET NULL onto audit_logs.organization_id, which used to raise
--   ERROR: record "new" has no field "updated_at"
-- and abort the whole DELETE. This is exactly the path
-- tests/db-cleanup.ts's hardDeleteOrganization() exercises in every
-- integration/e2e test's own cleanup.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO organizations (id, name, slug)
VALUES ('aaaaaaaa-0000-0000-0000-00000000a024', 'Audit trigger regression', 'audit-trigger-regression-000024');

INSERT INTO audit_logs (id, organization_id, entity_type, entity_id, action)
VALUES ('bbbbbbbb-0000-0000-0000-00000000a024', 'aaaaaaaa-0000-0000-0000-00000000a024', 'organizations', 'aaaaaaaa-0000-0000-0000-00000000a024', 'created');

SELECT lives_ok($$
  DELETE FROM organizations WHERE id = 'aaaaaaaa-0000-0000-0000-00000000a024'
$$, 'deleting an organization with existing audit_logs rows no longer raises the invalid updated_at trigger error');

SELECT results_eq($$
  SELECT count(*)::int FROM audit_logs WHERE id = 'bbbbbbbb-0000-0000-0000-00000000a024'
$$, ARRAY[1], 'the audit row itself is never deleted by the organization cascade (append-only, by design)');

SELECT results_eq($$
  SELECT organization_id FROM audit_logs WHERE id = 'bbbbbbbb-0000-0000-0000-00000000a024'
$$, ARRAY[NULL::uuid], 'its organization_id reference is correctly nulled by ON DELETE SET NULL, not left dangling');

-- Existing audit functionality (a plain INSERT, the only write path any
-- application code actually uses) still works after the trigger removal.
SELECT lives_ok($$
  INSERT INTO audit_logs (entity_type, entity_id, action)
  VALUES ('organizations', 'cccccccc-0000-0000-0000-00000000a024', 'created')
$$, 'a normal audit_logs insert still succeeds after the invalid trigger is dropped');

-- The trigger is confirmed gone, not merely non-erroring by coincidence -
-- queried directly from the catalog rather than relying on a pgtap helper
-- function of uncertain availability in this installation.
SELECT results_eq($$
  SELECT count(*)::int FROM pg_trigger
  WHERE tgrelid = 'public.audit_logs'::regclass
    AND tgname = 'update_audit_logs_updated_at'
    AND NOT tgisinternal
$$, ARRAY[0], 'the invalid update_audit_logs_updated_at trigger no longer exists on audit_logs');

-- This migration is scoped to audit_logs alone - an unrelated table's own
-- updated_at trigger (a genuinely mutable table, unlike audit_logs) is
-- untouched.
SELECT results_eq($$
  SELECT count(*)::int FROM pg_trigger
  WHERE tgrelid = 'public.organizations'::regclass
    AND tgname = 'update_organizations_updated_at'
    AND NOT tgisinternal
$$, ARRAY[1], 'an unrelated table''s own updated_at trigger is unaffected by this migration');

SELECT * FROM finish();
ROLLBACK;
