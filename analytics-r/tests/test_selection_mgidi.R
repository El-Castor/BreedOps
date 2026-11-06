# Numeric reference tests for selection_mgidi_v1
# (analytics-r/scripts/selection_models.R). Run with:
#   Rscript tests/test_selection_mgidi.R (from analytics-r/).
# Same plain-assertion convention as test_met_base_v1.R (testthat's own
# runner interferes with system2()'s stdin redirection) - exits non-zero on
# any failed assertion so it can gate CI the same way the TypeScript
# numeric-reference suites do.
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

# Both env vars are load-bearing - see test_met_base_v1.R's own comment for
# the full rationale (RENV_CONFIG_STARTUP_QUIET for the stdout JSON
# contract, LC_ALL/LANG for correct parsing of this script's own French
# string literals at R startup).
run_script <- function(payload) {
  input <- toJSON(payload, auto_unbox = TRUE)
  out <- system2("Rscript", c("scripts/selection_models.R", "selection_mgidi_v1"),
    input = input, stdout = TRUE, stderr = FALSE,
    env = c("RENV_CONFIG_STARTUP_QUIET=TRUE", "LC_ALL=C.UTF-8", "LANG=C.UTF-8"))
  fromJSON(paste(out, collapse = "\n"), simplifyVector = FALSE)
}

matrix_rows <- function(values_by_candidate_trait) {
  rows <- list()
  for (candidate_id in names(values_by_candidate_trait)) {
    for (trait_id in names(values_by_candidate_trait[[candidate_id]])) {
      rows[[length(rows) + 1]] <- list(
        candidate_id = candidate_id, trait_id = trait_id,
        value = values_by_candidate_trait[[candidate_id]][[trait_id]]
      )
    }
  }
  rows
}

# ---- deterministic fixture: yield (higher_is_better) negatively
# correlated with disease (lower_is_better) across 12 candidates ----
set.seed(11)
candidate_ids <- paste0("G", 1:12)
yield <- round(seq(40, 73, length.out = 12) + rnorm(12, 0, 1.5), 2)
disease <- round(10 - (yield - 40) / 3 + rnorm(12, 0, 0.5), 2)
values <- setNames(
  lapply(seq_along(candidate_ids), function(i) list(yield = yield[i], disease = disease[i])),
  candidate_ids
)

payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = lapply(candidate_ids, function(id) list(candidate_id = id)),
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "disease", direction = "lower_is_better")
  ),
  matrix = matrix_rows(values),
  options = list(selection_proportion = 25)
)
result <- run_script(payload)

check("status is ok for a well-conditioned 12-candidate/2-trait fixture", identical(result$status, "ok"))
check("exactly 12 candidates returned", length(result$candidates) == 12)
check("exactly 3 candidates selected (25% of 12, rounded by metan's own SI logic)",
  sum(vapply(result$candidates, function(c) isTRUE(c$selected), logical(1))) == 3)

# Direct reference call against the SAME data, bypassing the subprocess
# entirely - the actual cross-validation task review §44 calls for.
reference_df <- data.frame(GEN = candidate_ids, yield = yield, disease = disease)
reference_mg <- suppressWarnings(mgidi(reference_df, SI = 25, ideotype = c("h", "l"), verbose = FALSE))
reference_mgidi_by_gen <- setNames(as.numeric(reference_mg$MGIDI$MGIDI), reference_mg$MGIDI$Genotype)
script_mgidi_by_gen <- setNames(
  vapply(result$candidates, function(c) c$mgidi, numeric(1)),
  vapply(result$candidates, function(c) c$candidate_id, character(1))
)
check("MGIDI values match the direct metan::mgidi() call within tolerance",
  all(abs(script_mgidi_by_gen[candidate_ids] - reference_mgidi_by_gen[candidate_ids]) < 1e-6))
check("the selected set matches the direct metan::mgidi() call exactly",
  identical(
    sort(vapply(Filter(function(c) isTRUE(c$selected), result$candidates), function(c) c$candidate_id, character(1))),
    sort(reference_mg$sel_gen)
  ))
check("the best-ranked candidate is the one closest to the ideotype (lowest MGIDI)",
  result$candidates[[which.min(script_mgidi_by_gen)]]$rank == 1)

# ---- direction handling: a single dominant candidate on both traits is
# always ranked first, whichever direction each trait wants ----
dominant_values <- list(
  G1 = list(a = 100, b = 0), G2 = list(a = 50, b = 50), G3 = list(a = 10, b = 90),
  G4 = list(a = 60, b = 40), G5 = list(a = 70, b = 60)
)
dominant_payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = lapply(names(dominant_values), function(id) list(candidate_id = id)),
  traits = list(
    list(trait_id = "a", direction = "higher_is_better"),
    list(trait_id = "b", direction = "lower_is_better")
  ),
  matrix = matrix_rows(dominant_values),
  options = list(selection_proportion = 20)
)
dominant_result <- run_script(dominant_payload)
dominant_rank_by_gen <- setNames(
  vapply(dominant_result$candidates, function(c) c$rank, numeric(1)),
  vapply(dominant_result$candidates, function(c) c$candidate_id, character(1))
)
check("G1 (best on both higher_is_better 'a' and lower_is_better 'b') ranks first",
  dominant_rank_by_gen[["G1"]] == 1)

# ---- target_value: metan's own documented distance-to-target ideotype
# syntax (a numeric string in place of "h"/"l") - task review §13: this is
# metan's own validated behaviour, exercised here, never a hand-rolled
# transformation. ----
target_values <- list(
  G1 = list(yield = 40, height = 100), G2 = list(yield = 50, height = 80),
  G3 = list(yield = 60, height = 120), G4 = list(yield = 55, height = 60),
  G5 = list(yield = 45, height = 140)
)
target_payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = lapply(names(target_values), function(id) list(candidate_id = id)),
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "height", direction = "target_value", target_value = 100)
  ),
  matrix = matrix_rows(target_values),
  options = list(selection_proportion = 20)
)
target_result <- run_script(target_payload)
check("target_value fixture returns ok", identical(target_result$status, "ok"))
target_reference_df <- data.frame(
  GEN = names(target_values),
  yield = vapply(target_values, function(v) v$yield, numeric(1)),
  height = vapply(target_values, function(v) v$height, numeric(1))
)
target_reference_mg <- suppressWarnings(mgidi(target_reference_df, SI = 20, ideotype = c("h", "100"), verbose = FALSE))
target_script_mgidi_by_gen <- setNames(
  vapply(target_result$candidates, function(c) c$mgidi, numeric(1)),
  vapply(target_result$candidates, function(c) c$candidate_id, character(1))
)
target_reference_mgidi_by_gen <- setNames(
  as.numeric(target_reference_mg$MGIDI$MGIDI), target_reference_mg$MGIDI$Genotype
)
check("target_value MGIDI values match the direct metan::mgidi() distance-to-target call",
  all(abs(target_script_mgidi_by_gen[names(target_values)] - target_reference_mgidi_by_gen[names(target_values)]) < 1e-6))

# ---- weights change the ranking relative to the unweighted baseline ----
weight_values <- list(
  G1 = list(a = 100, b = 10), G2 = list(a = 10, b = 100), G3 = list(a = 55, b = 55),
  G4 = list(a = 80, b = 30), G5 = list(a = 30, b = 80)
)
unweighted_payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = lapply(names(weight_values), function(id) list(candidate_id = id)),
  traits = list(
    list(trait_id = "a", direction = "higher_is_better"),
    list(trait_id = "b", direction = "higher_is_better")
  ),
  matrix = matrix_rows(weight_values),
  options = list(selection_proportion = 20)
)
weighted_payload <- unweighted_payload
weighted_payload$traits <- list(
  list(trait_id = "a", direction = "higher_is_better", weight = 1),
  list(trait_id = "b", direction = "higher_is_better", weight = 0.1)
)
unweighted_result <- run_script(unweighted_payload)
weighted_result <- run_script(weighted_payload)
unweighted_mgidi <- setNames(
  vapply(unweighted_result$candidates, function(c) c$mgidi, numeric(1)),
  vapply(unweighted_result$candidates, function(c) c$candidate_id, character(1))
)
weighted_mgidi <- setNames(
  vapply(weighted_result$candidates, function(c) c$mgidi, numeric(1)),
  vapply(weighted_result$candidates, function(c) c$candidate_id, character(1))
)
check("assigning an explicit weight vector changes the MGIDI values relative to the unweighted baseline",
  any(abs(unweighted_mgidi[names(weight_values)] - weighted_mgidi[names(weight_values)]) > 1e-9))

# ---- eligibility: fewer than 2 traits is NOT_ESTIMABLE (metan's own
# requirement - "cannot be computed with one single variable") ----
one_trait_payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = list(list(candidate_id = "G1"), list(candidate_id = "G2"), list(candidate_id = "G3")),
  traits = list(list(trait_id = "yield", direction = "higher_is_better")),
  matrix = list(
    list(candidate_id = "G1", trait_id = "yield", value = 1),
    list(candidate_id = "G2", trait_id = "yield", value = 2),
    list(candidate_id = "G3", trait_id = "yield", value = 3)
  ),
  options = list(selection_proportion = 20)
)
one_trait_result <- run_script(one_trait_payload)
check("fewer than 2 traits: NOT_ESTIMABLE", identical(one_trait_result$status, "not_estimable"))
check("fewer than 2 traits: reason names the single-variable problem",
  grepl("un indice multi-traits ne peut pas", one_trait_result$message))

# ---- eligibility: candidates <= traits is NOT_ESTIMABLE (empirically
# confirmed: metan::mgidi() itself returns a perfectly-saturated +-1
# correlation matrix in this regime without any warning - not an
# arbitrary BreedOps threshold, see selection_models.R's own comment) ----
too_few_payload <- list(
  model_type = "selection_mgidi_v1",
  candidates = list(list(candidate_id = "G1"), list(candidate_id = "G2")),
  traits = list(
    list(trait_id = "yield", direction = "higher_is_better"),
    list(trait_id = "height", direction = "higher_is_better")
  ),
  matrix = list(
    list(candidate_id = "G1", trait_id = "yield", value = 1),
    list(candidate_id = "G1", trait_id = "height", value = 1),
    list(candidate_id = "G2", trait_id = "yield", value = 2),
    list(candidate_id = "G2", trait_id = "height", value = 2)
  ),
  options = list(selection_proportion = 20)
)
too_few_result <- run_script(too_few_payload)
check("candidates <= traits: NOT_ESTIMABLE", identical(too_few_result$status, "not_estimable"))
check("candidates <= traits: reason names the saturated-correlation problem",
  grepl("parfaitement saturée", too_few_result$message))

# Direct, independent confirmation of the claim the eligibility guard is
# based on: metan::mgidi() itself does NOT refuse this input, and its own
# correlation matrix is indeed every pairwise +-1.
degenerate_df <- data.frame(GEN = c("G1", "G2"), yield = c(1, 2), height = c(1, 2))
degenerate_mg <- suppressWarnings(mgidi(degenerate_df, SI = 20, ideotype = c("h", "h"), verbose = FALSE))
check("independent confirmation: metan::mgidi() silently 'succeeds' with a saturated +-1 correlation matrix at candidates<=traits (the exact defect BreedOps's own guard exists to pre-empt)",
  all(abs(as.matrix(degenerate_mg$cormat)[upper.tri(as.matrix(degenerate_mg$cormat))]) == 1))

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("Failed checks:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(status = 1)
}
cat("All selection_mgidi_v1 reference tests passed.\n")
