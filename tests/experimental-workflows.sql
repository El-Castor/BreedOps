-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(38);

INSERT INTO organizations(id,name,slug) VALUES
 ('33333333-0000-0000-0000-0000000000a1','Workflow A','workflow-test-a'),
 ('33333333-0000-0000-0000-0000000000a2','Workflow B','workflow-test-b');
INSERT INTO auth.users(id) VALUES
 ('44444444-0000-0000-0000-0000000000a1'),('44444444-0000-0000-0000-0000000000a2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('44444444-0000-0000-0000-0000000000a1','33333333-0000-0000-0000-0000000000a1','team_admin'),
 ('44444444-0000-0000-0000-0000000000a2','33333333-0000-0000-0000-0000000000a2','team_admin');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-0000000000a1','33333333-0000-0000-0000-0000000000a1','WFA1','Program A1'),
 ('55555555-0000-0000-0000-0000000000a2','33333333-0000-0000-0000-0000000000a1','WFA2','Program A2 (same org)'),
 ('55555555-0000-0000-0000-0000000000a9','33333333-0000-0000-0000-0000000000a2','WFB1','Program B1 (other org)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','44444444-0000-0000-0000-0000000000a1',true);

-- Task templates (program A1): A, B, C, D, E (E carries a required checklist item)
INSERT INTO task_templates(id,program_id,code,name,priority,zone) VALUES
 ('66666666-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','TA','Tache A','medium','Zone 1'),
 ('66666666-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a1','TB','Tache B','medium','Zone 1'),
 ('66666666-0000-0000-0000-0000000000a3','55555555-0000-0000-0000-0000000000a1','TC','Tache C','medium','Zone 1'),
 ('66666666-0000-0000-0000-0000000000a4','55555555-0000-0000-0000-0000000000a1','TD','Tache D','medium','Zone 1'),
 ('66666666-0000-0000-0000-0000000000a5','55555555-0000-0000-0000-0000000000a1','TE','Tache E','medium','Zone 1');
INSERT INTO task_template_checklist_items(task_template_id,label,is_required,sort_order) VALUES
 ('66666666-0000-0000-0000-0000000000a5','Controle qualite final',true,0);

-- ───────────────────────── Cycle template model ─────────────────────────
SELECT lives_ok($$
  INSERT INTO experimental_cycle_templates(id,program_id,code,name) VALUES
    ('77777777-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','WFUAT','Workflow experimental - UAT')
$$,'cycle template can be created');

SELECT lives_ok($$
  INSERT INTO experimental_cycle_template_tasks(id,cycle_template_id,task_template_id,start_offset_days,duration_days,sort_order) VALUES
    ('88888888-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a1',0,2,0),
    ('88888888-0000-0000-0000-0000000000a2','77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a2',0,3,1),
    ('88888888-0000-0000-0000-0000000000a3','77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a3',0,1,2),
    ('88888888-0000-0000-0000-0000000000a4','77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a4',0,2,3),
    ('88888888-0000-0000-0000-0000000000a5','77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a5',0,1,4)
$$,'template task membership can be created for every step');
SELECT is((SELECT count(*) FROM experimental_cycle_template_tasks WHERE cycle_template_id='77777777-0000-0000-0000-0000000000a1'),5::bigint,'all five template steps are recorded');

-- Dependency uniqueness + self-reference rejection.
SELECT lives_ok($$
  INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id,lag_days) VALUES
    ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a2',0)
$$,'A -> B dependency can be created');
SELECT throws_ok($$
  INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id) VALUES
    ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a2')
$$,'23505',NULL,'duplicate template dependency is rejected');
SELECT throws_ok($$
  INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id) VALUES
    ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1')
$$,'23514',NULL,'self-dependency is rejected for template steps');

-- Complete the A/B/C/D/E chain, then test cycle detection on the template graph.
INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id,lag_days) VALUES
 ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a3',0),
 ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a2','88888888-0000-0000-0000-0000000000a4',1),
 ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a3','88888888-0000-0000-0000-0000000000a4',1),
 ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a4','88888888-0000-0000-0000-0000000000a5',0);
SELECT throws_ok($$
  INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id) VALUES
    ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a5','88888888-0000-0000-0000-0000000000a1')
$$,'23514',NULL,'E -> A would close a cycle and is rejected (A->B->D->E->A)');

-- Cross-template dependency rejection: a second template''s step cannot be wired to this one.
INSERT INTO experimental_cycle_templates(id,program_id,code,name) VALUES
 ('77777777-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a1','WFOTHER','Other workflow');
INSERT INTO experimental_cycle_template_tasks(id,cycle_template_id,task_template_id,start_offset_days,duration_days,sort_order) VALUES
 ('88888888-0000-0000-0000-0000000000a9','77777777-0000-0000-0000-0000000000a2','66666666-0000-0000-0000-0000000000a1',0,1,0);
SELECT throws_ok($$
  INSERT INTO experimental_cycle_template_dependencies(cycle_template_id,predecessor_template_task_id,successor_template_task_id) VALUES
    ('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a9')
$$,'23514',NULL,'a dependency cannot bridge two different cycle templates');

-- ───────────────────────── Atomic instantiation ─────────────────────────
SELECT lives_ok($$
  SELECT instantiate_experimental_cycle('77777777-0000-0000-0000-0000000000a1','Cycle UAT','2026-03-02')
$$,'instantiation succeeds and returns a cycle id');

SELECT is(
  (SELECT count(*) FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id
   WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1'),
  5::bigint,'all five template steps generated a real task');

SELECT is(
  (SELECT count(*) FROM task_dependencies d
   JOIN tasks t ON t.id=d.predecessor_task_id
   JOIN experimental_cycles c ON c.id=t.experimental_cycle_id
   WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1'),
  5::bigint,'all five template dependencies were generated on the real tasks');

SELECT is(
  (SELECT planned_date FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id
   WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1' AND t.title='Tache D'),
  '2026-03-08'::date,'Tache D planned_date matches the dependency-aware formula (max predecessor due date + lag)');
SELECT is(
  (SELECT due_date FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id
   WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1' AND t.title='Tache D'),
  '2026-03-09'::date,'Tache D due_date matches its own duration applied to the computed planned_date');

SELECT is(
  (SELECT end_date FROM experimental_cycles WHERE source_template_id='77777777-0000-0000-0000-0000000000a1'),
  '2026-03-10'::date,'cycle end date is derived from the latest generated task due date');

SELECT is(
  (SELECT count(*) FROM task_checklist_items i
   JOIN tasks t ON t.id=i.task_id JOIN experimental_cycles c ON c.id=t.experimental_cycle_id
   WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1' AND t.title='Tache E'),
  1::bigint,'the required checklist item was snapshotted onto the generated Tache E');

-- Rollback on failure: an unknown template must raise and create nothing.
SELECT throws_ok($$
  SELECT instantiate_experimental_cycle('99999999-0000-0000-0000-000000000000','Should not exist','2026-01-01')
$$,'23514',NULL,'instantiating an unknown template is rejected');
SELECT is(
  (SELECT count(*) FROM experimental_cycles WHERE name='Should not exist'),
  0::bigint,'a failed instantiation leaves no partial cycle behind');

-- ───────────────────────── Real task dependency integrity ─────────────────────────
SELECT c.id AS cycle_a1_id FROM experimental_cycles c WHERE c.source_template_id='77777777-0000-0000-0000-0000000000a1' \gset
SELECT t.id AS task_a_id FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id WHERE c.id=:'cycle_a1_id' AND t.title='Tache A' \gset
SELECT t.id AS task_b_id FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id WHERE c.id=:'cycle_a1_id' AND t.title='Tache B' \gset
SELECT t.id AS task_d_id FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id WHERE c.id=:'cycle_a1_id' AND t.title='Tache D' \gset
SELECT t.id AS task_e_id FROM tasks t JOIN experimental_cycles c ON c.id=t.experimental_cycle_id WHERE c.id=:'cycle_a1_id' AND t.title='Tache E' \gset
SELECT i.id AS item_e_id FROM task_checklist_items i WHERE i.task_id=:'task_e_id' \gset

SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_a_id',:'task_a_id'),
  '23514',NULL,'a real task cannot depend on itself');
SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_e_id',:'task_a_id'),
  '23514',NULL,'E -> A would close a cycle on the real task graph and is rejected');

-- Cross-cycle rejection: a manual cycle in the SAME program, dependency across cycles is rejected.
INSERT INTO experimental_cycles(id,program_id,name,start_date,end_date,status) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','Manual cycle A1','2026-01-01','2026-01-10','active');
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,priority,status) VALUES
 ('bbbbbbbb-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','Tache hors cycle','2026-01-01','2026-01-02','medium','not_started');
SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_a_id','bbbbbbbb-0000-0000-0000-0000000000a1'),
  '23514',NULL,'a dependency cannot bridge two different experimental cycles');

-- Cross-program rejection: two programs in the SAME org, both writable, still cannot be bridged.
INSERT INTO experimental_cycles(id,program_id,name,start_date,end_date,status) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a2','Manual cycle A2','2026-01-01','2026-01-10','active');
INSERT INTO tasks(id,experimental_cycle_id,program_id,title,planned_date,due_date,priority,status) VALUES
 ('bbbbbbbb-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a2','Tache autre programme','2026-01-01','2026-01-02','medium','not_started');
SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_a_id','bbbbbbbb-0000-0000-0000-0000000000a2'),
  '23514',NULL,'a dependency cannot bridge two different programs, even within the same team');

-- Dependency to an archived/deleted task is rejected. tasks_read filters out
-- deleted_at rows, so soft-deleting (unlike template archiving) cannot be
-- done through the RLS-constrained authenticated role; do it as the
-- connection superuser, matching how such housekeeping actually happens.
RESET ROLE;
UPDATE tasks SET deleted_at = now() WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1';
SET LOCAL ROLE authenticated;
SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_a_id','bbbbbbbb-0000-0000-0000-0000000000a1'),
  '23514',NULL,'a dependency to an archived task is rejected');

-- ───────────────────────── Required checklist completion gate ─────────────────────────
SELECT throws_like(format($$SELECT set_task_status('%s','completed')$$,:'task_e_id'),
  '%contrôles obligatoires non terminés%','completing a task with an incomplete required checklist item is rejected');

-- ───────────────────────── Dependency-aware rescheduling ─────────────────────────
-- Tache E is not completed yet at this point, so this reschedule can
-- propagate cleanly all the way through the chain.
SELECT lives_ok(format($$SELECT recalculate_cycle_schedule('%s','2026-03-05','2026-03-07')$$,:'task_a_id'),
  'rescheduling Tache A propagates through its non-completed downstream chain');
SELECT is((SELECT planned_date FROM tasks WHERE id=:'task_b_id'),
  '2026-03-08'::date,'Tache B shifted to respect the new predecessor date');
SELECT is((SELECT due_date FROM tasks WHERE id=:'task_b_id'),
  '2026-03-10'::date,'Tache B kept its own 3-day duration while shifting');
SELECT is((SELECT end_date FROM experimental_cycles WHERE id=:'cycle_a1_id'),
  '2026-03-14'::date,'the cycle end date is recomputed after rescheduling');

-- Now complete the required checklist item and the task itself.
SELECT lives_ok(format($$SELECT complete_checklist_item('%s', true, 'Controle effectue')$$,:'item_e_id'),'the required checklist item can be completed');
SELECT lives_ok(format($$SELECT set_task_status('%s','completed')$$,:'task_e_id'),'the task can now be completed once the required checklist item is done');
SELECT is((SELECT completed_by FROM task_checklist_items WHERE id=:'item_e_id') IS NOT NULL,true,'completed_by is recorded server-side, never trusted from the client');
SELECT is((SELECT status FROM tasks WHERE id=:'task_e_id'),'completed','the task status is now completed');

-- Completed-task protection: Tache E is now completed; forcing Tache D later must block the whole recalculation.
SELECT throws_like(format($$SELECT recalculate_cycle_schedule('%s','2026-03-20','2026-03-21')$$,:'task_d_id'),
  '%tâche déjà terminée%','rescheduling is blocked when it would move an already-completed downstream task');
SELECT is((SELECT due_date FROM tasks WHERE id=:'task_d_id'),
  '2026-03-13'::date,'the blocked recalculation left Tache D''s date untouched');

-- move_cycle_template_task reorder RPC (mirrors move_module_trait).
SELECT lives_ok($$SELECT move_cycle_template_task('77777777-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a2',-1)$$,'a template step can be moved up');

-- ───────────────────────── RLS: cross-org isolation ─────────────────────────
SELECT set_config('request.jwt.claim.sub','44444444-0000-0000-0000-0000000000a2',true);

SELECT is(
  (SELECT count(*) FROM experimental_cycle_templates WHERE id='77777777-0000-0000-0000-0000000000a1'),
  0::bigint,'another team cannot read this team''s cycle template');

SELECT throws_ok($$
  INSERT INTO experimental_cycle_template_tasks(cycle_template_id,task_template_id,start_offset_days,duration_days) VALUES
    ('77777777-0000-0000-0000-0000000000a1','66666666-0000-0000-0000-0000000000a1',0,1)
$$,NULL,NULL,'another team cannot write a step into this team''s cycle template');

SELECT throws_ok(format($$INSERT INTO task_dependencies(predecessor_task_id,successor_task_id) VALUES ('%s','%s')$$,:'task_a_id',:'task_b_id'),
  NULL,NULL,'another team cannot create a dependency between tasks it cannot access');

SELECT is(
  (SELECT count(*) FROM task_templates WHERE id='66666666-0000-0000-0000-0000000000a1'),
  0::bigint,'another team cannot read this team''s task template');

SELECT * FROM finish();
ROLLBACK;
