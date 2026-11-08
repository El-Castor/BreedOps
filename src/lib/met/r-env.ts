// Pure function only (no DB/network/process access of its own) - no
// "server-only" guard, so it stays directly unit-testable, same convention
// as r-model-types.ts. Security-critical (B-review blocker #4): the R
// subprocess src/lib/met/r-runner.ts spawns must NEVER inherit the full
// server environment - a wholesale `...process.env` spread would forward
// SUPABASE_SERVICE_ROLE_KEY, database credentials, and any other
// deployment secret into a third-party statistical runtime that has no
// legitimate use for any of them. Centralizing the filter here (rather
// than inlining it at the spawn() call) means a test can exercise the
// exact function the real spawn call uses, not a parallel
// reimplementation that could silently drift from it.

/** Variable NAMES (never values) that may pass through from the calling
 * process's own environment into the R subprocess, if present - nothing
 * else survives, however seemingly harmless. Each one is required for R/
 * Rscript itself to run at all: PATH to locate the Rscript/R binaries and
 * any system tool R shells out to, HOME for R's and renv's user-level
 * config/cache, TMPDIR/TMP/TEMP for R's temporary files, R_HOME/R_LIBS*
 * for an operator-customized R installation/library path. */
const ALLOWED_ENV_NAMES = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "R_HOME",
  "R_LIBS",
  "R_LIBS_USER",
  "R_LIBS_SITE",
] as const;

/** renv (analytics-r/renv.lock) reads its own cache/library/project path
 * settings exclusively from RENV_*-prefixed variables - allowlisting by
 * this well-known, non-secret namespace rather than naming every
 * individual one renv might read. RENV_CONFIG_STARTUP_QUIET is excluded
 * here because it is one of the fixed values set unconditionally below,
 * never taken from the caller's environment. */
function isRenvConfigName(name: string): boolean {
  return name.startsWith("RENV_") && name !== "RENV_CONFIG_STARTUP_QUIET";
}

/** Builds the exact environment object passed to the R subprocess's
 * `spawn()` call. Only `ALLOWED_ENV_NAMES` and `RENV_*` settings survive
 * from `sourceEnv` (typically `process.env`), and only if actually
 * present - an allowed name absent from `sourceEnv` is omitted entirely,
 * never set to an empty string. LC_ALL/LANG/RENV_CONFIG_STARTUP_QUIET are
 * always the fixed values met_models.R's own header comment requires
 * (see its REQUIRED CALLER ENVIRONMENT note), never taken from
 * `sourceEnv` - a caller cannot override them by setting its own. */
export function buildRSubprocessEnv(
  sourceEnv: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const filtered: Record<string, string> = {
    // NodeJS.ProcessEnv's own type requires NODE_ENV - not a secret, so
    // it is always passed through (falling back to "production", never
    // left unset) rather than added to the allowlist proper.
    NODE_ENV: sourceEnv.NODE_ENV ?? "production",
  };
  for (const name of ALLOWED_ENV_NAMES) {
    const value = sourceEnv[name];
    if (value !== undefined) filtered[name] = value;
  }
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (value !== undefined && isRenvConfigName(name)) filtered[name] = value;
  }
  filtered.LC_ALL = "C.UTF-8";
  filtered.LANG = "C.UTF-8";
  filtered.RENV_CONFIG_STARTUP_QUIET = "TRUE";
  return filtered as NodeJS.ProcessEnv;
}
