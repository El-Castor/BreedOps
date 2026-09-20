import Link from "next/link";
import { requireAdministrator } from "@/lib/auth";
import { listManagedUsers, listOrganizations } from "@/lib/user-management";
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
    <main className="workspace">
      <header>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Utilisateurs</h1>
        </div>
        <div>
          <Link href="/app">Retour à BreedOps</Link>
          <form action="/auth/logout" method="post">
            <button>Déconnexion</button>
          </form>
        </div>
      </header>
      {params.success && <p role="status">{params.success}</p>}
      <section className="grid-2">
        <form
          action={inviteUser}
          className="card form"
          data-action="invite-user"
        >
          <h2>Inviter un utilisateur</h2>
          <UserFields organizations={organizations} roles={roles} />
          <button>Invite user</button>
        </form>
        <form
          action={createUser}
          className="card form"
          data-action="create-user"
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
          <button>Create user</button>
        </form>
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
                  <td>{user.status}</td>
                  <td>{formatDate(user.lastSignInAt)}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <form
                      action={updateUser}
                      className="form compact"
                      data-action="update-user"
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
                      <button>Enregistrer</button>
                    </form>
                    {user.role && (
                      <form
                        action={resetUserPassword}
                        className="form compact"
                        data-action="reset-user-password"
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
                        <button>Reset password</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
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
