# Reference tests for met_ammi_v1 and met_waasb_v1 (analytics-r/scripts/met_models.R).
# Run with: Rscript tests/test_met_ammi_waasb.R (from analytics-r/).
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

# A balanced MET with a genuine, strong, multi-dimensional Entry x
# Environment pattern (sin() interaction) - AMMI/WAASB need real
# interaction structure to be a meaningful reference case, unlike the
# purely-additive fixture used for met_base_v1.
n_entries <- 10
n_envs <- 5
n_reps <- 3
set.seed(42)
grid <- expand.grid(env = factor(paste0("E", 1:n_envs)), entry = factor(paste0("G", 1:n_entries)), rep = factor(1:n_reps))
env_eff <- rnorm(n_envs, 0, 5)[as.integer(grid$env)]
entry_eff <- rnorm(n_entries, 0, 3)[as.integer(grid$entry)]
interaction <- outer(1:n_entries, 1:n_envs, function(g, e) sin(g + e))[cbind(as.integer(grid$entry), as.integer(grid$env))] * 2
grid$value <- 50 + env_eff + entry_eff + interaction + rnorm(nrow(grid), 0, 1)
rows <- lapply(seq_len(nrow(grid)), function(i) list(
  entry_id = as.character(grid$entry[i]), environment_id = as.character(grid$env[i]),
  block = as.character(grid$rep[i]), value = grid$value[i]
))

# ---- AMMI ----
ammi <- run_script(list(model_type = "met_ammi_v1", rows = rows), "met_ammi_v1")
check("AMMI: status ok", identical(ammi$status, "ok"))
check("AMMI: at least one principal component reported", length(ammi$principal_components) >= 1)
pc_variances <- sapply(ammi$principal_components, function(p) p$variance_explained_pct)
check("AMMI: variance-explained percentages are non-increasing (PC1 explains the most)", all(diff(pc_variances) <= 1e-6))
check("AMMI: cumulative variance never exceeds 100%", max(sapply(ammi$principal_components, function(p) p$cumulative_pct)) <= 100 + 1e-6)
check("AMMI: every entry has a genotype score", length(ammi$genotype_scores) == n_entries)
check("AMMI: every environment has an environment score", length(ammi$environment_scores) == n_envs)

# ---- WAASB ----
waasb_equal <- run_script(list(model_type = "met_waasb_v1", rows = rows, options = list(performance_weight = 0.5)), "met_waasb_v1")
check("WAASB (50/50): status ok", identical(waasb_equal$status, "ok"))
check("WAASB (50/50): performance_weight echoed back", isTRUE(all.equal(waasb_equal$model$performance_weight, 0.5)))
check("WAASB (50/50): every entry has a WAASBY value", length(waasb_equal$entries) == n_entries)
check(
  "WAASB (50/50): WAASB is non-negative (it is defined as a weighted absolute score)",
  all(sapply(waasb_equal$entries, function(e) e$waasb >= 0))
)

waasb_perf_heavy <- run_script(list(model_type = "met_waasb_v1", rows = rows, options = list(performance_weight = 0.9)), "met_waasb_v1")
check("WAASB (90/10): status ok", identical(waasb_perf_heavy$status, "ok"))
# With performance weighted far more heavily, the entry with the single
# highest raw mean performance should rank at or very near the top of
# WAASBY - unlike with equal weighting, where a highly unstable top
# performer can be overtaken by a more stable, slightly-lower performer.
best_mean_entry <- waasb_perf_heavy$entries[[which.max(sapply(waasb_perf_heavy$entries, function(e) e$mean_performance))]]$entry_id
best_waasby_entry <- waasb_perf_heavy$entries[[which.max(sapply(waasb_perf_heavy$entries, function(e) e$waasby))]]$entry_id
check(
  "WAASB (90/10, performance-heavy): the highest-WAASBY entry is among the top 2 by raw mean performance",
  best_waasby_entry %in% c(
    best_mean_entry,
    waasb_perf_heavy$entries[[order(-sapply(waasb_perf_heavy$entries, function(e) e$mean_performance))[2]]]$entry_id
  )
)

# ---- Eligibility: AMMI refuses rather than fabricates when there is no real structure ----
sparse_rows <- list(
  list(entry_id = "E1", environment_id = "Env1", value = 10),
  list(entry_id = "E2", environment_id = "Env1", value = 11)
)
ammi_sparse <- run_script(list(model_type = "met_ammi_v1", rows = sparse_rows), "met_ammi_v1")
check("AMMI on an insufficient design: NOT_ESTIMABLE, never a fabricated model", identical(ammi_sparse$status, "not_estimable"))

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("FAILED:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(save = "no", status = 1)
}
cat("All met_ammi_v1 / met_waasb_v1 reference tests passed.\n")
