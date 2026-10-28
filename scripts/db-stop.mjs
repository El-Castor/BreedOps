import { runSupabase } from "./lib/supabase-cli.mjs";

// No --no-backup: this preserves the local data volume.
runSupabase(["stop"]);
