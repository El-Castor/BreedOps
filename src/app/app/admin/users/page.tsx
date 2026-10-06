import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { requireAdministrator } from "@/lib/auth";
import { listManagedUsers, listOrganizations } from "@/lib/user-management";
import { updateTeamName } from "../../actions";
import {
  createUser,
  inviteUser,
  resetUserPassword,
  updateUser,
} from "./actions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const identity = await requireAdministrator();
  const [users, organizations, params] = await Promise.all([
    listManagedUsers(),
    listOrganizations(),
    searchParams,
  ]);
  const roles =
    identity.profile.role === "system_admin"
      ? ["user", "team_admin", "system_admin"]
      : ["user"];
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Utilisateurs" }]}
      />
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs"
        description="Invitez, affectez et administrez les comptes autorisés pour votre périmètre."
      />
      {params.success && <p role="status">{params.success}</p>}
      {identity.profile.role === "team_admin" && (
        <form action={updateTeamName} className="card form" data-action="team">
          <h2>Nom de l’équipe</h2>
          <label>
            Nom
            <input
              name="name"
              defaultValue={identity.team.name}
              required
              maxLength={120}
            />
          </label>
          <button>Mettre à jour l’équipe</button>
        </form>
      )}
      <section className="grid-2">
        <ActionForm
          action={inviteUser}
          className="card form"
          actionName="invite-user"
          submitLabel="Inviter l’utilisateur"
        >
          <h2>Inviter un utilisateur</h2>
          <UserFields organizations={organizations} roles={roles} />
        </ActionForm>
        <ActionForm
          action={createUser}
          className="card form"
          actionName="create-user"
          submitLabel="Créer l’utilisateur"
        >
          <h2>Créer directement</h2>
          <UserFields organizations={organizations} roles={roles} />
          <label>
            Mot de passe temporaire
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
        </ActionForm>
      </section>
      <section className="card">
        <h2>Comptes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle / équipe</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th>Création</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName || "—"}</td>
                  <td>{user.email}</td>
                  <td>
                    {user.role ?? "—"}
                    <br />
                    <small>{user.organizationName ?? "Non affecté"}</small>
                  </td>
                  <td>
                    <StatusBadge
                      tone={
                        user.status === "active"
                          ? "success"
                          : user.status === "pending_assignment"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {user.status}
                    </StatusBadge>
                  </td>
                  <td>{formatDate(user.lastSignInAt)}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <ActionForm
                      action={updateUser}
                      className="form compact"
                      actionName="update-user"
                      submitLabel="Enregistrer"
                      resetOnSuccess={false}
                    >
                      <input type="hidden" name="user_id" value={user.id} />
                      <input
                        name="display_name"
                        defaultValue={user.displayName || user.email}
                        required
                        maxLength={120}
                      />
                      <select name="role" defaultValue={user.role ?? "user"}>
                        {roles.map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                      <select
                        name="organization_id"
                        defaultValue={user.organizationId ?? ""}
                        required
                      >
                        <option value="" disabled>
                          Affecter une équipe
                        </option>
                        {organizations.map((organization) => (
                          <option key={organization.id} value={organization.id}>
                            {organization.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name="is_active"
                        defaultValue={
                          user.status === "active" ? "true" : "false"
                        }
                      >
                        <option value="true">Actif</option>
                        <option value="false">Désactivé</option>
                      </select>
                    </ActionForm>
                    {user.role && (
                      <ActionForm
                        action={resetUserPassword}
                        className="form compact"
                        actionName="reset-user-password"
                        submitLabel="Réinitialiser le mot de passe"
                      >
                        <input type="hidden" name="user_id" value={user.id} />
                        <input
                          name="password"
                          type="password"
                          minLength={8}
                          placeholder="Nouveau mot de passe"
                          required
                          autoComplete="new-password"
                        />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.length && (
            <EmptyState
              title="Aucun utilisateur"
              message="Invitez ou créez le premier compte de cette équipe."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function UserFields({
  organizations,
  roles,
}: {
  organizations: { id: string; name: string }[];
  roles: string[];
}) {
  return (
    <>
      <label>
        Email
        <input name="email" type="email" required maxLength={254} />
      </label>
      <label>
        Nom affiché
        <input name="display_name" required maxLength={120} />
      </label>
      <label>
        Rôle
        <select name="role">
          {roles.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label>
        Équipe
        <select name="organization_id" required>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Jamais";
}
