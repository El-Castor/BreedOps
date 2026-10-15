-- Experimental Workflows: cycle templates, task dependencies and
-- dependency-aware generation/scheduling on top of the existing
-- task_templates / experimental_cycles / tasks / task_checklist_items
-- architecture (see 000001_init_schema.sql, 000011_operations_dashboard.sql).
--
-- This migration intentionally extends that architecture; it does not
-- introduce a parallel project-management model. Real tasks remain the
-- single operational source of truth; cycle templates are reusable
-- blueprints that generate real tasks (and their checklists/dependencies)
-- as a snapshot at instantiation time.
--
-- Finish-to-start dependency semantics (the only type supported in V1):
--   successor.planned_date >= predecessor.due_date + 1 + lag_days
-- Scheduling formula (evaluated in topological order, never template
-- sort_order):
--   base_start = cycle_start + start_offset_days
--   dependency_start = MAX(predecessor.due_date + 1 + lag_days) over all predecessors
--   planned_date = GREATEST(base_start, dependency_start)
--   due_date = planned_date + duration_days - 1

-- ───────────────────────── experimental_cycles: template traceability ─────────────────────────
ALTER TABLE public.experimental_cycles
  ADD COLUMN IF NOT EXISTS source_template_id uuid;
COMMENT ON COLUMN public.experimental_cycles.source_template_id IS
  'Cycle template this cycle was generated from, if any. Historical/manual cycles leave this null. Traceability only: editing the template never rewrites this cycle''s already-generated tasks.';

-- task_checklist_items: stable ordering for both manual and template-generated items.
ALTER TABLE public.task_checklist_items
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ───────────────────────── experimental_cycle_templates ─────────────────────────
-- Program-scoped reusable workflow blueprint. Archived (is_active = false /
-- deleted_at) templates can no longer be instantiated, but existing cycles
-- generated from them are entirely unaffected.
CREATE TABLE public.experimental_cycle_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  CONSTRAINT experimental_cycle_templates_code_unique UNIQUE (program_id, code)
);
COMMENT ON TABLE public.experimental_cycle_templates IS
  'Reusable, program-scoped experimental workflow blueprint. Instantiation generates real experimental_cycles/tasks as a snapshot; later template edits never retroactively change already-generated cycles.';

CREATE INDEX idx_experimental_cycle_templates_program_id ON public.experimental_cycle_templates(program_id);

CREATE TRIGGER update_experimental_cycle_templates_updated_at BEFORE UPDATE ON public.experimental_cycle_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.experimental_cycles
  ADD CONSTRAINT experimental_cycles_source_template_id_fkey
  FOREIGN KEY (source_template_id) REFERENCES public.experimental_cycle_templates(id) ON DELETE SET NULL;

-- ───────────────────────── experimental_cycle_template_tasks ─────────────────────────
-- One ordered step of a cycle template, associating it with an existing
-- reusable task_templates row. Scheduling metadata here (start_offset_days,
-- duration_days) is authoritative for generation; task_templates'
-- relative_week/relative_day remain a legacy hint for manually assembled
-- workflows and are never read by the generator.
CREATE TABLE public.experimental_cycle_template_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_template_id uuid NOT NULL REFERENCES public.experimental_cycle_templates(id) ON DELETE CASCADE,
  task_template_id uuid NOT NULL REFERENCES public.task_templates(id) ON DELETE RESTRICT,
  start_offset_days integer NOT NULL DEFAULT 0 CHECK (start_offset_days >= 0),
  duration_days integer NOT NULL DEFAULT 1 CHECK (duration_days >= 1),
  default_assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.experimental_cycle_template_tasks IS
  'One ordered step of a cycle template. start_offset_days is the minimum planned offset from cycle start; dependency scheduling can push a step later but never earlier than this.';
COMMENT ON COLUMN public.experimental_cycle_template_tasks.start_offset_days IS
  'Minimum offset (days) from the cycle start date. Authoritative scheduling metadata for generation; task_templates.relative_week/relative_day are legacy hints only.';

CREATE INDEX idx_ect_tasks_cycle_template_id ON public.experimental_cycle_template_tasks(cycle_template_id);
CREATE INDEX idx_ect_tasks_task_template_id ON public.experimental_cycle_template_tasks(task_template_id);

CREATE TRIGGER update_ect_tasks_updated_at BEFORE UPDATE ON public.experimental_cycle_template_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ───────────────────────── experimental_cycle_template_dependencies ─────────────────────────
-- Dependency edges between steps of the SAME cycle template. References
-- experimental_cycle_template_tasks rows, never real tasks.
CREATE TABLE public.experimental_cycle_template_dependencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_template_id uuid NOT NULL REFERENCES public.experimental_cycle_templates(id) ON DELETE CASCADE,
  predecessor_template_task_id uuid NOT NULL REFERENCES public.experimental_cycle_template_tasks(id) ON DELETE CASCADE,
  successor_template_task_id uuid NOT NULL REFERENCES public.experimental_cycle_template_tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type = 'finish_to_start'),
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days >= 0),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ect_dependencies_no_self_reference CHECK (predecessor_template_task_id <> successor_template_task_id),
  CONSTRAINT ect_dependencies_unique UNIQUE (predecessor_template_task_id, successor_template_task_id)
);
COMMENT ON TABLE public.experimental_cycle_template_dependencies IS
  'Finish-to-start dependency edges between steps of one cycle template. A template must always represent a DAG; validate_template_dependency() rejects self-reference, cross-template edges and anything that would introduce a cycle.';

CREATE INDEX idx_ect_dependencies_cycle_template_id ON public.experimental_cycle_template_dependencies(cycle_template_id);
CREATE INDEX idx_ect_dependencies_predecessor ON public.experimental_cycle_template_dependencies(predecessor_template_task_id);
CREATE INDEX idx_ect_dependencies_successor ON public.experimental_cycle_template_dependencies(successor_template_task_id);

-- Reject a cross-template edge and any edge that would introduce a cycle
-- (A->B->C->A). Cycle detection: compute the set of template-task nodes
-- reachable FORWARD from the successor through existing edges of the SAME
-- template; if the predecessor is already in that reachable set, the
-- successor already reaches back to the predecessor, so adding
-- predecessor->successor would close a loop.
CREATE FUNCTION public.validate_template_dependency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pred_template uuid;
  succ_template uuid;
  would_cycle boolean;
BEGIN
  SELECT cycle_template_id INTO pred_template FROM experimental_cycle_template_tasks WHERE id = NEW.predecessor_template_task_id;
  SELECT cycle_template_id INTO succ_template FROM experimental_cycle_template_tasks WHERE id = NEW.successor_template_task_id;
  IF pred_template IS NULL OR succ_template IS NULL OR pred_template <> succ_template THEN
    RAISE EXCEPTION 'Dependency steps must belong to the same cycle template' USING ERRCODE = '23514';
  END IF;
  IF NEW.cycle_template_id <> pred_template THEN
    RAISE EXCEPTION 'cycle_template_id must match the steps'' own template' USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE reachable(template_task_id) AS (
    SELECT NEW.successor_template_task_id
    UNION
    SELECT d.successor_template_task_id
    FROM experimental_cycle_template_dependencies d
    JOIN reachable r ON r.template_task_id = d.predecessor_template_task_id
    WHERE d.id IS DISTINCT FROM NEW.id
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE template_task_id = NEW.predecessor_template_task_id) INTO would_cycle;

  IF would_cycle THEN
    RAISE EXCEPTION 'This dependency would create a cycle in the template workflow' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_template_dependency() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_template_dependency_trigger BEFORE INSERT OR UPDATE ON public.experimental_cycle_template_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.validate_template_dependency();

-- ───────────────────────── task_dependencies (real tasks) ─────────────────────────
CREATE TABLE public.task_dependencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  predecessor_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  successor_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type = 'finish_to_start'),
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days >= 0),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT task_dependencies_no_self_reference CHECK (predecessor_task_id <> successor_task_id),
  CONSTRAINT task_dependencies_unique UNIQUE (predecessor_task_id, successor_task_id)
);
COMMENT ON TABLE public.task_dependencies IS
  'Finish-to-start dependency edges between real tasks: successor.planned_date >= predecessor.due_date + 1 + lag_days. validate_task_dependency() rejects self-reference, cross-program/cross-cycle edges, edges to archived tasks, and anything that would introduce a cycle.';

CREATE INDEX idx_task_dependencies_predecessor ON public.task_dependencies(predecessor_task_id);
CREATE INDEX idx_task_dependencies_successor ON public.task_dependencies(successor_task_id);

CREATE FUNCTION public.validate_task_dependency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pred RECORD;
  succ RECORD;
  would_cycle boolean;
BEGIN
  SELECT program_id, experimental_cycle_id, deleted_at, status INTO pred FROM tasks WHERE id = NEW.predecessor_task_id;
  SELECT program_id, experimental_cycle_id, deleted_at, status INTO succ FROM tasks WHERE id = NEW.successor_task_id;
  IF pred.program_id IS NULL OR succ.program_id IS NULL THEN
    RAISE EXCEPTION 'Dependency tasks must exist' USING ERRCODE = '23514';
  END IF;
  IF pred.deleted_at IS NOT NULL OR succ.deleted_at IS NOT NULL OR pred.status = 'cancelled' OR succ.status = 'cancelled' THEN
    RAISE EXCEPTION 'A dependency cannot reference an archived or cancelled task' USING ERRCODE = '23514';
  END IF;
  IF pred.program_id <> succ.program_id THEN
    RAISE EXCEPTION 'A task dependency cannot bridge two programs' USING ERRCODE = '23514';
  END IF;
  IF pred.experimental_cycle_id <> succ.experimental_cycle_id THEN
    RAISE EXCEPTION 'A task dependency cannot bridge two experimental cycles' USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE reachable(task_id) AS (
    SELECT NEW.successor_task_id
    UNION
    SELECT d.successor_task_id
    FROM task_dependencies d
    JOIN reachable r ON r.task_id = d.predecessor_task_id
    WHERE d.id IS DISTINCT FROM NEW.id
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE task_id = NEW.predecessor_task_id) INTO would_cycle;

  IF would_cycle THEN
    RAISE EXCEPTION 'This dependency would create a cycle in the task schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_task_dependency() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_task_dependency_trigger BEFORE INSERT OR UPDATE ON public.task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.validate_task_dependency();

-- ───────────────────────── task_template_checklist_items ─────────────────────────
-- SOP/checklist blueprint for a reusable task template. Copied into
-- task_checklist_items as a snapshot at instantiation time; template edits
-- never rewrite an already-generated task's checklist.
CREATE TABLE public.task_template_checklist_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_template_id uuid NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.task_template_checklist_items IS
  'SOP checklist blueprint for a task template. Copied into task_checklist_items as a snapshot when a workflow is instantiated; later edits here never rewrite existing task checklists.';

CREATE INDEX idx_task_template_checklist_items_template_id ON public.task_template_checklist_items(task_template_id);

CREATE TRIGGER update_task_template_checklist_items_updated_at BEFORE UPDATE ON public.task_template_checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ───────────────────────── RLS ─────────────────────────

-- Relax task_templates' read policy so archived (deleted_at) templates
-- remain visible to an "Afficher les archives" toggle, matching the
-- precedent set for breeding entities in 000014_breeding_identity_and_lifecycle.sql.
DROP POLICY task_templates_read ON public.task_templates;
CREATE POLICY task_templates_read ON public.task_templates FOR SELECT
  USING (can_access_program(program_id));

ALTER TABLE public.experimental_cycle_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY experimental_cycle_templates_read ON public.experimental_cycle_templates FOR SELECT
  USING (can_access_program(program_id));
CREATE POLICY experimental_cycle_templates_insert ON public.experimental_cycle_templates FOR INSERT
  WITH CHECK (can_write_program(program_id));
CREATE POLICY experimental_cycle_templates_update ON public.experimental_cycle_templates FOR UPDATE
  USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
-- No DELETE policy: a cycle template is archived (deleted_at/is_active),
-- never hard-deleted, matching task_templates and every other reusable
-- definition table in this schema.

ALTER TABLE public.experimental_cycle_template_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ect_tasks_read ON public.experimental_cycle_template_tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_access_program(t.program_id)));
CREATE POLICY ect_tasks_insert ON public.experimental_cycle_template_tasks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));
CREATE POLICY ect_tasks_update ON public.experimental_cycle_template_tasks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_access_program(t.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));
CREATE POLICY ect_tasks_delete ON public.experimental_cycle_template_tasks FOR DELETE
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));

ALTER TABLE public.experimental_cycle_template_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ect_dependencies_read ON public.experimental_cycle_template_dependencies FOR SELECT
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_access_program(t.program_id)));
CREATE POLICY ect_dependencies_insert ON public.experimental_cycle_template_dependencies FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));
CREATE POLICY ect_dependencies_update ON public.experimental_cycle_template_dependencies FOR UPDATE
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_access_program(t.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));
CREATE POLICY ect_dependencies_delete ON public.experimental_cycle_template_dependencies FOR DELETE
  USING (EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = cycle_template_id AND can_write_program(t.program_id)));

ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_dependencies_read ON public.task_dependencies FOR SELECT
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = predecessor_task_id AND can_access_program(t.program_id)));
CREATE POLICY task_dependencies_insert ON public.task_dependencies FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = predecessor_task_id AND can_write_program(t.program_id)));
CREATE POLICY task_dependencies_update ON public.task_dependencies FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = predecessor_task_id AND can_access_program(t.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = predecessor_task_id AND can_write_program(t.program_id)));
CREATE POLICY task_dependencies_delete ON public.task_dependencies FOR DELETE
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = predecessor_task_id AND can_write_program(t.program_id)));

ALTER TABLE public.task_template_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_template_checklist_items_read ON public.task_template_checklist_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = task_template_id AND can_access_program(tt.program_id)));
CREATE POLICY task_template_checklist_items_insert ON public.task_template_checklist_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = task_template_id AND can_write_program(tt.program_id)));
CREATE POLICY task_template_checklist_items_update ON public.task_template_checklist_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = task_template_id AND can_access_program(tt.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = task_template_id AND can_write_program(tt.program_id)));
CREATE POLICY task_template_checklist_items_delete ON public.task_template_checklist_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = task_template_id AND can_write_program(tt.program_id)));

-- ───────────────────────── move_cycle_template_task ─────────────────────────
-- Reorder a step within its template. Mirrors move_module_trait from
-- 000016_configurable_phenotyping.sql: swap sort_order with the adjacent
-- neighbour in the requested direction.
CREATE FUNCTION public.move_cycle_template_task(target_cycle_template_id uuid, target_template_task_id uuid, step integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  current_order integer;
  neighbour RECORD;
BEGIN
  IF step NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Invalid step' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM experimental_cycle_templates t WHERE t.id = target_cycle_template_id AND can_write_program(t.program_id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT sort_order INTO current_order FROM experimental_cycle_template_tasks
    WHERE cycle_template_id = target_cycle_template_id AND id = target_template_task_id;
  IF current_order IS NULL THEN
    RAISE EXCEPTION 'Step not in template' USING ERRCODE = '23514';
  END IF;

  SELECT id, sort_order INTO neighbour FROM experimental_cycle_template_tasks
    WHERE cycle_template_id = target_cycle_template_id
      AND CASE WHEN step < 0 THEN sort_order < current_order ELSE sort_order > current_order END
    ORDER BY CASE WHEN step < 0 THEN -sort_order ELSE sort_order END
    LIMIT 1;
  IF neighbour.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE experimental_cycle_template_tasks SET sort_order = neighbour.sort_order
    WHERE cycle_template_id = target_cycle_template_id AND id = target_template_task_id;
  UPDATE experimental_cycle_template_tasks SET sort_order = current_order
    WHERE cycle_template_id = target_cycle_template_id AND id = neighbour.id;
END;
$$;
REVOKE ALL ON FUNCTION public.move_cycle_template_task(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_cycle_template_task(uuid, uuid, integer) TO authenticated;

-- ───────────────────────── compute_cycle_template_schedule ─────────────────────────
-- Shared, read-only schedule computation backing BOTH the preview UI and
-- instantiate_experimental_cycle(), so preview and real generation can
-- never diverge. Evaluates steps in topological order (Kahn's algorithm)
-- over the template's dependency graph, never template sort_order.
CREATE FUNCTION public.compute_cycle_template_schedule(p_template_id uuid, p_start_date date)
RETURNS TABLE (
  template_task_id uuid,
  task_template_id uuid,
  title text,
  description text,
  zone text,
  priority text,
  sop_code text,
  expected_deliverable text,
  default_assigned_to uuid,
  sort_order integer,
  planned_date date,
  due_date date
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  target_program uuid;
  cur_id uuid;
  cur_offset integer;
  cur_duration integer;
  base_start date;
  dep_start date;
  final_start date;
BEGIN
  SELECT program_id INTO target_program FROM experimental_cycle_templates WHERE id = p_template_id;
  IF target_program IS NULL OR NOT can_access_program(target_program) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_template_schedule;
  CREATE TEMP TABLE tmp_template_schedule (
    template_task_id uuid PRIMARY KEY,
    task_template_id uuid NOT NULL,
    start_offset_days integer NOT NULL,
    duration_days integer NOT NULL,
    default_assigned_to uuid,
    sort_order integer NOT NULL,
    indegree integer NOT NULL DEFAULT 0,
    processed boolean NOT NULL DEFAULT false,
    planned_date date,
    due_date date
  );

  INSERT INTO tmp_template_schedule (template_task_id, task_template_id, start_offset_days, duration_days, default_assigned_to, sort_order)
  SELECT ectt.id, ectt.task_template_id, ectt.start_offset_days, ectt.duration_days, ectt.default_assigned_to, ectt.sort_order
  FROM experimental_cycle_template_tasks ectt WHERE ectt.cycle_template_id = p_template_id;

  UPDATE tmp_template_schedule t SET indegree = (
    SELECT count(*) FROM experimental_cycle_template_dependencies d WHERE d.successor_template_task_id = t.template_task_id
  );

  LOOP
    SELECT s.template_task_id, s.start_offset_days, s.duration_days
      INTO cur_id, cur_offset, cur_duration
      FROM tmp_template_schedule s WHERE NOT s.processed AND s.indegree = 0 LIMIT 1;
    EXIT WHEN cur_id IS NULL;

    base_start := p_start_date + cur_offset;
    SELECT MAX(p.due_date + 1 + d.lag_days) INTO dep_start
      FROM experimental_cycle_template_dependencies d
      JOIN tmp_template_schedule p ON p.template_task_id = d.predecessor_template_task_id
      WHERE d.successor_template_task_id = cur_id;
    final_start := GREATEST(base_start, COALESCE(dep_start, base_start));

    UPDATE tmp_template_schedule
      SET planned_date = final_start, due_date = final_start + cur_duration - 1, processed = true
      WHERE tmp_template_schedule.template_task_id = cur_id;

    UPDATE tmp_template_schedule t SET indegree = t.indegree - 1
      FROM experimental_cycle_template_dependencies d
      WHERE d.predecessor_template_task_id = cur_id AND d.successor_template_task_id = t.template_task_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM tmp_template_schedule WHERE NOT processed) THEN
    RAISE EXCEPTION 'Unable to schedule template: dependency cycle detected' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
    SELECT s.template_task_id, s.task_template_id, tt.name, tt.description, tt.zone, tt.priority,
           tt.sop_code, tt.expected_deliverable, s.default_assigned_to, s.sort_order, s.planned_date, s.due_date
    FROM tmp_template_schedule s JOIN task_templates tt ON tt.id = s.task_template_id
    ORDER BY s.planned_date, s.sort_order;

  DROP TABLE IF EXISTS pg_temp.tmp_template_schedule;
END;
$$;
REVOKE ALL ON FUNCTION public.compute_cycle_template_schedule(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_cycle_template_schedule(uuid, date) TO authenticated;

-- ───────────────────────── instantiate_experimental_cycle ─────────────────────────
-- Atomic generation: either everything succeeds (cycle + tasks + their
-- dependencies + checklists + derived end date) or nothing is created.
-- Task fields are copied from the template AT THIS MOMENT ONLY (snapshot);
-- later template edits never retroactively change this cycle's tasks.
-- If a step's default_assigned_to no longer resolves to a valid program
-- member, validate_task_context() (reused, never weakened) raises and the
-- whole instantiation is rolled back -- the deterministic, documented
-- choice for this milestone (see docs/database.md).
CREATE FUNCTION public.instantiate_experimental_cycle(p_template_id uuid, p_cycle_name text, p_start_date date)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  tpl RECORD;
  new_cycle_id uuid;
  row RECORD;
  new_task_id uuid;
  cycle_end date;
BEGIN
  SELECT * INTO tpl FROM experimental_cycle_templates WHERE id = p_template_id;
  IF tpl.id IS NULL THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = '23514';
  END IF;
  IF NOT can_write_program(tpl.program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF tpl.deleted_at IS NOT NULL OR NOT tpl.is_active THEN
    RAISE EXCEPTION 'This template is archived and cannot be instantiated' USING ERRCODE = '23514';
  END IF;
  IF p_cycle_name IS NULL OR char_length(trim(p_cycle_name)) = 0 THEN
    RAISE EXCEPTION 'Cycle name is required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO experimental_cycles (program_id, name, start_date, status, source_template_id)
  VALUES (tpl.program_id, p_cycle_name, p_start_date, 'active', p_template_id)
  RETURNING id INTO new_cycle_id;

  DROP TABLE IF EXISTS pg_temp.tmp_instantiate_map;
  CREATE TEMP TABLE tmp_instantiate_map (template_task_id uuid PRIMARY KEY, task_id uuid NOT NULL);

  FOR row IN SELECT * FROM compute_cycle_template_schedule(p_template_id, p_start_date) LOOP
    INSERT INTO tasks (
      experimental_cycle_id, program_id, task_template_id, title, description,
      planned_date, due_date, zone, assigned_to, priority, sop_code, expected_deliverable, status
    ) VALUES (
      new_cycle_id, tpl.program_id, row.task_template_id, row.title, row.description,
      row.planned_date, row.due_date, row.zone, row.default_assigned_to,
      COALESCE(row.priority, 'medium'), row.sop_code, row.expected_deliverable, 'not_started'
    ) RETURNING id INTO new_task_id;

    INSERT INTO tmp_instantiate_map (template_task_id, task_id) VALUES (row.template_task_id, new_task_id);

    INSERT INTO task_checklist_items (task_id, label, is_required, sort_order)
    SELECT new_task_id, label, is_required, sort_order
    FROM task_template_checklist_items WHERE task_template_id = row.task_template_id;
  END LOOP;

  INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type, lag_days)
  SELECT m1.task_id, m2.task_id, d.dependency_type, d.lag_days
  FROM experimental_cycle_template_dependencies d
  JOIN tmp_instantiate_map m1 ON m1.template_task_id = d.predecessor_template_task_id
  JOIN tmp_instantiate_map m2 ON m2.template_task_id = d.successor_template_task_id
  WHERE d.cycle_template_id = p_template_id;

  SELECT MAX(due_date) INTO cycle_end FROM tasks WHERE experimental_cycle_id = new_cycle_id;
  UPDATE experimental_cycles SET end_date = cycle_end WHERE id = new_cycle_id;

  DROP TABLE IF EXISTS pg_temp.tmp_instantiate_map;

  RETURN new_cycle_id;
END;
$$;
REVOKE ALL ON FUNCTION public.instantiate_experimental_cycle(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instantiate_experimental_cycle(uuid, text, date) TO authenticated;

-- ───────────────────────── recalculate_cycle_schedule ─────────────────────────
-- Dependency-aware rescheduling: applies a new planned/due date to one task,
-- then propagates to downstream dependents in topological order, preserving
-- each downstream task's own duration and recomputing only affected tasks.
-- Never reschedules a completed task; if propagation would require moving
-- one, the whole recalculation is blocked and nothing is changed.
CREATE FUNCTION public.recalculate_cycle_schedule(p_task_id uuid, p_new_planned_date date, p_new_due_date date)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  target_program uuid;
  target_cycle uuid;
  target_status text;
  target_planned date;
  dep_start date;
  cur_task_id uuid;
  cur_planned date;
  cur_duration integer;
  cur_status text;
  cycle_end date;
BEGIN
  SELECT program_id, experimental_cycle_id, status, planned_date
    INTO target_program, target_cycle, target_status, target_planned
    FROM tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF target_program IS NULL THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '23514';
  END IF;
  IF NOT can_write_program(target_program) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_new_due_date < p_new_planned_date THEN
    RAISE EXCEPTION 'Due date must be on or after the planned date' USING ERRCODE = '23514';
  END IF;
  IF target_status = 'completed' AND p_new_planned_date <> target_planned THEN
    RAISE EXCEPTION 'Cette tâche est terminée ; sa date ne peut plus être modifiée.' USING ERRCODE = '23514';
  END IF;

  SELECT MAX(p.due_date + 1 + d.lag_days) INTO dep_start
    FROM task_dependencies d JOIN tasks p ON p.id = d.predecessor_task_id
    WHERE d.successor_task_id = p_task_id;
  IF dep_start IS NOT NULL AND p_new_planned_date < dep_start THEN
    RAISE EXCEPTION 'La date planifiée doit respecter les dépendances (au plus tôt %).', dep_start USING ERRCODE = '23514';
  END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_resched;
  CREATE TEMP TABLE tmp_resched (
    task_id uuid PRIMARY KEY,
    planned_date date NOT NULL,
    due_date date NOT NULL,
    duration integer NOT NULL,
    status text NOT NULL,
    indegree integer NOT NULL DEFAULT 0,
    processed boolean NOT NULL DEFAULT false
  );

  INSERT INTO tmp_resched (task_id, planned_date, due_date, duration, status)
  SELECT id, planned_date, due_date, (due_date - planned_date + 1), status
  FROM tasks WHERE experimental_cycle_id = target_cycle AND deleted_at IS NULL;

  UPDATE tmp_resched
    SET planned_date = p_new_planned_date, due_date = p_new_due_date, duration = (p_new_due_date - p_new_planned_date + 1)
    WHERE task_id = p_task_id;

  UPDATE tmp_resched t SET indegree = (
    SELECT count(*) FROM task_dependencies d WHERE d.successor_task_id = t.task_id
  );

  LOOP
    SELECT task_id INTO cur_task_id FROM tmp_resched WHERE NOT processed AND indegree = 0 LIMIT 1;
    EXIT WHEN cur_task_id IS NULL;

    IF cur_task_id <> p_task_id THEN
      SELECT MAX(p.due_date + 1 + d.lag_days) INTO dep_start
        FROM task_dependencies d JOIN tmp_resched p ON p.task_id = d.predecessor_task_id
        WHERE d.successor_task_id = cur_task_id;

      IF dep_start IS NOT NULL THEN
        SELECT planned_date, duration, status INTO cur_planned, cur_duration, cur_status
          FROM tmp_resched WHERE task_id = cur_task_id;
        IF dep_start > cur_planned THEN
          IF cur_status = 'completed' THEN
            RAISE EXCEPTION 'Le recalcul déplacerait une tâche déjà terminée ; opération bloquée.' USING ERRCODE = '23514';
          END IF;
          UPDATE tmp_resched SET planned_date = dep_start, due_date = dep_start + cur_duration - 1
            WHERE task_id = cur_task_id;
        END IF;
      END IF;
    END IF;

    UPDATE tmp_resched SET processed = true WHERE task_id = cur_task_id;
    UPDATE tmp_resched t SET indegree = t.indegree - 1
      FROM task_dependencies d
      WHERE d.predecessor_task_id = cur_task_id AND d.successor_task_id = t.task_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM tmp_resched WHERE NOT processed) THEN
    RAISE EXCEPTION 'Unable to reschedule: dependency cycle detected' USING ERRCODE = '23514';
  END IF;

  UPDATE tasks t
    SET planned_date = r.planned_date, due_date = r.due_date
    FROM tmp_resched r
    WHERE r.task_id = t.id
      AND (t.planned_date IS DISTINCT FROM r.planned_date OR t.due_date IS DISTINCT FROM r.due_date);

  SELECT MAX(due_date) INTO cycle_end FROM tasks WHERE experimental_cycle_id = target_cycle AND deleted_at IS NULL;
  UPDATE experimental_cycles SET end_date = cycle_end WHERE id = target_cycle;

  DROP TABLE IF EXISTS pg_temp.tmp_resched;
END;
$$;
REVOKE ALL ON FUNCTION public.recalculate_cycle_schedule(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_cycle_schedule(uuid, date, date) TO authenticated;

-- ───────────────────────── set_task_status: required-checklist completion gate ─────────────────────────
-- Extends (CREATE OR REPLACE, not a parallel mechanism) the existing
-- function from 000011_operations_dashboard.sql with one additional rule:
-- a task cannot be marked completed while it still has incomplete REQUIRED
-- checklist items. Optional items never block completion.
CREATE OR REPLACE FUNCTION public.set_task_status(target_task_id uuid, new_status text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  task_program_id uuid;
  incomplete_required integer;
BEGIN
  IF new_status NOT IN ('not_started','in_progress','blocked','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;
  SELECT program_id INTO task_program_id FROM tasks WHERE id = target_task_id AND deleted_at IS NULL;
  IF task_program_id IS NULL OR NOT can_write_program(task_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF new_status = 'completed' THEN
    SELECT count(*) INTO incomplete_required FROM task_checklist_items
      WHERE task_id = target_task_id AND is_required AND NOT is_completed AND deleted_at IS NULL;
    IF incomplete_required > 0 THEN
      RAISE EXCEPTION 'Cette tâche comporte encore des contrôles obligatoires non terminés.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE tasks SET status = new_status, completed_at = CASE WHEN new_status = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END
  WHERE id = target_task_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_task_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_status(uuid,text) TO authenticated;

-- ───────────────────────── complete_checklist_item ─────────────────────────
-- Server-side identity for checklist completion: completed_by/completed_at
-- are always derived from the caller, never trusted from the client.
CREATE FUNCTION public.complete_checklist_item(target_item_id uuid, new_completed boolean, new_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  item_program_id uuid;
  caller_profile_id uuid;
BEGIN
  SELECT t.program_id INTO item_program_id
    FROM task_checklist_items i JOIN tasks t ON t.id = i.task_id
    WHERE i.id = target_item_id AND i.deleted_at IS NULL;
  IF item_program_id IS NULL OR NOT can_write_program(item_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO caller_profile_id FROM profiles WHERE user_id = auth.uid();

  UPDATE task_checklist_items
    SET is_completed = new_completed,
        completed_by = CASE WHEN new_completed THEN caller_profile_id ELSE NULL END,
        completed_at = CASE WHEN new_completed THEN now() ELSE NULL END,
        comment = COALESCE(new_comment, comment)
    WHERE id = target_item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_checklist_item(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_checklist_item(uuid, boolean, text) TO authenticated;
