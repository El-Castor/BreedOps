import { runSupabase } from "./lib/supabase-cli.mjs";
import { CANONICAL, currentProfile } from "./lib/stack-identity.mjs";
import {
  destroyReleaseCheckWorkdir,
  releaseCheckWorkdirPath,
} from "./lib/release-check-workdir.mjs";

const profile = currentProfile();
if (profile.name === CANONICAL.name) {
  // No --no-backup: this preserves the local data volume.
  runSupabase(["stop"]);
} else {
  // The release-check project is disposable by design: --no-backup here
  // discards its volume completely so every release:check run starts from
  // zero. This never runs against the canonical project - the workdir
  // passed is always the separate .release-check/ directory.
  runSupabase(["stop", "--workdir", releaseCheckWorkdirPath(), "--no-backup"]);
  destroyReleaseCheckWorkdir();
}
