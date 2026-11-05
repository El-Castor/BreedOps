# Numeric reference tests for met_base_v1 (analytics-r/scripts/met_models.R).
# Run with: Rscript tests/test_met_base_v1.R (from analytics-r/).
# Plain assertions rather than testthat::test_file(): testthat's own test
# runner wrapper was found to interfere with system2()'s stdin-redirection
# mechanism (the subprocess call that works perfectly standalone failed
# only when invoked through test_file()'s execution context) - since this
# file's entire job is exercising the real subprocess contract end to end,
# sidestepping that interference matters more than testthat's reporting.
# Exits non-zero on any failed assertion so it can gate CI the same way the
# TypeScript numeric-reference suites do.
suppressMessages(suppressWarnings({
  library(sommer)
  library(lme4)
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

# Both env vars are load-bearing, not cosmetic (see docs/DEPLOYMENT_GUIDE.md,
# "R subprocess environment"):
# - RENV_CONFIG_STARTUP_QUIET: without it renv prints an "out-of-sync"/
#   activation banner to stdout on every invocation, breaking the "exactly
#   one JSON object on stdout" contract.
# - LC_ALL/LANG=C.UTF-8: R parses an entire script's string literals using
#   the locale active at process start, before any in-script
#   Sys.setlocale() call can take effect; under the "C" locale this
#   sandbox's R defaults to, every accented character in the French
#   reason strings is silently mis-decoded (each byte hex-escaped
#   individually) rather than failing loudly. Setting it here, once, for
#   the whole subprocess is the only point that reliably fixes this -
#   not something fixable from inside the script.
run_script <- function(payload) {
  input <- toJSON(payload, auto_unbox = TRUE)
  out <- system2("Rscript", c("scripts/met_models.R", "met_base_v1"),
    input = input, stdout = TRUE, stderr = FALSE,
    env = c("RENV_CONFIG_STARTUP_QUIET=TRUE", "LC_ALL=C.UTF-8", "LANG=C.UTF-8"))
  fromJSON(paste(out, collapse = "\n"), simplifyVector = FALSE)
}

rows_from_grid <- function(entry_eff, env_eff, blocks = c("B1", "B2"), noise_sd = 1, seed = 1) {
  set.seed(seed)
  rows <- list()
  for (entry in names(entry_eff)) {
    for (env in names(env_eff)) {
      for (block in blocks) {
        rows[[length(rows) + 1]] <- list(
          entry_id = entry, environment_id = env, block = block,
          value = 20 + env_eff[[env]] + entry_eff[[entry]] + rnorm(1, 0, noise_sd)
        )
      }
    }
  }
  rows
}

# ---- balanced additive MET: BLUP ranking and sign recover the generating entry effects ----
entry_eff <- list(E1 = 0, E2 = 2, E3 = -1, E4 = 3, E5 = -2, E6 = 1)
env_eff <- list(Env1 = 0, Env2 = 5, Env3 = -3)
rows <- rows_from_grid(entry_eff, env_eff, noise_sd = 1, seed = 1)
result <- run_script(list(model_type = "met_base_v1", rows = rows))

check("balanced: status ok", identical(result$status, "ok"))
check("balanced: converged", isTRUE(result$model$convergence))
check("balanced: n_entries == 6", identical(result$model$n_entries, 6L))
check("balanced: n_environments == 3", identical(result$model$n_environments, 3L))

blups <- setNames(
  sapply(result$entry_predictions, function(p) p$blup),
  sapply(result$entry_predictions, function(p) p$entry_id)
)
check(
  "balanced: BLUP rank order matches generating effects (E4>E2>E6>E1>E3>E5)",
  identical(names(sort(blups, decreasing = TRUE)), c("E4", "E2", "E6", "E1", "E3", "E5"))
)
blup_values <- sapply(result$entry_predictions, function(p) p$blup)
true_values <- unlist(entry_eff[sapply(result$entry_predictions, function(p) p$entry_id)])
# BLUP shrinkage (spread <= the true effects' spread) is a property of the
# estimator in expectation, not a guarantee for any one noisy finite
# sample - with only 6 entries, a strict per-run inequality on either an
# individual BLUP or the aggregate spread is too fragile a thing to gate
# CI on. What is a legitimate, robust correctness check is that the BLUPs
# strongly correlate with (and so correctly rank and scale with) the true
# generating effects.
check(
  "balanced: BLUPs correlate strongly with the true generating effects (r > 0.95)",
  cor(blup_values, true_values) > 0.95
)

# ---- zero-interaction design: entry x environment variance near zero, not fabricated ----
check(
  "zero-interaction: entry x environment variance stays small",
  result$variance_components$entry_x_environment$estimate < 0.5
)

# ---- strong crossover interaction matches an independent lme4 REML fit exactly ----
n_entries <- 8
n_envs <- 4
set.seed(7)
grid <- expand.grid(entry = factor(1:n_entries), env = factor(1:n_envs), rep = factor(1:3))
exe <- outer(1:n_entries, 1:n_envs, function(e, v) ifelse(v <= 2, e, n_entries - e + 1)) * 1.5
grid$exe_eff <- exe[cbind(as.integer(grid$entry), as.integer(grid$env))]
genv_eff <- c(0, 4, -2, 6)[as.integer(grid$env)]
grid$value <- 20 + genv_eff + grid$exe_eff + rnorm(nrow(grid), 0, 1.2)

lme4_mod <- suppressMessages(lmer(value ~ env + (1 | entry) + (1 | entry:env), data = grid, REML = TRUE))
lme4_vc <- as.data.frame(VarCorr(lme4_mod))
lme4_fixed <- fixef(lme4_mod)

rows2 <- lapply(seq_len(nrow(grid)), function(i) list(
  entry_id = as.character(grid$entry[i]),
  environment_id = as.character(grid$env[i]),
  value = grid$value[i]
))
result2 <- run_script(list(model_type = "met_base_v1", rows = rows2))
check("crossover: status ok", identical(result2$status, "ok"))

fixed_match <- all(sapply(result2$fixed_effects_environment, function(fe) {
  name <- if (fe$level == "(Intercept)") "(Intercept)" else fe$level
  !is.na(lme4_fixed[[name]]) && isTRUE(all.equal(fe$estimate, unname(lme4_fixed[[name]]), tolerance = 1e-4))
}))
check("crossover: sommer fixed effects match lme4 exactly (tol 1e-4)", fixed_match)

exe_var_sommer <- result2$variance_components$entry_x_environment$estimate
exe_var_lme4 <- lme4_vc$vcov[lme4_vc$grp == "entry:env"]
check(
  "crossover: sommer entry x environment variance matches lme4 (tol 1e-3)",
  isTRUE(all.equal(exe_var_sommer, exe_var_lme4, tolerance = 1e-3))
)
residual_var_sommer <- result2$variance_components$residual$estimate
residual_var_lme4 <- lme4_vc$vcov[lme4_vc$grp == "Residual"]
check(
  "crossover: sommer residual variance matches lme4 (tol 1e-3)",
  isTRUE(all.equal(residual_var_sommer, residual_var_lme4, tolerance = 1e-3))
)

# ---- unbalanced MET (missing entry x environment cells): no imputation, no crash ----
rows3 <- rows_from_grid(entry_eff, env_eff, noise_sd = 1, seed = 3)
rows3 <- Filter(function(r) !(r$entry_id == "E1" && r$environment_id == "Env3"), rows3)
result3 <- run_script(list(model_type = "met_base_v1", rows = rows3))
check("unbalanced: status ok", identical(result3$status, "ok"))
check("unbalanced: converged", isTRUE(result3$model$convergence))
check("unbalanced: n_observations matches the actually-supplied row count", identical(result3$model$n_observations, length(rows3)))

# ---- too few environments: NOT_ESTIMABLE with the exact reason ----
result4 <- run_script(list(model_type = "met_base_v1", rows = list(
  list(entry_id = "E1", environment_id = "Env1", value = 10),
  list(entry_id = "E2", environment_id = "Env1", value = 11)
)))
check("insufficient environments: NOT_ESTIMABLE", identical(result4$status, "not_estimable"))
check("insufficient environments: reason names environnements", grepl("environnements", result4$message))

# ---- no entry shared across environments: NOT_ESTIMABLE (Entry x Environment unidentifiable) ----
result5 <- run_script(list(model_type = "met_base_v1", rows = list(
  list(entry_id = "E1", environment_id = "Env1", value = 10),
  list(entry_id = "E2", environment_id = "Env1", value = 11),
  list(entry_id = "E3", environment_id = "Env2", value = 12),
  list(entry_id = "E4", environment_id = "Env2", value = 13)
)))
check("no shared entries: NOT_ESTIMABLE", identical(result5$status, "not_estimable"))
check("no shared entries: reason names Entry x Environment", grepl("Entr.e x Environnement", result5$message))

cat("\n", checks_run, "checks run,", length(failures), "failed.\n")
if (length(failures) > 0) {
  cat("FAILED:\n")
  for (f in failures) cat(" -", f, "\n")
  quit(save = "no", status = 1)
}
cat("All met_base_v1 reference tests passed.\n")
