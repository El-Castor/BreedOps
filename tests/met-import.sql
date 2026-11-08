-- Disposable local test fixtures only. Everything is rolled back.
-- V2-05 MET import (migration 000030): import_met_observations.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-00000000d0a1','MetImport A','met-import-a'),
 ('11111111-0000-0000-0000-00000000d0a2','MetImport B','met-import-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-00000000d0a1'),
 ('22222222-0000-0000-0000-00000000d0a2');
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('33333333-0000-0000-0000-00000000d0a1','22222222-0000-0000-0000-00000000d0a1','11111111-0000-0000-0000-00000000d0a1','user'),
 ('33333333-0000-0000-0000-00000000d0a2','22222222-0000-0000-0000-00000000d0a2','11111111-0000-0000-0000-00000000d0a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-00000000d0a1','11111111-0000-0000-0000-00000000d0a1','MIA','MetImport program A');
INSERT INTO phenotype_traits(id,organization_id,code,name,data_type,allowed_values) VALUES
 ('66666666-0000-0000-0000-00000000d0a1','11111111-0000-0000-0000-00000000d0a1','yield_mi','Rendement MI','numeric',NULL),
 ('66666666-0000-0000-0000-00000000d0a2','11111111-0000-0000-0000-00000000d0a1','categ_mi','Catégorie MI','categorical',ARRAY['oui','non']);
INSERT INTO sites(id,organization_id,code,name) VALUES
 ('77777777-0000-0000-0000-00000000d0a1','11111111-0000-0000-0000-00000000d0a1','SITE-MI','Site MI');
INSERT INTO environments(id,program_id,site_id,code,name) VALUES
 ('88888888-0000-0000-0000-00000000d0a1','55555555-0000-0000-0000-00000000d0a1','77777777-0000-0000-0000-00000000d0a1','ENV-MI','Env MI'),
 ('88888888-0000-0000-0000-00000000d0a2','55555555-0000-0000-0000-00000000d0a1','77777777-0000-0000-0000-00000000d0a1','ENV-MI2','Env MI2 (not in trial)'),
 ('88888888-0000-0000-0000-00000000d0a3','55555555-0000-0000-0000-00000000d0a1','77777777-0000-0000-0000-00000000d0a1','ENV-MI3','Env MI3 (in trial, different from ENV-MI)');
INSERT INTO trials(id,program_id,code,name) VALUES
 ('99999999-0000-0000-0000-00000000d0a1','55555555-0000-0000-0000-00000000d0a1','TRIAL-MI','Trial MI');
INSERT INTO trial_environments(trial_id,environment_id) VALUES
 ('99999999-0000-0000-0000-00000000d0a1','88888888-0000-0000-0000-00000000d0a1'),
 ('99999999-0000-0000-0000-00000000d0a1','88888888-0000-0000-0000-00000000d0a3');
INSERT INTO trial_entries(id,trial_id,code,label,scientific_role) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d0a1','99999999-0000-0000-0000-00000000d0a1','E1','Entry 1','other');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000d0a1',true);

-- ───────── Create path ─────────
SELECT is(
  jsonb_array_length(import_met_observations(
    '55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-1', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '12.5', 'evaluation_date', '2026-03-01'))
  )),
  1, 'importing one new row returns exactly one result'
);
SELECT is(
  (SELECT numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1'),
  12.5::numeric, 'the imported numeric value is stored correctly'
);
SELECT is(
  (SELECT trial_entry_id FROM phenotypes WHERE phenotype_code = 'PH-MI-1'),
  'aaaaaaaa-0000-0000-0000-00000000d0a1'::uuid, 'the imported phenotype is linked to the resolved trial entry'
);

-- ───────── Idempotent update path (re-import the same code, new value) ─────────
SELECT is(
  (import_met_observations(
    '55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-1', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '99', 'evaluation_date', '2026-03-01'))
  )->0->>'status'),
  'updated', 're-importing the same phenotype_code updates rather than duplicates'
);
SELECT is(
  (SELECT count(*) FROM phenotypes WHERE phenotype_code = 'PH-MI-1'),
  1::bigint, 're-importing never creates a second phenotype row for the same business code'
);
SELECT is(
  (SELECT numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1'),
  99::numeric, 'the updated value replaces the original one'
);

-- ───────── Rejections ─────────
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-2', 'entry_code', 'DOES-NOT-EXIST', 'environment_code', 'ENV-MI', 'value', '1', 'evaluation_date', '2026-03-01')))$$,
  '23503', NULL, 'an entry_code that does not exist in this trial is rejected, never auto-created'
);
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-2', 'entry_code', 'E1', 'environment_code', 'ENV-MI2', 'value', '1', 'evaluation_date', '2026-03-01')))$$,
  '23503', NULL, 'an environment_code that exists but is not part of this trial''s own environments is rejected'
);
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a2',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-3', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '1', 'evaluation_date', '2026-03-01')))$$,
  '23514', NULL, 'importing a categorical trait is rejected - MET import only supports numeric/integer/ordinal'
);
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-1', 'entry_code', 'E1', 'environment_code', 'ENV-MI3', 'value', '1', 'evaluation_date', '2026-03-01')))$$,
  '23514', NULL, 'an attempt to move an already-imported phenotype to a different (but valid, in-trial) environment is rejected - entry/environment are immutable identity fields'
);
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-5', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '1')))$$,
  '23502', NULL, 'evaluation_date is required (B-review finding #5) - an unset date would make the evaluation-event resolution ambiguous'
);

-- ───────── Evaluation-identity resolution by (phenotype_id, evaluation_date)
-- (B-review finding #5, migration 000032): PH-MI-1 already has exactly one
-- evaluation, dated 2026-03-01, from the create/update tests above. ─────────
SELECT is(
  (SELECT count(*) FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1'),
  1::bigint, 'PH-MI-1 starts this section with exactly one evaluation event (2026-03-01)'
);
SELECT is(
  (import_met_observations(
    '55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-1', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '777', 'evaluation_date', '2026-04-15'))
  )->0->>'status'),
  'updated', 'importing PH-MI-1 with a NEW evaluation_date still reports "updated" (the phenotype, not a new one)'
);
SELECT is(
  (SELECT count(*) FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1'),
  2::bigint, 'a different evaluation_date creates a SECOND, distinct evaluation event rather than overwriting the first (the bug fixed by migration 000032)'
);
SELECT is(
  (SELECT tv.numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1' AND e.evaluation_date = '2026-03-01'),
  99::numeric, 'the original (2026-03-01) evaluation''s value is untouched by the different-date import - never the wrong evaluation overwritten'
);
SELECT is(
  (SELECT tv.numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1' AND e.evaluation_date = '2026-04-15'),
  777::numeric, 'the new (2026-04-15) evaluation event holds the newly-imported value'
);
SELECT is(
  (import_met_observations(
    '55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-1', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '42', 'evaluation_date', '2026-03-01'))
  )->0->>'status'),
  'updated', 're-importing the original (2026-03-01) date, with PH-MI-1 now having 2 evaluation events, still resolves deterministically'
);
SELECT is(
  (SELECT tv.numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1' AND e.evaluation_date = '2026-03-01'),
  42::numeric, 'that re-import updated exactly the 2026-03-01 evaluation (not the 2026-04-15 one)'
);
SELECT is(
  (SELECT tv.numeric_value FROM phenotype_trait_values tv JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1' AND e.evaluation_date = '2026-04-15'),
  777::numeric, 'the other (2026-04-15) evaluation remains exactly as it was - no cross-contamination between the two dated events'
);
SELECT is(
  (SELECT count(*) FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE p.phenotype_code = 'PH-MI-1'),
  2::bigint, 'PH-MI-1 still has exactly 2 evaluation events - re-importing an existing date never creates a spurious third one'
);

-- ───────── Cross-org isolation ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000d0a2',true);
SELECT throws_ok(
  $$SELECT import_met_observations('55555555-0000-0000-0000-00000000d0a1', '99999999-0000-0000-0000-00000000d0a1', '66666666-0000-0000-0000-00000000d0a1',
    jsonb_build_array(jsonb_build_object('row_index', 1, 'phenotype_code', 'PH-MI-4', 'entry_code', 'E1', 'environment_code', 'ENV-MI', 'value', '1', 'evaluation_date', '2026-03-01')))$$,
  '42501', NULL, 'a user from another organization cannot import observations for a program they cannot write to'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
