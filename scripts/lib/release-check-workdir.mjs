// Generates the disposable, from-scratch Supabase project the release gate
// (npm run release:check) runs against, so it never touches the canonical
// retained BreedOps stack's project_id, ports, container, or volume.
//
// The generated project lives at RELEASE_CHECK.workdir (".release-check/",
// gitignored) and is torn down to nothing between runs: this file always
// deletes and recreates it from the repository's real migrations/seed, so
// the disposable stack is genuinely rebuilt from zero each time, not reused
// stale state from a previous run.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL, RELEASE_CHECK } from "./stack-identity.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Shifts every `port = N`, `shadow_port = N`, and `inspector_port = N` line
// in a supabase/config.toml by a fixed offset. Commented-out lines (e.g.
// "# smtp_port = 54325") are left untouched since they start with `#`, not
// whitespace-then-key.
function shiftPorts(toml, offset) {
  return toml.replace(
    /^(\s*(?:shadow_port|inspector_port|port)\s*=\s*)(\d+)/gm,
    (_match, prefix, num) => `${prefix}${Number(num) + offset}`,
  );
}

export function releaseCheckWorkdirPath() {
  return path.join(repoRoot, RELEASE_CHECK.workdir);
}

export function prepareReleaseCheckWorkdir() {
  const workdirAbs = releaseCheckWorkdirPath();
  rmSync(workdirAbs, { recursive: true, force: true });
  mkdirSync(workdirAbs, { recursive: true });

  // Copy the whole supabase/ directory (migrations, seed.sql, email
  // templates, and anything else config.toml references by relative path)
  // rather than hand-picking files - .branches/ and .temp/ are the CLI's
  // own runtime state for the canonical project and must not be reused for
  // a different project_id, so they are excluded and left to be created
  // fresh by the disposable project's own `supabase start`.
  cpSync(
    path.join(repoRoot, "supabase"),
    path.join(workdirAbs, "supabase"),
    {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return base !== ".branches" && base !== ".temp";
      },
    },
  );

  const canonicalToml = readFileSync(
    path.join(repoRoot, "supabase", "config.toml"),
    "utf8",
  );
  const marker = `project_id = "${CANONICAL.projectId}"`;
  if (!canonicalToml.includes(marker)) {
    throw new Error(
      `supabase/config.toml does not contain ${JSON.stringify(marker)} - ` +
        "cannot safely rewrite it into a disposable release-check project. Aborting.",
    );
  }
  let disposableToml = canonicalToml.replace(
    marker,
    `project_id = "${RELEASE_CHECK.projectId}"`,
  );
  disposableToml = shiftPorts(disposableToml, RELEASE_CHECK.portOffset);
  // [auth] site_url/additional_redirect_urls embed the APP's origin (not a
  // Supabase service port, so shiftPorts above never touches it) into
  // invite/recovery emails - without this, those links point at the
  // canonical app port even though the disposable stack's app runs on a
  // different one.
  disposableToml = disposableToml.split(CANONICAL.appOrigin).join(RELEASE_CHECK.appOrigin);
  if (disposableToml.includes(marker)) {
    throw new Error(
      "Disposable config.toml still contains the canonical project_id after rewriting. Aborting.",
    );
  }

  writeFileSync(
    path.join(workdirAbs, "supabase", "config.toml"),
    disposableToml,
  );
  return workdirAbs;
}

export function destroyReleaseCheckWorkdir() {
  rmSync(releaseCheckWorkdirPath(), { recursive: true, force: true });
}
