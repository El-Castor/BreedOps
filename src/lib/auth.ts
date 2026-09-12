import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { z } from "zod";

const profileSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  role: z.enum(["system_admin", "team_admin", "user"]),
  display_name: z.string().nullable(),
});

export async function requireIdentity() {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const { data } = await client
    .from("profiles")
    .select("id,user_id,organization_id,role,display_name")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) redirect("/login?error=membership");
  const { data: team } = await client
    .from("organizations")
    .select("id,name")
    .eq("id", parsed.data.organization_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!team) redirect("/login?error=membership");
  return { client, user, profile: parsed.data, team };
}

export async function requireAdministrator() {
  const identity = await requireIdentity();
  if (identity.profile.role === "user") throw new Error("Forbidden");
  return identity;
}
