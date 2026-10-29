-- Disposable local test fixtures only. Everything is rolled back.
-- Covers migration 000022: seed lot lifecycle (A), eliminatory criteria (B),
-- equipment register (C) and inventory stock coverage (D).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(34);

INSERT INTO organizations(id,name,slug) VALUES
 ('b1111111-0000-0000-0000-0000000000a1','Biz A','biz-test-a'),
 ('b1111111-0000-0000-0000-0000000000a2','Biz B','biz-test-b');
INSERT INTO auth.users(id) VALUES
 ('b2222222-0000-0000-0000-0000000000a1'),('b2222222-0000-0000-0000-0000000000a2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('b2222222-0000-0000-0000-0000000000a1','b1111111-0000-0000-0000-0000000000a1','team_admin'),
 ('b2222222-0000-0000-0000-0000000000a2','b1111111-0000-0000-0000-0000000000a2','team_admin');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('b3333333-0000-0000-0000-0000000000a1','b1111111-0000-0000-0000-0000000000a1','BIZA','Biz Program A');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b2222222-0000-0000-0000-0000000000a1',true);

-- ───────────────────────── A. Seed lot lifecycle ─────────────────────────
INSERT INTO seed_lots(id,program_id,seed_lot_code,status) VALUES
  ('b4444444-0000-0000-0000-0000000000a1','b3333333-0000-0000-0000-0000000000a1','BIZA-L-0001','available');

SELECT lives_ok($$
  UPDATE seed_lots SET status = 'quarantined' WHERE id = 'b4444444-0000-0000-0000-0000000000a1'
$$, 'available -> quarantined is a valid transition');

SELECT lives_ok($$
  UPDATE seed_lots SET status = 'available' WHERE id = 'b4444444-0000-0000-0000-0000000000a1'
$$, 'quarantined -> available is a valid transition');

SELECT lives_ok($$
  UPDATE seed_lots SET status = 'depleted' WHERE id = 'b4444444-0000-0000-0000-0000000000a1'
$$, 'available -> depleted is a valid transition');

SELECT throws_ok($$
  UPDATE seed_lots SET status = 'available' WHERE id = 'b4444444-0000-0000-0000-0000000000a1'
$$, '23514', null, 'depleted is terminal: depleted -> available is rejected');

SELECT throws_ok($$
  UPDATE seed_lots SET status = 'quarantined' WHERE id = 'b4444444-0000-0000-0000-0000000000a1'
$$, '23514', null, 'depleted is terminal: depleted -> quarantined is rejected too');

INSERT INTO seed_lots(id,program_id,seed_lot_code,status) VALUES
  ('b4444444-0000-0000-0000-0000000000a2','b3333333-0000-0000-0000-0000000000a1','BIZA-L-0002','available');
SELECT throws_ok($$
  INSERT INTO seed_lots(program_id,seed_lot_code,status)
  VALUES ('b3333333-0000-0000-0000-0000000000a1','BIZA-L-0099','not_a_real_status')
$$, '23514', null, 'an undefined status value is rejected at insert by the CHECK constraint');

SELECT lives_ok($$
  UPDATE seed_lots SET status = status WHERE id = 'b4444444-0000-0000-0000-0000000000a2'
$$, 'setting a lot to its own current status is always a no-op, never rejected');

SELECT results_eq($$
  SELECT status FROM seed_lots WHERE id = 'b4444444-0000-0000-0000-0000000000a2'
$$, ARRAY['available'], 'the lifecycle status is independent of genetic_purity_status, which keeps its own unrelated default');

UPDATE seed_lots SET deleted_at = NOW() WHERE id = 'b4444444-0000-0000-0000-0000000000a2';
SELECT results_eq($$
  SELECT status FROM seed_lots WHERE id = 'b4444444-0000-0000-0000-0000000000a2'
$$, ARRAY['available'], 'archiving a lot (deleted_at) leaves its operational status untouched: archival stays a separate axis');
UPDATE seed_lots SET deleted_at = NULL WHERE id = 'b4444444-0000-0000-0000-0000000000a2';

-- update_seed_lot_status: the application's own entry point, atomic with its audit event.
SELECT lives_ok($$
  SELECT update_seed_lot_status('b4444444-0000-0000-0000-0000000000a2', 'quarantined')
$$, 'update_seed_lot_status applies a valid transition');
SELECT results_eq($$
  SELECT action, entity_type, old_values, new_values FROM audit_logs WHERE entity_id = 'b4444444-0000-0000-0000-0000000000a2'
$$, $$VALUES ('modification'::text, 'seed_lots'::text, '{"status":"available"}'::jsonb, '{"status":"quarantined"}'::jsonb)$$,
  'the status change through the RPC is recorded in audit_logs, atomically with the mutation');
SELECT throws_ok($$
  SELECT update_seed_lot_status('b4444444-0000-0000-0000-0000000000a1', 'quarantined')
$$, '23514', null, 'update_seed_lot_status rejects an invalid transition (the lot is already depleted) just like a direct UPDATE would');
SELECT results_eq($$
  SELECT count(*)::int FROM audit_logs WHERE entity_id = 'b4444444-0000-0000-0000-0000000000a1'
$$, ARRAY[0], 'the rejected transition attempt through the RPC wrote no audit row either');

-- ───────────────────────── B. Eliminatory criteria ─────────────────────────
INSERT INTO phenotypes(id,program_id,phenotype_code) VALUES
  ('b5555555-0000-0000-0000-0000000000a1','b3333333-0000-0000-0000-0000000000a1','BIZA-PH-0001');

-- A separate, single-criterion model isolates the "no eliminatory gate at
-- all" base case from the multi-criterion scenarios below, so neither test
-- can accidentally depend on the other's sequencing.
INSERT INTO selection_models(id,program_id,name,version,maximum_score,is_active) VALUES
  ('b6666666-0000-0000-0000-0000000000a0','b3333333-0000-0000-0000-0000000000a1','Modele Simple','1.0',10,true);
INSERT INTO selection_criteria(id,selection_model_id,code,name,coefficient,minimum_value,maximum_value,is_eliminatory,eliminatory_threshold) VALUES
  ('b7777777-0000-0000-0000-0000000000a0','b6666666-0000-0000-0000-0000000000a0','architecture','Architecture',1,0,10,false,NULL);
INSERT INTO selection_decision_rules(selection_model_id,decision,minimum_weighted_score,minimum_stability_score,display_order) VALUES
  ('b6666666-0000-0000-0000-0000000000a0','elite',8,0,1),
  ('b6666666-0000-0000-0000-0000000000a0','eliminate',0,0,2);
INSERT INTO phenotype_evaluations(id,phenotype_id,selection_model_id,evaluator_id,evaluation_date,validation_status)
SELECT 'b8888888-0000-0000-0000-0000000000a0','b5555555-0000-0000-0000-0000000000a1','b6666666-0000-0000-0000-0000000000a0',p.id,CURRENT_DATE,'draft'
FROM profiles p WHERE p.user_id = 'b2222222-0000-0000-0000-0000000000a1';
INSERT INTO phenotype_scores(phenotype_evaluation_id,criterion_id,raw_score) VALUES
  ('b8888888-0000-0000-0000-0000000000a0','b7777777-0000-0000-0000-0000000000a0',9);
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a0'
$$, $$VALUES ('elite'::text, false)$$,
  'a model with only a normal (non-eliminatory) criterion decides on the weighted score alone, with no elimination');

-- The full model: one normal criterion plus two eliminatory ones, every
-- criterion scored from the first insert so neither starts out "missing".
INSERT INTO selection_models(id,program_id,name,version,maximum_score,is_active) VALUES
  ('b6666666-0000-0000-0000-0000000000a1','b3333333-0000-0000-0000-0000000000a1','Modele Test','1.0',100,true);
INSERT INTO selection_criteria(id,selection_model_id,code,name,coefficient,minimum_value,maximum_value,is_eliminatory,eliminatory_threshold) VALUES
  ('b7777777-0000-0000-0000-0000000000a1','b6666666-0000-0000-0000-0000000000a1','yield','Rendement',10,0,10,false,NULL),
  ('b7777777-0000-0000-0000-0000000000a2','b6666666-0000-0000-0000-0000000000a1','sanitary','Qualite sanitaire',1,0,10,true,5),
  ('b7777777-0000-0000-0000-0000000000a3','b6666666-0000-0000-0000-0000000000a1','stability2','Stabilite2',1,0,10,true,6);
INSERT INTO selection_decision_rules(selection_model_id,decision,minimum_weighted_score,minimum_stability_score,display_order) VALUES
  ('b6666666-0000-0000-0000-0000000000a1','elite',90,0,1),
  ('b6666666-0000-0000-0000-0000000000a1','eliminate',0,0,2);
INSERT INTO phenotype_evaluations(id,phenotype_id,selection_model_id,evaluator_id,evaluation_date,validation_status)
SELECT 'b8888888-0000-0000-0000-0000000000a1','b5555555-0000-0000-0000-0000000000a1','b6666666-0000-0000-0000-0000000000a1',p.id,CURRENT_DATE,'draft'
FROM profiles p WHERE p.user_id = 'b2222222-0000-0000-0000-0000000000a1';

-- Every eliminatory criterion above its threshold: a high score is kept.
INSERT INTO phenotype_scores(phenotype_evaluation_id,criterion_id,raw_score) VALUES
  ('b8888888-0000-0000-0000-0000000000a1','b7777777-0000-0000-0000-0000000000a1',10),
  ('b8888888-0000-0000-0000-0000000000a1','b7777777-0000-0000-0000-0000000000a2',7),
  ('b8888888-0000-0000-0000-0000000000a1','b7777777-0000-0000-0000-0000000000a3',10);
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a1'
$$, $$VALUES ('elite'::text, false)$$,
  'eliminatory criteria at or above their thresholds (7>=5, 10>=6) do not block an otherwise qualifying decision');

-- High score but an eliminatory criterion now fails its threshold: must still eliminate.
UPDATE phenotype_scores SET raw_score = 3 WHERE phenotype_evaluation_id = 'b8888888-0000-0000-0000-0000000000a1'
  AND criterion_id = 'b7777777-0000-0000-0000-0000000000a2';
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a1'
$$, $$VALUES ('eliminate'::text, true)$$,
  'a high weighted score (117) is overridden to eliminate when an eliminatory criterion (sanitary 3 < 5) fails');
SELECT results_eq($$
  SELECT elimination_reasons FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a1'
$$, $$VALUES (ARRAY['Qualite sanitaire : 3 < seuil éliminatoire 5'])$$,
  'the elimination reason names the failing criterion, its observed value and its threshold');

-- Eliminatory criterion passed again (raised back above its threshold): decision recovers.
UPDATE phenotype_scores SET raw_score = 7 WHERE phenotype_evaluation_id = 'b8888888-0000-0000-0000-0000000000a1'
  AND criterion_id = 'b7777777-0000-0000-0000-0000000000a2';
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a1'
$$, $$VALUES ('elite'::text, false)$$,
  'raising the eliminatory criterion score back above its threshold (7 >= 5) lifts the elimination');

-- Multiple eliminatory criteria failing simultaneously: both reasons recorded.
UPDATE phenotype_scores SET raw_score = 3 WHERE phenotype_evaluation_id = 'b8888888-0000-0000-0000-0000000000a1'
  AND criterion_id = 'b7777777-0000-0000-0000-0000000000a2';
UPDATE phenotype_scores SET raw_score = 2 WHERE phenotype_evaluation_id = 'b8888888-0000-0000-0000-0000000000a1'
  AND criterion_id = 'b7777777-0000-0000-0000-0000000000a3';
SELECT results_eq($$
  SELECT cardinality(elimination_reasons) FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a1'
$$, ARRAY[2], 'two simultaneously failing eliminatory criteria produce two distinct reasons, not just the first');

-- Missing value on an eliminatory criterion (never scored at all, not merely
-- low) is a fail-safe failure. A fresh evaluation that only ever scores the
-- normal criterion leaves both eliminatory criteria with no score row.
INSERT INTO phenotype_evaluations(id,phenotype_id,selection_model_id,evaluator_id,evaluation_date,validation_status)
SELECT 'b8888888-0000-0000-0000-0000000000a2','b5555555-0000-0000-0000-0000000000a1','b6666666-0000-0000-0000-0000000000a1',p.id,CURRENT_DATE,'draft'
FROM profiles p WHERE p.user_id = 'b2222222-0000-0000-0000-0000000000a1';
INSERT INTO phenotype_scores(phenotype_evaluation_id,criterion_id,raw_score) VALUES
  ('b8888888-0000-0000-0000-0000000000a2','b7777777-0000-0000-0000-0000000000a1',10);
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a2'
$$, $$VALUES ('eliminate'::text, true)$$,
  'a criterion that was never scored at all is treated as a failure on an active eliminatory criterion, never silently ignored');
SELECT results_eq($$
  SELECT elimination_reasons @> ARRAY['Qualite sanitaire : note manquante (seuil éliminatoire 5)']
  FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a2'
$$, ARRAY[true],
  'the missing-value reason names the criterion and its configured threshold');

-- A criterion marked eliminatory with no threshold configured never eliminates on its own.
UPDATE selection_criteria SET eliminatory_threshold = NULL WHERE id IN
  ('b7777777-0000-0000-0000-0000000000a2','b7777777-0000-0000-0000-0000000000a3');
SELECT lives_ok($$
  UPDATE phenotype_scores SET raw_score = raw_score WHERE phenotype_evaluation_id = 'b8888888-0000-0000-0000-0000000000a2'
    AND criterion_id = 'b7777777-0000-0000-0000-0000000000a1'
$$, 'touching the remaining score recalculates (the trigger fires on UPDATE OF raw_score even when the value is unchanged)');
SELECT results_eq($$
  SELECT automatic_decision, is_eliminated FROM phenotype_evaluations WHERE id = 'b8888888-0000-0000-0000-0000000000a2'
$$, $$VALUES ('elite'::text, false)$$,
  'once eliminatory_threshold is cleared on both never-scored criteria, there is no elimination at all');

-- ───────────────────────── C. Equipment register ─────────────────────────
INSERT INTO equipment(id,organization_id,name,category,manufacturer,operational_status) VALUES
  ('b9999999-0000-0000-0000-0000000000a1','b1111111-0000-0000-0000-0000000000a1','Autoclave A','sterilization','Tuttnauer','operational');

SELECT throws_ok($$
  INSERT INTO equipment(organization_id,name,category)
  VALUES ('b1111111-0000-0000-0000-0000000000a2','Foreign Autoclave','sterilization')
$$, null, null, 'inserting equipment into another team''s organization is rejected by RLS');

SELECT results_eq($$
  SELECT count(*)::int FROM equipment WHERE organization_id = 'b1111111-0000-0000-0000-0000000000a2'
$$, ARRAY[0], 'the rejected cross-team equipment insert wrote nothing');

SELECT lives_ok($$
  UPDATE equipment SET deleted_at = NOW() WHERE id = 'b9999999-0000-0000-0000-0000000000a1'
$$, 'archiving (deleted_at) equipment is allowed, matching the existing soft-delete convention');
SELECT results_eq($$
  SELECT count(*)::int FROM equipment WHERE id = 'b9999999-0000-0000-0000-0000000000a1'
$$, ARRAY[1], 'an archived equipment row stays readable (for inspection/restore), matching the breeding-entity read convention');
SELECT lives_ok($$
  UPDATE equipment SET deleted_at = NULL WHERE id = 'b9999999-0000-0000-0000-0000000000a1'
$$, 'restoring archived equipment is allowed');

SELECT throws_ok($$
  INSERT INTO equipment(organization_id,name,category,operational_status)
  VALUES ('b1111111-0000-0000-0000-0000000000a1','Bad Status Device','other','not_a_real_status')
$$, '23514', null, 'an undefined operational_status value is rejected by the CHECK constraint');

-- Switch to the second team to prove read isolation independently of write isolation.
SELECT set_config('request.jwt.claim.sub','b2222222-0000-0000-0000-0000000000a2',true);
SELECT results_eq($$
  SELECT count(*)::int FROM equipment WHERE id = 'b9999999-0000-0000-0000-0000000000a1'
$$, ARRAY[0], 'another team cannot read this team''s equipment at all');
SELECT set_config('request.jwt.claim.sub','b2222222-0000-0000-0000-0000000000a1',true);

-- ───────────────────────── D. Inventory stock coverage ─────────────────────────
INSERT INTO inventory_items(id,organization_id,category,name,default_unit,minimum_stock) VALUES
  ('ba111111-0000-0000-0000-0000000000a1','b1111111-0000-0000-0000-0000000000a1','reagent','Avec historique','g',5),
  ('ba111111-0000-0000-0000-0000000000a2','b1111111-0000-0000-0000-0000000000a1','reagent','Sans historique','g',5),
  ('ba111111-0000-0000-0000-0000000000a3','b1111111-0000-0000-0000-0000000000a1','reagent','Seulement recu','g',5);

SELECT create_inventory_lot_with_receipt('ba111111-0000-0000-0000-0000000000a1','LOT-COV-A','2026-01-01',NULL,100,'Etagere 1');
SELECT record_inventory_movement(id,'consumption',7,CURRENT_DATE,'usage hebdomadaire')
  FROM inventory_lots WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a1';

SELECT create_inventory_lot_with_receipt('ba111111-0000-0000-0000-0000000000a2','LOT-COV-B','2026-01-01',NULL,50,'Etagere 2');

-- Receipt-only item: a receipt is not consumption and must never feed the coverage denominator.
SELECT create_inventory_lot_with_receipt('ba111111-0000-0000-0000-0000000000a3','LOT-COV-C','2026-01-01',NULL,30,'Etagere 3');

SELECT results_eq($$
  SELECT has_sufficient_data, average_weekly_consumption IS NOT NULL
  FROM inventory_item_coverage WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a1'
$$, $$VALUES (true, true)$$,
  'an item with real consumption history reports has_sufficient_data and a numeric weekly average');

SELECT results_eq($$
  SELECT has_sufficient_data, average_weekly_consumption, estimated_weeks_remaining
  FROM inventory_item_coverage WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a2'
$$, $$VALUES (false, NULL::numeric, NULL::numeric)$$,
  'an item with zero consumption history reports insufficient data, never a fabricated 0 or infinite coverage');

SELECT results_eq($$
  SELECT has_sufficient_data FROM inventory_item_coverage WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a3'
$$, ARRAY[false],
  'a receipt alone never counts as consumption: an item that was only received still has insufficient data');

-- inventory_lots is, by design, never mutated by a direct client-side UPDATE
-- anywhere in this app (only through create_inventory_lot_with_receipt /
-- record_inventory_movement); archiving it here as the table owner is
-- the test's own setup step, not a claim about what the RLS policy permits.
RESET ROLE;
UPDATE inventory_lots SET deleted_at = NOW() WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b2222222-0000-0000-0000-0000000000a1',true);
SELECT results_eq($$
  SELECT current_quantity FROM inventory_item_coverage WHERE inventory_item_id = 'ba111111-0000-0000-0000-0000000000a2'
$$, ARRAY[0::numeric], 'an archived (deleted_at) lot is excluded from the current_quantity aggregate');

SELECT * FROM finish();
ROLLBACK;
