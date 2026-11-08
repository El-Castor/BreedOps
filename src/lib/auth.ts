import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { z } from "zod";

const profileSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  role: z.enum(["system_admin", "team_admin", "user"]),
  display_name: z.string().nullable(),
});

interface ResolvedIdentity {
  client: Awaited<ReturnType<typeof createClient>>;
  user: User;
  profile: z.infer<typeof profileSchema>;
  team: { id: string; name: string };
}

/** Same resolution `requireIdentity()` performs, but returns a discriminated
 * result instead of calling `redirect()` - `redirect()` throws a Next.js
 * page/server-action-specific signal that is the wrong contract for a JSON
 * API route handler (src/app/api/offline-sync/route.ts), which must return
 * a structured AUTH_REQUIRED response of its own instead. Pages and server
 * actions should keep using `requireIdentity()` below; this is for route
 * handlers only. `reason` mirrors the two distinct redirect cases
 * `requireIdentity()` already made (no session vs. no active membership) so
 * a caller can tell them apart without duplicating the lookup. */
export async function resolveIdentity(): Promise<
  | ({ ok: true } & ResolvedIdentity)
  | { ok: false; reason: "unauthenticated" | "membership" }
> {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return { ok: false, reason: "unauthenticated" };
  const { data } = await client
    .from("profiles")
    .select("id,user_id,organization_id,role,display_name")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: "membership" };
  const { data: team } = await client
    .from("organizations")
    .select("id,name")
    .eq("id", parsed.data.organization_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!team) return { ok: false, reason: "membership" };
  return { ok: true, client, user, profile: parsed.data, team };
}

export async function requireIdentity(): Promise<ResolvedIdentity> {
  const identity = await resolveIdentity();
  if (!identity.ok) {
    redirect(
      identity.reason === "membership" ? "/login?error=membership" : "/login",
    );
  }
  return {
    client: identity.client,
    user: identity.user,
    profile: identity.profile,
    team: identity.team,
  };
}

export async function requireAdministrator() {
  const identity = await requireIdentity();
  if (identity.profile.role === "user") redirect("/app?error=forbidden");
  return identity;
}
