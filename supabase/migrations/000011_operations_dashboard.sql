ALTER TABLE public.experimental_cycles ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.experimental_cycles ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.experimental_cycles ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
ALTER TABLE public.tasks ALTER COLUMN experimental_cycle_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN priority SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.task_templates ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
ALTER TABLE public.task_checklist_items ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

ALTER TABLE public.experimental_cycles ADD CONSTRAINT experimental_cycles_dates_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
ALTER TABLE public.experimental_cycles ADD CONSTRAINT experimental_cycles_status_check CHECK (status IN ('planned','active','completed','cancelled'));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_dates_valid CHECK (due_date IS NULL OR planned_date IS NULL OR due_date >= planned_date);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low','medium','high','critical'));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('not_started','in_progress','blocked','completed','cancelled'));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_completion_consistent CHECK ((status='completed') = (completed_at IS NOT NULL));

CREATE FUNCTION public.validate_task_context()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM experimental_cycles c WHERE c.id=NEW.experimental_cycle_id AND c.program_id=NEW.program_id AND c.deleted_at IS NULL)
  THEN RAISE EXCEPTION 'Task cycle must belong to the same program' USING ERRCODE='23514'; END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles p JOIN programs g ON g.organization_id=p.organization_id
    WHERE p.id=NEW.assigned_to AND g.id=NEW.program_id AND p.is_active AND p.deleted_at IS NULL AND g.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Assignee must belong to the program team' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_task_context BEFORE INSERT OR UPDATE OF experimental_cycle_id,program_id,assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.validate_task_context();
REVOKE EXECUTE ON FUNCTION public.validate_task_context() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.set_task_status(target_task_id uuid,new_status text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE task_program_id uuid;
BEGIN
  IF new_status NOT IN ('not_started','in_progress','blocked','completed','cancelled') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
  SELECT program_id INTO task_program_id FROM tasks WHERE id=target_task_id AND deleted_at IS NULL;
  IF task_program_id IS NULL OR NOT can_write_program(task_program_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  UPDATE tasks SET status=new_status,completed_at=CASE WHEN new_status='completed' THEN COALESCE(completed_at,now()) ELSE NULL END WHERE id=target_task_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_task_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_task_status(uuid,text) TO authenticated;

CREATE FUNCTION public.get_dashboard_kpis(target_program_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target_team_id uuid;
BEGIN
  SELECT organization_id INTO target_team_id FROM programs WHERE id=target_program_id AND deleted_at IS NULL AND can_access_program(id);
  IF target_team_id IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'crosses',(SELECT count(*) FROM crosses WHERE program_id=target_program_id AND deleted_at IS NULL),
    'seed_lots',(SELECT count(*) FROM seed_lots WHERE program_id=target_program_id AND deleted_at IS NULL),
    'mean_germination_rate',(SELECT round(avg(g.germination_rate),2) FROM germination_tests g JOIN seed_lots l ON l.id=g.seed_lot_id WHERE l.program_id=target_program_id AND g.deleted_at IS NULL AND l.deleted_at IS NULL),
    'phenotypes_evaluated',(SELECT count(DISTINCT e.phenotype_id) FROM phenotype_evaluations e JOIN phenotypes p ON p.id=e.phenotype_id WHERE p.program_id=target_program_id AND e.deleted_at IS NULL AND p.deleted_at IS NULL),
    'elite_phenotypes',(SELECT count(DISTINCT e.phenotype_id) FROM phenotype_evaluations e JOIN phenotypes p ON p.id=e.phenotype_id WHERE p.program_id=target_program_id AND e.automatic_decision='elite' AND e.deleted_at IS NULL AND p.deleted_at IS NULL),
    'inventory_items_below_threshold',(SELECT count(*) FROM inventory_items i WHERE i.organization_id=target_team_id AND i.deleted_at IS NULL AND (SELECT COALESCE(sum(l.current_quantity),0) FROM inventory_lots l WHERE l.inventory_item_id=i.id AND l.deleted_at IS NULL) <= i.minimum_stock),
    'lots_nearing_expiration',(SELECT count(*) FROM inventory_lots l JOIN inventory_items i ON i.id=l.inventory_item_id WHERE i.organization_id=target_team_id AND l.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30 AND l.deleted_at IS NULL AND i.deleted_at IS NULL),
    'overdue_tasks',(SELECT count(*) FROM tasks WHERE program_id=target_program_id AND due_date<CURRENT_DATE AND completed_at IS NULL AND status NOT IN ('completed','cancelled') AND deleted_at IS NULL),
    'task_completion_ratio',(SELECT CASE WHEN count(*)=0 THEN 0 ELSE round(count(*) FILTER (WHERE status='completed')::numeric/count(*)*100,2) END FROM tasks WHERE program_id=target_program_id AND status<>'cancelled' AND deleted_at IS NULL)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid) TO authenticated;
