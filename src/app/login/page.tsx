import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { safeNextPath } from "@/lib/safe-next-path";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid: "Email ou mot de passe incorrect.",
  disabled: "Compte désactivé. Contactez votre administrateur.",
  unconfirmed: "Compte non confirmé. Consultez votre invitation.",
  expired: "Session expirée. Connectez-vous à nouveau.",
  membership: "Compte en attente d’affectation ou sans équipe active.",
  locked: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
  configuration: "Erreur de configuration serveur.",
  unexpected: "Erreur inattendue. Réessayez.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  // Re-validated here too (defense in depth - the real enforcement is in
  // the POST handler, src/app/auth/login/route.ts): never reflects an
  // attacker-controlled value into the form without first collapsing it
  // to a known-safe /app path.
  const safeNext = safeNextPath(next);
  return (
    <main className="login">
      <section>
        <h1>BreedOps</h1>
        <p>Connectez-vous avec votre compte d’équipe.</p>
      </section>
      <form className="card form login-card" action="/auth/login" method="post">
        <h2>Connexion</h2>
        {error && <p role="alert">{errors[error] ?? errors.unexpected}</p>}
        {safeNext && safeNext !== "/app" && (
          <input type="hidden" name="next" value={safeNext} />
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
        <SubmitButton>Se connecter</SubmitButton>
        <Link href="/forgot-password">Mot de passe oublié ?</Link>
        {process.env.ALLOW_SELF_SIGNUP === "true" && (
          <Link href="/signup">Créer un compte</Link>
        )}
      </form>
    </main>
  );
}
