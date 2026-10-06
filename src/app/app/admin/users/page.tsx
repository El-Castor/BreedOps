import { ActionForm } from "@/components/action-form";
import {
  ActionMenu,
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  PageNotice,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";

const roleLabels: Record<string, string> = {
  system_admin: "Administrateur système",
  team_admin: "Administrateur d’équipe",
  user: "Membre",
};
const statusLabels: Record<
  string,
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  active: { label: "Actif", tone: "success" },
  pending_assignment: { label: "En attente d’affectation", tone: "warning" },
  disabled: { label: "Désactivé", tone: "neutral" },
};
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
      {params.success && <PageNotice>{params.success}</PageNotice>}
      <section className="section-block">
        <SectionHeader
          title="Comptes"
          description={`${users.length} compte${users.length > 1 ? "s" : ""} dans votre périmètre. Utilisez ⋯ pour modifier un compte.`}
        />
        <Card className="flush">
          {users.length ? (
            <DataTable label="Comptes">
              <table>
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Rôle</th>
                    <th>Équipe</th>
                    <th>Statut</th>
                    <th>Dernière connexion</th>
                    <th>Création</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const status = statusLabels[user.status] ?? {
                      label: user.status,
                      tone: "neutral" as const,
                    };
                    return (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.displayName || "—"}</strong>
                          <span className="secondary-line">{user.email}</span>
                        </td>
                        <td>
                          {user.role ? roleLabels[user.role] ?? user.role : "—"}
                        </td>
                        <td>{user.organizationName ?? "Non affecté"}</td>
                        <td>
                          <StatusBadge tone={status.tone}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className="num">{formatDate(user.lastSignInAt)}</td>
                        <td className="num">{formatDate(user.createdAt)}</td>
                        <td className="cell-actions">
                          <ActionMenu label={`Gérer ${user.email}`} wide>
                            <p className="menu-label">Compte</p>
                            <ActionForm
                              action={updateUser}
                              className="form compact"
                              actionName={`update-user-${user.id}`}
                              submitLabel="Enregistrer"
                              resetOnSuccess={false}
                            >
                              <input
                                type="hidden"
                                name="user_id"
                                value={user.id}
                              />
                              <label>
                                Nom affiché
                                <input
                                  name="display_name"
                                  defaultValue={user.displayName || user.email}
                                  required
                                  maxLength={120}
                                />
                              </label>
                              <div className="fields-2">
                                <label>
                                  Rôle
                                  <select
                                    name="role"
                                    defaultValue={user.role ?? "user"}
                                  >
                                    {roles.map((role) => (
                                      <option key={role} value={role}>
                                        {roleLabels[role] ?? role}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Statut
                                  <select
                                    name="is_active"
                                    defaultValue={
                                      user.status === "active"
                                        ? "true"
                                        : "false"
                                    }
                                  >
                                    <option value="true">Actif</option>
                                    <option value="false">Désactivé</option>
                                  </select>
                                </label>
                              </div>
                              <label>
                                Équipe
                                <select
                                  name="organization_id"
                                  defaultValue={user.organizationId ?? ""}
                                  required
                                >
                                  <option value="" disabled>
                                    Affecter une équipe
                                  </option>
                                  {organizations.map((organization) => (
                                    <option
                                      key={organization.id}
                                      value={organization.id}
                                    >
                                      {organization.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </ActionForm>
                            {user.role && (
                              <>
                                <div className="menu-separator" />
                                <p className="menu-label">Mot de passe</p>
                                <ActionForm
                                  action={resetUserPassword}
                                  className="form compact"
                                  actionName={`reset-user-password-${user.id}`}
                                  submitLabel="Réinitialiser le mot de passe"
                                >
                                  <input
                                    type="hidden"
                                    name="user_id"
                                    value={user.id}
                                  />
                                  <label>
                                    Nouveau mot de passe
                                    <input
                                      name="password"
                                      type="password"
                                      minLength={8}
                                      required
                                      autoComplete="new-password"
                                    />
                                  </label>
                                </ActionForm>
                              </>
                            )}
                          </ActionMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              title="Aucun utilisateur"
              message="Invitez ou créez le premier compte de cette équipe."
            />
          )}
        </Card>
      </section>
      <section className="section-block">
        <SectionHeader
          eyebrow="Accès"
          title="Ajouter un compte"
          description="L’invitation envoie un lien par e-mail ; la création directe définit un mot de passe temporaire."
        />
        <div className="grid-2">
          <ActionForm
            action={inviteUser}
            className="card form"
            actionName="invite-user"
            submitLabel="Inviter l’utilisateur"
          >
            <h3>Inviter un utilisateur</h3>
            <UserFields organizations={organizations} roles={roles} />
          </ActionForm>
          <ActionForm
            action={createUser}
            className="card form"
            actionName="create-user"
            submitLabel="Créer l’utilisateur"
          >
            <h3>Créer directement</h3>
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
        </div>
      </section>
      {identity.profile.role === "team_admin" && (
        <form action={updateTeamName} className="card form" data-action="team">
          <h3>Nom de l’équipe</h3>
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
            <option key={role} value={role}>
              {roleLabels[role] ?? role}
            </option>
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
