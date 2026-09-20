import Link from "next/link";
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="login">
      <form
        className="card form login-card"
        action="/auth/reset-password"
        method="post"
      >
        <h1>Nouveau mot de passe</h1>
        {params.error && (
          <p role="alert">
            {params.error === "mismatch"
              ? "Les mots de passe ne correspondent pas."
              : "Lien expiré ou invalide."}
          </p>
        )}
        {params.success ? (
          <>
            <p role="status">Mot de passe modifié.</p>
            <Link href="/login">Se connecter</Link>
          </>
        ) : (
          <>
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
            <button>Enregistrer</button>
          </>
        )}
      </form>
    </main>
  );
}
