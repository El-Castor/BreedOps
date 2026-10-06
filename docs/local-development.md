# Local development and validation

Use Node 20.20.2 with npm 10.8.2 (validated in Conda `breedops-dev`) and Docker.
Run commands from the Git root. Do not use another project's database.

```sh
conda activate breedops-dev
npm ci
npm run db:start
npm run local:configure
npm run local:provision-admin
npm run build
npm run start -- --hostname 127.0.0.1 --port 3107
```

Open http://localhost:3107/login. Supabase uses API port 55421 and database port 55422.
CLI 2.75.0 is pinned by the scripts. Initial startup applies migrations 000001–000013
to a new local database; demo seeding is disabled. Never reset a retained database
containing user records. `supabase/seed.sql` is optional synthetic demo material,
not a prerequisite for the application or tests.

`local:configure` safely updates the required keys in `.env.local` and stores
privileged local test configuration in `.local/test-backend.json`, both Git-ignored.
The service-role credential is available only to server-side user-management code.
Never put it in a `NEXT_PUBLIC_` variable, client component, source file, or browser
payload. `npm run security:client-secrets` verifies the production client artifacts.
These generated local keys are not hosted credentials.

## Accounts and current scope

V1 roles are system_admin, team_admin and user. Each profile has one team, and
program access inherits the team. A valid Auth account without an active application
profile/team is rejected. There is no fake identity fallback and no public role selector.
Initial local bootstrap is an explicitly approved operator-only action. Run
`npm run local:provision-admin` in an interactive terminal after `local:configure`;
the password is hidden and no credential is written by the script. It creates or repairs
the required team, Auth account, and system_admin profile and verifies the password with
a real Supabase sign-in. It is safe to rerun. Use `npm run local:reset-password` for an
existing local administrator; it never prints the supplied password and verifies the
new credential before reporting success.
Do not use this local-only command against hosted environments. Tests create
temporary synthetic accounts only. The five V1 workflows use the local PostgreSQL
backend. The historical demo is preserved under
`src/demo/` but is not served by any application route.

Self-signup is off by default. With `ALLOW_SELF_SIGNUP=true`, a request creates an
unassigned Auth identity only. A pending identity has no `profiles` row, team, active
membership, or business-data access. A `system_admin` completes assignment from
`/app/admin/users`. Invitations and recovery messages are captured by local Mailpit at
http://127.0.0.1:55424.

## Validation

With the production server running on port 3107:

```sh
npm test
npm run test:rls
npm run test:e2e
npm run typecheck
npm run lint
npm run format:check
npm run security:client-secrets
npm audit
```

Unit tests can run without the backend using `npm run test:unit`.
HTTP integration tests require local configuration and the running production app.
They create randomly identified synthetic users/teams and clean them up afterward.
RLS tests run inside a transaction and roll back. Neither suite supports hosted targets.
Playwright Chromium executes the complete login → breeding → phenotyping → inventory
→ task → dashboard → reload → logout/login journey, including the real pedigree and
responsive shell at 1440, 1024 and 768 pixels. HTTP integration tests also validate real session
cookies and native Server Actions, including stale admin forms after role revocation.

Login, refresh-by-page-request and logout checks pass on the production build; realtime
subscriptions are outside V1. Cookies are HttpOnly, SameSite=Lax and Secure
in production. Hosted use requires HTTPS and APP_ORIGIN set to the exact application
origin. Local validation uses the localhost loopback origin.

The production build sends CSP, anti-framing, MIME-sniffing and referrer headers.
HSTS is intentionally omitted from the local HTTP configuration; enable it only at an
HTTPS deployment boundary. The current dependency audit retains findings in build-only
Tailwind/ESLint glob tooling because their advertised fixes require breaking major-version
changes. The validated audit reports 0 critical, 7 high and 2 moderate findings;
compatible `brace-expansion` and `source-map-js` fixes are applied in the lockfile.

Technical references: [Supabase cookie-based SSR](https://supabase.com/docs/guides/auth/server-side)
and [server identity validation](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs).
