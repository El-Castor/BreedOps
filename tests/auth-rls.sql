-- Disposable local test database only. Fixtures are rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);
INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-000000000001','Test A','auth-test-a'),
 ('11111111-0000-0000-0000-000000000002','Test B','auth-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000002'),
 ('22222222-0000-0000-0000-000000000003'),
 ('22222222-0000-0000-0000-000000000004');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','user'),
 ('22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002','team_admin'),
 ('22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000001','system_admin'),
 ('22222222-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000002','system_admin');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM organizations),0::bigint,'anonymous cannot read teams');
SELECT is((SELECT count(*) FROM profiles),0::bigint,'anonymous cannot read profiles');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM organizations),1::bigint,'user sees only own team');
SELECT is((SELECT count(*) FROM profiles),2::bigint,'user sees only own team profiles');
SELECT lives_ok($$INSERT INTO programs(organization_id,code,name) VALUES ('11111111-0000-0000-0000-000000000001','AUTH-TEST-OWN','Test')$$,'team member can create own program');
SELECT throws_ok($$INSERT INTO programs(organization_id,code,name) VALUES ('11111111-0000-0000-0000-000000000002','AUTH-TEST-FOREIGN','Test')$$,'42501',NULL,'cross-team insert denied');
SELECT throws_ok($$UPDATE profiles SET role='system_admin' WHERE user_id=auth.uid()$$,'42501',NULL,'self promotion denied');
SELECT throws_ok($$UPDATE profiles SET organization_id='11111111-0000-0000-0000-000000000002' WHERE user_id=auth.uid()$$,'42501',NULL,'self tenant transfer denied');
SELECT throws_ok($$SELECT refresh_inventory_lot_quantity('00000000-0000-0000-0000-000000000000')$$,'42501',NULL,'privileged inventory RPC denied');
SELECT throws_ok($$SELECT refresh_phenotype_evaluation('00000000-0000-0000-0000-000000000000')$$,'42501',NULL,'privileged scoring RPC denied');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM programs WHERE code='AUTH-TEST-OWN'),0::bigint,'other team cannot read program');
WITH changed AS (UPDATE programs SET name='Forbidden' WHERE code='AUTH-TEST-OWN' RETURNING id)
SELECT is(count(*),0::bigint,'other team cannot update program') FROM changed;
SELECT throws_ok($$UPDATE profiles SET user_id='22222222-0000-0000-0000-000000000001' WHERE user_id=auth.uid()$$,'23514','Profile auth identity is immutable','profile auth identity cannot be reassigned');
WITH changed AS (UPDATE profiles SET role='user' WHERE user_id='22222222-0000-0000-0000-000000000004' RETURNING id)
SELECT is(count(*),0::bigint,'team admin cannot demote a system admin in its team') FROM changed;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000003',true);
SELECT ok(is_system_admin(),'system admin recognized');
SELECT is((SELECT count(*) FROM organizations WHERE slug LIKE 'auth-test-%'),2::bigint,'system admin accesses both test teams');
RESET ROLE;
UPDATE profiles SET is_active=false WHERE user_id='22222222-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM programs),0::bigint,'inactive user cannot access programs');
SELECT * FROM finish();
ROLLBACK;
