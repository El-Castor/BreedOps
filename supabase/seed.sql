-- Local demonstration data only. It is applied by `supabase db reset`.

INSERT INTO organizations (id, name, slug)
VALUES ('10000000-0000-0000-0000-000000000001', 'Équipe Démonstration', 'equipe-demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO programs (id, organization_id, code, name, species, campaign, status)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'DEMO-2026',
  'Programme démonstration 2026',
  'Solanum lycopersicum',
  '2026',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_lines (id, program_id, parent_code, line_name, generation, status)
VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DEMO-F-01', 'Lignée femelle démo', 4, 'active'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'DEMO-M-01', 'Lignée mâle démo', 4, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crosses (id, program_id, cross_code, female_parent_id, male_parent_id, generation, pollination_date, pollinated_units, established_units, total_seeds, status)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'DEMO-X-001',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  1,
  CURRENT_DATE - 60,
  10,
  8,
  480,
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO families (id, program_id, cross_id, family_code, generation, status)
VALUES ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'DEMO-FAM-001', 1, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO seed_lots (id, program_id, cross_id, family_id, seed_lot_code, harvest_date, total_quantity, quantity_unit, status)
VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'DEMO-LOT-001', CURRENT_DATE - 20, 480, 'seeds', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO germination_tests (id, seed_lot_id, test_date, evaluation_day, seeds_tested, seeds_germinated, method)
VALUES ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', CURRENT_DATE - 7, 10, 100, 92, 'papier absorbant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO selection_models (id, program_id, name, version, maximum_score, is_active)
VALUES ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Notation initiale', '1.0', 130, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO selection_criteria (id, selection_model_id, code, name, coefficient, minimum_value, maximum_value, display_order)
VALUES
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'vigor', 'Vigueur végétative', 1, 0, 10, 1),
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', 'architecture', 'Architecture', 1, 0, 10, 2),
  ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000001', 'yield', 'Rendement', 2, 0, 10, 3),
  ('81000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000001', 'sanitary_quality', 'Qualité sanitaire et homogénéité', 2, 0, 10, 4),
  ('81000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000001', 'analytical_quality', 'Qualité analytique post-récolte', 3, 0, 10, 5),
  ('81000000-0000-0000-0000-000000000006', '80000000-0000-0000-0000-000000000001', 'stability', 'Stabilité sous stress', 4, 0, 10, 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO selection_decision_rules (id, selection_model_id, decision, minimum_weighted_score, minimum_stability_score, display_order)
VALUES
  ('82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'elite', 110, 9, 1),
  ('82000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', 'advance', 100, 8, 2),
  ('82000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000001', 'reserve', 90, 7, 3),
  ('82000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000001', 'eliminate', 0, 0, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO phenotypes (id, program_id, family_id, seed_lot_id, phenotype_code, block, replicate, status)
VALUES ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'DEMO-PHENO-001', 'A', 1, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO phenotype_evaluations (id, phenotype_id, selection_model_id, evaluation_date, validation_status)
VALUES ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', CURRENT_DATE, 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO phenotype_scores (id, phenotype_evaluation_id, criterion_id, raw_score)
VALUES
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 9),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 8),
  ('92000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', 9),
  ('92000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000004', 9),
  ('92000000-0000-0000-0000-000000000005', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000005', 9),
  ('92000000-0000-0000-0000-000000000006', '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000006', 9)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_items (id, organization_id, category, name, default_unit, minimum_stock, is_active)
VALUES ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'consumable', 'Gants nitrile', 'boîtes', 3, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_lots (id, inventory_item_id, batch_number, received_at, expiration_date, initial_quantity, current_quantity, status)
VALUES ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'LOT-DEMO-01', CURRENT_DATE - 30, CURRENT_DATE + 60, 10, 10, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_movements (id, inventory_lot_id, movement_type, quantity, unit, movement_date, reason)
VALUES ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'consumption', 2, 'boîtes', CURRENT_DATE - 1, 'Préparation démonstration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO experimental_cycles (id, program_id, name, start_date, end_date, status)
VALUES ('b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Cycle démonstration', CURRENT_DATE - 14, CURRENT_DATE + 28, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, experimental_cycle_id, program_id, title, planned_date, due_date, priority, status)
VALUES ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Évaluer la germination', CURRENT_DATE - 5, CURRENT_DATE - 1, 'high', 'in_progress')
ON CONFLICT (id) DO NOTHING;
