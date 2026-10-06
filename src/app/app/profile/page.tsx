import { Breadcrumbs, PageHeader, StatusBadge } from "@/components/ui";
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
        <p role="alert">
          {params.error === "mismatch"
            ? "Les mots de passe ne correspondent pas."
            : "Modification impossible."}
        </p>
      )}
      {params.success && <p role="status">Mot de passe modifié.</p>}
      <section className="grid-2">
        <section className="card">
          <h2>Identité</h2>
          <dl>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Rôle</dt>
            <dd>
              <StatusBadge>{profile.role}</StatusBadge>
            </dd>
            <dt>Équipe</dt>
            <dd>{team.name}</dd>
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
        </section>
        <section className="card">
          <h2>Sécurité</h2>
          <form action={changePassword} className="form">
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
            <button>Changer le mot de passe</button>
          </form>
          <form action="/auth/logout" method="post">
            <button>Déconnexion</button>
          </form>
        </section>
      </section>
    </div>
  );
}
