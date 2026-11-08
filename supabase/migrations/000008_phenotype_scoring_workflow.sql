ALTER TABLE public.phenotypes ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.selection_models ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.selection_models ALTER COLUMN maximum_score SET NOT NULL;
ALTER TABLE public.selection_criteria ALTER COLUMN selection_model_id SET NOT NULL;
ALTER TABLE public.selection_criteria ALTER COLUMN coefficient SET NOT NULL;
ALTER TABLE public.selection_criteria ALTER COLUMN minimum_value SET NOT NULL;
ALTER TABLE public.selection_criteria ALTER COLUMN maximum_value SET NOT NULL;
ALTER TABLE public.phenotype_evaluations ALTER COLUMN phenotype_id SET NOT NULL;
ALTER TABLE public.phenotype_evaluations ALTER COLUMN selection_model_id SET NOT NULL;
ALTER TABLE public.phenotype_scores ALTER COLUMN phenotype_evaluation_id SET NOT NULL;
ALTER TABLE public.phenotype_scores ALTER COLUMN criterion_id SET NOT NULL;
ALTER TABLE public.phenotype_scores ALTER COLUMN raw_score SET NOT NULL;

ALTER TABLE public.selection_models ADD CONSTRAINT selection_models_maximum_positive CHECK (maximum_score > 0);
ALTER TABLE public.selection_criteria ADD CONSTRAINT selection_criteria_bounds_valid CHECK (minimum_value <= maximum_value AND coefficient > 0);
ALTER TABLE public.selection_criteria ADD CONSTRAINT selection_criteria_model_code_unique UNIQUE (selection_model_id, code);
ALTER TABLE public.phenotype_scores ADD CONSTRAINT phenotype_scores_criterion_unique UNIQUE (phenotype_evaluation_id, criterion_id);
ALTER TABLE public.phenotype_evaluations ADD CONSTRAINT phenotype_evaluations_status_check CHECK (validation_status IN ('draft', 'validated'));

CREATE FUNCTION public.validate_phenotype_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM families WHERE id = NEW.family_id AND program_id = NEW.program_id AND deleted_at IS NULL)) OR
     (NEW.seed_lot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM seed_lots WHERE id = NEW.seed_lot_id AND program_id = NEW.program_id AND deleted_at IS NULL))
  THEN RAISE EXCEPTION 'Phenotype lineage must belong to the same program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_phenotype_lineage BEFORE INSERT OR UPDATE OF program_id, family_id, seed_lot_id ON public.phenotypes
FOR EACH ROW EXECUTE FUNCTION public.validate_phenotype_lineage();
REVOKE EXECUTE ON FUNCTION public.validate_phenotype_lineage() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_initial_selection_model(target_program_id uuid, model_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE model_id uuid;
BEGIN
  IF NOT can_write_program(target_program_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF length(trim(model_name)) < 1 OR length(model_name) > 160 THEN RAISE EXCEPTION 'Invalid model name' USING ERRCODE = '22023'; END IF;
  INSERT INTO selection_models(program_id,name,version,maximum_score,is_active)
  VALUES(target_program_id,trim(model_name),'1.0',130,true) RETURNING id INTO model_id;
  INSERT INTO selection_criteria(selection_model_id,code,name,coefficient,minimum_value,maximum_value,display_order) VALUES
    (model_id,'vigor','Vigueur',1,0,10,1),(model_id,'architecture','Architecture',1,0,10,2),
    (model_id,'yield','Rendement',2,0,10,3),(model_id,'sanitary_quality','Qualité sanitaire',2,0,10,4),
    (model_id,'analytical_quality','Qualité analytique',3,0,10,5),(model_id,'stability','Stabilité',4,0,10,6);
  INSERT INTO selection_decision_rules(selection_model_id,decision,minimum_weighted_score,minimum_stability_score,display_order) VALUES
    (model_id,'elite',110,9,1),(model_id,'advance',100,8,2),(model_id,'reserve',90,7,3),(model_id,'eliminate',0,0,4);
  RETURN model_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_initial_selection_model(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_initial_selection_model(uuid,text) TO authenticated;

CREATE FUNCTION public.update_selection_criterion(target_criterion_id uuid, new_coefficient numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE model_id uuid;
BEGIN
  IF new_coefficient <= 0 OR new_coefficient > 100 THEN RAISE EXCEPTION 'Invalid coefficient' USING ERRCODE='22023'; END IF;
  SELECT c.selection_model_id INTO model_id FROM selection_criteria c JOIN selection_models m ON m.id=c.selection_model_id
  WHERE c.id=target_criterion_id AND c.deleted_at IS NULL AND m.deleted_at IS NULL AND can_write_program(m.program_id);
  IF model_id IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  UPDATE selection_criteria SET coefficient=new_coefficient WHERE id=target_criterion_id;
  UPDATE selection_models SET maximum_score=(SELECT sum(maximum_value*coefficient) FROM selection_criteria WHERE selection_model_id=model_id AND deleted_at IS NULL)
  WHERE id=model_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_selection_criterion(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_selection_criterion(uuid,numeric) TO authenticated;

CREATE FUNCTION public.submit_phenotype_evaluation(target_phenotype_id uuid, target_model_id uuid, target_date date, submitted_scores jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE evaluation_id uuid; criterion record; supplied numeric; submitted_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM phenotypes p JOIN selection_models m ON m.program_id=p.program_id
    WHERE p.id=target_phenotype_id AND m.id=target_model_id AND p.deleted_at IS NULL AND m.deleted_at IS NULL
      AND m.is_active AND can_write_program(p.program_id))
  THEN RAISE EXCEPTION 'Invalid phenotype or model' USING ERRCODE = '23514'; END IF;
  IF jsonb_typeof(submitted_scores) <> 'object' THEN RAISE EXCEPTION 'Scores must be an object' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO submitted_count FROM jsonb_object_keys(submitted_scores);
  IF submitted_count <> (SELECT count(*) FROM selection_criteria WHERE selection_model_id=target_model_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'Every criterion must be scored exactly once' USING ERRCODE = '23514'; END IF;
  INSERT INTO phenotype_evaluations(phenotype_id,selection_model_id,evaluator_id,evaluation_date,validation_status)
  SELECT target_phenotype_id,target_model_id,p.id,target_date,'draft' FROM profiles p
  WHERE p.user_id=auth.uid() AND p.is_active AND p.deleted_at IS NULL RETURNING id INTO evaluation_id;
  IF evaluation_id IS NULL THEN RAISE EXCEPTION 'Active evaluator required' USING ERRCODE = '42501'; END IF;
  FOR criterion IN SELECT id,code,minimum_value,maximum_value FROM selection_criteria
    WHERE selection_model_id=target_model_id AND deleted_at IS NULL ORDER BY display_order LOOP
    IF NOT submitted_scores ? criterion.code OR jsonb_typeof(submitted_scores->criterion.code) <> 'number'
    THEN RAISE EXCEPTION 'Missing or invalid score for %',criterion.code USING ERRCODE='22023'; END IF;
    supplied := (submitted_scores->>criterion.code)::numeric;
    IF supplied < criterion.minimum_value OR supplied > criterion.maximum_value
    THEN RAISE EXCEPTION 'Score outside criterion bounds' USING ERRCODE='23514'; END IF;
    INSERT INTO phenotype_scores(phenotype_evaluation_id,criterion_id,raw_score) VALUES(evaluation_id,criterion.id,supplied);
  END LOOP;
  RETURN evaluation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_phenotype_evaluation(uuid,uuid,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_phenotype_evaluation(uuid,uuid,date,jsonb) TO authenticated;
