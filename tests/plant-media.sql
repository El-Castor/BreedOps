-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

-- Storage: the private bucket exists with the expected hard limits.
SELECT is((SELECT public FROM storage.buckets WHERE id='breedops-media'),false,'media bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id='breedops-media'),10485760::bigint,'media bucket enforces the 10 MiB limit');
SELECT is((SELECT allowed_mime_types FROM storage.buckets WHERE id='breedops-media'),ARRAY['image/jpeg','image/png','image/webp'],'media bucket restricts mime types');

INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-0000000000a1','Media A','media-test-a'),
 ('11111111-0000-0000-0000-0000000000a2','Media B','media-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-0000000000a1'),('22222222-0000-0000-0000-0000000000a2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('22222222-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a1','user'),
 ('22222222-0000-0000-0000-0000000000a2','11111111-0000-0000-0000-0000000000a2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a1','MDA','Media program A'),
 ('55555555-0000-0000-0000-0000000000a2','11111111-0000-0000-0000-0000000000a2','MDB','Media program B');
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','F'),
 ('77777777-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a1','M'),
 ('77777777-0000-0000-0000-0000000000a9','55555555-0000-0000-0000-0000000000a2','Foreign');
INSERT INTO crosses(id,program_id,female_parent_id,male_parent_id) VALUES
 ('88888888-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000a1','77777777-0000-0000-0000-0000000000a2');
INSERT INTO families(id,program_id,cross_id) VALUES
 ('99999999-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1');
INSERT INTO seed_lots(id,program_id,cross_id,family_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','88888888-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-0000000000a1');
INSERT INTO phenotypes(id,program_id,family_id,seed_lot_id) VALUES
 ('bbbbbbbb-0000-0000-0000-0000000000a1','55555555-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a1');
INSERT INTO phenotype_evaluations(id,phenotype_id,evaluation_date) VALUES
 ('cccccccc-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-0000000000a1','2026-09-01');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000a1',true);

-- One-target invariant: exactly one of the four target columns.
SELECT throws_ok($$INSERT INTO media_assets(storage_path,original_filename,mime_type,byte_size) VALUES ('org/x/none/none/none','a.jpg','image/jpeg',100)$$,'23514',NULL,'media row must target exactly one entity');
SELECT throws_ok($$INSERT INTO media_assets(parent_line_id,family_id,storage_path,original_filename,mime_type,byte_size) VALUES ('77777777-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-0000000000a1','org/x/two-targets','a.jpg','image/jpeg',100)$$,'23514',NULL,'media row cannot target two entities at once');

-- File constraints enforced at the database, not just the client.
SELECT throws_ok($$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES ('77777777-0000-0000-0000-0000000000a1','org/x/bad-mime','a.gif','image/gif',100)$$,'23514',NULL,'unsupported mime type rejected');
SELECT throws_ok($$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES ('77777777-0000-0000-0000-0000000000a1','org/x/too-big','a.jpg','image/jpeg',10485761)$$,'23514',NULL,'file over 10 MiB rejected');

-- organization_id/program_id are derived from the target, never trusted from the client.
INSERT INTO media_assets(id,organization_id,program_id,parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES
 ('dddddddd-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a2','55555555-0000-0000-0000-0000000000a2','77777777-0000-0000-0000-0000000000a1','org/m1/parent-line/m1/img1.jpg','img1.jpg','image/jpeg',1000);
SELECT is((SELECT organization_id FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a1'),'11111111-0000-0000-0000-0000000000a1'::uuid,'organization_id is derived from the target, overriding a forged client value');
SELECT is((SELECT program_id FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a1'),'55555555-0000-0000-0000-0000000000a1'::uuid,'program_id is derived from the target, overriding a forged client value');

-- Cross-org rejection: the target exists, but RLS blocks attaching media to another team's record.
SELECT throws_ok($$INSERT INTO media_assets(parent_line_id,storage_path,original_filename,mime_type,byte_size) VALUES ('77777777-0000-0000-0000-0000000000a9','org/m1/parent-line/m9/img.jpg','img.jpg','image/jpeg',1000)$$,'42501',NULL,'cannot attach media to another team''s record');

-- Immutability: target and storage identity cannot change after creation; presentation metadata can.
SELECT throws_ok($$UPDATE media_assets SET parent_line_id='77777777-0000-0000-0000-0000000000a2' WHERE id='dddddddd-0000-0000-0000-0000000000a1'$$,'23514',NULL,'media target is immutable');
SELECT throws_ok($$UPDATE media_assets SET storage_path='org/m1/parent-line/m1/other.jpg' WHERE id='dddddddd-0000-0000-0000-0000000000a1'$$,'23514',NULL,'media storage path is immutable');
SELECT lives_ok($$UPDATE media_assets SET caption='Plante en fleur' WHERE id='dddddddd-0000-0000-0000-0000000000a1'$$,'caption can be edited without touching identity');

-- Primary image invariant: at most one active primary per target, switched atomically.
INSERT INTO media_assets(id,parent_line_id,storage_path,original_filename,mime_type,byte_size,is_primary) VALUES
 ('dddddddd-0000-0000-0000-0000000000a2','77777777-0000-0000-0000-0000000000a1','org/m1/parent-line/m1/img2.jpg','img2.jpg','image/jpeg',1000,true);
SELECT throws_ok($$UPDATE media_assets SET is_primary=true WHERE id='dddddddd-0000-0000-0000-0000000000a1'$$,'23505',NULL,'only one active primary image per target at a time');
SELECT lives_ok($$SELECT set_media_primary('dddddddd-0000-0000-0000-0000000000a1')$$,'set_media_primary atomically switches the primary image');
SELECT is((SELECT count(*) FROM media_assets WHERE parent_line_id='77777777-0000-0000-0000-0000000000a1' AND is_primary),1::bigint,'exactly one primary image remains after switching');
SELECT is((SELECT is_primary FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a1'),true,'the requested image is now primary');

-- Archive / restore lifecycle: archiving the primary never auto-promotes a replacement.
UPDATE media_assets SET archived_at=NOW() WHERE id='dddddddd-0000-0000-0000-0000000000a1';
SELECT is((SELECT is_primary FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a1'),false,'archiving the primary image clears its own primary flag');
SELECT is((SELECT count(*) FROM media_assets WHERE parent_line_id='77777777-0000-0000-0000-0000000000a1' AND is_primary AND archived_at IS NULL),0::bigint,'no image is left primary while the former primary is archived');
UPDATE media_assets SET archived_at=NULL WHERE id='dddddddd-0000-0000-0000-0000000000a1';
SELECT is((SELECT is_primary FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a1'),false,'restoring an image never silently makes it primary again');

-- No hard delete: media is archived, never removed, like every other breeding lifecycle table.
DELETE FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*) FROM media_assets WHERE id='dddddddd-0000-0000-0000-0000000000a2'),1::bigint,'media rows have no delete policy and cannot be hard-deleted by a team member');

-- The other three supported target types are accepted; crosses are intentionally out of scope.
SELECT lives_ok($$INSERT INTO media_assets(family_id,storage_path,original_filename,mime_type,byte_size) VALUES ('99999999-0000-0000-0000-0000000000a1','org/m1/family/m1/img.jpg','img.jpg','image/jpeg',1000)$$,'family media accepted');
SELECT lives_ok($$INSERT INTO media_assets(seed_lot_id,storage_path,original_filename,mime_type,byte_size) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','org/m1/seed-lot/m1/img.jpg','img.jpg','image/jpeg',1000)$$,'seed lot media accepted');
SELECT lives_ok($$INSERT INTO media_assets(phenotype_evaluation_id,storage_path,original_filename,mime_type,byte_size) VALUES ('cccccccc-0000-0000-0000-0000000000a1','org/m1/phenotype-evaluation/m1/img.jpg','img.jpg','image/jpeg',1000)$$,'phenotype evaluation media accepted (supplementary evidence only, never a trait)');

-- Cross-team isolation on read.
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000a2',true);
SELECT is((SELECT count(*) FROM media_assets WHERE parent_line_id='77777777-0000-0000-0000-0000000000a1'),0::bigint,'other team cannot read this team''s media');

SELECT * FROM finish();
ROLLBACK;
