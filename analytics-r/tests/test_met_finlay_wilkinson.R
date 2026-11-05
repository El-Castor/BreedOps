# Reference tests for met_finlay_wilkinson_v1 (analytics-r/scripts/met_models.R).
# Run with: Rscript tests/test_met_finlay_wilkinson.R (from analytics-r/).
suppressMessages(suppressWarnings({
  library(jsonlite)
}))

failures <- character(0)
checks_run <- 0
check <- function(label, condition) {
  checks_run <<- checks_run + 1
  if (isTRUE(condition)) cat("ok - ", label, "\n") else {
    cat("NOT OK - ", label, "\n")
    failures <<- c(failures, label)
  }
}

run_script <- function(payload, model_type) {
  input <- toJSON(payload, auto_unbox = TRUE)
  out <- system2("Rscript", c("scripts/met_models.R", model_type),
    input = input, stdout = TRUE, stderr = FALSE,
    env = c("RENV_CONFIG_STARTUP_QUIET=TRUE", "LC_ALL=C.UTF-8", "LANG=C.UTF-8"))
  fromJSON(paste(out, collapse = "\n"), simplifyVector = FALSE)
}

# A balanced MET where each entry's sensitivity to the environment is
# explicitly, deterministically controlled: entry i's true response slope
# to the environmental effect is `sensitivity[i]`, so the fitted Finlay-
# Wilkinson slopes should come out ordered the same way, and the most
# sensitive entry (largest slope) should be unambiguous.
n_entries <- 6
n_envs <- 5
n_reps <- 3
sensitivity <- c(0.3, 0.7, 1.0, 1.0, 1.3, 1.8) # G6 is deliberately the most responsive
set.seed(11)
grid <- expand.grid(env = factor(paste0("E", 1:n_envs)), entry = factor(paste0("G", 1:n_entries)), rep = factor(1:n_reps))
env_eff <- rnorm(n_envs, 0, 6)[as.integer(grid$env)]
entry_eff <- rnorm(n_entries, 0, 2)[as.integer(grid$entry)]
grid$value <- 50 + entry_eff + sensitivity[as.integer(grid$entry)] * env_eff + rnorm(nrow(grid), 0, 0.5)
rows <- lapply(seq_len(nrow(grid)), function(i) list(
  entry_id = as.character(grid$entry[i]), environment_id = as.character(grid$env[i]),
  block = as.character(grid$rep[i]), value = grid$value[i]
))

fw <- run_script(list(model_type = "met_finlay_wilkinson_v1", rows = rows), "met_finlay_wilkinson_v1")
check("Finlay-Wilkinson: status ok", identical(fw$status, "ok"))
check("Finlay-Wilkinson: one entry per genotype", length(fw$entries) == n_entries)

by_entry <- setNames(fw$entries, sapply(fw$entries, function(e) e$entry_id))
check("Finlay-Wilkinson: every entry has a numeric slope", all(sapply(fw$entries, function(e) is.numeric(e$slope))))
check("Finlay-Wilkinson: every entry has a deviation_variance field", all(sapply(fw$entries, function(e) is.numeric(e$deviation_variance))))
check(
  "Finlay-Wilkinson: the most responsive entry by design (G6, sensitivity=1.8) has the largest fitted slope",
  by_entry[["G6"]]$slope == max(sapply(fw$entries, function(e) e$slope))
)
check(
  "Finlay-Wilkinson: the least responsive entry by design (G1, sensitivity=0.3) has the smallest fitted slope",
  by_entry[["G1"]]$slope == min(sapply(fw$entries, function(e) e$slope))
)
check(
  "Finlay-Wilkinson: fitted slopes preserve the full designed sensitivity ordering",
  all(diff(sapply(c("G1", "G2", "G3", "G5", "G6"), function(id) by_entry[[id]]$slope)) > 0)
)
check(
  "Finlay-Wilkinson: R2 is reported and plausible (close to 1 for this near-deterministic design)",
  all(sapply(fw$entries, function(e) e$r_squared > 0.8 && e$r_squared <= 1.0 + 1e-9))
)

# ---- Eligibility: Finlay-Wilkinson refuses rather than fabricates when
# there is no real structure (same insufficient-design fixture as AMMI/WAASB) ----
sparse_rows <- list(
  list(entry_id = "E1", environment_id = "Env1", value = 10),
  list(entry_id = "E2", environment_id = "Env1", value = 11)
)
fw_sparse <- run_script(list(model_type = "met_finlay_wilkinson_v1", rows = sparse_rows), "met_finlay_wilkinson_v1")
check("Finlay-Wilkinson on an insufficient design: NOT_ESTIMABLE, never a fabricated model", identical(fw_sparse$status, "not_estimable"))

# ---- Per-entry environment coverage (B-review blocker #6): the general
# eligibility gate only requires 2+ SHARED entries overall, which does not
# guarantee EVERY entry qualifies for its own regression. G1 observed in
# only 1 of the 5 environments must block the whole analysis, never
# silently produce a degenerate single-point "fit" for G1 alongside valid
# fits for the other 5 entries (verified empirically before this guard:
# metan::ge_reg returned a confident-looking, tiny-p-value slope for such
# an entry rather than failing). ----
rows_one_entry_insufficient <- Filter(function(r) !(r$entry_id == "G1" && r$environment_id != "E1"), rows)
fw_insufficient_entry <- run_script(list(model_type = "met_finlay_wilkinson_v1", rows = rows_one_entry_insufficient), "met_finlay_wilkinson_v1")
check(
  "Finlay-Wilkinson: one entry (G1) observed in only 1 of 5 environments blocks the whole analysis, never a degenerate per-entry fit",
  identical(fw_insufficient_entry$status, "not_estimable")
)
check(
  "Finlay-Wilkinson: the NOT_ESTIMABLE reason names the insufficient entry",
  grepl("G1", fw_insufficient_entry$message)
)

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("FAILED:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(save = "no", status = 1)
}
cat("All met_finlay_wilkinson_v1 reference tests passed.\n")
