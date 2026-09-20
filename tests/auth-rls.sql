-- Disposable local test database only. Fixtures are rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);
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
INSERT INTO inventory_items(id,organization_id,name,default_unit,minimum_stock) VALUES
 ('33333333-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Inventory A','g',10),
 ('33333333-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002','Inventory B','g',10);
INSERT INTO inventory_lots(id,inventory_item_id,batch_number,initial_quantity,current_quantity) VALUES
 ('44444444-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','LOT-A',0,0),
 ('44444444-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002','LOT-B',0,0);
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM organizations),0::bigint,'anonymous cannot read teams');
SELECT is((SELECT count(*) FROM profiles),0::bigint,'anonymous cannot read profiles');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM organizations),1::bigint,'user sees only own team');
SELECT is((SELECT count(*) FROM profiles),2::bigint,'user sees only own team profiles');
SELECT lives_ok($$INSERT INTO programs(organization_id,code,name) VALUES ('11111111-0000-0000-0000-000000000001','AUTH-TEST-OWN','Test')$$,'team member can create own program');
INSERT INTO experimental_cycles(id,program_id,name,start_date,end_date,status)
SELECT '55555555-0000-0000-0000-000000000001',id,'Auth cycle',CURRENT_DATE,CURRENT_DATE+10,'active' FROM programs WHERE code='AUTH-TEST-OWN';
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,status)
SELECT '66666666-0000-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',id,'Auth task',CURRENT_DATE,CURRENT_DATE+1,'not_started' FROM programs WHERE code='AUTH-TEST-OWN';
SELECT throws_ok($$INSERT INTO programs(organization_id,code,name) VALUES ('11111111-0000-0000-0000-000000000002','AUTH-TEST-FOREIGN','Test')$$,'42501',NULL,'cross-team insert denied');
SELECT throws_ok($$UPDATE profiles SET role='system_admin' WHERE user_id=auth.uid()$$,'42501',NULL,'self promotion denied');
SELECT throws_ok($$UPDATE profiles SET organization_id='11111111-0000-0000-0000-000000000002' WHERE user_id=auth.uid()$$,'42501',NULL,'self tenant transfer denied');
SELECT throws_ok($$SELECT refresh_inventory_lot_quantity('00000000-0000-0000-0000-000000000000')$$,'42501',NULL,'privileged inventory RPC denied');
SELECT throws_ok($$SELECT refresh_phenotype_evaluation('00000000-0000-0000-0000-000000000000')$$,'42501',NULL,'privileged scoring RPC denied');
SELECT throws_ok($$INSERT INTO audit_logs(organization_id,user_id,entity_type,entity_id,action) VALUES ('11111111-0000-0000-0000-000000000001',auth.uid(),'auth_user',auth.uid(),'user_created')$$,'42501',NULL,'ordinary user cannot forge audit records');
SELECT is((SELECT count(*) FROM audit_logs),0::bigint,'ordinary user cannot read audit records');
SELECT throws_ok($$INSERT INTO inventory_movements(inventory_lot_id,movement_type,quantity) VALUES ('44444444-0000-0000-0000-000000000001','receipt',1)$$,'42501',NULL,'authenticated direct inventory movement insert denied');
SELECT throws_ok($$SELECT record_inventory_movement('44444444-0000-0000-0000-000000000002','receipt',1,CURRENT_DATE,'foreign',NULL)$$,'42501','Forbidden','cross-team inventory movement RPC denied');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM programs WHERE code='AUTH-TEST-OWN'),0::bigint,'other team cannot read program');
SELECT throws_ok($$SELECT get_dashboard_kpis((SELECT id FROM programs WHERE code='AUTH-TEST-OWN'))$$,'42501','Forbidden','other team cannot read dashboard KPI');
SELECT throws_ok($$SELECT set_task_status('66666666-0000-0000-0000-000000000001','completed')$$,'42501','Forbidden','other team cannot update task status');
WITH changed AS (UPDATE programs SET name='Forbidden' WHERE code='AUTH-TEST-OWN' RETURNING id)
SELECT is(count(*),0::bigint,'other team cannot update program') FROM changed;
SELECT throws_ok($$UPDATE profiles SET user_id='22222222-0000-0000-0000-000000000001' WHERE user_id=auth.uid()$$,'23514','Profile auth identity is immutable','profile auth identity cannot be reassigned');
WITH changed AS (UPDATE profiles SET role='user' WHERE user_id='22222222-0000-0000-0000-000000000004' RETURNING id)
SELECT is(count(*),0::bigint,'team admin cannot demote a system admin in its team') FROM changed;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000003',true);
SELECT ok(is_system_admin(),'system admin recognized');
SELECT is((SELECT count(*) FROM organizations WHERE slug LIKE 'auth-test-%'),2::bigint,'system admin accesses both test teams');
SELECT lives_ok($$SELECT record_user_admin_event('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','user_activated',NULL,'{"is_active":true}'::jsonb)$$,'system admin can record a user administration event');
RESET ROLE;
UPDATE profiles SET is_active=false WHERE user_id='22222222-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM programs),0::bigint,'inactive user cannot access programs');
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000099',true);
SELECT is((SELECT count(*) FROM programs),0::bigint,'pending auth identity without profile cannot access business data');
SELECT * FROM finish();
ROLLBACK;
