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

1. From **Vue d’ensemble**, create a programme with name, species and campaign. No code
   is typed: PostgreSQL assigns it (`PRG-0001`, ...), shown next to the programme name
   once created.
2. Choose **Ajouter un parent** and create two distinct parent lines by name. No code is typed.
   Optional provenance: accession (external identifier), source (breeder, institute or
   supplier), origin and notes.
3. In **Croisements**, select both parents and record the pollination date.
4. In **Familles**, select the new cross and create its family.
5. In **Lots de graines**, select the cross and family, then record harvest and quantity.
6. In **Germination**, select the lot and enter tested and germinated seed counts. PostgreSQL calculates the rate.

Each completed step immediately populates the selector used by the next step. If a
prerequisite is missing, the page explains it and links to the required action.

## BreedOps codes, archive and restore

PostgreSQL assigns every new programme, parent, cross, family, seed lot and phenotype a
stable BreedOps code. A programme gets `PRG-0001`, `PRG-0002`, ... (globally unique,
sequential, never reused). Its parent, cross, family, seed lot and phenotype codes follow
as `PROGRAMCODE-P-0001` (parent), `-X-` (cross), `-F-` (family), `-L-`
(seed lot) and `-I-` (phenotype). The prefix is the programme code in upper case with
non-alphanumeric characters removed (`PRG-0001` → `PRG0001`; a manually-seeded legacy code
like `id-t.st` → `IDTST`). Numbering is per programme and
entity type, safe under concurrent creation, and the code cannot be edited afterwards.
The success message shows the code that was assigned. Codes recorded manually before this
change are kept unchanged. Use the name field for descriptive meaning.

Each register (data table on the left, creation form on the right) can be searched by code,
name, accession or source, and filtered with **Actifs / Avec archives**. Each row opens the
record inspector on click, Enter or Space. The **⋯** menu offers
**Voir le détail**, **Voir le pedigree** and **Archiver** (or **Restaurer** for an archived
record). Archiving hides parents, crosses, families and seed lots from the active registers
and from every selector used to create new relationships, without deleting anything. Existing
crosses, families, lots and the pedigree keep showing archived ancestors. **Afficher les
archives** lists archived records, which can be restored. Any active member of the owning team
can archive or restore; no hard delete is offered.

The inspector is the scientific record view. It shows an overview (programme, species,
campaign, accession, source, origin, timestamps), the lineage (parents, crosses, families and
lots, with archived relatives marked), pollination and harvest or seed/germination data, the
cross yield computed by PostgreSQL, linked phenotypes with their latest PostgreSQL-calculated
score and decision (or "Pas encore de données phénotypiques."), and notes. **Modifier** edits
a parent's descriptive provenance, a cross's status and notes, or family/lot notes; archived
records must be restored before editing. The **Images** section holds real plant photos —
see **Plant Media** below.

The visual and interaction rules for every screen are defined in `docs/DESIGN_SYSTEM.md`.

## Plant Media

Parent lines, families and seed lots (not crosses) and phenotype evaluations can carry real
photos. Every image is private: it lives in a non-public Supabase Storage bucket and is only
ever served through a short-lived signed URL generated on demand, never stored or cached.

In the record inspector's **Images** section, **Ajouter une image** opens a drawer: choose a
JPEG, PNG or WebP file up to 10 Mo, with a preview before upload, an optional legend, a type
(plant, organ, symptom, seed, harvest, other), a capture date and an optional "Définir comme
image principale". The server re-checks the file's actual content — not just its name or
declared type — and rejects anything else with a precise message
(for example "Format non pris en charge. Utilisez JPEG, PNG ou WebP." or "Le fichier dépasse
la limite de 10 Mo."). A phenotype evaluation's photos open from a compact **Photos** button
next to it in **Phénotypes → Évaluations → Mesures récentes**; they are supplementary
evidence only and never affect the weighted/normalized score, the automatic decision or the
ranking.

Click a thumbnail to open it full-size in a keyboard-accessible viewer (Échap closes it).
**Modifier** edits the legend, type and capture date without re-uploading the file.
**Définir comme image principale** promotes one image to primary for its record; at most one
active image is primary at a time. **Archiver** keeps the image and its history but removes
it from the active gallery; **Afficher les archives** lists archived images, which can be
restored. Archiving the record itself does not remove its photos — they stay fully visible,
including from the archived view — but blocks new uploads until the record is restored.

## Pedigree

Open **Pedigree** for the active programme. The graph uses persisted parent, cross,
family and seed-lot relations, including archived records that remain part of the lineage.
Drag the canvas to pan; use **Zoom +**, **Zoom −** and **Ajuster la vue** for navigation.
Select a node (click, Enter or Space) to center it, highlight its connected ancestors and
descendants, and open the same record inspector used by the registers. Editing remains in
the programme registers.

## Phenotyping and selection

Phenotyping is configurable per programme: a team keeps a reusable **trait library**
(any data type, unit, bounds and selection direction), groups traits into reusable
**modules**, and each programme activates only the modules it follows. The evaluation
form always reflects that programme's active traits — never a fixed list.

1. Open **Phénotypes → Configuration du programme** and **Créer le modèle**: this creates
   the initial "Sélection V1" module (six library traits — Vigueur, Architecture,
   Rendement, Qualité sanitaire, Qualité analytique, Stabilité) and activates it for the
   current programme. Existing teams can instead compose their own traits
   (**Bibliothèque de traits** → **Nouveau trait**) and modules (**Modules** → **Nouveau
   module**), then activate/deactivate them per programme from **Configuration du
   programme**.
2. In **Évaluations**, create a phenotype linked to its family and seed lot, then fill
   **Nouvelle évaluation**: the form renders one row per active trait, grouped by module,
   with the input type, unit and bounds driven by the trait's metadata. A trait with a
   weight in the active selection model also shows its coefficient.
3. PostgreSQL (`submit_trait_evaluation`) validates every value against its trait and
   stores typed observations. When every weighted trait of the active model is measured,
   the same call computes the weighted score, normalized score and automatic decision;
   otherwise the evaluation is kept as an unscored observation. Traits can be reweighted,
   or removed from the score while staying observed, from **Configuration du programme**.
   The **Classement** table orders persisted, scored evaluations.

A `system_admin` account can see every team's trait library and modules, not only its own
(by design). When that makes more than one team visible, **Bibliothèque de traits** and
**Modules** show an extra **Équipe** label next to each row so a legitimate cross-team view
never reads as an unexplained duplicate — e.g. two teams each independently running
**Créer le modèle** both get their own "Sélection V1" module and six traits named
Architecture, Vigueur, etc.; with the team shown, that is immediately legible as two teams,
not one duplicated row. The programme switchers (top bar and in-page) show the programme's
**name** first; its business code is secondary.

**Bibliothèque de traits** and **Modules** default to **Actifs**, matching the same
**Actifs / Avec archives** toggle used by the breeding registers; switch to **Avec
archives** to see archived traits or modules alongside active ones (archived rows keep
their dashed, muted styling). Archiving a trait or module keeps every historical
observation and evaluation that used it fully interpretable; it only stops it from being
offered for new modules or program configuration until restored.

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
npm run test:media
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
