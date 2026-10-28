import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The exact Supabase CLI version pinned as a devDependency in package.json.
// Keep these in sync; this file is the single source of truth other scripts
// should import rather than re-typing the version string.
export const SUPABASE_CLI_VERSION = "2.121.0";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const cliPath = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase",
);

// Every BreedOps-managed invocation runs with telemetry and update-notifier
// noise disabled, while leaving the rest of the caller's environment intact.
const quietEnv = {
  SUPABASE_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  SUPABASE_NO_UPDATE_NOTIFIER: "1",
};

function assertCliInstalled() {
  if (!existsSync(cliPath)) {
    throw new Error(
      `Project-local Supabase CLI not found at ${cliPath}. Run \`npm ci\` to install ` +
        `the pinned supabase@${SUPABASE_CLI_VERSION} devDependency before running this command.`,
    );
  }
}

function assertCliVersion(env) {
  const version = execFileSync(cliPath, ["--version"], {
    encoding: "utf8",
    env,
  }).trim();
  if (version !== SUPABASE_CLI_VERSION) {
    throw new Error(
      `Project-local Supabase CLI reports version ${version}, but BreedOps pins ` +
        `${SUPABASE_CLI_VERSION}. Run \`npm ci\` to reinstall the exact pinned version.`,
    );
  }
}

/**
 * Run the project-local, exact-pinned Supabase CLI. Never falls back to a
 * globally installed CLI and never downloads a binary at runtime.
 *
 * @param {string[]} args - CLI arguments, e.g. ["start", "-x", "studio"].
 * @param {{ capture?: boolean }} [options] - `capture: true` returns stdout
 *   (for commands like `status -o json`); otherwise stdio is inherited so
 *   interactive commands behave normally.
 * @returns {string | undefined} stdout when `capture` is true.
 */
export function runSupabase(args, { capture = false } = {}) {
  assertCliInstalled();
  const env = { ...process.env, ...quietEnv };
  assertCliVersion(env);

  if (capture) {
    return execFileSync(cliPath, args, { encoding: "utf8", env });
  }

  const result = spawnSync(cliPath, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `supabase ${args.join(" ")} exited with status ${result.status}`,
    );
  }
  return undefined;
}
