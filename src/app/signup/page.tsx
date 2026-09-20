import { redirect } from "next/navigation";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  if (process.env.ALLOW_SELF_SIGNUP !== "true") redirect("/login");
  const { sent } = await searchParams;
  return (
    <main className="login">
      <form
        className="card form login-card"
        action="/auth/signup"
        method="post"
      >
        <h1>Créer un compte</h1>
        {sent && (
          <p role="status">
            Si la demande est acceptée, vous recevrez un lien d’activation. Un
            administrateur devra ensuite affecter votre équipe.
          </p>
        )}
        <label>
          Nom affiché
          <input name="display_name" required maxLength={120} />
        </label>
        <label>
          Email
          <input name="email" type="email" required maxLength={254} />
        </label>
        <button>Demander un compte</button>
        <Link href="/login">Retour à la connexion</Link>
      </form>
    </main>
  );
}
