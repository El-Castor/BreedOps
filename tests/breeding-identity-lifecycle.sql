-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(29);
INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-0000000000a1','Identity A','identity-test-a'),
 ('11111111-0000-0000-0000-0000000000a2','Identity B','identity-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-0000000000a1'),
 ('22222222-0000-0000-0000-0000000000a2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('22222222-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a1','user'),
 ('22222222-0000-0000-0000-0000000000a2','11111111-0000-0000-0000-0000000000a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a1','id-t.st','Identity program');
-- Historical manual code and a legacy value already in the generated format.
INSERT INTO parent_lines(id,program_id,parent_code,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','LegacyManual','Legacy'),
 ('77777777-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a1','IDTST-P-0007','Legacy formatted');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000a1',true);
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000b1','55555555-0000-0000-0000-0000000000a1','Female'),
 ('77777777-0000-0000-0000-0000000000b2','55555555-0000-0000-0000-0000000000a1','Male');
SELECT is((SELECT parent_code FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000b1'),'IDTST-P-0008','parent code generated after the highest existing formatted code');
SELECT is((SELECT parent_code FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000b2'),'IDTST-P-0009','parent codes are sequential per program and type');
SELECT is((SELECT parent_code FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000a1'),'LegacyManual','legacy manual code preserved');
INSERT INTO crosses(id,program_id,female_parent_id,male_parent_id,pollination_date) VALUES
 ('88888888-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000b1','77777777-0000-0000-0000-0000000000b2',CURRENT_DATE);
SELECT is((SELECT cross_code FROM crosses WHERE id='88888888-0000-0000-0000-0000000000a1'),'IDTST-X-0001','cross code generated');
INSERT INTO families(id,program_id,cross_id) VALUES
 ('99999999-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1');
SELECT is((SELECT family_code FROM families WHERE id='99999999-0000-0000-0000-0000000000a1'),'IDTST-F-0001','family code generated');
INSERT INTO seed_lots(id,program_id,cross_id,family_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-0000000000a1');
SELECT is((SELECT seed_lot_code FROM seed_lots WHERE id='aaaaaaaa-0000-0000-0000-0000000000a1'),'IDTST-L-0001','seed lot code generated');
INSERT INTO phenotypes(id,program_id,family_id,seed_lot_id) VALUES
 ('bbbbbbbb-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a1');
SELECT is((SELECT phenotype_code FROM phenotypes WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1'),'IDTST-I-0001','phenotype code generated');
SELECT throws_ok($$UPDATE parent_lines SET parent_code='Renamed' WHERE id='77777777-0000-0000-0000-0000000000b1'$$,'23514','Breeding business codes are immutable','generated code cannot be rewritten');
SELECT throws_ok($$UPDATE parent_lines SET parent_code='Renamed' WHERE id='77777777-0000-0000-0000-0000000000a1'$$,'23514','Breeding business codes are immutable','legacy code cannot be rewritten');
SELECT throws_ok($$SELECT * FROM breeding_code_counters$$,'42501',NULL,'counters are not readable by clients');
SELECT throws_ok($$UPDATE breeding_code_counters SET last_value=1$$,'42501',NULL,'counters are not writable by clients');
SELECT throws_ok($$SELECT next_breeding_business_code('55555555-0000-0000-0000-0000000000a1','parent')$$,'42501',NULL,'code generator is not callable by clients');

-- Lifecycle: archive keeps the row and its lineage, restore makes it usable again.
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000b3','55555555-0000-0000-0000-0000000000a1','Third');
WITH changed AS (UPDATE parent_lines SET deleted_at=NOW() WHERE id='77777777-0000-0000-0000-0000000000b1' RETURNING id)
SELECT is(count(*),1::bigint,'team user archives a parent') FROM changed;
SELECT is((SELECT count(*) FROM parent_lines WHERE program_id='55555555-0000-0000-0000-0000000000a1' AND deleted_at IS NULL AND id='77777777-0000-0000-0000-0000000000b1'),0::bigint,'archived parent excluded from active selector query');
SELECT is((SELECT count(*) FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000b1' AND deleted_at IS NOT NULL),1::bigint,'archived parent remains readable for show archived');
SELECT is((SELECT female_parent_id FROM crosses WHERE id='88888888-0000-0000-0000-0000000000a1'),'77777777-0000-0000-0000-0000000000b1'::uuid,'historical cross keeps archived parent');
SELECT throws_ok($$INSERT INTO crosses(program_id,female_parent_id,male_parent_id) VALUES ('55555555-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000b1','77777777-0000-0000-0000-0000000000b3')$$,'23514',NULL,'archived parent rejected for a new cross');
WITH changed AS (UPDATE crosses SET deleted_at=NOW() WHERE id='88888888-0000-0000-0000-0000000000a1' RETURNING id)
SELECT is(count(*),1::bigint,'cross with archived parent can be archived') FROM changed;
WITH changed AS (UPDATE families SET deleted_at=NOW() WHERE id='99999999-0000-0000-0000-0000000000a1' RETURNING id)
SELECT is(count(*),1::bigint,'family archived') FROM changed;
WITH changed AS (UPDATE seed_lots SET deleted_at=NOW() WHERE id='aaaaaaaa-0000-0000-0000-0000000000a1' RETURNING id)
SELECT is(count(*),1::bigint,'seed lot archived') FROM changed;
UPDATE parent_lines SET deleted_at=NULL WHERE id='77777777-0000-0000-0000-0000000000b1';
SELECT lives_ok($$INSERT INTO crosses(program_id,female_parent_id,male_parent_id) VALUES ('55555555-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000b1','77777777-0000-0000-0000-0000000000b3')$$,'restored parent selectable for a new cross');
SELECT is((SELECT parent_code FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000b1'),'IDTST-P-0008','code stable across archive and restore');

-- Rich parent provenance and PostgreSQL-computed yield (000015).
UPDATE parent_lines SET accession='GB-0042', source='Station A', origin='Landrace selection'
  WHERE id='77777777-0000-0000-0000-0000000000b3';
SELECT is((SELECT accession||'|'||source FROM parent_lines WHERE id='77777777-0000-0000-0000-0000000000b3'),'GB-0042|Station A','parent provenance fields persist');
SELECT throws_ok($$UPDATE parent_lines SET accession='' WHERE id='77777777-0000-0000-0000-0000000000b3'$$,'23514',NULL,'empty accession rejected');
UPDATE crosses SET pollinated_units=10, total_seeds=45 WHERE id='88888888-0000-0000-0000-0000000000a1';
SELECT is((SELECT seed_yield FROM program_cross_yields('55555555-0000-0000-0000-0000000000a1') WHERE cross_id='88888888-0000-0000-0000-0000000000a1'),4.50::numeric,'yield computed by PostgreSQL');
SELECT is((SELECT deleted_at IS NOT NULL FROM crosses WHERE id='88888888-0000-0000-0000-0000000000a1'),true,'yield source cross is archived');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000a2',true);
SELECT is((SELECT count(*) FROM parent_lines WHERE program_id='55555555-0000-0000-0000-0000000000a1'),0::bigint,'other team cannot read archived or active records');
WITH changed AS (UPDATE parent_lines SET deleted_at=NOW() WHERE id='77777777-0000-0000-0000-0000000000b2' RETURNING id)
SELECT is(count(*),0::bigint,'other team cannot archive') FROM changed;
SELECT is((SELECT count(*) FROM program_cross_yields('55555555-0000-0000-0000-0000000000a1')),0::bigint,'other team gets no yields');
SELECT * FROM finish();
ROLLBACK;
