"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createManagedUser,
  inviteManagedUser,
  resetManagedUserPassword,
  updateManagedUser,
} from "@/lib/user-management";

function string(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}
function done(message: string): never {
  revalidatePath("/app/admin/users");
  redirect(`/app/admin/users?success=${encodeURIComponent(message)}`);
}

export async function inviteUser(form: FormData) {
  await inviteManagedUser({
    email: string(form, "email"),
    displayName: string(form, "display_name"),
    role: string(form, "role"),
    organizationId: string(form, "organization_id"),
  });
  done("Invitation envoyée.");
}
export async function createUser(form: FormData) {
  await createManagedUser({
    email: string(form, "email"),
    displayName: string(form, "display_name"),
    password: string(form, "password"),
    role: string(form, "role"),
    organizationId: string(form, "organization_id"),
  });
  done("Utilisateur créé.");
}
export async function updateUser(form: FormData) {
  await updateManagedUser({
    userId: string(form, "user_id"),
    displayName: string(form, "display_name"),
    role: string(form, "role"),
    organizationId: string(form, "organization_id"),
    isActive: string(form, "is_active") === "true",
  });
  done("Utilisateur mis à jour.");
}
export async function resetUserPassword(form: FormData) {
  await resetManagedUserPassword({
    userId: string(form, "user_id"),
    password: string(form, "password"),
  });
  done("Mot de passe réinitialisé.");
}
