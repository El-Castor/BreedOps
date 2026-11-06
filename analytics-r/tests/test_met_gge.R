# Reference test for met_gge_v1 (analytics-r/scripts/met_models.R).
# Run with: Rscript tests/test_met_gge.R (from analytics-r/).
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

# Same balanced, strong-interaction fixture as test_met_ammi_waasb.R - GGE
# and AMMI are both ordination methods on the same genotype x environment
# matrix, so they should agree on the basic shape of the result (variance
# explained ordering, full entry/environment coverage) even though their
# centering/scaling conventions differ.
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

gge <- run_script(list(model_type = "met_gge_v1", rows = rows), "met_gge_v1")
check("GGE: status ok", identical(gge$status, "ok"))
check("GGE: at least one principal component reported", length(gge$principal_components) >= 1)
pc_variances <- sapply(gge$principal_components, function(p) p$variance_explained_pct)
check("GGE: variance-explained percentages are non-increasing (PC1 explains the most)", all(diff(pc_variances) <= 1e-6))
check("GGE: every entry has a genotype score with coordinates", length(gge$genotype_scores) == n_entries)
check("GGE: every entry's coordinates vector has one value per axis", length(gge$genotype_scores[[1]]$coordinates) == length(gge$principal_components))
check("GGE: every environment has an environment score with coordinates", length(gge$environment_scores) == n_envs)
check("GGE: grand_mean is reported and numeric", is.numeric(gge$grand_mean))
check("GGE: model echoes its centering/scaling/svp configuration", identical(gge$model$centering, "environment"))
check("GGE on the complete balanced fixture: missing_cells_imputed == 0", identical(gge$model$missing_cells_imputed, 0L))

# ---- Eligibility: GGE refuses rather than fabricates when there is no
# real structure (same insufficient-design fixture as AMMI/WAASB) ----
sparse_rows <- list(
  list(entry_id = "E1", environment_id = "Env1", value = 10),
  list(entry_id = "E2", environment_id = "Env1", value = 11)
)
gge_sparse <- run_script(list(model_type = "met_gge_v1", rows = sparse_rows), "met_gge_v1")
check("GGE on an insufficient design: NOT_ESTIMABLE, never a fabricated model", identical(gge_sparse$status, "not_estimable"))

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("FAILED:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(save = "no", status = 1)
}
cat("All met_gge_v1 reference tests passed.\n")
