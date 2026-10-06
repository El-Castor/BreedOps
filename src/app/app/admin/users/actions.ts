"use server";

import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";
import {
  createManagedUser,
  inviteManagedUser,
  resetManagedUserPassword,
  updateManagedUser,
} from "@/lib/user-management";

function string(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}
function done(message: string): ActionState {
  return actionSuccess(message);
}

export async function inviteUser(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await inviteManagedUser({
      email: string(form, "email"),
      displayName: string(form, "display_name"),
      role: string(form, "role"),
      organizationId: string(form, "organization_id"),
    });
    return done("Invitation envoyée.");
  } catch (error) {
    return actionError(error, "Invitation impossible.");
  }
}
export async function createUser(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await createManagedUser({
      email: string(form, "email"),
      displayName: string(form, "display_name"),
      password: string(form, "password"),
      role: string(form, "role"),
      organizationId: string(form, "organization_id"),
    });
    return done("Utilisateur créé.");
  } catch (error) {
    return actionError(error, "Création de l’utilisateur impossible.");
  }
}
export async function updateUser(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateManagedUser({
      userId: string(form, "user_id"),
      displayName: string(form, "display_name"),
      role: string(form, "role"),
      organizationId: string(form, "organization_id"),
      isActive: string(form, "is_active") === "true",
    });
    return done("Utilisateur mis à jour.");
  } catch (error) {
    return actionError(error, "Mise à jour de l’utilisateur impossible.");
  }
}
export async function resetUserPassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await resetManagedUserPassword({
      userId: string(form, "user_id"),
      password: string(form, "password"),
    });
    return done("Mot de passe réinitialisé.");
  } catch (error) {
    return actionError(error, "Réinitialisation du mot de passe impossible.");
  }
}
