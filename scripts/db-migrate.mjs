import { runSupabase } from "./lib/supabase-cli.mjs";

// Applies pending migrations in place. Never resets or drops data, unlike
// `supabase db reset`, which this script intentionally never calls.
runSupabase(["migration", "up", "--local"]);
