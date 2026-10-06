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
2. Choose **Ajouter un parent** and create two distinct parent lines by name. No code is typed.
3. In **Croisements**, select both parents and record the pollination date.
4. In **Familles**, select the new cross and create its family.
5. In **Lots de graines**, select the cross and family, then record harvest and quantity.
6. In **Germination**, select the lot and enter tested and germinated seed counts. PostgreSQL calculates the rate.

Each completed step immediately populates the selector used by the next step. If a
prerequisite is missing, the page explains it and links to the required action.

## BreedOps codes, archive and restore

PostgreSQL assigns every new parent, cross, family, seed lot and phenotype a stable
BreedOps code: `PROGRAMCODE-P-0001` (parent), `-X-` (cross), `-F-` (family), `-L-`
(seed lot) and `-I-` (phenotype). The prefix is the programme code in upper case with
non-alphanumeric characters removed (`id-t.st` → `IDTST`). Numbering is per programme and
entity type, safe under concurrent creation, and the code cannot be edited afterwards.
The success message shows the code that was assigned. Codes recorded manually before this
change are kept unchanged. Use the name field for descriptive meaning.

Each register row opens the record inspector on click, Enter or Space. The **⋯** menu offers
**Voir le détail**, **Voir le pedigree** and **Archiver** (or **Restaurer** for an archived
record). Archiving hides parents, crosses, families and seed lots from the active registers
and from every selector used to create new relationships, without deleting anything. Existing
crosses, families, lots and the pedigree keep showing archived ancestors. **Afficher les
archives** lists archived records, which can be restored. Any active member of the owning team
can archive or restore; no hard delete is offered.

The inspector groups the real stored fields (identity, lineage, pollination or seed
propagation, metadata), lists linked phenotypes with their latest PostgreSQL-calculated score
and decision, or reports "Pas encore de données phénotypiques." Its **Images** section reads
"Aucune image enregistrée.": image upload and storage are a separate future milestone.

## Pedigree

Open **Pedigree** for the active programme. The graph uses persisted parent, cross,
family and seed-lot relations, including archived records that remain part of the lineage.
Drag the canvas to pan; use **Zoom +**, **Zoom −** and **Ajuster la vue** for navigation.
Select a node (click, Enter or Space) to center it, highlight its connected ancestors and
descendants, and open the same record inspector used by the registers. Editing remains in
the programme registers.

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
npm run test:identity
npm run test:code-concurrency
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
