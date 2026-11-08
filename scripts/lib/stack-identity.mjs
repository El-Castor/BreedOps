// Single source of truth for which Supabase stack a script, test, or e2e
// spec talks to. Two named profiles exist:
//
//   - "canonical": the retained/local-dev BreedOps stack from
//     supabase/config.toml (project_id "BreedOps", API port 55421, DB port
//     55422, container "supabase_db_BreedOps"). This is what a developer's
//     Mac keeps running across sessions and must never be reset, stopped
//     with --no-backup, or otherwise mutated by an automated gate.
//   - "release-check": a fully separate, disposable project the release
//     gate (npm run release:check) creates and destroys itself, with its
//     own project_id/ports/container/volume/workdir, so the gate is safe to
//     run on a machine where the canonical stack is already up.
//
// Which profile a given process resolves to is controlled by the
// BREEDOPS_STACK_PROFILE env var (default "canonical"), set by
// scripts/release-check.mjs on every child process it spawns. Nothing here
// changes ordinary `npm run <script>` behaviour for a developer, since the
// default profile is exactly the pre-existing canonical identity.
export const CANONICAL = Object.freeze({
  name: "canonical",
  projectId: "BreedOps",
  apiPort: 55421,
  dbPort: 55422,
  dbContainer: "supabase_db_BreedOps",
  backendFile: ".local/test-backend.json",
  appPort: 3107,
  apiUrl: "http://127.0.0.1:55421",
  appOrigin: "http://localhost:3107",
  appPidFile: ".local/app.pid",
});

// Every numeric port in supabase/config.toml is shifted by this offset to
// build the disposable project's config (see
// scripts/lib/release-check-workdir.mjs) - a single offset is less
// error-prone than hand-listing each port BreedOps's config.toml happens to
// define today.
const RELEASE_CHECK_PORT_OFFSET = 100;

export const RELEASE_CHECK = Object.freeze({
  name: "release-check",
  projectId: "BreedOpsReleaseCheck",
  apiPort: CANONICAL.apiPort + RELEASE_CHECK_PORT_OFFSET,
  dbPort: CANONICAL.dbPort + RELEASE_CHECK_PORT_OFFSET,
  dbContainer: "supabase_db_BreedOpsReleaseCheck",
  backendFile: ".local/release-check-backend.json",
  appPort: CANONICAL.appPort + 10,
  apiUrl: `http://127.0.0.1:${CANONICAL.apiPort + RELEASE_CHECK_PORT_OFFSET}`,
  appOrigin: `http://localhost:${CANONICAL.appPort + 10}`,
  appPidFile: ".local/release-check-app.pid",
  workdir: ".release-check",
  portOffset: RELEASE_CHECK_PORT_OFFSET,
});

export function currentProfile() {
  const name = process.env.BREEDOPS_STACK_PROFILE ?? "canonical";
  if (name === "canonical") return CANONICAL;
  if (name === "release-check") return RELEASE_CHECK;
  throw new Error(
    `Unknown BREEDOPS_STACK_PROFILE "${name}". Expected "canonical" or "release-check".`,
  );
}

// Fail-closed guard: throws unless `profile` is genuinely distinct from the
// canonical retained stack's identity on every axis that matters. Call this
// before any destructive or test operation that a profile object drives, so
// a future edit that accidentally reuses a canonical value aborts loudly
// instead of silently touching retained data.
export function assertNotCanonicalIdentity(profile) {
  if (profile === CANONICAL || profile.name === CANONICAL.name) {
    throw new Error(
      "SAFETY ABORT: this operation requires the disposable release-check " +
        "profile, but resolved to the canonical retained BreedOps profile.",
    );
  }
  if (
    profile.projectId === CANONICAL.projectId ||
    profile.apiPort === CANONICAL.apiPort ||
    profile.dbPort === CANONICAL.dbPort ||
    profile.dbContainer === CANONICAL.dbContainer ||
    profile.backendFile === CANONICAL.backendFile ||
    profile.appPort === CANONICAL.appPort
  ) {
    throw new Error(
      "SAFETY ABORT: resolved disposable stack identity collides with the " +
        "canonical retained BreedOps stack (project_id, port, container, " +
        "backend file, or app port). Refusing to run.",
    );
  }
}

// Second, independent gate: checks the *live* `supabase status -o json`
// output (not just the static profile constant) actually matches the
// profile we asked for. This is what catches a workdir/config-generation
// bug that silently fell back to the canonical project.
export function assertStatusMatchesProfile(status, profile) {
  if (profile.name !== CANONICAL.name) {
    assertNotCanonicalIdentity(profile);
    if (status.API_URL === CANONICAL.apiUrl) {
      throw new Error(
        "SAFETY ABORT: the disposable release-check stack resolved to the " +
          `canonical API URL (${CANONICAL.apiUrl}). Refusing to run.`,
      );
    }
  }
  if (status.API_URL !== profile.apiUrl) {
    throw new Error(
      `SAFETY ABORT: expected Supabase API at ${profile.apiUrl} for the ` +
        `"${profile.name}" profile, got ${status.API_URL}.`,
    );
  }
}
