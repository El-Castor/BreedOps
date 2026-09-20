# BreedOps V1 authentication implementation plan

1. Add tested hidden password input and make local provisioning idempotent.
2. Add a local password-reset command with direct Auth verification.
3. Normalize local origin, redirect allow-list, password minimum, and server-only configuration.
4. Add migration-backed user administration audit/RLS support.
5. Add server-only user administration services and authorization tests.
6. Add login, recovery, reset, signup, profile, and administration pages.
7. Add real Supabase integration and Playwright journeys for AUTH-01 through AUTH-16.
8. Reset and validate the existing administrator, run clean migrations and all final gates.
9. Update documentation, agenda, persistent checkpoint, and create atomic local commits.
