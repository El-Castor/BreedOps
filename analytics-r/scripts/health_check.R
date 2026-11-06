#!/usr/bin/env Rscript
# Health check for the R statistical runtime (B19's STATISTICAL_ENGINE_UNAVAILABLE
# requirement): confirms R itself, every required package, and a minimal
# real model fit all work, without touching any BreedOps data. Invoked by
# the Node.js runner before first use and exposed to administrators so a
# missing/broken R installation fails with a clear, specific diagnostic
# rather than an opaque crash. Always emits exactly one JSON object to
# stdout, exit code 0 whether healthy or not (status itself carries the
# result) so the caller never has to special-case a parse failure on top
# of a health failure.
result <- list(status = "ok", checks = list())
add_check <- function(name, ok, detail = NULL) {
  result$checks[[length(result$checks) + 1]] <<- list(name = name, ok = ok, detail = detail)
  if (!ok) result$status <<- "unavailable"
}

add_check("r_runtime", TRUE, R.version.string)

for (pkg in c("jsonlite", "sommer", "lme4", "metan")) {
  ok <- requireNamespace(pkg, quietly = TRUE)
  version <- if (ok) as.character(utils::packageVersion(pkg)) else NULL
  add_check(paste0("package:", pkg), ok, version)
}

locale_ok <- l10n_info()[["UTF-8"]] || grepl("UTF-8", Sys.getlocale("LC_CTYPE"), ignore.case = TRUE)
add_check("utf8_locale", locale_ok, Sys.getlocale("LC_CTYPE"))

fit_ok <- tryCatch({
  if (!requireNamespace("sommer", quietly = TRUE)) stop("sommer not installed")
  suppressMessages(suppressWarnings(library(sommer)))
  dat <- data.frame(
    entry = factor(rep(1:3, 4)), env = factor(rep(1:2, each = 6)),
    value = c(1, 2, 3, 2, 3, 4, 5, 6, 7, 6, 7, 8)
  )
  mod <- suppressWarnings(mmer(fixed = value ~ env, random = ~entry, rcov = ~units, data = dat, verbose = FALSE))
  isTRUE(mod$convergence)
}, error = function(e) {
  add_check("minimal_model_fit", FALSE, conditionMessage(e))
  FALSE
})
if (fit_ok) add_check("minimal_model_fit", TRUE)

# jsonlite is itself one of the checks above - if it's missing, fall back
# to a hand-built JSON string so this script never crashes on the one
# failure mode it exists to report.
if (requireNamespace("jsonlite", quietly = TRUE)) {
  write(jsonlite::toJSON(result, auto_unbox = TRUE), stdout())
} else {
  checks_json <- paste(sapply(result$checks, function(c) {
    detail <- if (is.null(c$detail)) "null" else paste0('"', gsub('"', '\\\\"', c$detail), '"')
    sprintf('{"name":"%s","ok":%s,"detail":%s}', c$name, tolower(c$ok), detail)
  }), collapse = ",")
  write(sprintf('{"status":"%s","checks":[%s]}', result$status, checks_json), stdout())
}
quit(save = "no", status = 0)
