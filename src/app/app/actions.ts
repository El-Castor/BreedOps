"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdministrator, requireIdentity } from "@/lib/auth";

export async function updateDisplayName(form: FormData) {
  const { client, profile } = await requireIdentity();
  const displayName = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .parse(form.get("display_name"));
  const { data, error } = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", profile.id)
    .select("id")
    .single();
  if (error || !data) throw new Error("Modification du profil refusée.");
  revalidatePath("/app");
}

export async function updateTeamName(form: FormData) {
  const { client, profile } = await requireAdministrator();
  const name = z.string().trim().min(1).max(120).parse(form.get("name"));
  const { data, error } = await client
    .from("organizations")
    .update({ name })
    .eq("id", profile.organization_id)
    .select("id")
    .single();
  if (error || !data) throw new Error("Modification de l’équipe refusée.");
  revalidatePath("/app");
}
