-- The initial schema installed update_updated_at_column triggers on these
-- tables without defining the columns those triggers write.
ALTER TABLE public.selection_models
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

ALTER TABLE public.selection_criteria
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

ALTER TABLE public.phenotype_scores
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
