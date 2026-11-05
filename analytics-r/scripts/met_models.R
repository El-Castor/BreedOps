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

ALLOWED_MODEL_TYPES <- c("met_base_v1", "met_finlay_wilkinson_v1", "met_ammi_v1", "met_waasb_v1")

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

run_met_base <- function(dat, has_block) {
  suppressMessages(suppressWarnings(library(sommer)))
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
    variance_components = variance_components,
    fixed_effects_environment = fixed_effects_environment,
    entry_predictions = entry_predictions,
    entry_environment_predictions = entry_env_predictions
  )
}

run_met_ammi <- function(dat) {
  suppressMessages(suppressWarnings(library(metan)))
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
      n_observations = n_obs, n_entries = n_entries, n_environments = n_environments
    ),
    principal_components = principal_components,
    genotype_scores = genotype_scores,
    environment_scores = environment_scores
  )
}

run_met_waasb <- function(dat, performance_weight) {
  suppressMessages(suppressWarnings(library(metan)))
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
  fail(paste0("Model type '", requested_model_type, "' is not yet implemented by this script."))
)

write(toJSON(result, auto_unbox = TRUE, digits = NA, na = "null"), stdout())
