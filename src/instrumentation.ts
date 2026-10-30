// Runs once when the Next.js server process starts (both `next dev` and
// `next start`), before any request is served. Fails fast and loudly on a
// misconfigured production deployment instead of letting it start up and
// fail confusingly on the first request (or, for APP_ORIGIN specifically,
// silently fall back to a same-origin check that can never actually
// protect anything once it's derived from the request itself behind a
// reverse proxy - see src/lib/request-security.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_ORIGIN",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `BreedOps production startup aborted: missing required environment variable(s): ${missing.join(", ")}. ` +
        "See .env.example and docs/ADMIN_GUIDE.md before starting the production server.",
    );
  }
}
