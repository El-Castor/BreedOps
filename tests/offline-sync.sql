-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(44);


-- LOT 3 compatibility helper: route historical LOT 1 assertions through
-- the NEW seven-argument RPC without restoring access to the obsolete
-- six-argument production function.
--
-- The base pack fingerprint is captured once after fixture configuration
-- has been created. Keeping it stable intentionally models a real offline
-- pack prepared before subsequent server-side configuration changes.
CREATE TEMP TABLE lot3_base_pack_fingerprint (
  fingerprint TEXT NOT NULL
);

GRANT SELECT, INSERT ON lot3_base_pack_fingerprint TO authenticated;

CREATE FUNCTION pg_temp.test_submit_offline_phenotype_evaluation(
  p_operation_id UUID,
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT,
  p_payload_hash TEXT
) RETURNS JSONB
LANGUAGE SQL
SECURITY INVOKER
AS $$
  SELECT public.submit_offline_phenotype_evaluation(
    p_operation_id,
    p_phenotype_id,
    p_evaluation_date,
    p_submitted_values,
    p_evaluation_notes,
    p_payload_hash,
    (SELECT fingerprint FROM pg_temp.lot3_base_pack_fingerprint LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION pg_temp.test_submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) TO authenticated;

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-000000000f01','Sync Org A','sync-test-a'),
 ('11111111-0000-0000-0000-000000000f02','Sync Org B','sync-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-000000000f01'),
 ('22222222-0000-0000-0000-000000000f02'),
 ('22222222-0000-0000-0000-000000000f03'),
 ('22222222-0000-0000-0000-000000000f04');
INSERT INTO profiles(user_id,organization_id,role,is_active) VALUES
 ('22222222-0000-0000-0000-000000000f01','11111111-0000-0000-0000-000000000f01','user',true),
 ('22222222-0000-0000-0000-000000000f02','11111111-0000-0000-0000-000000000f02','user',true),
 ('22222222-0000-0000-0000-000000000f03','11111111-0000-0000-0000-000000000f01','user',false),
 ('22222222-0000-0000-0000-000000000f04','11111111-0000-0000-0000-000000000f01','user',true);
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


-- Snapshot representing the configuration of the offline pack used by all
-- historical LOT 1 submission assertions below.
INSERT INTO pg_temp.lot3_base_pack_fingerprint(fingerprint)
SELECT
  public.offline_sync_program_configuration(
    '55555555-0000-0000-0000-000000000f01'
  ) ->> 'fingerprint';

-- Fresh operation: exactly one evaluation created, SYNCED, not a replay.
SELECT lives_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a')$$,
  'a fresh offline operation is accepted');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'exactly one evaluation exists after the first submission');
SELECT is((SELECT count(*) FROM offline_sync_receipts),1::bigint,'exactly one receipt recorded');
SELECT is(
  (SELECT (pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'result_code')),
  'SYNCED','retrying the exact same operation returns SYNCED');
SELECT is(
  (SELECT (pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'replay')::boolean),
  true,'the retry is reported as a replay');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'no second evaluation is ever created by the retry (exact-once)');
SELECT is((SELECT count(*) FROM offline_sync_receipts),1::bigint,'still exactly one receipt after the retry');
SELECT is(
  (SELECT (pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,'Notes terrain','hash-a') ->> 'evaluation_id')::uuid),
  (SELECT result_entity_id FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'),
  'the replay returns the exact same evaluation_id as the original');

-- Same operation_id, different payload: rejected outright, no mutation.
SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":999}'::jsonb,'Notes terrain','hash-b')$$,
  '23505',NULL,'reusing an operation_id with a different payload hash is rejected');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'the rejected different-payload retry creates no evaluation');

-- Target not found / archived.
SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f02','00000000-0000-0000-0000-000000000000',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-c')$$,
  'P0002',NULL,'an unknown phenotype_id is reported as TARGET_NOT_FOUND');
SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f03','bbbbbbbb-0000-0000-0000-000000000f02',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-d')$$,
  '23514',NULL,'a soft-deleted phenotype is reported as TARGET_ARCHIVED, not TARGET_NOT_FOUND');

-- Validation failure: no evaluation row survives, even transiently.
SELECT throws_like(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f04','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":9999}'::jsonb,NULL,'hash-e')$$,
  'VALIDATION_REJECTED:%','an out-of-bounds trait value is reported as VALIDATION_REJECTED, delegating to submit_trait_evaluation()''s own rule');
SELECT is((SELECT count(*) FROM phenotype_evaluations),1::bigint,'the failed validation never leaves a partial evaluation behind');

-- Cross-org / inactive-evaluator: PERMISSION_REVOKED.
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f02',true);
SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f05','bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06','{"plant_height":120}'::jsonb,NULL,'hash-f')$$,
  '42501',NULL,'a user from another organization is rejected as PERMISSION_REVOKED');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000f03',true);
SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
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
SELECT ok(
  (
    SELECT payload_hash <> 'tampered'
    FROM offline_sync_receipts
    WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'
  ),
  '...it never actually changes the stored payload_hash - the receipt is tamper-resistant');
SELECT lives_ok(
  $$DELETE FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'$$,
  'a DELETE against a receipt runs (same reason) but...');
SELECT is((SELECT count(*) FROM offline_sync_receipts WHERE operation_id='eeeeeeee-0000-0000-0000-000000000f01'),1::bigint,'...the receipt row still exists afterward - it cannot be erased by the application role');


-- ───────────────── V2-07 exact-once hardening regressions ─────────────────

-- A receipt belongs to the profile that created it. Knowing another user's
-- operation UUID and payload must not allow replaying or discovering its
-- result through the mutation RPC.
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-000000000f04',
  true
);

SELECT throws_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f01',
      'bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06',
      '{"plant_height":120}'::jsonb,
      'Notes terrain',
      'attacker-controlled-hash'
  )$$,
  '42501',
  NULL,
  'another profile cannot replay an existing offline receipt'
);

SELECT throws_ok(
  $$SELECT preflight_offline_sync_operation(
      'eeeeeeee-0000-0000-0000-000000000f01',
      'bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-06',
      '{"plant_height":120}'::jsonb,
      'Notes terrain',
      'attacker-controlled-hash'
  )$$,
  '42501',
  NULL,
  'preflight also prevents cross-profile receipt replay'
);

-- Restore the legitimate actor.
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-000000000f01',
  true
);

-- A caller may lie about p_payload_hash when invoking the RPC directly.
-- PostgreSQL must derive the receipt hash from the actual mutation payload
-- and must never persist the caller-controlled hash as authority.
SELECT lives_ok(
  $$SELECT pg_temp.test_submit_offline_phenotype_evaluation(
      'eeeeeeee-0000-0000-0000-000000000f07',
      'bbbbbbbb-0000-0000-0000-000000000f01',
      '2026-11-12',
      '{"plant_height":121}'::jsonb,
      'Direct RPC hash hardening',
      'forged-client-hash'
  )$$,
  'a forged client hash cannot control the authoritative receipt hash'
);

SELECT ok(
  (
    SELECT
      payload_hash <> 'forged-client-hash'
      AND length(payload_hash) = 64
    FROM offline_sync_receipts
    WHERE operation_id = 'eeeeeeee-0000-0000-0000-000000000f07'
  ),
  'the receipt stores a server-derived SHA-256 hash rather than the supplied hash'
);


-- ═════════════════════════════════════════════════════════════════════════════
RESET ROLE;

-- LOT 3A: authoritative configuration fingerprint + transactional guard
--
-- PostgreSQL is authoritative for configuration identity. These assertions
-- cover deterministic fingerprints, scoring-relevant configuration changes,
-- stale-pack rejection before mutation, and committed replay after a later
-- configuration change.
-- ═════════════════════════════════════════════════════════════════════════════

-- ───────────────────────── Fixtures ─────────────────────────

INSERT INTO organizations(id, name, slug) VALUES
(
  '11111111-0000-0000-0000-00000000c001',
  'LOT3 configuration guard',
  'lot3-config-guard'
);

INSERT INTO auth.users(id) VALUES
('22222222-0000-0000-0000-00000000c001');

INSERT INTO profiles(id, user_id, organization_id, role, is_active) VALUES
(
  '33333333-0000-0000-0000-00000000c001',
  '22222222-0000-0000-0000-00000000c001',
  '11111111-0000-0000-0000-00000000c001',
  'user',
  true
);

INSERT INTO programs(id, organization_id, code, name) VALUES
(
  '44444444-0000-0000-0000-00000000c001',
  '11111111-0000-0000-0000-00000000c001',
  'LOT3',
  'LOT3 configuration guard'
);

INSERT INTO phenotypes(id, program_id, phenotype_code) VALUES
(
  '55555555-0000-0000-0000-00000000c001',
  '44444444-0000-0000-0000-00000000c001',
  'LOT3-P1'
);

INSERT INTO phenotype_traits(
  id,
  organization_id,
  code,
  name,
  category,
  data_type,
  unit,
  minimum_value,
  maximum_value,
  decimal_places,
  direction
) VALUES (
  '66666666-0000-0000-0000-00000000c001',
  '11111111-0000-0000-0000-00000000c001',
  'plant_height',
  'Hauteur',
  'morphology',
  'numeric',
  'cm',
  0,
  300,
  1,
  'neutral'
);

INSERT INTO phenotyping_modules(
  id,
  organization_id,
  name,
  is_active
) VALUES (
  '77777777-0000-0000-0000-00000000c001',
  '11111111-0000-0000-0000-00000000c001',
  'Agronomie',
  true
);

INSERT INTO phenotyping_module_traits(
  module_id,
  trait_id,
  display_order
) VALUES (
  '77777777-0000-0000-0000-00000000c001',
  '66666666-0000-0000-0000-00000000c001',
  1
);

INSERT INTO program_phenotyping_modules(
  program_id,
  module_id,
  is_active,
  display_order
) VALUES (
  '44444444-0000-0000-0000-00000000c001',
  '77777777-0000-0000-0000-00000000c001',
  true,
  1
);

INSERT INTO selection_models(
  id,
  program_id,
  name,
  version,
  maximum_score,
  is_active
) VALUES (
  '88888888-0000-0000-0000-00000000c001',
  '44444444-0000-0000-0000-00000000c001',
  'LOT3 model',
  '1.0',
  300,
  true
);

INSERT INTO selection_criteria(
  id,
  selection_model_id,
  trait_id,
  code,
  name,
  coefficient,
  minimum_value,
  maximum_value,
  display_order,
  is_eliminatory,
  eliminatory_threshold
) VALUES (
  '99999999-0000-0000-0000-00000000c001',
  '88888888-0000-0000-0000-00000000c001',
  '66666666-0000-0000-0000-00000000c001',
  'plant_height',
  'Hauteur',
  1,
  0,
  300,
  1,
  false,
  NULL
);

INSERT INTO selection_decision_rules(
  id,
  selection_model_id,
  decision,
  minimum_weighted_score,
  minimum_stability_score,
  display_order
) VALUES (
  'aaaaaaaa-0000-0000-0000-00000000c001',
  '88888888-0000-0000-0000-00000000c001',
  'elite',
  100,
  0,
  1
);

-- Retain fingerprints across SET ROLE / RESET ROLE transitions.
CREATE TEMP TABLE lot3_fingerprints(
  label TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON lot3_fingerprints
TO authenticated;

-- ───────────────────────── Base snapshot ─────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

INSERT INTO lot3_fingerprints(label, value)
SELECT
  'base',
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint';

SELECT ok(
  length((SELECT value FROM lot3_fingerprints WHERE label = 'base')) = 64,
  'the authoritative configuration fingerprint is a SHA-256 hex digest'
);

SELECT is(
  jsonb_array_length(
    offline_sync_program_configuration(
      '44444444-0000-0000-0000-00000000c001'
    ) -> 'active_traits'
  ),
  1,
  'the atomic pack snapshot contains the active trait'
);

-- ───────────────────────── Trait validity metadata ─────────────────────────

RESET ROLE;

UPDATE phenotype_traits
SET maximum_value = 250
WHERE id = '66666666-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

INSERT INTO lot3_fingerprints(label, value)
SELECT
  'trait-bound',
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint';

SELECT isnt(
  (SELECT value FROM lot3_fingerprints WHERE label = 'trait-bound'),
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'changing a trait validation bound changes the fingerprint'
);

RESET ROLE;

UPDATE phenotype_traits
SET maximum_value = 300
WHERE id = '66666666-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT is(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'restoring the trait bound restores the deterministic fingerprint'
);

-- ───────────────────────── Selection coefficient ─────────────────────────

RESET ROLE;

UPDATE selection_criteria
SET coefficient = 2
WHERE id = '99999999-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT isnt(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'changing a selection coefficient changes the fingerprint'
);

RESET ROLE;

UPDATE selection_criteria
SET coefficient = 1
WHERE id = '99999999-0000-0000-0000-00000000c001';

-- ───────────────────────── Eliminatory rule ─────────────────────────

UPDATE selection_criteria
SET
  is_eliminatory = true,
  eliminatory_threshold = 100
WHERE id = '99999999-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT isnt(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'changing an eliminatory rule changes the fingerprint'
);

RESET ROLE;

UPDATE selection_criteria
SET
  is_eliminatory = false,
  eliminatory_threshold = NULL
WHERE id = '99999999-0000-0000-0000-00000000c001';

-- ───────────────────────── Decision rule ─────────────────────────

UPDATE selection_decision_rules
SET minimum_weighted_score = 150
WHERE id = 'aaaaaaaa-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT isnt(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'changing a decision threshold changes the fingerprint'
);

RESET ROLE;

UPDATE selection_decision_rules
SET minimum_weighted_score = 100
WHERE id = 'aaaaaaaa-0000-0000-0000-00000000c001';

-- ───────────────────────── Criterion identity/display semantics ─────────────────────────

UPDATE selection_criteria
SET name = 'Hauteur révisée'
WHERE id = '99999999-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT isnt(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'changing criterion metadata used by elimination output changes the fingerprint'
);

RESET ROLE;

UPDATE selection_criteria
SET name = 'Hauteur'
WHERE id = '99999999-0000-0000-0000-00000000c001';

-- ───────────────────────── Stale pack must fail before mutation ─────────────────────────

UPDATE phenotype_traits
SET maximum_value = 250
WHERE id = '66666666-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT throws_like(
  $$SELECT submit_offline_phenotype_evaluation(
    'bbbbbbbb-0000-0000-0000-00000000c001',
    '55555555-0000-0000-0000-00000000c001',
    '2026-11-07',
    '{"plant_height":120}'::jsonb,
    'stale pack',
    'client-hash-is-not-authoritative',
    (SELECT value FROM lot3_fingerprints WHERE label = 'base')
  )$$,
  'CONFIG_CHANGED%',
  'a stale pack fingerprint is rejected inside the mutation transaction'
);

SELECT is(
  (SELECT count(*) FROM phenotype_evaluations),
  0::bigint,
  'CONFIG_CHANGED creates no phenotype evaluation'
);

SELECT is(
  (SELECT count(*) FROM offline_sync_receipts),
  0::bigint,
  'CONFIG_CHANGED creates no idempotency receipt'
);

-- Restore the exact base configuration.
RESET ROLE;

UPDATE phenotype_traits
SET maximum_value = 300
WHERE id = '66666666-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT is(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'the configuration is back to the original pack fingerprint'
);

-- ───────────────────────── Valid commit ─────────────────────────

SELECT is(
  submit_offline_phenotype_evaluation(
    'bbbbbbbb-0000-0000-0000-00000000c002',
    '55555555-0000-0000-0000-00000000c001',
    '2026-11-07',
    '{"plant_height":120}'::jsonb,
    'valid pack',
    'client-hash-is-not-authoritative',
    (SELECT value FROM lot3_fingerprints WHERE label = 'base')
  ) ->> 'result_code',
  'SYNCED',
  'a current authoritative fingerprint allows the scientific write'
);

SELECT is(
  (SELECT count(*) FROM phenotype_evaluations),
  1::bigint,
  'a valid operation creates exactly one phenotype evaluation'
);

SELECT is(
  (SELECT count(*) FROM offline_sync_receipts),
  1::bigint,
  'a valid operation creates exactly one idempotency receipt'
);

-- ───────────────────────── Ack-loss replay after config mutation ─────────────────────────
--
-- Once committed, replay has priority over current configuration. A field
-- device that lost the HTTP acknowledgement must not turn a successful
-- scientific write into CONFIG_CHANGED merely because configuration changed
-- afterward.

RESET ROLE;

UPDATE selection_decision_rules
SET minimum_weighted_score = 150
WHERE id = 'aaaaaaaa-0000-0000-0000-00000000c001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-0000-0000-0000-00000000c001',
  true
);

SELECT isnt(
  offline_sync_program_configuration(
    '44444444-0000-0000-0000-00000000c001'
  ) ->> 'fingerprint',
  (SELECT value FROM lot3_fingerprints WHERE label = 'base'),
  'configuration really is different before testing the committed replay'
);

SELECT is(
  submit_offline_phenotype_evaluation(
    'bbbbbbbb-0000-0000-0000-00000000c002',
    '55555555-0000-0000-0000-00000000c001',
    '2026-11-07',
    '{"plant_height":120}'::jsonb,
    'valid pack',
    'a-forged-client-hash-still-does-not-matter',
    (SELECT value FROM lot3_fingerprints WHERE label = 'base')
  ) ->> 'result_code',
  'SYNCED',
  'a committed operation still replays as SYNCED after configuration changes'
);

SELECT is(
  (
    submit_offline_phenotype_evaluation(
      'bbbbbbbb-0000-0000-0000-00000000c002',
      '55555555-0000-0000-0000-00000000c001',
      '2026-11-07',
      '{"plant_height":120}'::jsonb,
      'valid pack',
      'another-forged-client-hash',
      (SELECT value FROM lot3_fingerprints WHERE label = 'base')
    ) ->> 'replay'
  )::boolean,
  true,
  'the post-change retry is explicitly reported as an idempotent replay'
);

SELECT is(
  (
    submit_offline_phenotype_evaluation(
      'bbbbbbbb-0000-0000-0000-00000000c002',
      '55555555-0000-0000-0000-00000000c001',
      '2026-11-07',
      '{"plant_height":120}'::jsonb,
      'valid pack',
      'ignored-client-hash',
      (SELECT value FROM lot3_fingerprints WHERE label = 'base')
    ) ->> 'evaluation_id'
  )::uuid,
  (
    SELECT result_entity_id
    FROM offline_sync_receipts
    WHERE operation_id = 'bbbbbbbb-0000-0000-0000-00000000c002'
  ),
  'the replay returns the exact originally committed evaluation id'
);

SELECT is(
  (SELECT count(*) FROM phenotype_evaluations),
  1::bigint,
  'replaying after a configuration change never duplicates the evaluation'
);

SELECT * FROM finish();
ROLLBACK;
