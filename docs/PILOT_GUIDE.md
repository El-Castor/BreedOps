# BreedOps pilot guide

This guide covers the validated local pilot workflow. All records shown by the application
come from local PostgreSQL through Supabase; the application does not require demo data.

## Install and start

1. Install Docker Desktop and activate the validated Node environment: `conda activate breedops-dev`.
2. Run `npm ci`, then `npm run db:start`.
3. Run `npm run local:configure`. If `.env.local` already exists, the script updates the managed values safely.
4. Run `npm run local:provision-admin`. Enter an email, display name, team name, kebab-case team slug and a password of at least eight characters. Password input stays hidden.
5. Run `npm run build`, then `npm run start -- --hostname 127.0.0.1 --port 3107`.
6. Open `http://localhost:3107/login` and sign in with the credentials supplied during provisioning.

Use `npm run local:reset-password` if the local administrator password must be replaced.
Both local credential scripts verify a real Supabase password login before reporting success.

## Users and access

Open **Utilisateurs** as `system_admin` to invite a user or create a local test account.
Assign an existing team and choose `user` unless elevated access is explicitly required.
`team_admin` can manage ordinary users in its own team. Self-signup is disabled by default;
when enabled, it creates a pending identity with no team and no business access until a
`system_admin` assigns and activates it. Invitation and recovery emails appear in local
Mailpit at `http://127.0.0.1:55424`.

## Breeding workflow

1. From **Vue d’ensemble**, create a programme with code, name and species.
2. Choose **Ajouter un parent** and create two distinct parent lines.
3. In **Croisements**, select both parents and record the pollination date.
4. In **Familles**, select the new cross and create its family.
5. In **Lots de graines**, select the cross and family, then record harvest and quantity.
6. In **Germination**, select the lot and enter tested and germinated seed counts. PostgreSQL calculates the rate.

Each completed step immediately populates the selector used by the next step. If a
prerequisite is missing, the page explains it and links to the required action.

## Pedigree

Open **Pedigree** for the active programme. The graph uses persisted parent, cross,
family and seed-lot relations. Drag the canvas to pan; use **Zoom +**, **Zoom −** and
**Ajuster la vue** for navigation. Select a node to center it, show its details and
highlight its connected ancestors and descendants. Editing remains in the programme registers.

## Phenotyping and selection

Open **Phénotypes**, create the initial selection model, then create a phenotype linked
to its family and seed lot. Enter every criterion score in **Nouvelle évaluation**.
PostgreSQL stores criterion scores and calculates the weighted score, normalized score
and automatic decision. The **Classement** table orders persisted evaluations.

## Inventory

Open **Inventaire**, create an article, then create a lot with an initial receipt.
Use **Mouvement traçable** for consumption, receipt, return, destruction or justified
adjustment. Current stock comes from the movement ledger. Lot status shows low-stock and
expiration alerts; direct stock editing is unavailable.

## Operations and dashboard

Open **Opérations**, create an experimental cycle, then create and assign a task with
planned and due dates. Update its status from the task register. List and calendar views
use the same records. Dashboard metrics aggregate real crosses, lots, germination,
phenotypes, inventory alerts and tasks for the selected programme.

## Pilot validation

With the production server running, execute:

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

The default E2E run verifies that self-signup is unavailable. To validate the explicit
opt-in pending-account path, restart the production server with
`ALLOW_SELF_SIGNUP=true`, then run
`ALLOW_SELF_SIGNUP=true npm run test:e2e -- --grep "enabled self signup"`.

Tests use synthetic, randomly identified fixtures and clean them after execution. Do not
run destructive tests against hosted or retained production data.
