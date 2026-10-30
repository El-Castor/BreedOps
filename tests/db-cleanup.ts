import { execFileSync } from "node:child_process";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";

// Synthetic test organizations must be fully removed after every run so they
// never accumulate and leak into cross-team views (e.g. a system_admin's
// trait/module library). The service-role Supabase client cannot do this:
// `organizations` has RLS enabled with only SELECT/INSERT/UPDATE policies
// (migration 000003), so a PostgREST DELETE through it silently affects zero
// rows instead of erroring. Deleting directly against the database as the
// Postgres superuser (the same path `scripts/test-rls.mjs` uses) bypasses
// RLS and actually removes the row and its cascaded children.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Throws on a real SQL error (e.g. a constraint this helper doesn't expect)
// and also when the row simply wasn't there to delete -- a cleanup that
// silently removes nothing is exactly the failure mode that let synthetic
// organizations accumulate before migration 000017, so "0 rows" must fail
// loudly here rather than be mistaken for success.
export function hardDeleteOrganization(id: string) {
  if (!uuid.test(id)) throw new Error(`Not a UUID: ${id}`);
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      currentProfile().dbContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-At",
    ],
    {
      // A profile row still referencing this org (e.g. because a caller's
      // own `deleteUser` step did not run or did not actually remove it)
      // would otherwise make the organizations DELETE below fail: the FK's
      // ON DELETE SET NULL action conflicts with the profiles_organization_
      // required CHECK constraint, aborting the whole statement. Clearing
      // any such row explicitly first keeps this cleanup helper reliable
      // regardless of what the caller already did.
      input: `DELETE FROM public.profiles WHERE organization_id = '${id}';
              DELETE FROM public.organizations WHERE id = '${id}' RETURNING id;`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (output.trim() !== id)
    throw new Error(
      `hardDeleteOrganization(${id}) deleted no row -- cleanup did not run, or the organization was already gone`,
    );
}
