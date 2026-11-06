#!/usr/bin/env Rscript
# BreedOps V2-06 breeding-decision statistical runner.
#
# Contract: reads one JSON object from stdin, writes exactly one JSON object
# to stdout, and nothing else to stdout (diagnostics/warnings go to stderr) -
# exactly the same contract as scripts/met_models.R (V2-05). Never evaluates
# a client-supplied formula or expression: the client picks a `model_type`
# from a small fixed allowlist below, and this script alone knows what R
# call corresponds to it.
#
# Invoked as: Rscript selection_models.R <model_type>
# model_type is also duplicated inside the JSON body for a defense-in-depth
# cross-check; a mismatch is a hard error.
#
# REQUIRED CALLER ENVIRONMENT: same as met_models.R - the process spawning
# this script MUST set LC_ALL=C.UTF-8 (or another UTF-8 locale) and
# RENV_CONFIG_STARTUP_QUIET=TRUE. See met_models.R's own header comment for
# the full rationale (a parse-time locale issue, not fixable from inside
# this script) and src/lib/met/r-env.ts, which this script's caller
# (src/lib/breeding-decision/r-runner.ts) reuses unchanged.
suppressMessages(suppressWarnings({
  library(jsonlite)
  library(metan)
}))

ALLOWED_MODEL_TYPES <- c(
  "selection_mgidi_v1",
  "selection_mtsi_v1",
  "selection_smith_hazel_v1",
  "selection_multitrait_covariance_v1"
)

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
if (is.null(spec$candidates) || length(spec$candidates) == 0) fail("No candidates supplied.")
if (is.null(spec$traits) || length(spec$traits) == 0) fail("No traits supplied.")
if (is.null(spec$matrix) || length(spec$matrix) == 0) fail("No candidate x trait matrix cells supplied.")

MAX_CANDIDATES <- 5000
MAX_TRAITS <- 100
if (length(spec$candidates) > MAX_CANDIDATES) {
  fail(paste0("Dataset exceeds the supported size (", MAX_CANDIDATES, " candidates)."), status = "dataset_too_large")
}
if (length(spec$traits) > MAX_TRAITS) {
  fail(paste0("Dataset exceeds the supported size (", MAX_TRAITS, " traits)."), status = "dataset_too_large")
}

engine_info <- list(
  engine_name = "breedops-r-selection",
  engine_version = "1.0.0",
  r_version = R.version.string,
  metan_version = as.character(utils::packageVersion("metan"))
)

# ───────────────────────── Shared matrix builder ─────────────────────────
# Builds the wide candidate x trait table every method starts from. The
# caller (src/lib/breeding-decision/dataset.ts) guarantees the matrix is
# already complete-case (every cell filled) - complete-case filtering is a
# TypeScript-side, disclosed decision (task review §14), never silent and
# never this script's job. A gap here is therefore always a caller defect,
# not a user-facing NOT_ESTIMABLE.
build_wide_matrix <- function(spec) {
  candidate_ids <- vapply(spec$candidates, function(c) c$candidate_id, character(1))
  trait_ids <- vapply(spec$traits, function(t) t$trait_id, character(1))
  trait_cols <- paste0("trait_", seq_along(trait_ids))

  mat <- matrix(NA_real_, nrow = length(candidate_ids), ncol = length(trait_ids))
  for (cell in spec$matrix) {
    ci <- match(cell$candidate_id, candidate_ids)
    ti <- match(cell$trait_id, trait_ids)
    if (!is.na(ci) && !is.na(ti)) mat[ci, ti] <- as.numeric(cell$value)
  }
  if (any(is.na(mat))) {
    stop("Internal error: candidate x trait matrix must be complete-case before reaching the R engine.")
  }

  df <- as.data.frame(mat, stringsAsFactors = FALSE)
  colnames(df) <- trait_cols
  df <- cbind(GEN = candidate_ids, df, stringsAsFactors = FALSE)

  list(df = df, candidate_ids = candidate_ids, trait_ids = trait_ids, trait_cols = trait_cols)
}

# Ideotype vector in metan's own mgidi()/mtsi() syntax: "h" (higher is
# better), "l" (lower is better), or a numeric string (the explicit
# distance-to-target transformation metan's own mgidi() documents and
# implements internally - task review §13: this is metan's own validated
# behaviour, not a hand-rolled transformation, and is exercised by a
# dedicated reference-test case, never silently assumed to work).
build_ideotype <- function(traits) {
  vapply(traits, function(t) {
    direction <- t$direction
    if (is.null(direction)) stop("Chaque trait doit avoir une direction de sélection explicite.")
    if (direction == "higher_is_better") "h"
    else if (direction == "lower_is_better") "l"
    else if (direction == "target_value") {
      if (is.null(t$target_value)) stop("Un trait à valeur cible doit fournir target_value.")
      as.character(as.numeric(t$target_value))
    } else {
      stop(paste0("Direction de sélection inconnue : ", direction))
    }
  }, character(1))
}

build_weights <- function(traits) {
  has_any <- any(vapply(traits, function(t) !is.null(t$weight), logical(1)))
  if (!has_any) return(NULL)
  vapply(traits, function(t) if (is.null(t$weight)) 1 else as.numeric(t$weight), numeric(1))
}

trait_meta_by_col <- function(built) {
  setNames(lapply(seq_along(built$trait_ids), function(i) {
    list(trait_id = built$trait_ids[i], col = built$trait_cols[i])
  }), built$trait_cols)
}

# ───────────────────────── MGIDI ─────────────────────────
# Multi-trait genotype-ideotype distance index (Olivoto & Nardino 2020),
# via the pinned metan::mgidi(). Eligibility (task review §44, validated
# empirically, not an arbitrary threshold - see analytics-r/tests/
# test_selection_mgidi.R and agend.md for the full derivation):
#   - at least 2 traits: metan::mgidi() itself refuses a single trait
#     ("cannot be computed with one single variable").
#   - strictly more candidates than traits: confirmed by direct
#     inspection of mg$cormat that metan::mgidi() does NOT itself guard
#     against this - at candidates <= traits, every pairwise trait
#     correlation comes back exactly +-1 (a perfectly saturated,
#     statistically meaningless correlation matrix), yet mgidi() still
#     "succeeds" silently. BreedOps adds the guard metan omits, mirroring
#     met_base_v1's own within-cell-replication identifiability
#     discipline (V2-05) applied here to factor-analytic identifiability.
run_selection_mgidi <- function(spec) {
  built <- build_wide_matrix(spec)
  n_candidates <- length(built$candidate_ids)
  n_traits <- length(built$trait_ids)

  if (n_traits < 2) {
    fail("Le MGIDI nécessite au moins 2 traits (un indice multi-traits ne peut pas être calculé avec une seule variable).", status = "not_estimable")
  }
  if (n_candidates <= n_traits) {
    fail(paste0(
      "Le MGIDI nécessite strictement plus de candidats que de traits sélectionnés (", n_candidates,
      " candidat(s) pour ", n_traits, " trait(s)) : en dessous de ce seuil, la matrice de corrélation entre traits ",
      "est parfaitement saturée (chaque corrélation vaut exactement +-1) et l'analyse factorielle n'a aucun sens statistique."
    ), status = "not_estimable")
  }

  selection_proportion <- as.numeric(spec$options$selection_proportion)
  if (is.na(selection_proportion) || selection_proportion <= 0 || selection_proportion > 100) {
    fail("options.selection_proportion must be a number between 0 (exclusive) and 100.")
  }

  ideotype <- tryCatch(build_ideotype(spec$traits), error = function(e) e)
  if (inherits(ideotype, "error")) fail(conditionMessage(ideotype))
  weights <- build_weights(spec$traits)

  mg <- suppressWarnings(tryCatch(
    mgidi(built$df, SI = selection_proportion, ideotype = ideotype, weights = weights, verbose = FALSE),
    error = function(e) e
  ))
  if (inherits(mg, "error")) {
    fail(paste0("Le moteur MGIDI n'a pas pu ajuster ce jeu de données : ", conditionMessage(mg)), status = "not_estimable")
  }

  trait_by_col <- trait_meta_by_col(built)
  factor_cols <- grep("^FA[0-9]+$", colnames(mg$FA), value = TRUE)

  mgidi_by_gen <- setNames(as.numeric(mg$MGIDI$MGIDI), mg$MGIDI$Genotype)
  ranked_gens <- mg$MGIDI$Genotype[order(as.numeric(mg$MGIDI$MGIDI))]
  rank_by_gen <- setNames(seq_along(ranked_gens), ranked_gens)
  selected_set <- mg$sel_gen

  candidates_result <- lapply(built$candidate_ids, function(gid) {
    list(
      candidate_id = gid,
      mgidi = unname(mgidi_by_gen[[gid]]),
      rank = unname(rank_by_gen[[gid]]),
      selected = gid %in% selected_set
    )
  })

  factor_loadings <- list()
  for (fc in factor_cols) {
    for (i in seq_len(nrow(mg$FA))) {
      var_col <- paste0("trait_", i)
      trait_id <- trait_by_col[[var_col]]$trait_id
      factor_loadings[[length(factor_loadings) + 1]] <- list(
        trait_id = trait_id,
        factor = fc,
        loading = as.numeric(mg$FA[[fc]][i]),
        communality = as.numeric(mg$FA$Communality[i])
      )
    }
  }

  factor_contributions <- list()
  contri <- mg$contri_fac
  gen_col <- if ("GEN" %in% colnames(contri)) "GEN" else "Genotype"
  for (i in seq_len(nrow(contri))) {
    gid <- contri[[gen_col]][i]
    for (fc in factor_cols) {
      if (fc %in% colnames(contri)) {
        factor_contributions[[length(factor_contributions) + 1]] <- list(
          candidate_id = gid,
          factor = fc,
          contribution_pct = as.numeric(contri[[fc]][i])
        )
      }
    }
  }

  pca <- lapply(seq_len(nrow(mg$PCA)), function(i) {
    list(
      component = mg$PCA$PC[i],
      eigenvalue = as.numeric(mg$PCA$Eigenvalues[i]),
      variance_explained_pct = as.numeric(mg$PCA[["Variance (%)"]][i])
    )
  })

  list(
    status = "ok",
    engine = engine_info,
    model = list(
      model_type = "selection_mgidi_v1",
      n_candidates = n_candidates,
      n_traits = n_traits,
      selection_proportion = selection_proportion,
      n_factors_retained = length(factor_cols),
      kmo = as.numeric(mg$KMO)
    ),
    candidates = candidates_result,
    factor_loadings = factor_loadings,
    factor_contributions = factor_contributions,
    pca = pca
  )
}

result <- switch(requested_model_type,
  selection_mgidi_v1 = run_selection_mgidi(spec),
  fail(paste0("Model type '", requested_model_type, "' is not yet implemented by this script."))
)

write(toJSON(result, auto_unbox = TRUE, digits = NA, na = "null"), stdout())
