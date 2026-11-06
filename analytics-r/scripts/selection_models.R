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

# as.numeric(NULL) is numeric(0), and is.na(numeric(0)) is logical(0) -
# which crashes `if()` with "argument is of length zero" instead of
# cleanly failing, the moment an options field is simply absent from the
# request rather than explicitly null. Every numeric option is read
# through this helper so a missing field always reaches fail() with a
# normal message, never an uncaught R-level crash.
get_numeric_option <- function(options, name) {
  value <- if (is.null(options)) NULL else options[[name]]
  if (is.null(value)) NA_real_ else as.numeric(value)
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
if (is.null(spec$traits) || length(spec$traits) == 0) fail("No traits supplied.")

MAX_CANDIDATES <- 5000
MAX_TRAITS <- 100
MAX_ROWS <- 500000
if (length(spec$traits) > MAX_TRAITS) {
  fail(paste0("Dataset exceeds the supported size (", MAX_TRAITS, " traits)."), status = "dataset_too_large")
}

# selection_mgidi_v1 takes a pre-aggregated candidate x trait matrix
# (point values, complete-case, built by
# src/lib/breeding-decision/dataset.ts); selection_mtsi_v1 instead takes
# the raw long-format entry x environment x trait observations, because
# it must refit metan::waasb() itself across every selected trait at
# once - there is no stored object a prior V2-05 run could hand it that
# would let metan::mtsi() work from already-summarized numbers.
if (requested_model_type == "selection_mgidi_v1") {
  if (is.null(spec$candidates) || length(spec$candidates) == 0) fail("No candidates supplied.")
  if (is.null(spec$matrix) || length(spec$matrix) == 0) fail("No candidate x trait matrix cells supplied.")
  if (length(spec$candidates) > MAX_CANDIDATES) {
    fail(paste0("Dataset exceeds the supported size (", MAX_CANDIDATES, " candidates)."), status = "dataset_too_large")
  }
} else if (requested_model_type == "selection_mtsi_v1") {
  if (is.null(spec$rows) || length(spec$rows) == 0) fail("No observation rows supplied.")
  if (length(spec$rows) > MAX_ROWS) {
    fail(paste0("Dataset exceeds the supported size (", MAX_ROWS, " rows)."), status = "dataset_too_large")
  }
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

  selection_proportion <- get_numeric_option(spec$options, "selection_proportion")
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

# ───────────────────────── MTSI ─────────────────────────
# Multi-trait stability index (Olivoto et al. 2019), via the pinned
# metan::waasb() (refit fresh across every selected trait at once, long
# format) + metan::mtsi(). Eligibility (task review §18/§44):
#   - at least 2 traits: metan::mtsi() itself refuses a single variable,
#     identical wording to mgidi's own guard.
#   - strictly more than 2 entries AND more than 2 environments:
#     metan::waasb() does not cleanly refuse this itself - it prints a
#     raw warning ("The number of environments and number of genotypes
#     must be greater than 2") and then crashes several calls deeper
#     with an unrelated, cryptic dplyr/mutate error. This is the exact
#     defect V2-05's own run_met_waasb() (met_models.R) already found
#     and guards against for single-trait WAASB; reused verbatim here
#     for the multi-trait refit, confirmed empirically again for this
#     code path in analytics-r/tests/test_selection_mtsi.R.
#   - target_value traits are not supported: metan::waasb()'s own
#     direction argument (mresp) only knows "h"/"l", with no
#     distance-to-target concept (unlike mgidi's ideotype) - never
#     silently approximated as one or the other.
#   - every trait must have a SUCCESSFUL V2-05 met_waasb_v1 source run
#     for this exact trial (checked in TypeScript before this script is
#     even invoked - see src/lib/breeding-decision/eligibility.ts -
#     never re-litigated here); every trait's source run's
#     performance_weight must be identical (harmonized), also checked in
#     TypeScript, and passed through here as the one shared
#     options$performance_weight.
#   - index is always "waasby", never a client-selectable option:
#     confirmed empirically (analytics-r/tests/test_selection_mtsi.R)
#     that metan 1.19.0's mtsi(index = "waasb", ideotype = <anything
#     non-NULL>) crashes internally ("object 'df_ideotype' not found"),
#     regardless of what the ideotype vector actually contains (even all
#     "h") - a genuine bug in metan's own "waasb" branch, not anything
#     about BreedOps's data. Never patched or worked around inside a
#     pinned package; "waasb" alone (stability only, no mean-performance
#     weighting) is simply not offered until metan fixes this upstream.
run_selection_mtsi <- function(spec) {
  get_field <- function(r, name) if (is.null(r[[name]])) NA else r[[name]]
  entry_id <- vapply(spec$rows, get_field, character(1), name = "entry_id")
  environment_id <- vapply(spec$rows, get_field, character(1), name = "environment_id")
  phenotype_id <- vapply(spec$rows, get_field, character(1), name = "phenotype_id")
  block <- vapply(spec$rows, function(r) {
    v <- get_field(r, "block")
    if (is.null(v) || identical(v, NA)) NA_character_ else as.character(v)
  }, character(1))
  trait_id <- vapply(spec$rows, get_field, character(1), name = "trait_id")
  value <- vapply(spec$rows, function(r) as.numeric(get_field(r, "value")), numeric(1))

  long <- data.frame(
    entry_id = entry_id, environment_id = environment_id, phenotype_id = phenotype_id,
    block = block, trait_id = trait_id, value = value, stringsAsFactors = FALSE
  )
  long <- long[!is.na(long$value) & !is.na(long$entry_id) & !is.na(long$environment_id) & !is.na(long$phenotype_id) & !is.na(long$trait_id), , drop = FALSE]
  long$block[is.na(long$block) | !nzchar(long$block)] <- "_unblocked"

  trait_ids <- vapply(spec$traits, function(t) t$trait_id, character(1))
  trait_cols <- paste0("trait_", seq_along(trait_ids))
  trait_col_by_id <- setNames(trait_cols, trait_ids)

  directions <- vapply(spec$traits, function(t) {
    if (is.null(t$direction)) stop("Chaque trait doit avoir une direction de sélection explicite.")
    t$direction
  }, character(1))
  if (any(directions == "target_value")) {
    fail("Le MTSI ne prend pas en charge les traits à valeur cible (target_value) : la pondération WAASB/WAASBY ne connaît que les directions hausse/baisse.", status = "not_estimable")
  }

  n_entries <- length(unique(long$entry_id))
  n_environments <- length(unique(long$environment_id))
  if (n_entries <= 2 || n_environments <= 2) {
    fail("Le MTSI nécessite strictement plus de 2 entrées et plus de 2 environnements (contrainte propre à metan::waasb(), qui échoue de façon imprévisible en dessous de ce seuil).", status = "not_estimable")
  }
  if (length(trait_ids) < 2) {
    fail("Le MTSI nécessite au moins 2 traits (un indice multi-traits ne peut pas être calculé avec une seule variable).", status = "not_estimable")
  }

  # Pivot to wide, joined on phenotype_id alone - the true experimental-
  # unit identity (task review hardening #6), never on
  # (entry_id, environment_id, block): when block is absent for every
  # row of an unblocked design, that triple is identical for every
  # replicate of the same cell, and merge() on it would silently produce
  # a cartesian product across traits (every trait-A replicate paired
  # with every trait-B replicate, in row order - never a real
  # correspondence). phenotype_id is globally unique per biological
  # unit, so merging on it alone is always exactly 1:1 regardless of
  # whether block is set. entry_id/environment_id/block are carried
  # through from the FIRST trait's own rows only (they are the same
  # physical unit's descriptive columns, identical across every trait
  # that actually has an observation for this phenotype_id - never
  # re-merged per trait, which would otherwise re-introduce duplicate
  # .x/.y columns).
  wide <- NULL
  for (i in seq_along(trait_ids)) {
    tid <- trait_ids[i]
    sub <- long[long$trait_id == tid, c("phenotype_id", "entry_id", "environment_id", "block", "value")]
    colnames(sub)[5] <- trait_cols[i]
    if (is.null(wide)) {
      wide <- sub
    } else {
      wide <- merge(wide, sub[, c("phenotype_id", trait_cols[i])], by = "phenotype_id", all = TRUE)
    }
  }
  if (any(is.na(wide[trait_cols]))) {
    fail("Le MTSI nécessite une observation pour chaque trait sélectionné à chaque unité expérimentale utilisée.", status = "not_estimable")
  }

  selection_proportion <- get_numeric_option(spec$options, "selection_proportion")
  if (is.na(selection_proportion) || selection_proportion <= 0 || selection_proportion > 100) {
    fail("options.selection_proportion must be a number between 0 (exclusive) and 100.")
  }
  index <- "waasby"
  mresp <- ifelse(directions == "higher_is_better", "h", "l")
  performance_weight <- get_numeric_option(spec$options, "performance_weight")
  if (is.na(performance_weight) || performance_weight < 0 || performance_weight > 1) {
    fail("options.performance_weight must be a number between 0 and 1.")
  }
  wresp <- performance_weight * 100

  wa <- suppressWarnings(tryCatch(
    waasb(wide, env = environment_id, gen = entry_id, rep = block,
      resp = all_of(trait_cols), mresp = mresp, wresp = wresp, verbose = FALSE),
    error = function(e) e
  ))
  if (inherits(wa, "error")) {
    fail(paste0("Le moteur WAASB n'a pas pu ajuster ce jeu de données multi-traits : ", conditionMessage(wa)), status = "not_estimable")
  }

  ideotype <- ifelse(directions == "higher_is_better", "h", "l")
  mt <- suppressWarnings(tryCatch(
    mtsi(wa, index = index, ideotype = ideotype, SI = selection_proportion, verbose = FALSE),
    error = function(e) e
  ))
  if (inherits(mt, "error")) {
    fail(paste0("Le moteur MTSI n'a pas pu calculer l'indice : ", conditionMessage(mt)), status = "not_estimable")
  }

  factor_cols <- grep("^FA[0-9]+$", colnames(mt$FA), value = TRUE)
  mtsi_by_gen <- setNames(as.numeric(mt$MTSI$MTSI), mt$MTSI$Genotype)
  ranked_gens <- mt$MTSI$Genotype[order(as.numeric(mt$MTSI$MTSI))]
  rank_by_gen <- setNames(seq_along(ranked_gens), ranked_gens)
  selected_set <- mt$sel_gen

  candidate_ids <- unique(long$entry_id)
  candidates_result <- lapply(candidate_ids, function(gid) {
    list(
      candidate_id = gid,
      mtsi = unname(mtsi_by_gen[[gid]]),
      rank = unname(rank_by_gen[[gid]]),
      selected = gid %in% selected_set
    )
  })

  factor_loadings <- list()
  for (fc in factor_cols) {
    for (i in seq_len(nrow(mt$FA))) {
      var_col <- paste0("trait_", i)
      tid <- trait_ids[match(var_col, trait_cols)]
      factor_loadings[[length(factor_loadings) + 1]] <- list(
        trait_id = tid, factor = fc,
        loading = as.numeric(mt$FA[[fc]][i]),
        communality = as.numeric(mt$FA$Communality[i])
      )
    }
  }

  factor_contributions <- list()
  contri <- mt$contri_fac
  gen_col <- if ("GEN" %in% colnames(contri)) "GEN" else "Genotype"
  for (i in seq_len(nrow(contri))) {
    gid <- contri[[gen_col]][i]
    for (fc in factor_cols) {
      if (fc %in% colnames(contri)) {
        factor_contributions[[length(factor_contributions) + 1]] <- list(
          candidate_id = gid, factor = fc,
          contribution_pct = as.numeric(contri[[fc]][i])
        )
      }
    }
  }

  list(
    status = "ok",
    engine = engine_info,
    model = list(
      model_type = "selection_mtsi_v1",
      n_candidates = length(candidate_ids),
      n_traits = length(trait_ids),
      n_environments = n_environments,
      selection_proportion = selection_proportion,
      index = index,
      performance_weight = performance_weight,
      n_factors_retained = length(factor_cols)
    ),
    candidates = candidates_result,
    factor_loadings = factor_loadings,
    factor_contributions = factor_contributions
  )
}

result <- switch(requested_model_type,
  selection_mgidi_v1 = run_selection_mgidi(spec),
  selection_mtsi_v1 = run_selection_mtsi(spec),
  fail(paste0("Model type '", requested_model_type, "' is not yet implemented by this script."))
)

write(toJSON(result, auto_unbox = TRUE, digits = NA, na = "null"), stdout())
