import { requireIdentity } from "@/lib/auth";
import { updateDisplayName, updateTeamName } from "./actions";

export default async function Application() {
  const { user, profile, team } = await requireIdentity();
  return (
    <main className="workspace">
      <h1>BreedOps</h1>
      <p>Équipe : {team.name}</p>
      <p>
        {profile.display_name || user.email} — {profile.role}
      </p>
      <form action="/auth/logout" method="post">
        <button>Déconnexion</button>
      </form>
      <form action={updateDisplayName} className="card form">
        <label>
          Nom affiché
          <input
            name="display_name"
            defaultValue={profile.display_name || ""}
            required
            maxLength={120}
          />
        </label>
        <button>Enregistrer mon profil</button>
      </form>
      {profile.role !== "user" && (
        <form action={updateTeamName} className="card form">
          <label>
            Nom de l’équipe
            <input
              name="name"
              defaultValue={team.name}
              required
              maxLength={120}
            />
          </label>
          <button>Enregistrer l’équipe</button>
        </form>
      )}
      <section className="card">
        <h2>Modules métier</h2>
        <p>
          Indisponibles pendant la connexion des parcours à la base de données.
        </p>
      </section>
    </main>
  );
}
