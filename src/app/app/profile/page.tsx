import {
  Breadcrumbs,
  Card,
  PageHeader,
  PageNotice,
  StatusBadge,
} from "@/components/ui";

const roleLabels: Record<string, string> = {
  system_admin: "Administrateur système",
  team_admin: "Administrateur d’équipe",
  user: "Membre",
};
import { requireIdentity } from "@/lib/auth";
import { updateDisplayName } from "../actions";
import { changePassword } from "./actions";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { user, profile, team } = await requireIdentity();
  const params = await searchParams;
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Mon profil" }]}
      />
      <PageHeader
        eyebrow="Compte"
        title="Mon profil"
        description="Consultez votre identité, votre périmètre d’accès et vos paramètres de sécurité."
      />
      {params.error && (
        <PageNotice tone="error">
          {params.error === "mismatch"
            ? "Les mots de passe ne correspondent pas."
            : "Modification impossible."}
        </PageNotice>
      )}
      {params.success && <PageNotice>Mot de passe modifié.</PageNotice>}
      <section className="grid-2">
        <Card>
          <h2>Identité</h2>
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Équipe</dt>
              <dd>{team.name}</dd>
            </div>
            <div>
              <dt>Rôle</dt>
              <dd>
                <StatusBadge tone="info">
                  {roleLabels[profile.role] ?? profile.role}
                </StatusBadge>
              </dd>
            </div>
          </dl>
          <form
            action={updateDisplayName}
            className="form"
            data-action="profile"
          >
            <label>
              Nom affiché
              <input
                name="display_name"
                defaultValue={profile.display_name ?? ""}
                required
                maxLength={120}
              />
            </label>
            <button>Enregistrer</button>
          </form>
        </Card>
        <Card>
          <h2>Sécurité</h2>
          <form action={changePassword} className="form">
            <div className="fields-2">
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
              <label>
                Confirmation
                <input
                  name="confirmation"
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </label>
            </div>
            <p className="form-hint">Au moins huit caractères.</p>
            <button>Changer le mot de passe</button>
          </form>
          <hr />
          <form action="/auth/logout" method="post">
            <button className="secondary">Déconnexion</button>
          </form>
        </Card>
      </section>
    </div>
  );
}
