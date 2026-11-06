-- Disposable local test fixtures only. Everything is rolled back.
-- V2-06 breeding-decision schema (migration 000033):
-- breeding_decision_scenarios, breeding_decision_scenario_traits, and the
-- analytics_runs 'breeding_decision' analysis_type extension. Scientific
-- computation itself (MGIDI/MTSI via R) is validated in
-- analytics-r/tests/; this file is purely the database-level
-- authorization/integrity boundary: cross-org, cross-program, forged
-- scope columns, and the CHECK constraints that keep source provenance
-- explicit (task review §8/§32/§50).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(38);

INSERT INTO organizations(id,name,slug) VALUES
 ('e1111111-0000-0000-0000-00000000e0a1','BreedDec A','breed-dec-a'),
 ('e1111111-0000-0000-0000-00000000e0a2','BreedDec B','breed-dec-b');
INSERT INTO auth.users(id) VALUES
 ('e2222222-0000-0000-0000-00000000e0a1'),
 ('e2222222-0000-0000-0000-00000000e0a2');
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('e3333333-0000-0000-0000-00000000e0a1','e2222222-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','user'),
 ('e3333333-0000-0000-0000-00000000e0a2','e2222222-0000-0000-0000-00000000e0a2','e1111111-0000-0000-0000-00000000e0a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('e5555555-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','BDA1','BreedDec program A1'),
 ('e5555555-0000-0000-0000-00000000e0a3','e1111111-0000-0000-0000-00000000e0a1','BDA2','BreedDec sibling program A2'),
 ('e5555555-0000-0000-0000-00000000e0a2','e1111111-0000-0000-0000-00000000e0a2','BDB1','BreedDec program B1');
INSERT INTO phenotype_traits(id,organization_id,code,name,data_type) VALUES
 ('e6666666-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','ya','Rendement A','numeric'),
 ('e6666666-0000-0000-0000-00000000e0a2','e1111111-0000-0000-0000-00000000e0a2','yb','Rendement B','numeric'),
 ('e6666666-0000-0000-0000-00000000e0a4','e1111111-0000-0000-0000-00000000e0a1','yc','Rendement C (autre trait, meme org)','numeric');
INSERT INTO trials(id,program_id,code,name) VALUES
 ('e9999999-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','BDT1','BreedDec Trial 1'),
 ('e9999999-0000-0000-0000-00000000e0a3','e5555555-0000-0000-0000-00000000e0a3','BDT2','BreedDec Trial on sibling program'),
 ('e9999999-0000-0000-0000-00000000e0a2','e5555555-0000-0000-0000-00000000e0a2','BDT3','BreedDec Trial B'),
 ('e9999999-0000-0000-0000-00000000e0a4','e5555555-0000-0000-0000-00000000e0a1','BDT4','BreedDec Trial 4 (meme programme que Trial 1)');
INSERT INTO trial_entries(id,trial_id,code,label,scientific_role) VALUES
 ('eaaaaaaa-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','E1','Entry 1','genotype'),
 ('eaaaaaaa-0000-0000-0000-00000000e0a2','e9999999-0000-0000-0000-00000000e0a1','E2','Entry 2','genotype');
-- A phenotype/evaluation marking E1 operationally eliminated under the
-- EXISTING scoring workflow, to exercise breeding_candidate_pool's
-- operationally_eliminated diagnostic.
INSERT INTO phenotypes(id,program_id,phenotype_code,trial_entry_id) VALUES
 ('eccccccc-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','BD-PHENO-1','eaaaaaaa-0000-0000-0000-00000000e0a1');
INSERT INTO phenotype_evaluations(id,phenotype_id,evaluation_date,is_eliminated) VALUES
 ('eddddddd-0000-0000-0000-00000000e0a1','eccccccc-0000-0000-0000-00000000e0a1','2026-01-01',true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a1',true);

-- ───────── breeding_decision_scenarios ─────────
INSERT INTO breeding_decision_scenarios(id,organization_id,program_id,trial_id,name,candidate_eligibility,selection_proportion) VALUES
 ('ebbbbbbb-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a2','e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Scenario 1','all',20);
SELECT pass('a scenario can be created by a member of its own program''s organization');
SELECT is(
  (SELECT organization_id FROM breeding_decision_scenarios WHERE id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  'e1111111-0000-0000-0000-00000000e0a1'::uuid,
  'organization_id is re-derived from program_id, overriding a forged client value'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a2','e9999999-0000-0000-0000-00000000e0a2','Forged scenario',20)$$,
  '42501', NULL, 'a user cannot create a scenario for another organization''s program'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a3','Cross-program trial',20)$$,
  '23514', NULL, 'trial_id must belong to the same program as the scenario, even a sibling program in the same organization'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,candidate_type,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Bad candidate type','family',20)$$,
  '23514', NULL, 'candidate_type is restricted to the trial_entry allowlist'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Zero proportion',0)$$,
  '23514', NULL, 'selection_proportion must be strictly greater than zero'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Over 100',101)$$,
  '23514', NULL, 'selection_proportion cannot exceed 100'
);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Scenario 1',30)$$,
  '23505', NULL, 'scenario name must be unique within a trial'
);

-- A second scenario on the sibling program, for cross-program source-run
-- rejection below.
INSERT INTO breeding_decision_scenarios(id,program_id,trial_id,name,selection_proportion) VALUES
 ('ebbbbbbb-0000-0000-0000-00000000e0a3','e5555555-0000-0000-0000-00000000e0a3','e9999999-0000-0000-0000-00000000e0a3','Scenario on sibling program',25);

RESET ROLE;
-- Org B's own scenario, created as org B, for the genuine cross-org
-- rejection test below (distinct from the sibling-program, same-org case
-- just above).
INSERT INTO breeding_decision_scenarios(id,program_id,trial_id,name,selection_proportion) VALUES
 ('ebbbbbbb-0000-0000-0000-00000000e0a2','e5555555-0000-0000-0000-00000000e0a2','e9999999-0000-0000-0000-00000000e0a2','Org B scenario',15);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a1',true);

-- ───────── breeding_decision_scenario_traits ─────────
INSERT INTO breeding_decision_scenario_traits(id,scenario_id,trait_id,direction,source_type) VALUES
 ('ee000001-0000-0000-0000-00000000e0a1','ebbbbbbb-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a1','higher_is_better','RAW_PHENOTYPIC');
SELECT pass('a scenario trait can be added with RAW_PHENOTYPIC source and no source_run_id');

SELECT throws_ok(
  format(
    $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type) VALUES (%L,'e6666666-0000-0000-0000-00000000e0a1','target_value','RAW_PHENOTYPIC')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'direction=target_value requires a non-NULL target_value'
);

SELECT throws_ok(
  format(
    $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,target_value,source_type) VALUES (%L,'e6666666-0000-0000-0000-00000000e0a1','higher_is_better',42,'RAW_PHENOTYPIC')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'target_value must be NULL unless direction=target_value'
);

SELECT throws_ok(
  format(
    $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type) VALUES (%L,'e6666666-0000-0000-0000-00000000e0a1','higher_is_better','WAASBY_STABILITY_PERFORMANCE')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'WAASBY_STABILITY_PERFORMANCE requires a non-NULL source_run_id'
);

SELECT throws_ok(
  format(
    $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type) VALUES (%L,'e6666666-0000-0000-0000-00000000e0a2','higher_is_better','RAW_PHENOTYPIC')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'trait_id must belong to the same organization as the scenario'
);

RESET ROLE;
-- A completed analytics_runs row under the SIBLING program (same org),
-- used only to prove source_run_id's own program must match the
-- scenario's program - not merely its organization.
INSERT INTO analytics_runs(
  organization_id, program_id, trait_id, analysis_type, specification, dataset_fingerprint, status, engine_name, engine_version, created_by
) VALUES (
  'e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a3','e6666666-0000-0000-0000-00000000e0a1',
  'trait_intelligence','{}'::jsonb,repeat('e',64),'completed','breedops-ts-stats','1.0.0','e3333333-0000-0000-0000-00000000e0a1'
) RETURNING id \gset sibling_run_
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a1',true);

SELECT throws_ok(
  format(
    $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type,source_run_id) VALUES (%L,'e6666666-0000-0000-0000-00000000e0a1','higher_is_better','WAASBY_STABILITY_PERFORMANCE',%L)$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1', :'sibling_run_id'
  ),
  '23514', NULL, 'source_run_id must belong to the same program as the scenario, even a sibling program in the same organization'
);

INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type) VALUES
 ('ebbbbbbb-0000-0000-0000-00000000e0a3','e6666666-0000-0000-0000-00000000e0a1','higher_is_better','RAW_PHENOTYPIC');
SELECT pass('a user can write a trait row for their own organization''s sibling-program scenario (team-wide write, same as can_write_program elsewhere)');

-- Uses org B's own trait (e0a2) so the trigger's trait/scenario org check
-- passes and the assertion isolates RLS alone, not the trigger (same
-- discipline as the environment/site pairing in multi-environment.sql).
SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type) VALUES ('ebbbbbbb-0000-0000-0000-00000000e0a2','e6666666-0000-0000-0000-00000000e0a2','higher_is_better','RAW_PHENOTYPIC')$$,
  '42501', NULL, 'a user cannot write a trait row for another organization''s scenario, even knowing its id and using an internally-consistent (same-org) trait'
);

-- ───────── Scenario trait source_run_id: trial/trait/analysis_type
-- hardening (independent review, migration 000034) - a source run must
-- match the scenario trait's own trial AND exact trait, and must itself
-- be a multi_environment run; cross-program alone (tested above) is not
-- enough. ─────────
RESET ROLE;
-- The scenario trait under test here uses trait yc (e0a4) - NOT ya
-- (e0a1), which this same scenario already has a row for (test #9
-- above) and would otherwise collide on UNIQUE(scenario_id, trait_id).
INSERT INTO analytics_runs(
  id, organization_id, program_id, trait_id, analysis_type, trial_id, specification, dataset_fingerprint, status, engine_name, engine_version, created_by
) VALUES
 ('ef000001-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a1',
  'multi_environment','e9999999-0000-0000-0000-00000000e0a1','{}'::jsonb,repeat('1',64),'completed','breedops-r-mixed-models','1.0.0','e3333333-0000-0000-0000-00000000e0a1'),
 ('ef000002-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4',
  'multi_environment','e9999999-0000-0000-0000-00000000e0a4','{}'::jsonb,repeat('2',64),'completed','breedops-r-mixed-models','1.0.0','e3333333-0000-0000-0000-00000000e0a1'),
 ('ef000003-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4',
  'trait_intelligence',NULL,'{}'::jsonb,repeat('3',64),'completed','breedops-ts-stats','1.0.0','e3333333-0000-0000-0000-00000000e0a1'),
 ('ef000004-0000-0000-0000-00000000e0a1','e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4',
  'multi_environment','e9999999-0000-0000-0000-00000000e0a1','{}'::jsonb,repeat('4',64),'completed','breedops-r-mixed-models','1.0.0','e3333333-0000-0000-0000-00000000e0a1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a1',true);

SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type,source_run_id) VALUES ('ebbbbbbb-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4','higher_is_better','MET_ENTRY_PREDICTION','ef000001-0000-0000-0000-00000000e0a1')$$,
  '23514', NULL, 'source_run_id computed for a DIFFERENT trait in the same trial is rejected, even same program/org'
);
SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type,source_run_id) VALUES ('ebbbbbbb-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4','higher_is_better','MET_ENTRY_PREDICTION','ef000002-0000-0000-0000-00000000e0a1')$$,
  '23514', NULL, 'source_run_id computed for a DIFFERENT trial in the same program is rejected, even with the right trait'
);
SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type,source_run_id) VALUES ('ebbbbbbb-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4','higher_is_better','MET_ENTRY_PREDICTION','ef000003-0000-0000-0000-00000000e0a1')$$,
  '23514', NULL, 'a non-multi_environment source_run_id is rejected, even with the right trait and no trial'
);
INSERT INTO breeding_decision_scenario_traits(scenario_id,trait_id,direction,source_type,source_run_id) VALUES
 ('ebbbbbbb-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a4','higher_is_better','MET_ENTRY_PREDICTION','ef000004-0000-0000-0000-00000000e0a1');
SELECT pass('a source_run_id matching the scenario trait''s own program/trial/trait and analysis_type=multi_environment is accepted');
DELETE FROM breeding_decision_scenario_traits WHERE scenario_id='ebbbbbbb-0000-0000-0000-00000000e0a1' AND trait_id='e6666666-0000-0000-0000-00000000e0a4';

-- ───────── analytics_runs: breeding_decision analysis type ─────────
INSERT INTO analytics_runs(
  organization_id, program_id, analysis_type, scenario_id, trial_id, specification, dataset_fingerprint, status, result, n_observations, engine_name, engine_version, created_by
) VALUES (
  'e1111111-0000-0000-0000-00000000e0a2', -- forged org, should be re-derived
  'e5555555-0000-0000-0000-00000000e0a1',
  'breeding_decision',
  'ebbbbbbb-0000-0000-0000-00000000e0a1',
  'e9999999-0000-0000-0000-00000000e0a1',
  '{"method":"selection_mgidi_v1"}'::jsonb,
  repeat('f', 64),
  'completed',
  '{"candidates":[]}'::jsonb,
  2,
  'breedops-r-selection',
  '1.0.0',
  'e3333333-0000-0000-0000-00000000e0a1'
);
SELECT pass('a breeding_decision analytics_runs row can be created with trait_id left NULL');
SELECT is(
  (SELECT organization_id FROM analytics_runs WHERE scenario_id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  'e1111111-0000-0000-0000-00000000e0a1'::uuid,
  'organization_id is re-derived from program_id for a breeding_decision run too, overriding a forged client value'
);

SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,analysis_type,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','breeding_decision','e9999999-0000-0000-0000-00000000e0a1','{}'::jsonb,repeat('1',64),'completed','breedops-r-selection','1.0.0','e3333333-0000-0000-0000-00000000e0a1')$$,
  '23514', NULL, 'scenario_id is required when analysis_type is breeding_decision'
);

SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,analysis_type,scenario_id,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','breeding_decision',%L,'e9999999-0000-0000-0000-00000000e0a1','{}'::jsonb,repeat('2',64),'completed','breedops-r-selection','1.0.0','e3333333-0000-0000-0000-00000000e0a1')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a3'
  ),
  '23514', NULL, 'scenario_id must belong to the same program as this run, even a sibling program'
);

SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,analysis_type,scenario_id,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','breeding_decision',%L,'e9999999-0000-0000-0000-00000000e0a3','{}'::jsonb,repeat('3',64),'completed','breedops-r-selection','1.0.0','e3333333-0000-0000-0000-00000000e0a1')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'trial_id must equal the scenario''s own trial_id'
);

SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,analysis_type,trial_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','trait_intelligence','e9999999-0000-0000-0000-00000000e0a1','{}'::jsonb,repeat('4',64),'completed','breedops-ts-stats','1.0.0','e3333333-0000-0000-0000-00000000e0a1')$$,
  '23514', NULL, 'trait_id is still required for trait_intelligence after the breeding_decision rewrite (non-regression)'
);

SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,analysis_type,scenario_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('e1111111-0000-0000-0000-00000000e0a1','e5555555-0000-0000-0000-00000000e0a1','e6666666-0000-0000-0000-00000000e0a1','trait_intelligence',%L,'{}'::jsonb,repeat('5',64),'completed','breedops-ts-stats','1.0.0','e3333333-0000-0000-0000-00000000e0a1')$$,
    'ebbbbbbb-0000-0000-0000-00000000e0a1'
  ),
  '23514', NULL, 'scenario_id must be NULL unless analysis_type is breeding_decision'
);

-- ───────── breeding_candidate_pool ─────────
SELECT is(
  (SELECT count(*) FROM breeding_candidate_pool('e9999999-0000-0000-0000-00000000e0a1')),
  2::bigint, 'breeding_candidate_pool returns every trial_entry for its own organization''s trial'
);
SELECT is(
  (SELECT operationally_eliminated FROM breeding_candidate_pool('e9999999-0000-0000-0000-00000000e0a1') WHERE trial_entry_id='eaaaaaaa-0000-0000-0000-00000000e0a1'),
  true, 'breeding_candidate_pool flags a candidate whose most recent evaluation is_eliminated=true'
);
SELECT is(
  (SELECT operationally_eliminated FROM breeding_candidate_pool('e9999999-0000-0000-0000-00000000e0a1') WHERE trial_entry_id='eaaaaaaa-0000-0000-0000-00000000e0a2'),
  false, 'breeding_candidate_pool defaults operationally_eliminated to false for a candidate with no linked evaluation'
);

-- ───────── Cross-team isolation for the whole schema ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a2',true);
SELECT is(
  (SELECT count(*) FROM breeding_decision_scenarios WHERE organization_id='e1111111-0000-0000-0000-00000000e0a1'),
  0::bigint, 'a user in another organization reads zero breeding_decision_scenarios for this team');
SELECT is(
  (SELECT count(*) FROM breeding_decision_scenario_traits WHERE scenario_id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  0::bigint, 'a user in another organization reads zero scenario traits for this team''s scenario');
SELECT is(
  (SELECT count(*) FROM analytics_runs WHERE scenario_id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  0::bigint, 'a user in another organization reads zero breeding_decision analytics_runs for this team''s scenario');
SELECT is(
  (SELECT count(*) FROM breeding_candidate_pool('e9999999-0000-0000-0000-00000000e0a1')),
  0::bigint, 'breeding_candidate_pool returns zero rows for another organization''s trial, even though it is SECURITY INVOKER (RLS/can_access_program applies inside the function body)');
SELECT throws_ok(
  $$INSERT INTO breeding_decision_scenarios(program_id,trial_id,name,selection_proportion) VALUES ('e5555555-0000-0000-0000-00000000e0a1','e9999999-0000-0000-0000-00000000e0a1','Forged from org B',20)$$,
  '42501', NULL, 'a user in another organization cannot create a scenario for this team''s program, even knowing its id'
);
RESET ROLE;

-- ───────── Soft delete: archiving a scenario never trips RLS, and the
-- archived row stays readable for inspection/restore (same established
-- convention as trials_read/sites_read - deleted_at is lifecycle state,
-- not an authorization boundary). ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2222222-0000-0000-0000-00000000e0a1',true);
UPDATE breeding_decision_scenarios SET deleted_at = now() WHERE id = 'ebbbbbbb-0000-0000-0000-00000000e0a1';
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM breeding_decision_scenarios WHERE id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  true, 'archiving a scenario (deleted_at) is allowed and does not violate RLS'
);
SELECT is(
  (SELECT count(*) FROM breeding_decision_scenarios WHERE id='ebbbbbbb-0000-0000-0000-00000000e0a1'),
  1::bigint, 'an archived scenario stays readable by its own program''s user, for inspection/restore'
);
RESET ROLE;

-- ───────── anon has no grant at all (belt-and-suspenders with RLS) ─────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT 1 FROM breeding_decision_scenarios LIMIT 1$$,
  '42501', NULL, 'anon has no SELECT grant on breeding_decision_scenarios at all, independent of RLS'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
