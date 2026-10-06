import { execFileSync } from "node:child_process";

// Synthetic test organizations must be fully removed after every run so they
// never accumulate and leak into cross-team views (e.g. a system_admin's
// trait/module library). The service-role Supabase client cannot do this:
// `organizations` has RLS enabled with only SELECT/INSERT/UPDATE policies
// (migration 000003), so a PostgREST DELETE through it silently affects zero
// rows instead of erroring. Deleting directly against the database as the
// Postgres superuser (the same path `scripts/test-rls.mjs` uses) bypasses
// RLS and actually removes the row and its cascaded children.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hardDeleteOrganization(id: string) {
  if (!uuid.test(id)) throw new Error(`Not a UUID: ${id}`);
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_BreedOps",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      input: `DELETE FROM public.organizations WHERE id = '${id}';`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
