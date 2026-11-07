-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-000000000f01','Sync Org A','sync-test-a'),
 ('11111111-0000-0000-0000-000000000f02','Sync Org B','sync-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-000000000f01'),
 ('22222222-0000-0000-0000-000000000f02'),
 ('22222222-0000-0000-0000-000000000f03');
INSERT INTO profiles(user_id,organization_id,role,is_active) VALUES
 ('22222222-0000-0000-0000-000000000f01','11111111-0000-0000-0000-000000000f01','user',true),
 ('22222222-0000-0000-0000-000000000f02','11111111-0000-0000-0000-000000000f02','user',true),
 ('22222222-0000-0000-0000-000000000f03','11111111-0000-0000-0000-000000000f01','user',false);
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-000000000f01','11111111-0000-0000-0000-000000000f01','SYA','Sync program A');
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-000000000f01','55555555-0000-0000-0000-000000000f01','F'),
 ('77777777-0000-0000-0000-000000000f02','55555555-0000-0000-0000-000000000f01','M');
INSERT INTO crosses(id,program_id,female_parent_id,male_parent_id) VALUES
 ('88888888-0000-0000-0000-000000000f01','55555555-0000-0000-0000-000000000f01','77777777-0000-0000-0000-000000000f01','77777777-0000-0000-0000-000000000f02');
INSERT INTO families(id,program_id,cross_id) VALUES
 ('99999999-0000-0000-0000-000000000f01','55555555-0000-0000-0000-000000000f01','88888888-0000-0000-0000-000000000f01');
INSERT INTO seed_lots(id,program_id,cross_id,family_id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000f01','55555555-0000-0000-0000-000000000f01','88888888-0000-0000-0000-000000000f01','99999999-0000-0000-0000-000000000f01');
INSERT INTO phenotypes(id,program_id,family_id,seed_lot_id) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000f01','55555555-0000-0000-0000-000000000f01','99999999-0000-0000-0000-000000000f01','aaaaaaaa-0000-0000-0000-000000000f01'),
 ('bbbbbbbb-0000-0000-0000-000000000f02','55555555-0000-0000-0000-000000000f01','99999999-0000-0000-0000-000000000f01','aaaaaaaa-0000-0000-0000-000000000f01');
UPDATE phenotypes SET deleted_at = NOW() WHERE id = 'bbbbbbbb-0000-0000-0000-000000000f02';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f01',true);

INSERT INTO phenotype_traits(id,organization_id,code,name,category,data_type,unit,minimum_value,maximum_value,decimal_places,direction) VALUES
 ('cccccccc-0000-0000-0000-000000000f01','11111111-0000-0000-0000-000000000f01','plant_height','Hauteur','morphology','numeric','cm',0,300,1,'neutral');
INSERT INTO phenotyping_modules(id,organization_id,name) VALUES
 ('dddddddd-0000-0000-0000-000000000f01','11111111-0000-0000-0000-000000000f01','Agronomie');
INSERT INTO phenotyping_module_traits(module_id,trait_id,display_order) VALUES
 ('dddddddd-0000-0000-0000-000000000f01','cccccccc-0000-0000-0000-000000000f01',1);
INSERT INTO program_phenotyping_modules(program_id,module_id) VALUES
 ('55555555-0000-0000-0000-000000000f01','dddddddd-0000-0000-0000-000000000f01');

-- Fresh operation: exactly one evaluation created, SYNCED, not a replay.
SELECT lives_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a')$$,
  'a fresh offline operation is accepted');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'exactly one evaluation exists after the first submission');
SELECT is((SELECT count(*) FROM offline_sync_receipts),1::bigint,'exactly one receipt recorded');
SELECT is(
  (SELECT (submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'result_code')),
  'SYNCED','retrying the exact same operation returns SYNCED');
SELECT is(
  (SELECT (submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'replay')::boolean),
  true,'the retry is reported as a replay');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'no second evaluation is ever created by the retry (exact-once)');
SELECT is((SELECT count(*) FROM offline_sync_receipts),1::bigint,'still exactly one receipt after the retry');
SELECT is(
  (SELECT (submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'evaluation_id')::uuid),
  (SELECT result_entity_id FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'),
  'the replay returns the exact same evaluation_id as the original');

-- Same operation_id, different payload: rejected outright, no mutation.
SELECT throws_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":999}'::jsonb,'Notes terrain','hash-b')$$,
  '23505',NULL,'reusing an operation_id with a different payload hash is rejected');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'the rejected different-payload retry creates no evaluation');

-- Target not found / archived.
SELECT throws_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f02','00000000-0000-0000-0000-000000000000',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-c')$$,
  'P0002',NULL,'an unknown phenotype_id is reported as TARGET_NOT_FOUND');
SELECT throws_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f03','bbbbbbbb-0000-0000-0000-000000000f02',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-d')$$,
  '23514',NULL,'a soft-deleted phenotype is reported as TARGET_ARCHIVED, not TARGET_NOT_FOUND');

-- Validation failure: no evaluation row survives, even transiently.
SELECT throws_like(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f04','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":9999}'::jsonb,NULL,'hash-e')$$,
  'VALIDATION_REJECTED:%','an out-of-bounds trait value is reported as VALIDATION_REJECTED, delegating to submit_trait_evaluation()''s own rule');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'the failed validation never leaves a partial evaluation behind');

-- Cross-org / inactive-evaluator: PERMISSION_REVOKED.
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f02',true);
SELECT throws_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f05','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-f')$$,
  '42501',NULL,'a user from another organization is rejected as PERMISSION_REVOKED');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f03',true);
SELECT throws_ok(
  $$SELECT submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f06','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-g')$$,
  '42501',NULL,'an inactive profile is rejected as PERMISSION_REVOKED');

-- Receipts are append-only: no UPDATE/DELETE policy exists for
-- `authenticated` at all, so RLS silently matches zero rows for either
-- statement rather than raising - the row itself must be provably
-- untouched afterward, not merely "no exception was thrown".
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f01',true);
SELECT lives_ok(
  $$UPDATE offline_sync_receipts SET payload_hash = 'tampered' WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'$$,
  'an UPDATE against a receipt runs (RLS has no UPDATE policy to match against) but...');
SELECT is(
  (SELECT payload_hash FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'),
  'hash-a','...it never actually changes the stored payload_hash - the receipt is tamper-resistant');
SELECT lives_ok(
  $$DELETE FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'$$,
  'a DELETE against a receipt runs (same reason) but...');
SELECT is((SELECT count(*) FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'),1::bigint,'...the receipt row still exists afterward - it cannot be erased by the application role');

SELECT * FROM finish();
ROLLBACK;
