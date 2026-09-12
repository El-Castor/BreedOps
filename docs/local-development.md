# Local development and validation

Use Node 20.20.2 with npm 10.8.2 (validated in Conda `breedops-dev`) and Docker.
Run commands from the Git root. Do not use another project's database.

```sh
conda activate breedops-dev
npm ci
npm run db:start
npm run local:configure
npm run build
npm run start -- --hostname 127.0.0.1 --port 3107
```

Open http://localhost:3107. Supabase uses API port 55421 and database port 55422.
CLI 2.75.0 is pinned by the scripts. Initial startup applies migrations 000001–000005
to a new local database; demo seeding is disabled. Never reset a retained database
containing user records. `supabase/seed.sql` is optional synthetic demo material,
not a prerequisite for the application or tests.

`local:configure` writes `.env.local` without overwriting an existing file and stores
privileged local test configuration in `.local/test-backend.json`, both Git-ignored.
The application uses only the anonymous/public API key and the authenticated user's
session. Never put a service-role credential in a NEXT_PUBLIC variable or source file.
These local generated keys are not hosted credentials.

## Accounts and current scope

V1 roles are system_admin, team_admin and user. Each profile has one team, and
program access inherits the team. A valid Auth account without an active application
profile/team is rejected. There is no fake identity fallback and no public role selector.
Initial local bootstrap is an explicitly approved operator-only action. Run
`npm run local:provision-admin` in an interactive terminal after `local:configure`;
the password is hidden and no credential is written by the script. It creates exactly
one team, Auth account, and system_admin profile, rolling back partial creation on error.
Do not use this local-only command against hosted environments. Tests create
temporary synthetic accounts only. Business modules are visibly unavailable until
their persisted workflows pass validation. The historical demo is preserved under
`src/demo/` but is not served by any application route.

## Validation

With the production server running on port 3107:

```sh
npm test
npm run test:rls
npm run typecheck
npm run lint
npm run format:check
npm audit
```

Unit tests can run without the backend using `npm run test:unit`.
HTTP integration tests require local configuration and the running production app.
They create randomly identified synthetic users/teams and clean them up afterward.
RLS tests run inside a transaction and roll back. Neither suite supports hosted targets.
No Playwright configuration existed at V1.1; HTTP tests validate real session cookies
and native Server Actions, including stale admin forms after role revocation.

The production build currently reports Supabase Edge-bundle Node API warnings.
Login, refresh-by-page-request and logout HTTP checks passed on that build; realtime
subscriptions are not part of this slice. Cookies are HttpOnly, SameSite=Lax and Secure
in production. Hosted use requires HTTPS and APP_ORIGIN set to the exact application
origin. Local validation uses the localhost loopback origin.

Technical references: [Supabase cookie-based SSR](https://supabase.com/docs/guides/auth/server-side)
and [server identity validation](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs).
