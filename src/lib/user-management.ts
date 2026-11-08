import "server-only";
import { z } from "zod";
import { requireAdministrator } from "./auth";
import { createAdminClient } from "./supabase/admin";

export const roleSchema = z.enum(["system_admin", "team_admin", "user"]);
const userInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  role: roleSchema,
  organizationId: z.string().uuid(),
});

type Identity = Awaited<ReturnType<typeof requireAdministrator>>;
type AuditValues = Record<string, unknown> | null;

function relatedOrganizationName(value: unknown): string | null {
  if (Array.isArray(value))
    return typeof value[0]?.name === "string" ? value[0].name : null;
  if (value && typeof value === "object" && "name" in value)
    return typeof value.name === "string" ? value.name : null;
  return null;
}

function assertScope(
  identity: Identity,
  role: z.infer<typeof roleSchema>,
  organizationId: string,
) {
  if (identity.profile.role === "system_admin") return;
  if (role !== "user" || organizationId !== identity.profile.organization_id)
    throw new Error("Action non autorisée pour cette équipe ou ce rôle.");
}

async function audit(
  identity: Identity,
  targetUserId: string,
  organizationId: string | null,
  action: string,
  oldValues: AuditValues = null,
  newValues: AuditValues = null,
) {
  const { error } = await identity.client.rpc("record_user_admin_event", {
    target_user_id: targetUserId,
    target_organization_id: organizationId,
    event_action: action,
    previous_values: oldValues,
    resulting_values: newValues,
  });
  if (error) throw new Error("La journalisation de sécurité a échoué.");
}

export async function listManagedUsers() {
  const identity = await requireAdministrator();
  const admin = createAdminClient();
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 100) break;
  }
  const { data: profiles, error } = await admin
    .from("profiles")
    .select(
      "id,user_id,organization_id,display_name,role,is_active,created_at,organizations(id,name)",
    )
    .is("deleted_at", null);
  if (error) throw error;
  const profileByUser = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, profile]),
  );
  return users
    .map((user) => ({ user, profile: profileByUser.get(user.id) ?? null }))
    .filter(({ profile }) =>
      identity.profile.role === "system_admin"
        ? true
        : profile?.organization_id === identity.profile.organization_id,
    )
    .map(({ user, profile }) => ({
      id: user.id,
      email: user.email ?? "",
      displayName:
        profile?.display_name ?? user.user_metadata?.display_name ?? "",
      role: profile?.role ?? null,
      organizationId: profile?.organization_id ?? null,
      organizationName: relatedOrganizationName(profile?.organizations),
      status: profile
        ? profile.is_active
          ? "active"
          : "disabled"
        : "pending_assignment",
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: user.created_at,
    }));
}

export async function inviteManagedUser(input: unknown) {
  const identity = await requireAdministrator();
  const values = userInputSchema.parse(input);
  assertScope(identity, values.role, values.organizationId);
  const admin = createAdminClient();
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("Configuration serveur incomplète.");
  const invitation = await admin.auth.admin.inviteUserByEmail(values.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
    data: { display_name: values.displayName },
  });
  if (invitation.error) throw new Error("Invitation impossible.");
  const userId = invitation.data.user.id;
  const profile = await admin.from("profiles").insert({
    user_id: userId,
    organization_id: values.organizationId,
    display_name: values.displayName,
    role: values.role,
    is_active: true,
  });
  if (profile.error) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error("Invitation annulée car le profil n’a pas pu être créé.");
  }
  try {
    await audit(identity, userId, values.organizationId, "user_invited", null, {
      role: values.role,
    });
  } catch (error) {
    await admin.from("profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
  return userId;
}

export async function createManagedUser(input: unknown) {
  const identity = await requireAdministrator();
  const values = userInputSchema
    .extend({ password: z.string().min(8).max(1024) })
    .parse(input);
  assertScope(identity, values.role, values.organizationId);
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email: values.email,
    password: values.password,
    email_confirm: true,
    user_metadata: { display_name: values.displayName },
  });
  if (created.error) throw new Error("Création du compte impossible.");
  const userId = created.data.user.id;
  const profile = await admin.from("profiles").insert({
    user_id: userId,
    organization_id: values.organizationId,
    display_name: values.displayName,
    role: values.role,
    is_active: true,
  });
  if (profile.error) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error("Création annulée car le profil n’a pas pu être créé.");
  }
  try {
    await audit(identity, userId, values.organizationId, "user_created", null, {
      role: values.role,
    });
  } catch (error) {
    await admin.from("profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
  return userId;
}

export async function updateManagedUser(input: unknown) {
  const identity = await requireAdministrator();
  const values = z
    .object({
      userId: z.string().uuid(),
      organizationId: z.string().uuid(),
      role: roleSchema,
      isActive: z.boolean(),
      displayName: z.string().trim().min(1).max(120),
    })
    .parse(input);
  const admin = createAdminClient();
  const currentResult = await admin
    .from("profiles")
    .select("organization_id,role,is_active,display_name")
    .eq("user_id", values.userId)
    .maybeSingle();
  if (currentResult.error) throw currentResult.error;
  const current = currentResult.data;
  if (identity.profile.role !== "system_admin") {
    if (
      !current ||
      current.organization_id !== identity.profile.organization_id ||
      current.role !== "user"
    )
      throw new Error("Action non autorisée.");
    assertScope(identity, values.role, values.organizationId);
  }
  if (values.userId === identity.user.id && !values.isActive)
    throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
  if (!current && identity.profile.role !== "system_admin")
    throw new Error("Action non autorisée.");
  const payload = {
    organization_id: values.organizationId,
    role: values.role,
    is_active: values.isActive,
    display_name: values.displayName,
  };
  const write = current
    ? await admin.from("profiles").update(payload).eq("user_id", values.userId)
    : await admin
        .from("profiles")
        .insert({ user_id: values.userId, ...payload });
  if (write.error) throw new Error("Mise à jour utilisateur impossible.");
  try {
    if (!current || current.is_active !== values.isActive)
      await audit(
        identity,
        values.userId,
        values.organizationId,
        values.isActive ? "user_activated" : "user_deactivated",
        current,
        payload,
      );
    if (current && current.role !== values.role)
      await audit(
        identity,
        values.userId,
        values.organizationId,
        "user_role_changed",
        { role: current.role },
        { role: values.role },
      );
    if (current && current.organization_id !== values.organizationId)
      await audit(
        identity,
        values.userId,
        values.organizationId,
        "user_team_changed",
        { organization_id: current.organization_id },
        { organization_id: values.organizationId },
      );
  } catch (error) {
    if (current)
      await admin.from("profiles").update(current).eq("user_id", values.userId);
    else await admin.from("profiles").delete().eq("user_id", values.userId);
    throw error;
  }
}

export async function resetManagedUserPassword(input: unknown) {
  const identity = await requireAdministrator();
  const values = z
    .object({
      userId: z.string().uuid(),
      password: z.string().min(8).max(1024),
    })
    .parse(input);
  const admin = createAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("organization_id,role")
    .eq("user_id", values.userId)
    .single();
  if (profileResult.error) throw new Error("Utilisateur introuvable.");
  const profile = profileResult.data;
  if (
    identity.profile.role !== "system_admin" &&
    (profile.organization_id !== identity.profile.organization_id ||
      profile.role !== "user")
  )
    throw new Error("Action non autorisée.");
  const result = await admin.auth.admin.updateUserById(values.userId, {
    password: values.password,
  });
  if (result.error) throw new Error("Réinitialisation impossible.");
  try {
    await audit(
      identity,
      values.userId,
      profile.organization_id,
      "admin_password_reset",
    );
  } catch (error) {
    const compensation = await admin.auth.admin.updateUserById(values.userId, {
      ban_duration: "876000h",
    });
    if (compensation.error)
      console.error("Password reset audit and compensation failed", {
        targetUserId: values.userId,
        auditError: error instanceof Error ? error.message : "unknown",
        compensationError: compensation.error.message,
      });
    throw new Error(
      "Le mot de passe a changé mais la journalisation a échoué. Le compte a été désactivé par sécurité.",
    );
  }
}

export async function listOrganizations() {
  const identity = await requireAdministrator();
  const admin = createAdminClient();
  let query = admin
    .from("organizations")
    .select("id,name")
    .is("deleted_at", null)
    .order("name");
  if (identity.profile.role !== "system_admin")
    query = query.eq("id", identity.profile.organization_id);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
