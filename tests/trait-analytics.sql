-- Disposable local test fixtures only. Everything is rolled back.
-- V2-04 trait analytics: analytics_runs provenance table (migration
-- 000027). Scientific computation itself (stats/ICC/fingerprint) is unit
-- tested in TypeScript (tests/analytics-stats.test.ts,
-- tests/analytics-icc.test.ts, tests/analytics-fingerprint.test.ts); this
-- file is purely about the database-level authorization/integrity
-- boundary.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-00000000a0b1','TraitAnalytics A','trait-analytics-a'),
 ('11111111-0000-0000-0000-00000000a0b2','TraitAnalytics B','trait-analytics-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-00000000a0b1'),
 ('22222222-0000-0000-0000-00000000a0b2');
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('33333333-0000-0000-0000-00000000a0b1','22222222-0000-0000-0000-00000000a0b1','11111111-0000-0000-0000-00000000a0b1','user'),
 ('33333333-0000-0000-0000-00000000a0b2','22222222-0000-0000-0000-00000000a0b2','11111111-0000-0000-0000-00000000a0b2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-00000000a0b1','11111111-0000-0000-0000-00000000a0b1','TAA','TraitAnalytics program A'),
 ('55555555-0000-0000-0000-00000000a0b2','11111111-0000-0000-0000-00000000a0b2','TAB','TraitAnalytics program B');
INSERT INTO phenotype_traits(id,organization_id,code,name,data_type) VALUES
 ('66666666-0000-0000-0000-00000000a0b1','11111111-0000-0000-0000-00000000a0b1','vigor_a','Vigueur A','numeric'),
 ('66666666-0000-0000-0000-00000000a0b2','11111111-0000-0000-0000-00000000a0b1','height_a','Hauteur A','numeric'),
 ('66666666-0000-0000-0000-00000000b0b2','11111111-0000-0000-0000-00000000a0b2','vigor_b','Vigueur B','numeric');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a0b1',true);

-- ───────── Scope validation and organization_id derivation ─────────
-- A forged organization_id is discarded and replaced with the one derived
-- from program_id, exactly like media_assets/notifications already do.
INSERT INTO analytics_runs(
  id, organization_id, program_id, trait_id, specification, dataset_fingerprint, status, result, n_observations, engine_name, engine_version, created_by
) VALUES (
  '77777777-0000-0000-0000-00000000a0b1',
  '11111111-0000-0000-0000-00000000a0b2', -- forged: org B's id, on program A
  '55555555-0000-0000-0000-00000000a0b1',
  '66666666-0000-0000-0000-00000000a0b1',
  '{"programId":"p1"}'::jsonb,
  repeat('a', 64),
  'completed',
  '{"n":10}'::jsonb,
  10,
  'breedops-ts-stats',
  '1.0.0',
  '33333333-0000-0000-0000-00000000a0b1'
);
SELECT is(
  (SELECT organization_id FROM analytics_runs WHERE id='77777777-0000-0000-0000-00000000a0b1'),
  '11111111-0000-0000-0000-00000000a0b1'::uuid,
  'organization_id is re-derived from program_id, overriding a forged client value'
);

SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000b0b2','{}'::jsonb,repeat('b',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '23514', NULL, 'a trait_id from another organization is rejected'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,secondary_trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000b0b2','{}'::jsonb,repeat('c',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '23514', NULL, 'a secondary_trait_id from another organization is rejected'
);

-- ───────── can_write_program is required, not only can_write_team ─────────
-- Both program_id and trait_id point at org B here (so the scope trigger's
-- own trait/program consistency check passes cleanly) - this isolates the
-- RLS boundary itself: an org-A user still cannot attach a run to org B's
-- program merely because the trait reference happens to agree with it.
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b2','66666666-0000-0000-0000-00000000b0b2','{}'::jsonb,repeat('d',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '42501', NULL, 'attaching a run to another team''s program is rejected by RLS'
);

-- ───────── Column-level CHECK constraints ─────────
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,analysis_type,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','not_a_real_type','{}'::jsonb,repeat('e',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '23514', NULL, 'an unlisted analysis_type is rejected'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','{}'::jsonb,'not-a-sha256-hash','completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '23514', NULL, 'a dataset_fingerprint that is not a 64-character hex digest is rejected'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','{}'::jsonb,repeat('f',64),'running','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
  '23514', NULL, 'an unlisted status value is rejected'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by,started_at,completed_at)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','{}'::jsonb,repeat('1',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1',now(),now() - interval '1 hour')$$,
  '23514', NULL, 'a completed_at earlier than started_at is rejected'
);
SELECT throws_ok(
  format(
    $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
      VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1',%L::jsonb,repeat('2',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b1')$$,
    jsonb_build_object('padding', repeat('x', 20100))::text
  ),
  '23514', NULL, 'a specification over the 20000-byte size cap is rejected'
);

-- ───────── Cross-team isolation ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a0b2',true);
SELECT is(
  (SELECT count(*) FROM analytics_runs WHERE organization_id='11111111-0000-0000-0000-00000000a0b1'),
  0::bigint, 'a user in another organization reads zero analytics runs for this team'
);
SELECT throws_ok(
  $$INSERT INTO analytics_runs(organization_id,program_id,trait_id,specification,dataset_fingerprint,status,engine_name,engine_version,created_by)
    VALUES ('11111111-0000-0000-0000-00000000a0b1','55555555-0000-0000-0000-00000000a0b1','66666666-0000-0000-0000-00000000a0b1','{}'::jsonb,repeat('3',64),'completed','breedops-ts-stats','1.0.0','33333333-0000-0000-0000-00000000a0b2')$$,
  '42501', NULL, 'a user in another organization cannot create a run for this team''s program, even knowing its id'
);
SELECT throws_ok(
  format(
    $$UPDATE analytics_runs SET status='failed' WHERE id=%L$$,
    '77777777-0000-0000-0000-00000000a0b1'
  ),
  '42501', NULL, 'a user in another organization cannot update this team''s analytics run'
);
RESET ROLE;

-- ───────── Immutable provenance: no UPDATE/DELETE grant at all ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a0b1',true);
SELECT throws_ok(
  format(
    $$UPDATE analytics_runs SET status='failed' WHERE id=%L$$,
    '77777777-0000-0000-0000-00000000a0b1'
  ),
  '42501', NULL, 'even the run''s own creator cannot update an analytics run - no UPDATE grant exists at all'
);
SELECT throws_ok(
  format(
    $$DELETE FROM analytics_runs WHERE id=%L$$,
    '77777777-0000-0000-0000-00000000a0b1'
  ),
  '42501', NULL, 'even the run''s own creator cannot delete an analytics run - no DELETE grant exists at all'
);
SELECT is(
  (SELECT status FROM analytics_runs WHERE id='77777777-0000-0000-0000-00000000a0b1'),
  'completed', 'the run''s status is still exactly what it was created with'
);

-- ───────── Program/team consistency on a second, independent run ─────────
INSERT INTO analytics_runs(organization_id,program_id,trait_id,secondary_trait_id,specification,dataset_fingerprint,status,result,n_observations,engine_name,engine_version,created_by) VALUES (
  '11111111-0000-0000-0000-00000000a0b1',
  '55555555-0000-0000-0000-00000000a0b1',
  '66666666-0000-0000-0000-00000000a0b1',
  '66666666-0000-0000-0000-00000000a0b2',
  '{"traitId":"vigor_a","secondaryTraitId":"height_a"}'::jsonb,
  repeat('4', 64),
  'not_estimable',
  NULL,
  0,
  'breedops-ts-stats',
  '1.0.0',
  '33333333-0000-0000-0000-00000000a0b1'
);
SELECT pass('a second run with a same-organization secondary_trait_id and NULL result (not_estimable) is created');
SELECT is(
  (SELECT count(*) FROM analytics_runs WHERE program_id='55555555-0000-0000-0000-00000000a0b1'),
  2::bigint, 'the owning team now sees both of its own analytics runs'
);

-- ───────── trait_observation_dataset / program_evaluation_dataset RLS ─────────
-- Both are SECURITY INVOKER: a user from another organization gets zero
-- rows even when passing another team's exact program/trait ids, since
-- can_access_program() inside the function denies it (and the underlying
-- RLS on phenotype_trait_values/phenotype_evaluations/phenotypes still
-- applies on top).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a0b2',true);
SELECT is(
  (SELECT count(*) FROM trait_observation_dataset(
    '55555555-0000-0000-0000-00000000a0b1', '66666666-0000-0000-0000-00000000a0b1')),
  0::bigint, 'trait_observation_dataset returns zero rows for another organization''s program/trait'
);
SELECT is(
  (SELECT count(*) FROM program_evaluation_dataset('55555555-0000-0000-0000-00000000a0b1')),
  0::bigint, 'program_evaluation_dataset returns zero rows for another organization''s program'
);
RESET ROLE;

-- ───────── A categorical/boolean trait is rejected by trait_observation_dataset ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a0b1',true);
INSERT INTO phenotype_traits(id,organization_id,code,name,data_type,allowed_values) VALUES
 ('66666666-0000-0000-0000-00000000c0b1','11111111-0000-0000-0000-00000000a0b1','color_a','Couleur A','categorical',ARRAY['rouge','vert']);
SELECT is(
  (SELECT count(*) FROM trait_observation_dataset(
    '55555555-0000-0000-0000-00000000a0b1', '66666666-0000-0000-0000-00000000c0b1')),
  0::bigint, 'trait_observation_dataset never feeds a categorical trait into the numeric analysis path'
);

-- ───────── An absurd row_limit request never errors (LEAST(...,5000) always clamps it) ─────────
SELECT lives_ok(
  $$SELECT count(*) FROM trait_observation_dataset(
    '55555555-0000-0000-0000-00000000a0b1', '66666666-0000-0000-0000-00000000a0b1',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 999999999)$$,
  'requesting far more than the 5000-row cap is accepted and simply clamped, never an error'
);

SELECT * FROM finish();
ROLLBACK;
