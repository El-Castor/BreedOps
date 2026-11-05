-- Disposable local test fixtures only. Everything is rolled back.
-- V2-05 multi-environment G x E schema (migration 000028): sites,
-- environments, trials, trial_environments, trial_entries, the additive
-- phenotypes links, and the analytics_runs multi_environment extension.
-- Scientific computation itself (the R mixed-model engine) is validated in
-- analytics-r/tests/; this file is purely the database-level
-- authorization/integrity boundary.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(27);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-00000000b0a1','MultiEnv A','multi-env-a'),
 ('11111111-0000-0000-0000-00000000b0a2','MultiEnv B','multi-env-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-00000000b0a1'),
 ('22222222-0000-0000-0000-00000000b0a2');
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('33333333-0000-0000-0000-00000000b0a1','22222222-0000-0000-0000-00000000b0a1','11111111-0000-0000-0000-00000000b0a1','user'),
 ('33333333-0000-0000-0000-00000000b0a2','22222222-0000-0000-0000-00000000b0a2','11111111-0000-0000-0000-00000000b0a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-00000000b0a1','11111111-0000-0000-0000-00000000b0a1','MEA','MultiEnv program A'),
 ('55555555-0000-0000-0000-00000000b0a2','11111111-0000-0000-0000-00000000b0a2','MEB','MultiEnv program B');
INSERT INTO phenotype_traits(id,organization_id,code,name,data_type) VALUES
 ('66666666-0000-0000-0000-00000000b0a1','11111111-0000-0000-0000-00000000b0a1','yield_a','Rendement A','numeric');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);

-- ───────── Sites ─────────
INSERT INTO sites(id,organization_id,code,name) VALUES
 ('77777777-0000-0000-0000-00000000b0a1','11111111-0000-0000-0000-00000000b0a1','SITE1','Site 1');
SELECT pass('a site can be created by a member of its own organization');
SELECT throws_ok(
  $$INSERT INTO sites(organization_id,code,name) VALUES ('11111111-0000-0000-0000-00000000b0a2','SITEX','Forged site')$$,
  '42501', NULL, 'a user cannot create a site for another organization'
);

-- Org B's own site, created as org B. Needed up front so the next test can
-- pair it with org B's own program (77777777-...b0a2 + 55555555-...b0a2):
-- an internally-consistent pairing the site/program trigger has no reason
-- to reject, which isolates the assertion to RLS alone, not the trigger.
RESET ROLE;
INSERT INTO sites(id,organization_id,code,name) VALUES
 ('77777777-0000-0000-0000-00000000b0a2','11111111-0000-0000-0000-00000000b0a2','SITE2','Site 2 (org B)');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);

-- ───────── Environments ─────────
INSERT INTO environments(id,program_id,site_id,code,name,campaign) VALUES
 ('88888888-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','77777777-0000-0000-0000-00000000b0a1','ENV1','Environnement 1','2026A');
SELECT pass('an environment can be created referencing a same-organization site');
SELECT throws_ok(
  format(
    $$INSERT INTO environments(program_id,site_id,code,name) VALUES ('55555555-0000-0000-0000-00000000b0a2',%L,'ENVX','Forged env')$$,
    '77777777-0000-0000-0000-00000000b0a2'
  ),
  '42501', NULL, 'a user cannot create an environment for another organization''s program, even with an internally-consistent site/program pair (isolates RLS, not the trigger)'
);

SELECT throws_ok(
  format(
    $$INSERT INTO environments(program_id,site_id,code,name) VALUES ('55555555-0000-0000-0000-00000000b0a1',%L,'ENV2','Cross-org env')$$,
    '77777777-0000-0000-0000-00000000b0a2'
  ),
  '23514', NULL, 'site_id must belong to the same organization as the program (trigger, not just RLS)'
);

-- ───────── Trials and trial_environments ─────────
INSERT INTO trials(id,program_id,code,name) VALUES
 ('99999999-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','TRIAL1','MET Trial 1');
INSERT INTO trial_environments(trial_id,environment_id) VALUES
 ('99999999-0000-0000-0000-00000000b0a1','88888888-0000-0000-0000-00000000b0a1');
SELECT pass('a trial environment can be created for a same-program trial/environment pair');

RESET ROLE;
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-00000000b0a3','11111111-0000-0000-0000-00000000b0a1','MEA2','MultiEnv program A2');
INSERT INTO trials(id,program_id,code,name) VALUES
 ('99999999-0000-0000-0000-00000000b0a2','55555555-0000-0000-0000-00000000b0a3','TRIAL2','Trial on a sibling program');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);
SELECT throws_ok(
  format(
    $$INSERT INTO trial_environments(trial_id,environment_id) VALUES (%L,'88888888-0000-0000-0000-00000000b0a1')$$,
    '99999999-0000-0000-0000-00000000b0a2'
  ),
  '23514', NULL, 'a trial can only include environments from its own program, even a sibling program in the same organization'
);

-- ───────── Trial entries and lineage validation ─────────
INSERT INTO trial_entries(id,trial_id,code,label,scientific_role) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000b0a1','99999999-0000-0000-0000-00000000b0a1','E1','Entry 1','other');
SELECT pass('a trial entry can be created with the default "other" scientific role');
SELECT throws_ok(
  $$INSERT INTO trial_entries(trial_id,code,label,scientific_role) VALUES ('99999999-0000-0000-0000-00000000b0a1','E2','Entry 2','not_a_real_role')$$,
  '23514', NULL, 'an unlisted scientific_role is rejected'
);

RESET ROLE;
INSERT INTO parent_lines(id,program_id,parent_code,line_name) VALUES
 ('bbbbbbbb-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a3','PARENT-SIBLING','Parent on sibling program');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);
SELECT throws_ok(
  format(
    $$INSERT INTO trial_entries(trial_id,code,label,scientific_role,parent_line_id) VALUES ('99999999-0000-0000-0000-00000000b0a1','E3','Entry 3','genotype',%L)$$,
    'bbbbbbbb-0000-0000-0000-00000000b0a1'
  ),
  '23514', NULL, 'parent_line_id must belong to the same program as the trial, even a sibling program'
);

-- ───────── Cross-team isolation for the whole schema ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a2',true);
SELECT is((SELECT count(*) FROM sites WHERE organization_id='11111111-0000-0000-0000-00000000b0a1'), 0::bigint,
  'a user in another organization reads zero sites for this team');
SELECT is((SELECT count(*) FROM environments WHERE program_id='55555555-0000-0000-0000-00000000b0a1'), 0::bigint,
  'a user in another organization reads zero environments for this team');
SELECT is((SELECT count(*) FROM trials WHERE program_id='55555555-0000-0000-0000-00000000b0a1'), 0::bigint,
  'a user in another organization reads zero trials for this team');
SELECT is((SELECT count(*) FROM trial_entries WHERE trial_id='99999999-0000-0000-0000-00000000b0a1'), 0::bigint,
  'a user in another organization reads zero trial entries for this team''s trial');
SELECT throws_ok(
  $$INSERT INTO trials(program_id,code,name) VALUES ('55555555-0000-0000-0000-00000000b0a1','FORGED','Forged trial')$$,
  '42501', NULL, 'a user in another organization cannot create a trial for this team''s program, even knowing its id'
);
RESET ROLE;

-- ───────── Linking phenotypes to MET entities ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);
INSERT INTO phenotypes(id,program_id,phenotype_code,environment_id,trial_entry_id) VALUES
 ('cccccccc-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','PHENO-MET-1',
  '88888888-0000-0000-0000-00000000b0a1','aaaaaaaa-0000-0000-0000-00000000b0a1');
SELECT pass('a phenotype can be linked to an environment and trial entry it is actually consistent with');

-- A second environment NOT in trial 1's trial_environments.
INSERT INTO environments(id,program_id,site_id,code,name) VALUES
 ('88888888-0000-0000-0000-00000000b0a3','55555555-0000-0000-0000-00000000b0a1','77777777-0000-0000-0000-00000000b0a1','ENV3','Environnement 3 (hors trial 1)');
SELECT throws_ok(
  format(
    $$INSERT INTO phenotypes(program_id,phenotype_code,environment_id,trial_entry_id) VALUES ('55555555-0000-0000-0000-00000000b0a1','PHENO-MET-2',%L,'aaaaaaaa-0000-0000-0000-00000000b0a1')$$,
    '88888888-0000-0000-0000-00000000b0a3'
  ),
  '23514', NULL, 'environment_id must be one of trial_entry_id''s own trial environments'
);

-- ───────── analytics_runs: multi_environment analysis type ─────────
INSERT INTO analytics_runs(
  organization_id, program_id, trait_id, analysis_type, trial_id, specification, dataset_fingerprint, status, result, n_observations, engine_name, engine_version, created_by
) VALUES (
  '11111111-0000-0000-0000-00000000b0a2', -- forged org, should be re-derived
  '55555555-0000-0000-0000-00000000b0a1',
  '66666666-0000-0000-0000-00000000b0a1',
  'multi_environment',
  '99999999-0000-0000-0000-00000000b0a1',
  '{"trialId":"t1"}'::jsonb,
  repeat('a', 64),
  'completed',
  '{"n":10}'::jsonb,
  10,
  'breedops-r-mixed-models',
  '1.0.0',
  '33333333-0000-0000-0000-00000000b0a1'
);
SELECT is(
  (SELECT organization_id FROM analytics_runs WHERE trial_id='99999999-0000-0000-0000-00000000b0a1'),
  '11111111-0000-0000-0000-00000000b0a1'::uuid,
  'organization_id is re-derived from program_id for a multi_environment run too, overriding a forged client value'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,analysis_type,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1','multi_environment','{}'::jsonb,repeat('b',64),'completed','breedops-r-mixed-models','1.0.0','33333333-0000-0000-0000-00000000b0a1')$$,
  '23514', NULL, 'trial_id is required when analysis_type is multi_environment'
);
SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,analysis_type,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('11111111-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1','trait_intelligence',%L,'{}'::jsonb,repeat('c',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000b0a1')$$,
    '99999999-0000-0000-0000-00000000b0a1'
  ),
  '23514', NULL, 'trial_id must be NULL unless analysis_type is multi_environment'
);
SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,analysis_type,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('11111111-0000-0000-0000-00000000b0a1','55555555-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1','multi_environment',%L,'{}'::jsonb,repeat('d',64),'completed','breedops-r-mixed-models','1.0.0','33333333-0000-0000-0000-00000000b0a1')$$,
    '99999999-0000-0000-0000-00000000b0a2'
  ),
  '23514', NULL, 'trial_id must belong to the same program as this analytics run, even a sibling program'
);

-- ───────── met_observation_dataset RLS ─────────
INSERT INTO phenotype_evaluations(id,phenotype_id,evaluation_date) VALUES
 ('dddddddd-0000-0000-0000-00000000b0a1','cccccccc-0000-0000-0000-00000000b0a1','2026-01-01');
-- phenotype_trait_values has no direct INSERT policy at all (values are
-- written only through submit_trait_evaluation, migration 000016) - bypass
-- RLS for this fixture row the same way the rest of this file's fixtures
-- above the first SET LOCAL ROLE do.
RESET ROLE;
INSERT INTO phenotype_trait_values(phenotype_evaluation_id,trait_id,numeric_value) VALUES
 ('dddddddd-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1',42.0);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);
SELECT is(
  (SELECT count(*) FROM met_observation_dataset('99999999-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1')),
  1::bigint, 'met_observation_dataset returns the one linked observation for its own organization'
);
SELECT is(
  (SELECT numeric_value FROM met_observation_dataset('99999999-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1')),
  42.0, 'met_observation_dataset returns the correct numeric value'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a2',true);
SELECT is(
  (SELECT count(*) FROM met_observation_dataset('99999999-0000-0000-0000-00000000b0a1','66666666-0000-0000-0000-00000000b0a1')),
  0::bigint, 'met_observation_dataset returns zero rows for another organization''s trial/trait'
);
RESET ROLE;

-- ───────── Soft delete: archiving a trial never trips RLS, and the archived
-- row stays readable for inspection/restore, matching the established
-- convention (equipment/selection_criteria/task_templates - deleted_at is
-- lifecycle state, not an authorization boundary; see
-- 000022_business_completion.sql §E and trials_read above). ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000b0a1',true);
UPDATE trials SET deleted_at = now() WHERE id = '99999999-0000-0000-0000-00000000b0a1';
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM trials WHERE id='99999999-0000-0000-0000-00000000b0a1'),
  true, 'archiving a trial (deleted_at) is allowed and does not violate RLS'
);
SELECT is(
  (SELECT count(*) FROM trials WHERE id='99999999-0000-0000-0000-00000000b0a1'),
  1::bigint, 'an archived trial stays readable by its own program''s user, for inspection/restore'
);

UPDATE trials SET deleted_at = NULL WHERE id = '99999999-0000-0000-0000-00000000b0a1';
SELECT is(
  (SELECT deleted_at FROM trials WHERE id='99999999-0000-0000-0000-00000000b0a1'),
  NULL::timestamp, 'restoring the archived trial (deleted_at = NULL) is allowed'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
