-- Phenotyping data cleanup + configuration consistency.
--
-- Root cause of the duplicate-looking trait/module library rows: every
-- integration/E2E test run creates a synthetic organization and, via
-- create_initial_selection_model, its own org-scoped "Sélection V1" module
-- and six library traits (migration 000016). Each test's teardown deletes
-- the synthetic auth user, then tries to hard-delete the organization so
-- everything else cascades away with it -- but three foreign keys added in
-- 000016 reference phenotype_traits(id) without ON DELETE CASCADE, unlike
-- every sibling column in that migration (phenotyping_module_traits.module_id,
-- phenotype_evaluations.selection_model_id, etc.). Postgres therefore
-- rejects the cascading delete of phenotype_traits with a foreign key
-- violation. The test's delete call never checked its result, so the
-- organization -- and its program, module, traits and evaluations -- was
-- silently left behind on every single run. A system_admin sees every
-- team (by design: can_access_team() in migration 000003), so these
-- leftover per-team copies of "Sélection V1" / "Architecture" / etc. show
-- up side by side and look like unexplained duplicates, even though there
-- is never more than one such row inside any single organization (the
-- UNIQUE(organization_id, code) / UNIQUE(organization_id, name) constraints
-- from 000016 already hold in every team examined).
--
-- This migration only fixes the referential-integrity gap so a whole-team
-- teardown (the only place phenotype_traits rows are ever actually deleted;
-- the application itself only archives traits via is_active) cascades
-- consistently, exactly like every other table in this schema already does.
-- It does not touch RLS, does not add roles, and does not delete any row
-- itself -- it only lets a future cascade succeed instead of failing midway
-- and leaving a dangling organization.

ALTER TABLE public.phenotyping_module_traits
  DROP CONSTRAINT phenotyping_module_traits_trait_id_fkey,
  ADD CONSTRAINT phenotyping_module_traits_trait_id_fkey
    FOREIGN KEY (trait_id) REFERENCES public.phenotype_traits(id) ON DELETE CASCADE;

ALTER TABLE public.phenotype_trait_values
  DROP CONSTRAINT phenotype_trait_values_trait_id_fkey,
  ADD CONSTRAINT phenotype_trait_values_trait_id_fkey
    FOREIGN KEY (trait_id) REFERENCES public.phenotype_traits(id) ON DELETE CASCADE;

ALTER TABLE public.selection_criteria
  DROP CONSTRAINT selection_criteria_trait_id_fkey,
  ADD CONSTRAINT selection_criteria_trait_id_fkey
    FOREIGN KEY (trait_id) REFERENCES public.phenotype_traits(id) ON DELETE CASCADE;
