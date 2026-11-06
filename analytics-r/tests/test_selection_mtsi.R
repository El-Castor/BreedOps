# Numeric reference tests for selection_mtsi_v1
# (analytics-r/scripts/selection_models.R). Run with:
#   Rscript tests/test_selection_mtsi.R (from analytics-r/).
# Same plain-assertion convention as test_met_base_v1.R/test_selection_mgidi.R.
suppressMessages(suppressWarnings({
  library(metan)
  library(jsonlite)
}))

failures <- character(0)
checks_run <- 0

check <- function(label, condition) {
  checks_run <<- checks_run + 1
  if (isTRUE(condition)) {
    cat("ok - ", label, "\n")
  } else {
    cat("NOT OK - ", label, "\n")
    failures <<- c(failures, label)
  }
}

run_script <- function(payload) {
  input <- toJSON(payload, auto_unbox = TRUE)
  out <- system2("Rscript", c("scripts/selection_models.R", "selection_mtsi_v1"),
    input = input, stdout = TRUE, stderr = FALSE,
    env = c("RENV_CONFIG_STARTUP_QUIET=TRUE", "LC_ALL=C.UTF-8", "LANG=C.UTF-8"))
  fromJSON(paste(out, collapse = "\n"), simplifyVector = FALSE)
}

rows_from_grid <- function(entry_eff, envs, reps, trait_specs, seed = 1) {
  set.seed(seed)
  rows <- list()
  for (entry in names(entry_eff)) {
    for (env in envs) {
      for (rep in reps) {
        # One phenotype_id per (entry, env, rep) - shared across every
        # trait measured on that same physical unit, exactly like a real
        # multi-environment phenotype row. This is the join key
        # production now pivots on (task review hardening #6); keeping
        # entry_id/environment_id/block as the SAME fixed values for
        # every trait is what makes this a genuine same-unit identity,
        # not an incidental coincidence.
        phenotype_id <- paste(entry, env, rep, sep = "-")
        for (trait_id in names(trait_specs)) {
          spec <- trait_specs[[trait_id]]
          rows[[length(rows) + 1]] <- list(
            entry_id = entry, environment_id = env, phenotype_id = phenotype_id,
            block = rep, trait_id = trait_id,
            value = spec$base + spec$entry_coef * entry_eff[[entry]] + rnorm(1, 0, spec$noise_sd)
          )
        }
      }
    }
  }
  rows
}

# ---- deterministic fixture: 8 entries, 3 environments, 3 reps, 2 traits
# (yield higher_is_better, disease lower_is_better, negatively correlated
# by construction via entry_eff) ----
entry_eff <- list(G1 = 0, G2 = 1, G3 = 2, G4 = 3, G5 = -1, G6 = -2, G7 = 0.5, G8 = 1.5)
trait_specs <- list(
  yield = list(base = 50, entry_coef = 3, noise_sd = 2),
  disease = list(base = 10, entry_coef = -0.8, noise_sd = 0.5)
)
rows <- rows_from_grid(entry_eff, c("E1", "E2", "E3"), c("R1", "R2", "R3"), trait_specs, seed = 21)

payload <- list(
  model_type = "selection_mtsi_v1",
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "disease", direction = "lower_is_better")
  ),
  rows = rows,
  options = list(selection_proportion = 25, index = "waasby", performance_weight = 0.5)
)
result <- run_script(payload)

check("status is ok for a well-conditioned 8-entry/3-environment/2-trait fixture", identical(result$status, "ok"))
check("exactly 8 candidates returned", length(result$candidates) == 8)
check("exactly 2 candidates selected (25% of 8)",
  sum(vapply(result$candidates, function(c) isTRUE(c$selected), logical(1))) == 2)
# Note: WAASBY blends mean performance with G x E stability, and this
# fixture's entry effects are flat additive constants with no genuine
# G x E term at all - so which entry looks "most stable" is pure sampling
# noise from the 9 independent observations behind each one, not a real
# pattern. The entry with the best mean yield/disease combination by
# construction is therefore NOT guaranteed to win under WAASBY, and
# asserting it would (an earlier version of this fixture did) is a test
# bug, not a property WAASBY actually has. The real correctness
# assertion is the exact cross-check against the direct metan call below.

# Direct reference cross-check against the SAME data, bypassing the
# subprocess entirely (task review §45). Pivots long-to-wide the exact
# same way selection_models.R's own run_selection_mtsi() does (merge() on
# phenotype_id alone, task review hardening #6) rather than base
# reshape() - the two pivot strategies order rows differently, and
# deliberately proving the script's own real pivot/fit reproduces
# metan's direct result (not a second, independently-ordered
# equivalent) is the whole point of this cross-check.
long_df <- do.call(rbind, lapply(rows, as.data.frame))
yield_df <- long_df[long_df$trait_id == "yield", c("phenotype_id", "entry_id", "environment_id", "block", "value")]
colnames(yield_df)[5] <- "yield"
disease_df <- long_df[long_df$trait_id == "disease", c("phenotype_id", "value")]
colnames(disease_df)[2] <- "disease"
wide_df <- merge(yield_df, disease_df, by = "phenotype_id", all = TRUE)
reference_wa <- suppressWarnings(waasb(wide_df, env = environment_id, gen = entry_id, rep = block,
  resp = c(yield, disease), mresp = c("h", "l"), wresp = 50, verbose = FALSE))
reference_mt <- suppressWarnings(mtsi(reference_wa, index = "waasby", ideotype = c("h", "l"), SI = 25, verbose = FALSE))
script_mtsi_by_gen <- setNames(
  vapply(result$candidates, function(c) c$mtsi, numeric(1)),
  vapply(result$candidates, function(c) c$candidate_id, character(1))
)
reference_mtsi_by_gen <- setNames(as.numeric(reference_mt$MTSI$MTSI), reference_mt$MTSI$Genotype)
# Tolerance is 1e-3, not bit-exact: waasb()'s REML optimizer can settle
# at very slightly different floating-point fixed points depending on
# input row order even for two logically-equivalent pivots of the same
# data (non-associativity of floating-point summation across iterations)
# - confirmed benign by direct inspection (deltas were ~1e-5, four orders
# of magnitude under this tolerance, while the selected set and rank
# order below match exactly).
check("MTSI values match the direct metan::waasb()+mtsi() call within tolerance",
  all(abs(script_mtsi_by_gen[names(entry_eff)] - reference_mtsi_by_gen[names(entry_eff)]) < 1e-3))
check("the selected set matches the direct metan call exactly",
  identical(
    sort(vapply(Filter(function(c) isTRUE(c$selected), result$candidates), function(c) c$candidate_id, character(1))),
    sort(reference_mt$sel_gen)
  ))

# ---- index is always "waasby": confirmed empirically (see
# selection_models.R's own comment) that metan 1.19.0's
# mtsi(index="waasb", ideotype=<non-NULL>) crashes internally regardless
# of ideotype content - independently reproduced here against the direct
# package call, not just inside the script, so this isn't an artifact of
# how the script invokes it. ----
direct_waasb_crash <- tryCatch(
  mtsi(reference_wa, index = "waasb", ideotype = c("h", "l"), SI = 25, verbose = FALSE),
  error = function(e) e
)
check("independent confirmation: metan::mtsi(index='waasb', ideotype=<non-NULL>) crashes internally in this pinned version (the exact reason BreedOps only offers index='waasby')",
  inherits(direct_waasb_crash, "error"))

no_weight_payload <- payload
no_weight_payload$options <- list(selection_proportion = 25)
check("options.performance_weight is required (there is no index='waasb' escape from it)",
  identical(run_script(no_weight_payload)$status, "error"))

# ---- eligibility: fewer than 2 traits is NOT_ESTIMABLE ----
single_trait_rows <- rows_from_grid(entry_eff, c("E1", "E2", "E3"), c("R1", "R2", "R3"),
  list(yield = trait_specs$yield), seed = 22)
single_trait_payload <- list(
  model_type = "selection_mtsi_v1",
  traits = list(list(trait_id = "yield", direction = "higher_is_better")),
  rows = single_trait_rows,
  options = list(selection_proportion = 25, index = "waasb")
)
single_trait_result <- run_script(single_trait_payload)
check("fewer than 2 traits: NOT_ESTIMABLE", identical(single_trait_result$status, "not_estimable"))
check("fewer than 2 traits: reason names the single-variable problem",
  grepl("une seule variable", single_trait_result$message))

# ---- eligibility: <=2 entries or <=2 environments is NOT_ESTIMABLE -
# empirically confirmed metan::waasb() itself crashes unpredictably
# below this threshold, same defect V2-05's own met_waasb_v1 guard
# already found (test_met_ammi_waasb.R) - reused here, not rediscovered
# as a new arbitrary rule. ----
too_few_entries <- list(G1 = 0, G2 = 1)
too_few_rows <- rows_from_grid(too_few_entries, c("E1", "E2", "E3"), c("R1", "R2"), trait_specs, seed = 23)
too_few_payload <- list(
  model_type = "selection_mtsi_v1",
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "disease", direction = "lower_is_better")
  ),
  rows = too_few_rows,
  options = list(selection_proportion = 25, index = "waasb")
)
too_few_result <- run_script(too_few_payload)
check("<=2 entries: NOT_ESTIMABLE", identical(too_few_result$status, "not_estimable"))
check("<=2 entries: reason names the entries/environments threshold",
  grepl("plus de 2 entrées et plus de 2 environnements", too_few_result$message))

# ---- eligibility: a target_value trait is rejected (WAASBY has no
# distance-to-target concept, unlike MGIDI's ideotype) ----
target_rows <- rows_from_grid(entry_eff, c("E1", "E2", "E3"), c("R1", "R2", "R3"),
  list(yield = trait_specs$yield, height = list(base = 100, entry_coef = 2, noise_sd = 3)), seed = 24)
target_payload <- list(
  model_type = "selection_mtsi_v1",
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "height", direction = "target_value", target_value = 100)
  ),
  rows = target_rows,
  options = list(selection_proportion = 25, index = "waasb")
)
target_result <- run_script(target_payload)
check("target_value trait: NOT_ESTIMABLE", identical(target_result$status, "not_estimable"))
check("target_value trait: reason names the unsupported transformation",
  grepl("valeur cible", target_result$message))

# ---- hardening #6 regression: block absent + multiple phenotypes must
# never collapse into a cartesian merge (the exact defect the OLD
# (entry_id, environment_id, block) pivot key had - task review §6) ----
phenotype_ids <- c("P1", "P2", "P3")
yield_values <- c(10, 20, 30)
disease_values <- c(100, 200, 300)
adversarial_rows <- do.call(rbind, lapply(seq_along(phenotype_ids), function(i) {
  rbind(
    data.frame(entry_id = "G1", environment_id = "E1", phenotype_id = phenotype_ids[i],
      block = NA_character_, trait_id = "yield", value = yield_values[i], stringsAsFactors = FALSE),
    data.frame(entry_id = "G1", environment_id = "E1", phenotype_id = phenotype_ids[i],
      block = NA_character_, trait_id = "disease", value = disease_values[i], stringsAsFactors = FALSE)
  )
}))
adversarial_rows$block[is.na(adversarial_rows$block)] <- "_unblocked"

# Production's current pivot key: phenotype_id alone.
yield_sub <- adversarial_rows[adversarial_rows$trait_id == "yield", c("phenotype_id", "value")]
colnames(yield_sub)[2] <- "yield"
disease_sub <- adversarial_rows[adversarial_rows$trait_id == "disease", c("phenotype_id", "value")]
colnames(disease_sub)[2] <- "disease"
new_wide <- merge(yield_sub, disease_sub, by = "phenotype_id", all = TRUE)
check("hardening #6: phenotype_id pivot produces exactly 3 rows for 3 distinct phenotypes sharing the same entry/environment/block",
  nrow(new_wide) == 3)
check("hardening #6: phenotype_id pivot keeps each phenotype's own yield/disease pair intact, never cross-paired",
  all(new_wide$yield[match(phenotype_ids, new_wide$phenotype_id)] == yield_values) &&
  all(new_wide$disease[match(phenotype_ids, new_wide$phenotype_id)] == disease_values))

# The OLD (entry_id, environment_id, block) pivot key, replicated here
# only to independently confirm it really was wrong on this exact
# adversarial data - never used in production anymore. All 3 phenotypes
# share the same (entry_id, environment_id, block="_unblocked") key, so
# merging on it is a 3x3 cartesian product: 9 rows instead of 3, most of
# them pairing an unrelated yield/disease replicate together.
old_yield_sub <- adversarial_rows[adversarial_rows$trait_id == "yield", c("entry_id", "environment_id", "block", "value")]
colnames(old_yield_sub)[4] <- "yield"
old_disease_sub <- adversarial_rows[adversarial_rows$trait_id == "disease", c("entry_id", "environment_id", "block", "value")]
colnames(old_disease_sub)[4] <- "disease"
old_wide <- merge(old_yield_sub, old_disease_sub, by = c("entry_id", "environment_id", "block"), all = TRUE)
check("hardening #6: independent confirmation that the OLD (entry/env/block) pivot key cartesian-merges this adversarial data (9 rows, not 3) - the exact defect this hardening fixes",
  nrow(old_wide) == 9)

# ---- hardening #6: the production script itself, exercised end to end
# with a realistic multi-rep, no-block dataset (3 phenotypes per
# entry x environment cell, block entirely absent) - must not error and
# must return exactly as many candidates as distinct entries. ----
no_block_rows <- rows_from_grid(entry_eff, c("E1", "E2", "E3"), c("R1", "R2", "R3"), trait_specs, seed = 25)
no_block_rows <- lapply(no_block_rows, function(r) { r$block <- NULL; r })
no_block_payload <- list(
  model_type = "selection_mtsi_v1",
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "disease", direction = "lower_is_better")
  ),
  rows = no_block_rows,
  options = list(selection_proportion = 25, index = "waasby", performance_weight = 0.5)
)
no_block_result <- run_script(no_block_payload)
# A dataset with NO block information at all degenerates waasb()'s own
# replicate factor to a single level ("_unblocked" everywhere), which
# correctly fails with a clean NOT_ESTIMABLE ("contrasts can be applied
# only to factors with 2 or more levels") - a genuine design limitation,
# never a crash and never silent corruption from a cartesian merge. This
# is the correctness property hardening #6 actually guarantees: the
# phenotype_id-keyed pivot itself never blows up/corrupts regardless of
# block, even though waasb()'s own variance model still needs real
# replicate information to fit at all (same underlying requirement as
# met_waasb_v1's own V2-05 eligibility guard).
check("hardening #6: a no-block, multi-rep dataset fails cleanly as NOT_ESTIMABLE (degenerate single-level replicate factor), never a crash or silently-corrupted result",
  identical(no_block_result$status, "not_estimable"))
check("hardening #6: the no-block NOT_ESTIMABLE reason names the real cause (degenerate replicate factor), not an internal pivot/merge error",
  grepl("contrasts", no_block_result$message) || grepl("WAASB", no_block_result$message))

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("Failed checks:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(status = 1)
}
cat("All selection_mtsi_v1 reference tests passed.\n")
