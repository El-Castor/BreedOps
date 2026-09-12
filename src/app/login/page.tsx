export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <section>
        <h1>BreedOps</h1>
        <p>Connectez-vous avec votre compte d’équipe.</p>
      </section>
      <form className="card form login-card" action="/auth/login" method="post">
        <h2>Connexion</h2>
        {error && (
          <p role="alert">
            {error === "membership"
              ? "Aucune appartenance active à une équipe. Contactez votre administrateur."
              : "Connexion impossible. Vérifiez vos identifiants et réessayez."}
          </p>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
          />
        </label>
        <label>
          Mot de passe
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
        <button type="submit">Se connecter</button>
      </form>
    </main>
  );
}
