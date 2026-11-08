import { runSupabase } from "./lib/supabase-cli.mjs";
import { CANONICAL, currentProfile } from "./lib/stack-identity.mjs";
import { prepareReleaseCheckWorkdir } from "./lib/release-check-workdir.mjs";

// Storage must stay enabled: Plant Media (migration 000018) needs it for the
// private `breedops-media` bucket. The rest of these services are unused by
// BreedOps and only add local startup time.
const exclude = "studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor";

const profile = currentProfile();
if (profile.name === CANONICAL.name) {
  // Default behaviour, unchanged: starts the canonical local BreedOps
  // project defined by supabase/config.toml in this checkout.
  runSupabase(["start", "-x", exclude]);
} else {
  // BREEDOPS_STACK_PROFILE=release-check: build and start a fully separate,
  // disposable Supabase project (own project_id/ports/container/volume) so
  // this never touches the canonical retained stack, which may be running
  // at the same time.
  const workdir = prepareReleaseCheckWorkdir();
  runSupabase(["start", "--workdir", workdir, "-x", exclude]);
}
