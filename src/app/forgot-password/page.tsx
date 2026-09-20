import Link from "next/link";
export default async function ForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="login">
      <form
        className="card form login-card"
        action="/auth/forgot-password"
        method="post"
      >
        <h1>Réinitialiser le mot de passe</h1>
        {sent && (
          <p role="status">
            If an account exists for this email, password reset instructions
            have been sent.
          </p>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        <button>Envoyer les instructions</button>
        <Link href="/login">Retour à la connexion</Link>
      </form>
    </main>
  );
}
