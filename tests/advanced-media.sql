-- Disposable local test fixtures only. Everything is rolled back.
-- V2-03 advanced media: acquisition metadata constraints and the new
-- media_annotations model (non-destructive overlay annotations).
-- Existing Plant Media regression stays in tests/plant-media.sql,
-- unmodified in spirit - this file is purely additive coverage for
-- migration 000026.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-0000000000b1','AdvMedia A','adv-media-a'),
 ('11111111-0000-0000-0000-0000000000b2','AdvMedia B','adv-media-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-0000000000b1'),
 ('22222222-0000-0000-0000-0000000000b2'),
 ('22222222-0000-0000-0000-0000000000b3');
-- b1: user in org A (the acting operator/annotator). b2: a second profile
-- in org A, used only as a valid same-org operator_id target. b3: user in
-- org B, must never reach org A's media/annotations.
INSERT INTO profiles(id,user_id,organization_id,role) VALUES
 ('33333333-0000-0000-0000-0000000000b1','22222222-0000-0000-0000-0000000000b1','11111111-0000-0000-0000-0000000000b1','user'),
 ('33333333-0000-0000-0000-0000000000b2','22222222-0000-0000-0000-0000000000b2','11111111-0000-0000-0000-0000000000b1','user'),
 ('33333333-0000-0000-0000-0000000000b3','22222222-0000-0000-0000-0000000000b3','11111111-0000-0000-0000-0000000000b2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-0000000000b1','11111111-0000-0000-0000-0000000000b1','AMA','AdvMedia program A'),
 ('55555555-0000-0000-0000-0000000000b2','11111111-0000-0000-0000-0000000000b2','AMB','AdvMedia program B');
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000b1','55555555-0000-0000-0000-0000000000b1','AdvMedia parent A');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000b1',true);

-- ───────── Acquisition metadata CHECK constraints ─────────
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,captured_at_time) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t1.jpg','t1.jpg','image/jpeg',100,'10:00')$$,
  '23514', NULL, 'a capture time without a capture date is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,developmental_stage) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t2.jpg','t2.jpg','image/jpeg',100,repeat('x',61))$$,
  '23514', NULL, 'developmental_stage over 60 characters is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,viewpoint) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t3.jpg','t3.jpg','image/jpeg',100,'bird-eye')$$,
  '23514', NULL, 'an unlisted viewpoint value is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,imaging_modality) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t4.jpg','t4.jpg','image/jpeg',100,'xray')$$,
  '23514', NULL, 'an unlisted imaging modality is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,scale_unit) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t5.jpg','t5.jpg','image/jpeg',100,'inch')$$,
  '23514', NULL, 'an unlisted scale unit is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,scale_value) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t6.jpg','t6.jpg','image/jpeg',100,10)$$,
  '23514', NULL, 'a scale value without a scale unit is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size,operator_id) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/t7.jpg','t7.jpg','image/jpeg',100,'33333333-0000-0000-0000-0000000000b3')$$,
  '23514', NULL, 'an operator_id from another organization is rejected'
);
INSERT INTO media_assets(id,parent_line_id,storage_path,original_filename,mime_type,byte_size,captured_at,captured_at_time,developmental_stage,viewpoint,imaging_modality,operator_id,scale_value,scale_unit,scale_note,scientific_note) VALUES
 ('dddddddd-0000-0000-0000-0000000000b1','77777777-0000-0000-0000-0000000000b1','org/b1/main.jpg','main.jpg','image/jpeg',1000,'2026-09-01','10:30','D3','top','visible','33333333-0000-0000-0000-0000000000b2',10,'cm','règle 10cm','Feuille jaunie au bord');
SELECT is(
  (SELECT operator_id FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000b1'),
  '33333333-0000-0000-0000-0000000000b2'::uuid,
  'a same-organization operator_id is accepted and stored'
);

-- ───────── Annotation creation and geometry validation ─────────
INSERT INTO media_annotations(id,media_asset_id,annotation_type,x,y,label) VALUES
 ('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b1','point',0.5,0.5,'bourgeon');
SELECT pass('a point annotation with a label is created');
INSERT INTO media_annotations(id,media_asset_id,annotation_type,x,y,width,height,label) VALUES
 ('eeeeeeee-0000-0000-0000-0000000000b2','dddddddd-0000-0000-0000-0000000000b1','rectangle',0.1,0.1,0.2,0.2,'zone nécrotique');
SELECT pass('a rectangle annotation within bounds is created');
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','text',0.5,0.5)$$,
  '23514', NULL, 'a text annotation with no label is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y,width) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',0.5,0.5,0.1)$$,
  '23514', NULL, 'a point annotation cannot have a width'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','rectangle',0.5,0.5)$$,
  '23514', NULL, 'a rectangle annotation requires a width and height'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y,width,height) VALUES ('dddddddd-0000-0000-0000-0000000000b1','rectangle',0.9,0.9,0.5,0.5)$$,
  '23514', NULL, 'a rectangle may not extend outside the image'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',1.5,0.5)$$,
  '23514', NULL, 'a coordinate outside [0,1] is rejected'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y,label) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',0.5,0.5,repeat('x',301))$$,
  '23514', NULL, 'an annotation label over 300 characters is rejected'
);
-- RLS evaluates (and rejects) this before the foreign key constraint
-- ever gets a chance to - a non-existent media_asset_id gets the exact
-- same rejection as a real cross-team one, consistent with this schema's
-- "no distinguishing signal" convention elsewhere (e.g. the QR lookup).
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('99999999-9999-9999-9999-999999999999','point',0.5,0.5)$$,
  '42501', NULL, 'an annotation cannot reference a non-existent media asset'
);

-- ───────── Cross-team isolation (derived from media_assets, not a client-supplied org) ─────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000b3',true);
SELECT is(
  (SELECT count(*) FROM media_annotations WHERE media_asset_id='dddddddd-0000-0000-0000-0000000000b1'),
  0::bigint, 'a user in another organization reads zero annotations for this media'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',0.2,0.2)$$,
  '42501', NULL, 'a user in another organization cannot create an annotation on this media, even knowing its id'
);
RESET ROLE;

-- ───────── Archived media: annotations remain inspectable, no new ones ─────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000b1',true);
UPDATE media_assets SET archived_at=now(), archived_by='33333333-0000-0000-0000-0000000000b1' WHERE id='dddddddd-0000-0000-0000-0000000000b1';
SELECT is(
  (SELECT count(*) FROM media_annotations WHERE media_asset_id='dddddddd-0000-0000-0000-0000000000b1' AND archived_at IS NULL),
  2::bigint, 'existing annotations remain readable once the media is archived'
);
SELECT throws_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',0.3,0.3)$$,
  '42501', NULL, 'no new annotation may be created on already-archived media'
);
-- An UPDATE whose USING clause excludes every target row is a silent
-- 0-row no-op in Postgres RLS, not a raised error (the same shape as
-- "attempting to mark a teammate's notification as read" elsewhere in
-- this schema) - the real assertion is that the label genuinely never
-- changed.
SELECT lives_ok(
  $$UPDATE media_annotations SET label='edited while archived' WHERE id='eeeeeeee-0000-0000-0000-0000000000b1'$$,
  'editing an annotation while its media is archived does not raise (silently affects zero rows)'
);
SELECT is(
  (SELECT label FROM media_annotations WHERE id='eeeeeeee-0000-0000-0000-0000000000b1'),
  'bourgeon', 'the annotation''s label was not actually changed while its media was archived'
);
UPDATE media_assets SET archived_at=NULL, archived_by=NULL WHERE id='dddddddd-0000-0000-0000-0000000000b1';
SELECT lives_ok(
  $$INSERT INTO media_annotations(media_asset_id,annotation_type,x,y) VALUES ('dddddddd-0000-0000-0000-0000000000b1','point',0.4,0.4)$$,
  'restoring the media allows new annotations again'
);

-- ───────── Annotation identity guard and lifecycle ─────────
-- A second, same-team media asset to prove reassignment itself (not
-- merely a no-op write of the same value) is rejected.
INSERT INTO media_assets(id,parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES
 ('dddddddd-0000-0000-0000-0000000000b2','77777777-0000-0000-0000-0000000000b1','org/b1/second.jpg','second.jpg','image/jpeg',500);
SELECT throws_ok(
  $$UPDATE media_annotations SET media_asset_id='dddddddd-0000-0000-0000-0000000000b2' WHERE id='eeeeeeee-0000-0000-0000-0000000000b2'$$,
  '23514', NULL, 'an annotation''s media_asset_id is immutable (reassigning it to a different, even same-team, media asset is rejected)'
);
SELECT throws_ok(
  $$UPDATE media_annotations SET annotation_type='point' WHERE id='eeeeeeee-0000-0000-0000-0000000000b2'$$,
  '23514', NULL, 'an annotation''s annotation_type is immutable'
);
SELECT lives_ok(
  $$UPDATE media_annotations SET label='zone nécrotique (confirmée)' WHERE id='eeeeeeee-0000-0000-0000-0000000000b2'$$,
  'an annotation''s label can be edited without touching its identity'
);
UPDATE media_annotations SET archived_at=now(), archived_by='33333333-0000-0000-0000-0000000000b1' WHERE id='eeeeeeee-0000-0000-0000-0000000000b1';
SELECT is(
  (SELECT archived_at IS NOT NULL FROM media_annotations WHERE id='eeeeeeee-0000-0000-0000-0000000000b1'),
  true, 'an annotation can be archived (soft removal, never hard-deleted)'
);
UPDATE media_annotations SET archived_at=NULL, archived_by=NULL WHERE id='eeeeeeee-0000-0000-0000-0000000000b1';
SELECT is(
  (SELECT archived_at FROM media_annotations WHERE id='eeeeeeee-0000-0000-0000-0000000000b1'),
  NULL, 'an archived annotation can be restored'
);

-- ───────── Existing Plant Media behavior unaffected by migration 000026 ─────────
SELECT lives_ok(
  $$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES ('77777777-0000-0000-0000-0000000000b1','org/b1/legacy.jpg','legacy.jpg','image/jpeg',500)$$,
  'a plain insert using only the pre-000026 columns still succeeds (backward compatible)'
);
SELECT is(
  (SELECT captured_at_time FROM media_assets WHERE storage_path='org/b1/legacy.jpg'),
  NULL, 'new columns default to NULL on a row that never set them'
);
SELECT throws_ok(
  $$UPDATE media_assets SET storage_path='org/b1/renamed.jpg' WHERE id='dddddddd-0000-0000-0000-0000000000b1'$$,
  '23514', NULL, 'guard_media_asset_identity (migration 000018) still blocks storage_path changes after 000026'
);

SELECT * FROM finish();
ROLLBACK;
