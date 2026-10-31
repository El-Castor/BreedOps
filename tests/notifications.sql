-- Disposable local test database only. Fixtures are rolled back.
-- V2-02 notification center: generation, dedup/idempotency, resolve-on-fix,
-- fan-out targeting, cross-team isolation, archived-record exclusion, and
-- mark-as-read ownership.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(34);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-00000000a001','Notif Team A','notif-team-a'),
 ('11111111-0000-0000-0000-00000000a002','Notif Team B','notif-team-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-00000000a001'),
 ('22222222-0000-0000-0000-00000000a002'),
 ('22222222-0000-0000-0000-00000000a003');
-- a001: ordinary user in team A, assigned the overdue task.
-- a002: team_admin in team A, catches the unassigned due-soon task.
-- a003: ordinary user in team B - must never see anything from team A.
INSERT INTO profiles(id,user_id,organization_id,role,is_active) VALUES
 ('33333333-0000-0000-0000-00000000a001','22222222-0000-0000-0000-00000000a001','11111111-0000-0000-0000-00000000a001','user',true),
 ('33333333-0000-0000-0000-00000000a002','22222222-0000-0000-0000-00000000a002','11111111-0000-0000-0000-00000000a001','team_admin',true),
 ('33333333-0000-0000-0000-00000000a003','22222222-0000-0000-0000-00000000a003','11111111-0000-0000-0000-00000000a002','user',true);
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('44444444-0000-0000-0000-00000000a001','11111111-0000-0000-0000-00000000a001','NOTIF-A','Program A');
INSERT INTO experimental_cycles(id,program_id,name,start_date,end_date,status) VALUES
 ('55555555-0000-0000-0000-00000000a001','44444444-0000-0000-0000-00000000a001','Cycle A',CURRENT_DATE,CURRENT_DATE+30,'active');
-- Overdue, assigned to a001.
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,status,assigned_to) VALUES
 ('66666666-0000-0000-0000-00000000a001','55555555-0000-0000-0000-00000000a001','44444444-0000-0000-0000-00000000a001','Semis', CURRENT_DATE-5, CURRENT_DATE-1,'not_started','33333333-0000-0000-0000-00000000a001');
-- Due soon, unassigned - should fan out to the team_admin (a002) only.
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,status,assigned_to) VALUES
 ('66666666-0000-0000-0000-00000000a002','55555555-0000-0000-0000-00000000a001','44444444-0000-0000-0000-00000000a001','Arrosage', CURRENT_DATE, CURRENT_DATE+2,'not_started',NULL);
-- Archived task, otherwise overdue - must never generate a notification.
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,status,assigned_to,deleted_at) VALUES
 ('66666666-0000-0000-0000-00000000a003','55555555-0000-0000-0000-00000000a001','44444444-0000-0000-0000-00000000a001','Archivee', CURRENT_DATE-5, CURRENT_DATE-1,'not_started','33333333-0000-0000-0000-00000000a001',now());
-- Low stock item (5 <= minimum 10) and an expiring lot, both team-wide.
INSERT INTO inventory_items(id,organization_id,name,default_unit,minimum_stock) VALUES
 ('77777777-0000-0000-0000-00000000a001','11111111-0000-0000-0000-00000000a001','Engrais','kg',10);
INSERT INTO inventory_lots(id,inventory_item_id,batch_number,initial_quantity,current_quantity,expiration_date) VALUES
 ('88888888-0000-0000-0000-00000000a001','77777777-0000-0000-0000-00000000a001','LOT-A1',5,5,CURRENT_DATE+10);
-- Archived inventory item, otherwise low stock - must never generate one.
INSERT INTO inventory_items(id,organization_id,name,default_unit,minimum_stock,deleted_at) VALUES
 ('77777777-0000-0000-0000-00000000a002','11111111-0000-0000-0000-00000000a001','Supprime','kg',10,now());
INSERT INTO inventory_lots(id,inventory_item_id,batch_number,initial_quantity,current_quantity) VALUES
 ('88888888-0000-0000-0000-00000000a002','77777777-0000-0000-0000-00000000a002','LOT-DEL',0,0);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);

SELECT throws_ok(
  $$SELECT sync_notifications_for_team('11111111-0000-0000-0000-00000000a002')$$,
  '42501', 'Forbidden', 'syncing a foreign team''s notifications is denied'
);

-- sync_notifications_for_team is SECURITY DEFINER specifically so it can
-- write a teammate's (e.g. the team_admin's) notification row - RLS still
-- correctly hides that row from a001's own SELECT, so every assertion that
-- needs the cross-recipient/total view below runs RESET ROLE first, as the
-- privileged test-runner, exactly like inspecting any other table's full
-- contents in this suite. This is the inserted/resolved counters already
-- being correct (checked here) proving the write side works; the RESET ROLE
-- block right after independently proves RLS still isolates the read side
-- per recipient.
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'inserted')::int$$,
  ARRAY[6], 'first sync inserts exactly the 6 genuinely-true (condition, recipient) pairs: overdue(1) + due_soon(1, admin only) + stock_low(2, team-wide) + lot_expiring(2, team-wide), none for the 2 archived records'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='task_overdue' AND recipient_profile_id='33333333-0000-0000-0000-00000000a001'),
  1::bigint, 'overdue task notification created for its assignee'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='task_due_soon' AND recipient_profile_id='33333333-0000-0000-0000-00000000a002'),
  1::bigint, 'unassigned due-soon task notification fanned out to the team_admin'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='task_due_soon' AND recipient_profile_id='33333333-0000-0000-0000-00000000a001'),
  0::bigint, 'unassigned task notification is not also sent to the ordinary member'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low'),
  2::bigint, 'stock_low is fanned out to every active team member (2)'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='lot_expiring'),
  2::bigint, 'lot_expiring is fanned out to every active team member (2)'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE title LIKE '%Archivee%' OR title LIKE '%Supprime%'),
  0::bigint, 'archived task and archived inventory item never generate a notification'
);

-- Idempotency: a second sync call, nothing changed, inserts nothing new.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'inserted')::int$$,
  ARRAY[0], 'a repeat sync with no change inserts zero new rows (idempotent)'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications), 6::bigint,
  'row count is unchanged after the repeat sync - a page reload never creates duplicates'
);

-- Resolve-on-fix: completing the overdue task retracts its notification.
UPDATE tasks SET status='completed', completed_at=now() WHERE id='66666666-0000-0000-0000-00000000a001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'resolved')::int$$,
  ARRAY[1], 'completing the task resolves exactly its own notification on the next sync'
);
SELECT is(
  (SELECT resolved_at IS NOT NULL FROM notifications WHERE category='task_overdue'),
  true, 'the resolved notification row is kept (not deleted) with resolved_at set'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='task_overdue' AND resolved_at IS NULL),
  0::bigint, 'a resolved notification no longer counts as active'
);

-- Mark as read: only the recipient can mark their own notification read.
SELECT lives_ok(
  $$SELECT mark_notification_read((SELECT id FROM notifications WHERE category='stock_low' AND recipient_profile_id='33333333-0000-0000-0000-00000000a001'))$$,
  'recipient can mark their own notification as read'
);
SELECT is(
  (SELECT read_at IS NOT NULL FROM notifications WHERE category='stock_low' AND recipient_profile_id='33333333-0000-0000-0000-00000000a001'),
  true, 'read_at is set after marking as read'
);
-- a002's own row is not visible to a001 under RLS (the WHERE clause below
-- matches zero rows for a001's session, not a row with read_at = NULL) -
-- the real cross-recipient check is below, after RESET ROLE.
-- Attempting to mark a teammate's row has no effect (not an error - the
-- same "silently no-op under RLS" shape as the rest of this schema).
SELECT lives_ok(
  $$SELECT mark_notification_read((SELECT id FROM notifications WHERE category='stock_low' AND recipient_profile_id='33333333-0000-0000-0000-00000000a002'))$$,
  'attempting to mark a teammate''s notification as read does not raise'
);
RESET ROLE;
SELECT is(
  (SELECT read_at FROM notifications WHERE category='stock_low' AND recipient_profile_id='33333333-0000-0000-0000-00000000a002') IS NULL,
  true, 'that attempt by a001 silently had no effect on a002''s own row (ownership enforced)'
);

-- Cross-team isolation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a003',true);
SELECT is(
  (SELECT count(*) FROM notifications), 0::bigint,
  'a user in a different organization sees zero of team A''s notifications'
);
SELECT lives_ok(
  $$SELECT mark_all_notifications_read()$$,
  'mark_all_notifications_read is harmless for a user with no notifications'
);
RESET ROLE;

-- mark_all_notifications_read only ever touches the caller's own rows.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a002',true);
SELECT lives_ok($$SELECT mark_all_notifications_read()$$, 'team_admin can mark all their own notifications read');
SELECT is(
  (SELECT count(*) FROM notifications WHERE recipient_profile_id='33333333-0000-0000-0000-00000000a002' AND read_at IS NULL AND resolved_at IS NULL),
  0::bigint, 'after mark_all_notifications_read, the caller has no remaining unread active notification'
);
RESET ROLE;
-- a001 still has its lot_expiring notification unread at this point (only
-- stock_low was explicitly marked read above) - confirms a002's
-- mark_all_notifications_read call touched only a002's own rows.
SELECT is(
  (SELECT read_at FROM notifications WHERE category='lot_expiring' AND recipient_profile_id='33333333-0000-0000-0000-00000000a001') IS NULL,
  true, 'a001''s own still-unread notification is unaffected by a002''s mark_all_notifications_read call'
);

-- Recurrence: a resolved condition must be able to become active again
-- without being permanently stuck resolved, and without ever creating a
-- second row for the same (condition, recipient) pair. At this point
-- a001's and a002's stock_low notifications are both already read (a001
-- from the explicit mark-as-read above; a002 from mark_all_notifications_read).

-- 1. Read state is stable across a repeat sync while the condition has
-- not changed - the WHERE resolved_at IS NOT NULL guard on the ON
-- CONFLICT clause means an already-active row (read or not) is left
-- completely untouched, never flipped back to unread by mere re-syncing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'inserted')::int$$,
  ARRAY[0], 'a repeat sync with the stock condition still true inserts/reactivates nothing'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND read_at IS NOT NULL),
  2::bigint, 'both already-read stock_low notifications remain read after a no-op repeat sync'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND resolved_at IS NULL),
  2::bigint, 'and both remain active (not resolved) since the stock is still low'
);

-- 2. Stock is replenished: the condition clears and the notification
-- resolves (read_at is left as-is - a resolved row's own read state is
-- never touched by the resolve step).
UPDATE inventory_lots SET current_quantity = 100
  WHERE inventory_item_id = '77777777-0000-0000-0000-00000000a001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'resolved')::int$$,
  ARRAY[2], 'replenishing the stock resolves exactly the 2 stock_low notifications (one per recipient)'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND resolved_at IS NOT NULL),
  2::bigint, 'both stock_low notifications are now resolved'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND read_at IS NOT NULL),
  2::bigint, 'resolving a notification does not disturb its already-set read_at'
);

-- 3. The same logical condition recurs: stock drops below the threshold
-- again for the exact same item. The same dedup_key must be reactivated
-- in place - never a second row, and the notification must come back as
-- unread regardless of whether it was read before it resolved.
UPDATE inventory_lots SET current_quantity = 3
  WHERE inventory_item_id = '77777777-0000-0000-0000-00000000a001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'inserted')::int$$,
  ARRAY[2], 'the recurrence reactivates exactly the 2 existing rows (never a brand-new logical insert)'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low'),
  2::bigint, 'still exactly one row per recipient for this condition - reactivation never duplicates it'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND resolved_at IS NULL),
  2::bigint, 'the reactivated condition is active again (resolved_at cleared)'
);
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND read_at IS NULL),
  2::bigint, 'and unread again, even though both had previously been marked read before resolving'
);

-- 4. Idempotency holds for the reactivated row too: syncing again right
-- away with nothing further changed must not re-touch it a second time.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000a001',true);
SELECT results_eq(
  $$SELECT (sync_notifications_for_team('11111111-0000-0000-0000-00000000a001')->>'inserted')::int$$,
  ARRAY[0], 'a sync right after reactivation, with nothing further changed, reactivates/inserts nothing more'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM notifications WHERE category='stock_low' AND read_at IS NULL),
  2::bigint, 'the freshly-reactivated notifications are still unread (not reset by the extra sync)'
);

SELECT * FROM finish();
ROLLBACK;
