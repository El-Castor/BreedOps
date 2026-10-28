import { runSupabase } from "./lib/supabase-cli.mjs";

// Storage must stay enabled: Plant Media (migration 000018) needs it for the
// private `breedops-media` bucket. The rest of these services are unused by
// BreedOps and only add local startup time.
runSupabase([
  "start",
  "-x",
  "studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor",
]);
