-- Disposable local test fixtures only. Everything is rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);
INSERT INTO organizations(id,name,slug) VALUES
 ('11111111-0000-0000-0000-0000000000d1','Pheno A','pheno-test-a'),
 ('11111111-0000-0000-0000-0000000000d2','Pheno B','pheno-test-b');
INSERT INTO auth.users(id) VALUES
 ('22222222-0000-0000-0000-0000000000d1'),('22222222-0000-0000-0000-0000000000d2');
INSERT INTO profiles(user_id,organization_id,role) VALUES
 ('22222222-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000d1','user'),
 ('22222222-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-0000000000d2','user');
INSERT INTO programs(id,organization_id,code,name) VALUES
 ('55555555-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000d1','PHA','Pheno program A'),
 ('55555555-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-0000000000d1','PHB','Pheno program B'),
 ('55555555-0000-0000-0000-0000000000d3','11111111-0000-0000-0000-0000000000d2','PHC','Foreign program');
INSERT INTO parent_lines(id,program_id,line_name) VALUES
 ('77777777-0000-0000-0000-0000000000d1','55555555-0000-0000-0000-0000000000d1','F'),
 ('77777777-0000-0000-0000-0000000000d2','55555555-0000-0000-0000-0000000000d1','M');
INSERT INTO crosses(id,program_id,female_parent_id,male_parent_id) VALUES
 ('88888888-0000-0000-0000-0000000000d1','55555555-0000-0000-0000-0000000000d1','77777777-0000-0000-0000-0000000000d1','77777777-0000-0000-0000-0000000000d2');
INSERT INTO families(id,program_id,cross_id) VALUES
 ('99999999-0000-0000-0000-0000000000d1','55555555-0000-0000-0000-0000000000d1','88888888-0000-0000-0000-0000000000d1');
INSERT INTO seed_lots(id,program_id,cross_id,family_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000d1','55555555-0000-0000-0000-0000000000d1','88888888-0000-0000-0000-0000000000d1','99999999-0000-0000-0000-0000000000d1');
INSERT INTO phenotypes(id,program_id,family_id,seed_lot_id) VALUES
 ('bbbbbbbb-0000-0000-0000-0000000000d1','55555555-0000-0000-0000-0000000000d1','99999999-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-0000000000d1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000d1',true);

-- Trait library and type validation
INSERT INTO phenotype_traits(id,organization_id,code,name,category,data_type,unit,minimum_value,maximum_value,decimal_places,direction) VALUES
 ('cccccccc-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000d1','plant_height','Hauteur','morphology','numeric','cm',0,300,1,'neutral'),
 ('cccccccc-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-0000000000d1','disease','Résistance','disease_resistance','ordinal',NULL,1,9,NULL,'higher_is_better');
INSERT INTO phenotype_traits(id,organization_id,code,name,category,data_type,allowed_values) VALUES
 ('cccccccc-0000-0000-0000-0000000000d3','11111111-0000-0000-0000-0000000000d1','flower_color','Couleur','flowering','categorical',ARRAY['blanc','rose','rouge']);
INSERT INTO phenotype_traits(id,organization_id,code,name,category,data_type) VALUES
 ('cccccccc-0000-0000-0000-0000000000d4','11111111-0000-0000-0000-0000000000d1','lodging','Verse','stress_tolerance','boolean'),
 ('cccccccc-0000-0000-0000-0000000000d5','11111111-0000-0000-0000-0000000000d1','heading_date','Épiaison','flowering','date'),
 ('cccccccc-0000-0000-0000-0000000000d6','11111111-0000-0000-0000-0000000000d1','remark','Remarque','other','text');
SELECT is((SELECT count(*) FROM phenotype_traits WHERE organization_id='11111111-0000-0000-0000-0000000000d1'),6::bigint,'team member creates traits of every type');
SELECT throws_ok($$INSERT INTO phenotype_traits(organization_id,code,name,data_type,minimum_value,maximum_value) VALUES ('11111111-0000-0000-0000-0000000000d1','bad_ord','Bad','ordinal',1.5,5)$$,'23514',NULL,'ordinal scale must use whole bounds');
SELECT throws_ok($$INSERT INTO phenotype_traits(organization_id,code,name,data_type) VALUES ('11111111-0000-0000-0000-0000000000d1','bad_cat','Bad','categorical')$$,'23514',NULL,'categorical trait requires allowed values');
SELECT throws_ok($$INSERT INTO phenotype_traits(organization_id,code,name,data_type,minimum_value) VALUES ('11111111-0000-0000-0000-0000000000d1','bad_txt','Bad','text',1)$$,'23514',NULL,'text trait cannot carry a numeric range');
SELECT throws_ok($$INSERT INTO phenotype_traits(organization_id,code,name,data_type) VALUES ('11111111-0000-0000-0000-0000000000d1','Bad Code','Bad','text')$$,'23514',NULL,'trait code format enforced');
SELECT throws_ok($$INSERT INTO phenotype_traits(organization_id,code,name,data_type) VALUES ('11111111-0000-0000-0000-0000000000d2','foreign','Foreign','text')$$,'42501',NULL,'cannot create a trait for another team');

-- Modules and program configuration
INSERT INTO phenotyping_modules(id,organization_id,name) VALUES
 ('dddddddd-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000d1','Agronomie');
INSERT INTO phenotyping_module_traits(module_id,trait_id,display_order)
SELECT 'dddddddd-0000-0000-0000-0000000000d1', id, row_number() OVER (ORDER BY code)
FROM phenotype_traits WHERE organization_id='11111111-0000-0000-0000-0000000000d1';
SELECT is((SELECT count(*) FROM phenotyping_module_traits WHERE module_id='dddddddd-0000-0000-0000-0000000000d1'),6::bigint,'module groups traits');
SELECT lives_ok($$SELECT move_module_trait('dddddddd-0000-0000-0000-0000000000d1','cccccccc-0000-0000-0000-0000000000d1',-1)$$,'trait can be moved up');
SELECT is((SELECT display_order FROM phenotyping_module_traits WHERE trait_id='cccccccc-0000-0000-0000-0000000000d1'),4,'move swaps display order');
INSERT INTO program_phenotyping_modules(program_id,module_id) VALUES
 ('55555555-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d1');
SELECT is((SELECT count(*) FROM program_active_traits('55555555-0000-0000-0000-0000000000d1')),6::bigint,'program A follows the module traits');
SELECT is((SELECT count(*) FROM program_active_traits('55555555-0000-0000-0000-0000000000d2')),0::bigint,'program B follows no traits');
SELECT throws_ok($$INSERT INTO program_phenotyping_modules(program_id,module_id) VALUES ('55555555-0000-0000-0000-0000000000d3','dddddddd-0000-0000-0000-0000000000d1')$$,'23514',NULL,'cannot attach a module to a foreign program');

-- Dynamic evaluation: typed values and validation (observation-only, no model)
SELECT lives_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-01',
  '{"plant_height":123.4,"disease":7,"flower_color":"rose","lodging":false,"heading_date":"2026-06-02","remark":"Bon port"}'::jsonb)$$,'every data type accepted');
SELECT is((SELECT count(*) FROM phenotype_trait_values),6::bigint,'typed values persisted');
SELECT is((SELECT numeric_value FROM phenotype_trait_values WHERE trait_id='cccccccc-0000-0000-0000-0000000000d1'),123.4,'numeric value stored');
SELECT is((SELECT date_value FROM phenotype_trait_values WHERE trait_id='cccccccc-0000-0000-0000-0000000000d5'),'2026-06-02'::date,'date value stored');
SELECT is((SELECT selection_model_id FROM phenotype_evaluations LIMIT 1),NULL,'observation-only evaluation has no model');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"plant_height":301}'::jsonb)$$,'23514',NULL,'numeric bounds enforced');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"plant_height":12.34}'::jsonb)$$,'22023',NULL,'precision enforced');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"disease":3.5}'::jsonb)$$,'22023',NULL,'ordinal requires whole values');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"flower_color":"bleu"}'::jsonb)$$,'23514',NULL,'categorical allowed values enforced');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"lodging":"oui"}'::jsonb)$$,'22023',NULL,'boolean type enforced');
SELECT throws_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-02','{"unknown":1}'::jsonb)$$,'23514',NULL,'traits outside the program configuration rejected');
SELECT throws_ok($$INSERT INTO phenotype_trait_values(phenotype_evaluation_id,trait_id,numeric_value) SELECT id,'cccccccc-0000-0000-0000-0000000000d1',1 FROM phenotype_evaluations LIMIT 1$$,'42501',NULL,'values cannot be written directly');

-- Selection model integration: V1 model maps to library traits; weights only on chosen traits
SELECT lives_ok($$SELECT create_initial_selection_model('55555555-0000-0000-0000-0000000000d1','Modèle test')$$,'initial model creates linked V1 traits');
SELECT is((SELECT count(*) FROM selection_criteria c JOIN selection_models m ON m.id=c.selection_model_id WHERE m.program_id='55555555-0000-0000-0000-0000000000d1' AND c.trait_id IS NOT NULL),6::bigint,'V1 criteria reference library traits');
SELECT lives_ok($$SELECT set_program_trait_weight('55555555-0000-0000-0000-0000000000d1','cccccccc-0000-0000-0000-0000000000d2',3)$$,'ordinal trait can be weighted');
SELECT is((SELECT maximum_score FROM selection_models WHERE program_id='55555555-0000-0000-0000-0000000000d1'),157::numeric,'model maximum recomputed (130 + 9 x 3)');
SELECT throws_ok($$SELECT set_program_trait_weight('55555555-0000-0000-0000-0000000000d1','cccccccc-0000-0000-0000-0000000000d3',2)$$,'23514',NULL,'categorical trait cannot be weighted');
SELECT lives_ok($$SELECT submit_trait_evaluation('bbbbbbbb-0000-0000-0000-0000000000d1','2026-09-03',
  '{"vigor":9,"architecture":9,"yield":9,"sanitary_quality":9,"analytical_quality":9,"stability":9,"disease":9,"plant_height":150}'::jsonb)$$,'complete weighted evaluation accepted');
SELECT is((SELECT weighted_score||'|'||automatic_decision FROM phenotype_evaluations WHERE evaluation_date='2026-09-03'),'144|elite','PostgreSQL scores the trait-based evaluation (13 x 9 + 3 x 9)');

SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-0000000000d2',true);
SELECT is((SELECT count(*) FROM phenotype_traits WHERE organization_id='11111111-0000-0000-0000-0000000000d1'),0::bigint,'other team cannot read the trait library');
SELECT * FROM finish();
ROLLBACK;
