# BreedOps V1 authentication and user management design

## Approved security model

BreedOps keeps exactly three application roles: `system_admin`, `team_admin`,
and `user`. Self-signup is disabled by default. When enabled, signup creates
only a Supabase Auth identity in a pending state. It creates no organization,
does not assign an application role, and cannot access `/app` or business data.
A `system_admin` must assign an existing team, choose a role (default `user`),
and activate the account before a business profile exists.

## Authentication

`/login` is the canonical sign-in page and `http://localhost:3107` is the
canonical local application origin. Technical POST endpoints always redirect
back to a user page with safe error codes. Middleware refreshes sessions and
redirects authenticated users away from `/login`; the server identity boundary
continues to reject missing, inactive, deleted, or unassigned profiles.

Password input in local administration scripts is read one character at a
time. CR and LF terminate input and are never appended. Terminal mode is
restored in `finally`. Provisioning and reset verify the supplied credential
with `signInWithPassword` before reporting success.

## Privileged operations

Supabase Admin API calls run only in server-only modules. The service-role key
is stored in a non-public server environment variable and never enters client
components or browser bundles. Every operation first resolves the current
authenticated profile on the normal session client and enforces role and team
scope. `system_admin` has global scope; `team_admin` can manage only ordinary
users in its own team.

Invites and direct user creation are compensated by deleting the Auth identity
if profile creation fails. Profile activation, role/team changes, invitations,
creation, deactivation, and administrator password resets write an audit row
without credentials or tokens.

## Pending accounts

Pending self-signup identities have no row in `profiles`. Existing RLS helpers
therefore return no team and no role, and business policies deny all access.
The administration page obtains pending Auth identities through the protected
server-only Admin API and lets only a `system_admin` assign and activate them.

## Recovery

Forgot-password responses are generic. Recovery and invitation links return
through an allow-listed callback into `/reset-password`. Password updates require
at least eight characters and matching confirmation. Expired or invalid links
produce a safe user-facing error.

