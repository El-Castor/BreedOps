-- Disposable local test fixtures only. Everything is rolled back.
-- V2-05 legacy location/material mapping workflow (migration 000029):
-- legacy_phenotype_location_summary, legacy_phenotype_material_summary,
-- map_legacy_location_to_environment, map_legacy_material_to_trial_entry.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-00000000c0a1','LegacyMap A','legacy-map-a'),
 ('11111111-0000-0000-0000-00000000c0a2','LegacyMap B','legacy-map-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-00000000c0a1'),
 ('22222222-0000-0000-0000-00000000c0a2');
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('33333333-0000-0000-0000-00000000c0a1','22222222-0000-0000-0000-00000000c0a1','11111111-0000-0000-0000-00000000c0a1','user'),
 ('33333333-0000-0000-0000-00000000c0a2','22222222-0000-0000-0000-00000000c0a2','11111111-0000-0000-0000-00000000c0a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-00000000c0a1','11111111-0000-0000-0000-00000000c0a1','LMA','LegacyMap program A');
INSERT INTO parent_lines(id,program_id,parent_code) VALUES
 ('44444444-0000-0000-0000-00000000c0a1','55555555-0000-0000-0000-00000000c0a1','PARENT-LMA-F'),
 ('44444444-0000-0000-0000-00000000c0a2','55555555-0000-0000-0000-00000000c0a1','PARENT-LMA-M');
INSERT INTO crosses(id,program_id,cross_code,female_parent_id,male_parent_id) VALUES
 ('44444444-0000-0000-0000-00000000c0b1','55555555-0000-0000-0000-00000000c0a1','CROSS-LMA','44444444-0000-0000-0000-00000000c0a1','44444444-0000-0000-0000-00000000c0a2');
INSERT INTO families(id,program_id,cross_id,family_code) VALUES
 ('66666666-0000-0000-0000-00000000c0a1','55555555-0000-0000-0000-00000000c0a1','44444444-0000-0000-0000-00000000c0b1','FAM-LMA-1');
INSERT INTO sites(id,organization_id,code,name) VALUES
 ('77777777-0000-0000-0000-00000000c0a1','11111111-0000-0000-0000-00000000c0a1','SITE-LMA','Site LMA');
INSERT INTO environments(id,program_id,site_id,code,name) VALUES
 ('88888888-0000-0000-0000-00000000c0a1','55555555-0000-0000-0000-00000000c0a1','77777777-0000-0000-0000-00000000c0a1','ENV-LMA','Env LMA'),
 ('88888888-0000-0000-0000-00000000c0a2','55555555-0000-0000-0000-00000000c0a1','77777777-0000-0000-0000-00000000c0a1','ENV-LMA2','Env LMA 2');
INSERT INTO trials(id,program_id,code,name) VALUES
 ('99999999-0000-0000-0000-00000000c0a1','55555555-0000-0000-0000-00000000c0a1','TRIAL-LMA','Trial LMA');
-- Only ENV-LMA (not ENV-LMA2) is actually part of this trial.
INSERT INTO trial_environments(trial_id,environment_id) VALUES
 ('99999999-0000-0000-0000-00000000c0a1','88888888-0000-0000-0000-00000000c0a1');
INSERT INTO trial_entries(id,trial_id,code,label,scientific_role) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000c0a1','99999999-0000-0000-0000-00000000c0a1','ENTRY-LMA','Entry LMA','family');

-- Legacy phenotypes: three share location 'Champ Nord', unmapped; one
-- already has an environment_id (must be excluded from the summary and
-- untouched by the bulk mapping); two share family_id, unmapped to any
-- trial_entry, one of them already has environment_id = ENV-LMA (inside
-- the target trial - mappable) and the other has environment_id =
-- ENV-LMA2 (NOT inside the target trial - must be skipped, not fail the
-- whole batch).
INSERT INTO phenotypes(id,program_id,phenotype_code,location,family_id,environment_id) VALUES
 ('bbbbbbbb-0000-0000-0000-00000000c0a1','55555555-0000-0000-0000-00000000c0a1','PH-LMA-1','Champ Nord',NULL,NULL),
 ('bbbbbbbb-0000-0000-0000-00000000c0a2','55555555-0000-0000-0000-00000000c0a1','PH-LMA-2','Champ Nord',NULL,NULL),
 ('bbbbbbbb-0000-0000-0000-00000000c0a3','55555555-0000-0000-0000-00000000c0a1','PH-LMA-3','Champ Nord','66666666-0000-0000-0000-00000000c0a1','88888888-0000-0000-0000-00000000c0a1'),
 ('bbbbbbbb-0000-0000-0000-00000000c0a4','55555555-0000-0000-0000-00000000c0a1','PH-LMA-4','Champ Nord déjà mappé',NULL,'88888888-0000-0000-0000-00000000c0a1'),
 ('bbbbbbbb-0000-0000-0000-00000000c0a5','55555555-0000-0000-0000-00000000c0a1','PH-LMA-5',NULL,'66666666-0000-0000-0000-00000000c0a1','88888888-0000-0000-0000-00000000c0a2');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000c0a1',true);

-- ───────── Summaries ─────────
SELECT is(
  (SELECT phenotype_count FROM legacy_phenotype_location_summary('55555555-0000-0000-0000-00000000c0a1') WHERE location = 'Champ Nord'),
  2::bigint,
  'location summary counts only still-unmapped phenotypes sharing the exact location text (PH-LMA-3 already has an environment_id, excluded)'
);
SELECT is(
  (SELECT count(*) FROM legacy_phenotype_location_summary('55555555-0000-0000-0000-00000000c0a1') WHERE location = 'Champ Nord déjà mappé'),
  0::bigint,
  'a location whose only phenotype is already mapped does not appear in the summary at all'
);
SELECT is(
  (SELECT phenotype_count FROM legacy_phenotype_material_summary('55555555-0000-0000-0000-00000000c0a1') WHERE family_id = '66666666-0000-0000-0000-00000000c0a1'),
  2::bigint,
  'material summary counts phenotypes sharing the same family_id, regardless of their environment_id, as long as trial_entry_id is still unmapped'
);

-- ───────── map_legacy_location_to_environment ─────────
SELECT is(
  map_legacy_location_to_environment('55555555-0000-0000-0000-00000000c0a1', 'Champ Nord', '88888888-0000-0000-0000-00000000c0a1'),
  2,
  'mapping a location updates exactly the still-unmapped phenotypes sharing that exact text (2, not 3 - PH-LMA-3 already had an environment_id)'
);
SELECT is(
  (SELECT environment_id FROM phenotypes WHERE id = 'bbbbbbbb-0000-0000-0000-00000000c0a1'),
  '88888888-0000-0000-0000-00000000c0a1'::uuid,
  'the previously-unmapped phenotype is now linked to the chosen environment'
);
SELECT is(
  (SELECT environment_id FROM phenotypes WHERE id = 'bbbbbbbb-0000-0000-0000-00000000c0a3'),
  '88888888-0000-0000-0000-00000000c0a1'::uuid,
  'a phenotype that already had an environment_id is never overwritten by the bulk mapping'
);
SELECT is(
  map_legacy_location_to_environment('55555555-0000-0000-0000-00000000c0a1', 'Champ Nord', '88888888-0000-0000-0000-00000000c0a2'),
  0,
  're-running the same mapping afterwards updates zero rows - nothing left unmapped for that location'
);

-- ───────── map_legacy_material_to_trial_entry ─────────
SELECT is(
  map_legacy_material_to_trial_entry('55555555-0000-0000-0000-00000000c0a1', '66666666-0000-0000-0000-00000000c0a1', NULL, 'aaaaaaaa-0000-0000-0000-00000000c0a1'),
  1,
  'mapping material updates only the phenotype whose existing environment_id (ENV-LMA) is actually part of the target trial - the other (ENV-LMA2, outside the trial) is skipped, not failed'
);
SELECT is(
  (SELECT trial_entry_id FROM phenotypes WHERE id = 'bbbbbbbb-0000-0000-0000-00000000c0a3'),
  'aaaaaaaa-0000-0000-0000-00000000c0a1'::uuid,
  'the in-trial phenotype is now linked to the chosen trial entry'
);
SELECT is(
  (SELECT trial_entry_id FROM phenotypes WHERE id = 'bbbbbbbb-0000-0000-0000-00000000c0a5'),
  NULL::uuid,
  'the out-of-trial phenotype (ENV-LMA2 not in TRIAL-LMA) is left unmapped rather than silently forced in, or aborting the whole batch'
);
SELECT throws_ok(
  $$SELECT map_legacy_material_to_trial_entry('55555555-0000-0000-0000-00000000c0a1', NULL, NULL, '00000000-0000-0000-0000-000000000000')$$,
  '23514', NULL, 'mapping to a trial_entry_id that does not resolve raises, rather than silently updating zero rows ambiguously'
);

-- ───────── Cross-org isolation ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000c0a2',true);
SELECT is(
  (SELECT count(*) FROM legacy_phenotype_location_summary('55555555-0000-0000-0000-00000000c0a1')),
  0::bigint,
  'a user from another organization sees no unmapped locations for a program they cannot access'
);
SELECT is(
  map_legacy_location_to_environment('55555555-0000-0000-0000-00000000c0a1', 'Champ Nord déjà mappé', '88888888-0000-0000-0000-00000000c0a1'),
  0,
  'a user from another organization cannot map a location for a program they cannot access - RLS silently excludes every row, never an exception that would leak the program''s existence'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
