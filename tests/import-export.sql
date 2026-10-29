-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(40);

INSERT INTO organizations(id,name,slug) VALUES
 ('23333333-0000-0000-0000-0000000000a1','Import A','import-test-a'),
 ('23333333-0000-0000-0000-0000000000a2','Import B','import-test-b');
INSERT INTO auth.users(id) VALUES
 ('24444444-0000-0000-0000-0000000000a1'),('24444444-0000-0000-0000-0000000000a2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('24444444-0000-0000-0000-0000000000a1','23333333-0000-0000-0000-0000000000a1','team_admin'),
 ('24444444-0000-0000-0000-0000000000a2','23333333-0000-0000-0000-0000000000a2','team_admin');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('25555555-0000-0000-0000-0000000000a1','23333333-0000-0000-0000-0000000000a1','IMPA1','Import Program A1'),
 ('25555555-0000-0000-0000-0000000000a9','23333333-0000-0000-0000-0000000000a2','IMPB1','Import Program B1 (other org)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','24444444-0000-0000-0000-0000000000a1',true);

-- ───────────────────────── Parent Lines ─────────────────────────
SELECT lives_ok($$
  SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"parent_code":"IMPA1-P-0001","line_name":"Ligne A"},
      {"row_index":2,"line_name":"Ligne auto-code"}]'::jsonb)
$$,'parent lines: explicit code and auto-generated code both create');

SELECT results_eq($$
  SELECT count(*)::int FROM parent_lines WHERE program_id='25555555-0000-0000-0000-0000000000a1'
$$, ARRAY[2], 'exactly two parent lines exist after the first import');

SELECT lives_ok($$
  SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"parent_code":"IMPA1-P-0001","line_name":"Ligne A renommee"}]'::jsonb)
$$,'re-importing the same parent_code updates instead of duplicating');

SELECT results_eq($$
  SELECT count(*)::int FROM parent_lines WHERE program_id='25555555-0000-0000-0000-0000000000a1'
$$, ARRAY[2], 'idempotent re-import did not create a duplicate');

SELECT results_eq($$
  SELECT line_name FROM parent_lines WHERE parent_code='IMPA1-P-0001'
$$, ARRAY['Ligne A renommee'], 'the mutable field was actually updated by the re-import');

-- Archive one parent, then prove it can no longer be updated via import.
UPDATE parent_lines SET deleted_at = now() WHERE parent_code = 'IMPA1-P-0001';
SELECT throws_ok($$
  SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"parent_code":"IMPA1-P-0001","line_name":"Should not apply"}]'::jsonb)
$$, '23514', null, 'importing against an archived parent is rejected');
SELECT results_eq($$
  SELECT line_name FROM parent_lines WHERE parent_code='IMPA1-P-0001'
$$, ARRAY['Ligne A renommee'], 'the archived row was not silently updated');
UPDATE parent_lines SET deleted_at = NULL WHERE parent_code = 'IMPA1-P-0001';

-- A second parent for the cross below.
SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a1',
  '[{"row_index":1,"parent_code":"IMPA1-P-0099","line_name":"Ligne B"}]'::jsonb);

-- ───────────────────────── Crosses ─────────────────────────
SELECT lives_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"cross_code":"IMPA1-X-0001","female_parent_code":"IMPA1-P-0001","male_parent_code":"IMPA1-P-0099","priority":"high"}]'::jsonb)
$$,'cross created by resolving both parent business codes');

SELECT throws_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"cross_code":"IMPA1-X-0099","female_parent_code":"IMPA1-P-0001","male_parent_code":"NO-SUCH-CODE"}]'::jsonb)
$$, '23503', null, 'an unresolved parent reference is rejected, not silently skipped');

SELECT results_eq($$
  SELECT count(*)::int FROM crosses WHERE cross_code='IMPA1-X-0099'
$$, ARRAY[0], 'the failed row created nothing');

SELECT lives_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"cross_code":"IMPA1-X-0001","priority":"medium","target_traits":"yield"}]'::jsonb)
$$,'re-importing an existing cross by code updates mutable fields');
SELECT results_eq($$
  SELECT priority FROM crosses WHERE cross_code='IMPA1-X-0001'
$$, ARRAY['medium'], 'the mutable priority field was updated');

SELECT throws_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"cross_code":"IMPA1-X-0001","female_parent_code":"IMPA1-P-0099","male_parent_code":"IMPA1-P-0001"}]'::jsonb)
$$, '23514', null, 'attempting to change an existing cross''s parents (immutable identity) via import is rejected');

-- Atomic rollback: batch of two rows where the second is invalid must not apply the first either.
SELECT throws_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"cross_code":"IMPA1-X-0002","female_parent_code":"IMPA1-P-0001","male_parent_code":"IMPA1-P-0099"},
      {"row_index":2,"cross_code":"IMPA1-X-0003","female_parent_code":"IMPA1-P-0001","male_parent_code":"NO-SUCH-CODE"}]'::jsonb)
$$, '23503', null, 'a batch with one bad row raises');
SELECT results_eq($$
  SELECT count(*)::int FROM crosses WHERE cross_code='IMPA1-X-0002'
$$, ARRAY[0], 'the earlier, otherwise-valid row in the same batch was rolled back too');

-- ───────────────────────── Families / Seed Lots / Phenotypes ─────────────────────────
SELECT lives_ok($$
  SELECT import_families('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"family_code":"IMPA1-F-0001","cross_code":"IMPA1-X-0001"}]'::jsonb)
$$,'family created by resolving the cross business code');

SELECT throws_ok($$
  SELECT import_families('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"family_code":"IMPA1-F-0002","cross_code":"NO-SUCH-CROSS"}]'::jsonb)
$$, '23503', null, 'an unresolved cross reference is rejected');

SELECT lives_ok($$
  SELECT import_seed_lots('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"seed_lot_code":"IMPA1-L-0001","family_code":"IMPA1-F-0001","quantity_unit":"seeds"}]'::jsonb)
$$,'seed lot created by resolving the family business code');

SELECT lives_ok($$
  SELECT import_phenotypes('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"phenotype_code":"IMPA1-I-0001","family_code":"IMPA1-F-0001","seed_lot_code":"IMPA1-L-0001","block":"B1"}]'::jsonb)
$$,'phenotype created by resolving family and seed lot business codes');

SELECT throws_ok($$
  SELECT import_phenotypes('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"phenotype_code":"IMPA1-I-0001","family_code":"IMPA1-F-0001","seed_lot_code":"NO-SUCH-LOT"}]'::jsonb)
$$, '23503', null, 'changing to an unresolved seed lot on update is rejected before any identity check');

-- ───────────────────────── Inventory Lots ─────────────────────────
INSERT INTO inventory_items(id,organization_id,name,default_unit) VALUES
 ('26666666-0000-0000-0000-0000000000a1','23333333-0000-0000-0000-0000000000a1','Agar poudre','g');

SELECT lives_ok($$
  SELECT import_inventory_lots('23333333-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"item_name":"Agar poudre","batch_number":"LOT-0001","initial_quantity":500}]'::jsonb)
$$,'inventory lot created with an initial receipt movement');

SELECT results_eq($$
  SELECT current_quantity FROM inventory_lots WHERE batch_number='LOT-0001'
$$, ARRAY[500::numeric], 'current_quantity reflects the receipt movement via the existing trigger, not a direct write');

SELECT throws_ok($$
  SELECT import_inventory_lots('23333333-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"item_name":"No Such Item","batch_number":"LOT-0002"}]'::jsonb)
$$, '23503', null, 'an unresolved inventory item name is rejected (no fuzzy matching)');

INSERT INTO inventory_items(id,organization_id,name,default_unit) VALUES
 ('26666666-0000-0000-0000-0000000000a2','23333333-0000-0000-0000-0000000000a1','AGAR POUDRE','g');
SELECT throws_ok($$
  SELECT import_inventory_lots('23333333-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"item_name":"Agar poudre","batch_number":"LOT-0003"}]'::jsonb)
$$, '23505', null, 'an ambiguous (case-insensitive duplicate) item name is rejected rather than guessed');
DELETE FROM inventory_items WHERE id = '26666666-0000-0000-0000-0000000000a2';

-- ───────────────────────── Tasks ─────────────────────────
INSERT INTO experimental_cycles(id,program_id,name,start_date,end_date) VALUES
 ('27777777-0000-0000-0000-0000000000a1','25555555-0000-0000-0000-0000000000a1','Cycle Test','2026-01-01','2026-12-31');

SELECT throws_ok($$
  SELECT import_tasks('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"task_code":"IMPA1-T-0000","title":"Sans cycle"}]'::jsonb)
$$, '23502', null, 'creating a task without an experimental cycle name is rejected (every task belongs to a cycle)');

SELECT lives_ok($$
  SELECT import_tasks('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"task_code":"IMPA1-T-0001","title":"Semis","priority":"high","cycle_name":"Cycle Test"}]'::jsonb)
$$,'task created with a new business code');

SELECT results_eq($$
  SELECT status FROM tasks WHERE task_code='IMPA1-T-0001'
$$, ARRAY['not_started'], 'a manually imported task starts not_started, never accepted from the row');

SELECT lives_ok($$
  SELECT import_tasks('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"task_code":"IMPA1-T-0001","priority":"low"}]'::jsonb)
$$,'re-importing the same task_code updates instead of duplicating');
SELECT results_eq($$
  SELECT count(*)::int FROM tasks WHERE task_code='IMPA1-T-0001'
$$, ARRAY[1], 'idempotent re-import did not create a duplicate task');

SELECT throws_ok($$
  SELECT import_tasks('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"task_code":"IMPA1-T-0002","title":"Arrosage","cycle_name":"No Such Cycle"}]'::jsonb)
$$, '23503', null, 'an unresolved experimental cycle name is rejected');

-- ───────────────────────── Cross-team isolation ─────────────────────────
SELECT throws_ok($$
  SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a9',
    '[{"row_index":1,"line_name":"Should never be written"}]'::jsonb)
$$, '42501', null, 'importing into a program owned by another team is forbidden, independent of RLS alone');
SELECT results_eq($$
  SELECT count(*)::int FROM parent_lines WHERE program_id='25555555-0000-0000-0000-0000000000a9'
$$, ARRAY[0], 'nothing was written to the other team''s program');

SELECT throws_ok($$
  SELECT import_inventory_lots('23333333-0000-0000-0000-0000000000a2',
    '[{"row_index":1,"item_name":"Agar poudre","batch_number":"LOT-0009"}]'::jsonb)
$$, '42501', null, 'importing inventory into another team''s organization is forbidden');

-- ───────────────────────── Cross-program leakage ─────────────────────────
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('25555555-0000-0000-0000-0000000000a2','23333333-0000-0000-0000-0000000000a1','IMPA2','Import Program A2 (same org)');
SELECT throws_ok($$
  SELECT import_crosses('25555555-0000-0000-0000-0000000000a2',
    '[{"row_index":1,"cross_code":"IMPA2-X-0001","female_parent_code":"IMPA1-P-0001","male_parent_code":"IMPA1-P-0099"}]'::jsonb)
$$, '23503', null, 'a parent code from a sibling program in the same team cannot be resolved across programs');

-- ───────────────────────── Audit scope integrity (000021) ─────────────────────────
SELECT lives_ok($$
  SELECT record_import_export_event(
    '23333333-0000-0000-0000-0000000000a1', '25555555-0000-0000-0000-0000000000a1',
    'export', 'parent_lines', '{"format":"csv"}'::jsonb)
$$, 'a valid same-organization program pairing is accepted');
SELECT results_eq($$
  SELECT count(*)::int FROM audit_logs
  WHERE organization_id='23333333-0000-0000-0000-0000000000a1'
    AND program_id='25555555-0000-0000-0000-0000000000a1'
    AND action='export' AND entity_type='parent_lines'
$$, ARRAY[1], 'the matching audit_logs row was actually written');

SELECT throws_ok($$
  SELECT record_import_export_event(
    '23333333-0000-0000-0000-0000000000a1', '25555555-0000-0000-0000-0000000000a9',
    'export', 'parent_lines', '{"format":"csv"}'::jsonb)
$$, '42501', null, 'pairing the caller''s own organization with another team''s program is rejected, not recorded');
SELECT results_eq($$
  SELECT count(*)::int FROM audit_logs
  WHERE organization_id='23333333-0000-0000-0000-0000000000a1'
    AND program_id='25555555-0000-0000-0000-0000000000a9'
$$, ARRAY[0], 'the forged pairing produced no audit_logs row at all');

-- ───────────────────────── Import + audit atomicity (000021) ─────────────────────────
-- Four distinct new codes make total_rows=4 a value no other import_parent_lines
-- call in this file produces, so the assertion below can select the exact
-- matching audit row by content instead of by recency. Recency (ORDER BY
-- created_at DESC) is not reliable here: Postgres's now() returns the same
-- transaction-start timestamp for every statement inside this single
-- BEGIN...ROLLBACK test transaction, so every audit_logs row written in this
-- file ties on created_at and "most recent" is not actually well-defined.
SELECT lives_ok($$
  SELECT import_parent_lines('25555555-0000-0000-0000-0000000000a1',
    '[{"row_index":1,"parent_code":"IMPA1-P-0501","line_name":"Audit atomicity check 1"},
      {"row_index":2,"parent_code":"IMPA1-P-0502","line_name":"Audit atomicity check 2"},
      {"row_index":3,"parent_code":"IMPA1-P-0503","line_name":"Audit atomicity check 3"},
      {"row_index":4,"parent_code":"IMPA1-P-0504","line_name":"Audit atomicity check 4"}]'::jsonb)
$$, 'import succeeds and, per migration 000021, also records its own audit event in the same transaction');
SELECT results_eq($$
  SELECT new_values->>'created', new_values->>'total_rows' FROM audit_logs
  WHERE organization_id='23333333-0000-0000-0000-0000000000a1'
    AND program_id='25555555-0000-0000-0000-0000000000a1'
    AND action='import' AND entity_type='parent_lines'
    AND new_values->>'total_rows' = '4'
$$, $$VALUES ('4','4')$$, 'this exact import''s audit event recorded a correct created count, with no separate RPC call from the application layer');

SELECT * FROM finish();
ROLLBACK;
