#!/usr/bin/env Rscript
# BreedOps V2-05 multi-environment statistical runner.
#
# Contract: reads one JSON object from stdin, writes exactly one JSON object
# to stdout, and nothing else to stdout (diagnostics/warnings go to stderr).
# Never evaluates a client-supplied formula or expression: the client picks
# a `model_type` from a small fixed allowlist below, and this script alone
# knows the R formula that corresponds to it. There is no other input path
# into model specification.
#
# Invoked as: Rscript met_models.R <model_type>
# model_type is also duplicated inside the JSON body for a defense-in-depth
# cross-check; a mismatch is a hard error.
#
# REQUIRED CALLER ENVIRONMENT: the process spawning this script MUST set
# LC_ALL=C.UTF-8 (or another UTF-8 locale) and RENV_CONFIG_STARTUP_QUIET=TRUE.
# Neither is fixable from inside this script: R parses an entire script's
# string literals - every one, regardless of where it sits in the file -
# using whichever locale is active at process start, before any in-script
# Sys.setlocale() call can take effect; under the plain "C" locale this is
# started with by default in a minimal container, every accented character
# in the French reason strings below is silently mis-decoded (each byte
# hex-escaped individually) rather than failing loudly. See
# docs/DEPLOYMENT_GUIDE.md "R subprocess environment" and the Node.js
# runner, which sets both on every spawn.
suppressMessages(suppressWarnings({
  library(jsonlite)
}))

ALLOWED_MODEL_TYPES <- c("met_base_v1", "met_finlay_wilkinson_v1", "met_ammi_v1", "met_waasb_v1", "met_gge_v1")

fail <- function(message, status = "error") {
  write(toJSON(list(status = status, message = message), auto_unbox = TRUE), stdout())
  quit(save = "no", status = 0)
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1 || !(args[1] %in% ALLOWED_MODEL_TYPES)) {
  fail(paste0("Unknown or missing model_type argument. Allowed: ", paste(ALLOWED_MODEL_TYPES, collapse = ", ")))
}
requested_model_type <- args[1]

input_text <- paste(readLines(con = "stdin", warn = FALSE), collapse = "\n")
spec <- tryCatch(fromJSON(input_text, simplifyVector = FALSE), error = function(e) NULL)
if (is.null(spec)) fail("Request body was not valid JSON.")
if (is.null(spec$model_type) || spec$model_type != requested_model_type) {
  fail("model_type in the request body does not match the command-line argument.")
}
if (is.null(spec$rows) || length(spec$rows) == 0) fail("No observation rows supplied.")

MAX_ROWS <- 50000
if (length(spec$rows) > MAX_ROWS) {
  fail(paste0("Dataset exceeds the supported size (", MAX_ROWS, " rows)."), status = "dataset_too_large")
}

rows_to_df <- function(rows) {
  get_field <- function(r, name) if (is.null(r[[name]])) NA else r[[name]]
  data.frame(
    entry_id = vapply(rows, get_field, character(1), name = "entry_id"),
    environment_id = vapply(rows, get_field, character(1), name = "environment_id"),
    block = vapply(rows, function(r) {
      v <- get_field(r, "block")
      if (is.null(v) || identical(v, NA)) NA_character_ else as.character(v)
    }, character(1)),
    value = vapply(rows, function(r) as.numeric(get_field(r, "value")), numeric(1)),
    stringsAsFactors = FALSE
  )
}

dat <- rows_to_df(spec$rows)
dat <- dat[!is.na(dat$value) & !is.na(dat$entry_id) & !is.na(dat$environment_id), , drop = FALSE]

n_entries <- length(unique(dat$entry_id))
n_environments <- length(unique(dat$environment_id))
n_obs <- nrow(dat)

MIN_ENTRIES <- 2
MIN_ENVIRONMENTS <- 2
eligibility_reasons <- character(0)
if (n_environments < MIN_ENVIRONMENTS) {
  eligibility_reasons <- c(eligibility_reasons, paste0(
    "Au moins ", MIN_ENVIRONMENTS, " environnements distincts sont nécessaires (trouvé : ", n_environments, ")."))
}
if (n_entries < MIN_ENTRIES) {
  eligibility_reasons <- c(eligibility_reasons, paste0(
    "Au moins ", MIN_ENTRIES, " entrées distinctes sont nécessaires (trouvé : ", n_entries, ")."))
}
# No repeated material across environments: every entry observed in exactly
# one environment carries zero Entry x Environment information.
shared <- table(dat$entry_id, dat$environment_id) > 0
entries_in_multiple_envs <- sum(rowSums(shared) >= 2)
if (length(eligibility_reasons) == 0 && entries_in_multiple_envs < MIN_ENTRIES) {
  eligibility_reasons <- c(eligibility_reasons,
    "Aucune entrée commune n'est observée dans au moins deux environnements : l'effet Entrée x Environnement n'est pas identifiable.")
}
if (length(eligibility_reasons) > 0) {
  fail(paste(eligibility_reasons, collapse = " "), status = "not_estimable")
}

dat$entry <- factor(dat$entry_id)
dat$env <- factor(dat$environment_id)
has_block <- any(!is.na(dat$block) & nzchar(dat$block))
if (has_block) {
  dat$block[is.na(dat$block)] <- "_unblocked"
  dat$block_env <- factor(paste(dat$env, dat$block, sep = "||"))
}

engine_info <- list(
  engine_name = "breedops-r-mixed-models",
  engine_version = "1.0.0",
  r_version = R.version.string,
  sommer_version = as.character(utils::packageVersion("sommer"))
)

replication_diagnostics <- function(dat) {
  cell_key <- paste(dat$entry_id, dat$environment_id, sep = "||")
  cell_counts <- table(cell_key)
  list(
    populated_cells = length(cell_counts),
    total_observations = nrow(dat),
    replicated_cells = sum(cell_counts >= 2)
  )
}

run_met_base <- function(dat, has_block) {
  suppressMessages(suppressWarnings(library(sommer)))
  # Entry x Environment variance and residual variance are not separately
  # identifiable with exactly one observation per Entry x Environment cell:
  # confirmed empirically against both lme4::lmer() (which hard-refuses with
  # "number of levels of each grouping factor must be < number of
  # observations" for the entry:env term in that case) and sommer::mmer()
  # (which does NOT refuse - it silently "converges" and arbitrarily splits
  # the single residual degree of freedom per cell between entry:env and
  # units, with no real identifying information behind the split). This is
  # not an arbitrary threshold: it is the standard mixed-model
  # identifiability requirement (a random effect needs strictly fewer
  # levels than the total sample size to have an estimable variance
  # distinct from residual) - equivalently, at least one Entry x
  # Environment cell must have 2+ observations. See
  # analytics-r/tests/test_met_base_v1.R for the reference cases (no
  # replication -> NOT_ESTIMABLE, full replication -> ELIGIBLE, partial
  # replication -> ELIGIBLE with a visible caution).
  replication <- replication_diagnostics(dat)
  if (replication$replicated_cells == 0) {
    fail(paste0(
      "La variance Entrée x Environnement et la variance résiduelle ne sont pas identifiables séparément : ",
      "chacune des ", replication$populated_cells, " cellules Entrée x Environnement ne compte qu'une seule observation ",
      "(", replication$total_observations, " observations au total). Au moins une cellule doit comporter une répétition."
    ), status = "not_estimable")
  }
  random_formula <- if (has_block) {
    ~ entry + entry:env + block_env
  } else {
    ~ entry + entry:env
  }
  model <- tryCatch(
    suppressWarnings(sommer::mmer(
      fixed = value ~ env,
      random = random_formula,
      rcov = ~units,
      data = dat,
      verbose = FALSE
    )),
    error = function(e) e
  )
  if (inherits(model, "error")) {
    fail(paste0("Le modèle n'a pas pu être estimé : ", conditionMessage(model)), status = "not_estimable")
  }
  if (!isTRUE(model$convergence)) {
    fail("Le modèle à effets mixtes n'a pas convergé pour ce jeu de données.", status = "not_estimable")
  }

  var_comp <- function(term) {
    if (is.null(model$sigma[[term]])) return(NULL)
    estimate <- as.numeric(model$sigma[[term]])[1]
    list(estimate = estimate, term = term)
  }
  sigma_names <- names(model$sigma)
  variance_components <- list(
    entry = var_comp("entry"),
    entry_x_environment = var_comp("entry:env"),
    block_environment = if (has_block) var_comp("block_env") else NULL,
    residual = var_comp("units")
  )

  beta <- model$Beta
  beta_se <- sqrt(diag(as.matrix(model$VarBeta)))
  fixed_effects_environment <- lapply(seq_len(nrow(beta)), function(i) {
    list(level = beta$Effect[i], estimate = as.numeric(beta$Estimate[i]), se = as.numeric(beta_se[i]))
  })

  entry_blup <- model$U$entry$value
  entry_pev <- diag(as.matrix(model$PevU$entry$value))
  entry_predictions <- lapply(names(entry_blup), function(level) {
    list(
      entry_id = sub("^entry", "", level),
      blup = as.numeric(entry_blup[[level]]),
      se = as.numeric(sqrt(entry_pev[[level]]))
    )
  })

  exe_blup <- model$U$`entry:env`$value
  exe_pev <- diag(as.matrix(model$PevU$`entry:env`$value))
  entry_env_predictions <- lapply(names(exe_blup), function(level) {
    parts <- strsplit(sub("^entry", "", level), ":env", fixed = TRUE)[[1]]
    list(
      entry_id = parts[1],
      environment_id = parts[2],
      effect = as.numeric(exe_blup[[level]]),
      se = as.numeric(sqrt(exe_pev[[level]]))
    )
  })

  monitor <- model$monitor
  log_lik <- as.numeric(monitor[1, ncol(monitor)])

  list(
    status = "ok",
    engine = engine_info,
    model = list(
      model_type = "met_base_v1",
      formula_fixed = "value ~ environment",
      formula_random = if (has_block) "~ entry + entry:environment + block(environment)" else "~ entry + entry:environment",
      n_observations = n_obs,
      n_entries = n_entries,
      n_environments = n_environments,
      block_effect_estimable = has_block,
      convergence = TRUE,
      aic = as.numeric(model$AIC),
      bic = as.numeric(model$BIC),
      log_lik = log_lik
    ),
    replication = replication,
    variance_components = variance_components,
    fixed_effects_environment = fixed_effects_environment,
    entry_predictions = entry_predictions,
    entry_environment_predictions = entry_env_predictions
  )
}

missing_cells_count <- function(dat) {
  n_entries * n_environments - length(unique(paste(dat$entry_id, dat$environment_id, sep = "||")))
}

run_met_ammi <- function(dat) {
  suppressMessages(suppressWarnings(library(metan)))
  # metan::performs_ammi() already raises a normal R condition (caught by
  # tryCatch below) when entries/environments <= 2, with its own message
  # ("Both genotypes and environments must have more than two levels.") -
  # verified empirically. This explicit pre-check is not required for
  # correctness the way run_met_waasb()'s is (performs_ammi's failure never
  # corrupts stdout), but gives the same clear, French, consistently-worded
  # NOT_ESTIMABLE reason as every other model here, rather than depending
  # on metan's own English wording.
  if (n_entries <= 2 || n_environments <= 2) {
    fail("Le modèle AMMI nécessite plus de 2 entrées et plus de 2 environnements.", status = "not_estimable")
  }
  missing_cells <- missing_cells_count(dat)
  dat$GEN <- dat$entry
  dat$ENV <- dat$env
  dat$REP <- factor(if (has_block) dat$block else seq_len(nrow(dat)))
  # metan::performs_ammi's `resp` argument is only reliably honored when the
  # response column is literally named Y in this metan+dplyr combination
  # (verified empirically: an otherwise-identical call with the response
  # column named anything else - "value", "trait_value", "response_value" -
  # silently returns an empty result object with no error at all, while
  # "Y" works correctly). Renaming here, rather than trusting `resp=`, is
  # the one fix confirmed to work.
  dat$Y <- dat$value
  model <- tryCatch(
    suppressMessages(suppressWarnings(
      metan::performs_ammi(dat, env = ENV, gen = GEN, rep = REP, resp = Y, verbose = FALSE)
    )),
    error = function(e) e
  )
  if (inherits(model, "error")) {
    fail(paste0("Le modèle AMMI n'a pas pu être estimé : ", conditionMessage(model)), status = "not_estimable")
  }
  anova_tbl <- model$Y$ANOVA
  pc_rows <- anova_tbl[grepl("^PC[0-9]+$", anova_tbl$Source), , drop = FALSE]
  if (nrow(pc_rows) == 0) {
    fail("Le modèle AMMI n'a produit aucune composante d'interaction significative pour ce jeu de données.", status = "not_estimable")
  }
  principal_components <- lapply(seq_len(nrow(pc_rows)), function(i) list(
    component = pc_rows$Source[i],
    variance_explained_pct = as.numeric(pc_rows$Proportion[i]),
    cumulative_pct = as.numeric(pc_rows$Accumulated[i])
  ))
  scores <- model$Y$model
  genotype_scores <- lapply(which(scores$type == "GEN"), function(i) list(
    entry_id = as.character(scores$Code[i]),
    mean = as.numeric(scores$Y[i]),
    pc1 = as.numeric(scores$PC1[i]),
    pc2 = if ("PC2" %in% names(scores)) as.numeric(scores$PC2[i]) else NULL
  ))
  environment_scores <- lapply(which(scores$type == "ENV"), function(i) list(
    environment_id = as.character(scores$Code[i]),
    mean = as.numeric(scores$Y[i]),
    pc1 = as.numeric(scores$PC1[i]),
    pc2 = if ("PC2" %in% names(scores)) as.numeric(scores$PC2[i]) else NULL
  ))
  list(
    status = "ok",
    engine = modifyList(engine_info, list(metan_version = as.character(utils::packageVersion("metan")))),
    model = list(
      model_type = "met_ammi_v1",
      n_observations = n_obs, n_entries = n_entries, n_environments = n_environments,
      # metan::performs_ammi() does NOT exclude a missing Entry x Environment
      # cell - it fills it in via impute_missing_val()'s EM-SVD algorithm
      # before fitting (confirmed by reading metan's own source). This is a
      # real, literature-established technique for incomplete MET trials,
      # but B40 requires it to be visible, never silent: missing_cells_
      # imputed is always reported, 0 when the design is complete.
      missing_cells_imputed = missing_cells
    ),
    principal_components = principal_components,
    genotype_scores = genotype_scores,
    environment_scores = environment_scores
  )
}

run_met_waasb <- function(dat, performance_weight) {
  suppressMessages(suppressWarnings(library(metan)))
  # metan::waasb() requires MORE than 2 entries AND MORE than 2 environments
  # (verified empirically: 2 of either triggers this, 3+ of both does not).
  # Unlike performs_ammi()'s equivalent failure, which raises a normal R
  # condition caught by tryCatch() below, waasb() writes this warning
  # straight to stdout with a bare cat()-style call - bypassing R's
  # condition system entirely, so suppressWarnings()/tryCatch() cannot
  # intercept it, and it would otherwise corrupt the "exactly one JSON
  # object on stdout" contract (found via manual UI verification, not by
  # the reference tests, which never exercised exactly 2 environments for
  # this model). This explicit pre-check is the only fix: catching the
  # resulting malformed-JSON failure after the fact would already be too
  # late to protect the stdout contract.
  if (n_entries <= 2 || n_environments <= 2) {
    fail("Le modèle WAASB nécessite plus de 2 entrées et plus de 2 environnements (contrairement au modèle de base, qui n'en nécessite que 2).", status = "not_estimable")
  }
  dat$GEN <- dat$entry
  dat$ENV <- dat$env
  dat$REP <- factor(if (has_block) dat$block else seq_len(nrow(dat)))
  # See the identical note in run_met_ammi(): metan's `resp` argument only
  # reliably works when the response column is literally named Y.
  dat$Y <- dat$value
  model <- tryCatch(
    suppressMessages(suppressWarnings(
      metan::waasb(dat, env = ENV, gen = GEN, rep = REP, resp = Y,
        wresp = performance_weight * 100, verbose = FALSE)
    )),
    error = function(e) e
  )
  if (inherits(model, "error")) {
    fail(paste0("Le modèle WAASB n'a pas pu être estimé : ", conditionMessage(model)), status = "not_estimable")
  }
  tbl <- model$Y$model
  gen_rows <- tbl[tbl$type == "GEN", , drop = FALSE]
  entries <- lapply(seq_len(nrow(gen_rows)), function(i) list(
    entry_id = as.character(gen_rows$Code[i]),
    mean_performance = as.numeric(gen_rows$Y[i]),
    waasb = as.numeric(gen_rows$WAASB[i]),
    waasby = as.numeric(gen_rows$WAASBY[i]),
    performance_percentile = as.numeric(gen_rows$PctResp[i]),
    stability_percentile = as.numeric(gen_rows$PctWAASB[i])
  ))
  list(
    status = "ok",
    engine = modifyList(engine_info, list(metan_version = as.character(utils::packageVersion("metan")))),
    model = list(
      model_type = "met_waasb_v1",
      n_observations = n_obs, n_entries = n_entries, n_environments = n_environments,
      performance_weight = performance_weight,
      stability_weight = 1 - performance_weight
    ),
    entries = entries
  )
}

run_met_finlay_wilkinson <- function(dat) {
  suppressMessages(suppressWarnings(library(metan)))
  # Every entry included in a Finlay-Wilkinson regression must itself be
  # observed in at least 2 environments: the regression is fit PER ENTRY
  # against the environmental index, so an entry present in only 1
  # environment gives metan::ge_reg() exactly one point to regress against
  # its own index value - verified empirically to still return a
  # confident-looking fit (a tiny p-value) rather than failing or flagging
  # the degeneracy, which would otherwise silently fabricate a slope/
  # stability result for that entry. The generic eligibility gate above
  # only requires 2+ SHARED entries overall (B13-B14), which does not
  # guarantee every individual entry qualifies - this is a stricter,
  # model-specific requirement.
  entry_env_counts <- table(unique(dat[c("entry_id", "environment_id")])$entry_id)
  insufficient_entries <- names(entry_env_counts)[entry_env_counts < 2]
  if (length(insufficient_entries) > 0) {
    fail(paste0(
      "Le modèle de régression conjointe (Finlay-Wilkinson) nécessite que chaque entrée soit observée dans au moins 2 environnements. ",
      "Entrée(s) insuffisante(s) : ", paste(insufficient_entries, collapse = ", "), "."
    ), status = "not_estimable")
  }
  dat$GEN <- dat$entry
  dat$ENV <- dat$env
  dat$REP <- factor(if (has_block) dat$block else seq_len(nrow(dat)))
  # Unlike performs_ammi/waasb, metan::ge_reg does not have the Y-only
  # naming bug (verified empirically with a non-"Y" response column), but
  # the response is still renamed here for consistency with the rest of
  # this file and as a defensive guard against a future metan regression.
  dat$Y <- dat$value
  model <- tryCatch(
    suppressWarnings(metan::ge_reg(dat, env = ENV, gen = GEN, rep = REP, resp = Y, verbose = FALSE)),
    error = function(e) e
  )
  if (inherits(model, "error")) {
    fail(paste0("Le modèle de régression conjointe (Finlay-Wilkinson) n'a pas pu être estimé : ", conditionMessage(model)), status = "not_estimable")
  }
  reg <- model$Y$regression
  if (is.null(reg) || nrow(reg) == 0) {
    fail("Le modèle de régression conjointe n'a produit aucun résultat pour ce jeu de données.", status = "not_estimable")
  }
  entries <- lapply(seq_len(nrow(reg)), function(i) list(
    entry_id = as.character(reg$GEN[i]),
    # b1 (slope): responsiveness to the environmental index. 1 is average
    # responsiveness, matching the field's own reference value, not 0 -
    # this is deliberately NOT centered the way an ordinary regression
    # slope would be interpreted.
    intercept = as.numeric(reg$b0[i]),
    slope = as.numeric(reg$b1[i]),
    # t-test / p-value for H0: slope == 1 (not the usual H0: slope == 0) -
    # Eberhart & Russell's own convention, since 1 is the reference value.
    slope_t_stat = as.numeric(reg[["t(b1=1)"]])[i],
    slope_p_value = as.numeric(reg$pval_t)[i],
    # s2di: Eberhart & Russell's deviation-from-regression variance - the
    # stability measure proper (lower = more predictable response pattern
    # across environments, independent of the slope/responsiveness).
    deviation_variance = as.numeric(reg$s2di[i]),
    deviation_f_stat = as.numeric(reg[["F(s2di=0)"]])[i],
    deviation_p_value = as.numeric(reg$pval_f[i]),
    rmse = as.numeric(reg$RMSE[i]),
    r_squared = as.numeric(reg$R2[i])
  ))
  list(
    status = "ok",
    engine = modifyList(engine_info, list(metan_version = as.character(utils::packageVersion("metan")))),
    model = list(
      model_type = "met_finlay_wilkinson_v1",
      n_observations = n_obs, n_entries = n_entries, n_environments = n_environments
    ),
    entries = entries
  )
}

run_met_gge <- function(dat) {
  suppressMessages(suppressWarnings(library(metan)))
  missing_cells <- missing_cells_count(dat)
  dat$GEN <- dat$entry
  dat$ENV <- dat$env
  # gge() takes no `rep` argument - unlike performs_ammi/waasb/ge_reg, it
  # aggregates replicated rows to genotype x environment means internally
  # (verified empirically: identical result whether raw replicated rows or
  # pre-aggregated means are supplied). Renaming the response to Y is
  # unnecessary here too (verified, no analogous bug), kept for the same
  # defensive-consistency reason as run_met_finlay_wilkinson().
  dat$Y <- dat$value
  model <- tryCatch(
    suppressMessages(suppressWarnings(metan::gge(dat, env = ENV, gen = GEN, resp = Y))),
    error = function(e) e
  )
  if (inherits(model, "error")) {
    fail(paste0("Le modèle GGE n'a pas pu être estimé : ", conditionMessage(model)), status = "not_estimable")
  }
  gge_result <- model$Y
  n_axes <- length(gge_result$labelaxes)
  principal_components <- lapply(seq_len(n_axes), function(i) list(
    component = gge_result$labelaxes[i],
    eigenvalue = as.numeric(gge_result$eigenvalues[i]),
    variance_explained_pct = as.numeric(gge_result$varexpl[i])
  ))
  genotype_scores <- lapply(seq_along(gge_result$labelgen), function(i) list(
    entry_id = as.character(gge_result$labelgen[i]),
    mean = as.numeric(gge_result$mean_gen[i]),
    coordinates = as.numeric(gge_result$coordgen[i, ])
  ))
  environment_scores <- lapply(seq_along(gge_result$labelenv), function(i) list(
    environment_id = as.character(gge_result$labelenv[i]),
    mean = as.numeric(gge_result$mean_env[i]),
    coordinates = as.numeric(gge_result$coordenv[i, ])
  ))
  list(
    status = "ok",
    engine = modifyList(engine_info, list(metan_version = as.character(utils::packageVersion("metan")))),
    model = list(
      model_type = "met_gge_v1",
      n_observations = n_obs, n_entries = n_entries, n_environments = n_environments,
      centering = gge_result$centering, scaling = gge_result$scaling, svp = gge_result$svp,
      # metan::gge() does NOT exclude a missing Entry x Environment cell -
      # it fills it in via impute_missing_val()'s EM-SVD algorithm before
      # the SVD biplot decomposition (confirmed by reading metan's own
      # source: `if (has_na(ge_mat)) ge_mat <- impute_missing_val(ge_mat,
      # ...)`). Same B40 disclosure rule as met_ammi_v1: always reported,
      # 0 when the design is complete, never silent.
      missing_cells_imputed = missing_cells
    ),
    grand_mean = as.numeric(gge_result$grand_mean),
    principal_components = principal_components,
    genotype_scores = genotype_scores,
    environment_scores = environment_scores
  )
}

performance_weight <- if (!is.null(spec$options) && !is.null(spec$options$performance_weight)) {
  as.numeric(spec$options$performance_weight)
} else {
  0.5
}
if (is.na(performance_weight) || performance_weight < 0 || performance_weight > 1) {
  fail("options.performance_weight must be a number between 0 and 1.")
}

result <- switch(requested_model_type,
  met_base_v1 = run_met_base(dat, has_block),
  met_ammi_v1 = run_met_ammi(dat),
  met_waasb_v1 = run_met_waasb(dat, performance_weight),
  met_finlay_wilkinson_v1 = run_met_finlay_wilkinson(dat),
  met_gge_v1 = run_met_gge(dat),
  fail(paste0("Model type '", requested_model_type, "' is not yet implemented by this script."))
)

write(toJSON(result, auto_unbox = TRUE, digits = NA, na = "null"), stdout())
