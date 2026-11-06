# Database Design

## Overview

BreedOps uses a PostgreSQL database with Supabase for authentication and storage. The database schema is designed to be normalized and follow the requirements in the project specification.

## Core Entities

### Organizations
Stores information about organizations using the platform.

### Profiles
Stores user profile information linked to Supabase auth users.

### Programs
Manages breeding programs within organizations.

### Team membership
Migration 000003 removes program_members. Each profile belongs to one organization/team;
program access inherits that team. V1 uses system_admin, team_admin and user.
Migration 000005 guards profile identity and privileged-role boundaries and restricts
trigger-only calculation functions. Migrations 000012–000013 implement pending-account
assignment and audited user administration. The final 25 auth/RLS assertions pass locally.

### Parent Lines
Stores information about parent lines used in crosses.

### Crosses
Records crossing events between parent lines.

### Families
Organizes crosses into families.

### Seed Lots
Tracks seed lots generated from families.

### Germination Tests
Records germination test results for seed lots.

### Phenotypes
Stores phenotypic information about individuals.

### Selection Models
Defines models for phenotypic evaluation.

### Selection Criteria
Defines criteria for selection models.

### Phenotype Evaluations
Records evaluations of phenotypes.

### Phenotype Scores
Stores individual scores for each selection criterion.

### Phenotype Traits
Team-scoped, reusable trait definitions (migration 000016): name, code, category, data
type (`numeric`, `integer`, `ordinal`, `categorical`, `boolean`, `date`, `text`), unit,
bounds/precision, allowed values for categorical traits, selection `direction`
(`higher_is_better`, `lower_is_better`, `target_value`, `neutral`) and protocol. Traits are
soft-archived (`is_active`), never deleted through the application, so historical
observations stay interpretable. `UNIQUE(organization_id, code)` prevents duplicate traits
within a team; `code` must be a stable, meaningful slug (e.g. `plant_height`), never a UUID.
A trait is reusable across every module and program of its own team; the application never
clones a trait to let one more program use it or to change its per-program weight — see
`program_phenotyping_modules` and `set_program_trait_weight` below.

Rows are only ever hard-deleted as part of deleting the whole owning `organizations` row
(the application has no "delete trait" action; traits are archived via `is_active`).
Migration 000017 fixes three foreign keys added in 000016
(`phenotyping_module_traits.trait_id`, `phenotype_trait_values.trait_id`,
`selection_criteria.trait_id`) that were missing `ON DELETE CASCADE`, unlike every sibling
column in that migration. Without it, deleting an organization that had ever run
`create_initial_selection_model` failed with a foreign key violation partway through —
which integration/E2E test teardown silently swallowed (see "Test fixture cleanup" below),
leaving the organization, its program, its "Sélection V1" module and six traits behind on
every run. A `system_admin` sees every team by design (`can_access_team()`, migration
000003), so these orphaned per-team copies showed up side by side in the trait/module
library and looked like unexplained duplicates, even though `UNIQUE(organization_id, code)`
/ `UNIQUE(organization_id, name)` held correctly within every individual team the whole
time. The trait and module library tables show an "Équipe" column (only when more than one
team is actually present in what the caller can see) so a legitimate cross-team view never
looks like an unexplained duplicate again.

### Test fixture cleanup
Integration tests and `e2e/critical-v1.spec.ts` each create a throwaway organization via
the service-role Supabase client and must remove it afterwards. `organizations` has RLS
enabled with only SELECT/INSERT/UPDATE policies (migration 000003) and no DELETE policy, by
design (soft delete only), so a PostgREST delete through the service-role client cannot be
relied on for teardown even when it returns no catchable error. `tests/db-cleanup.ts`
(`hardDeleteOrganization`) instead deletes the row directly against the database as the
Postgres superuser — the same privileged path `scripts/test-rls.mjs` already uses — which
now actually cascades, after the 000017 fix above. It also verifies the row actually
disappeared (`DELETE ... RETURNING id` and a check on the result) and throws if not, so a
cleanup that silently removes nothing fails the test loudly instead of leaking another
organization. Every suite that creates a synthetic organization
(`phenotypes.integration.test.ts`, `breeding.integration.test.ts`,
`inventory.integration.test.ts`, `operations.integration.test.ts`,
`auth.integration.test.ts`, `critical-v1.spec.ts`, `auth-management.spec.ts`) now tears it
down through this helper.

### Phenotyping Modules and Module Traits
A phenotyping module (`phenotyping_modules`) is a named, reusable, ordered group of traits
(`phenotyping_module_traits`, one row per trait with `display_order`). Modules compose the
evaluation form; they do not belong to a single program.

### Program Phenotyping Modules
`program_phenotyping_modules` selects which modules (and therefore which traits) a given
program follows, each independently activatable. `program_active_traits(program_id)`
resolves the program's current trait set (active modules → active traits, first module
wins on a conflict) and is the single source the evaluation form and `submit_trait_evaluation`
both read from.

### Phenotype Trait Values
One typed value per trait per evaluation (`phenotype_trait_values`): exactly one of
`numeric_value`, `text_value`, `boolean_value`, `date_value` is set, enforced by PostgreSQL.
Rows are written only by `submit_trait_evaluation` (SECURITY DEFINER; no direct insert
policy), which validates every value against the trait's bounds/precision/allowed values
before insert.

### Inventory Items
Tracks inventory items (reagents, consumables, equipment).

### Inventory Lots
Manages lots of inventory items.

### Inventory Movements
Records movements of inventory items.

### Experimental Workflows: Task Templates, Cycle Templates, Dependencies

Migration 000019 extends the original `task_templates` / `experimental_cycles` / `tasks` /
`task_checklist_items` model (000001, 000011) with reusable, dependency-aware workflow
templates. It never introduces a parallel project-management system: a cycle template is a
blueprint that *generates* ordinary `experimental_cycles` and `tasks` rows; execution always
happens on the real tables, exactly as before.

**Hierarchy**: Program → Experimental Cycle Template (optional) → Experimental Cycle →
Tasks → Task Checklist Items. A cycle can also be created manually, with no template at all
(`source_template_id IS NULL`); manual creation and manual task creation are unchanged and
fully preserved.

#### Task Templates
A reusable, program-scoped definition of one kind of operation (`task_templates`: code, name,
description, `zone`, `priority`, `sop_code`, `expected_deliverable`, `is_active`). Its
`relative_week`/`relative_day` columns are a **legacy hint** for manually assembled
workflows only; the generator never reads them. `task_templates_read` has no `deleted_at`
filter (relaxed the same way breeding entities were in 000014) so an "Afficher les archives"
view can list archived templates; archiving does not touch cycles already generated from it.

#### Task Template Checklist Items
`task_template_checklist_items` (label, `is_required`, `sort_order`) is the SOP/checklist
blueprint for a task template. It is copied into real `task_checklist_items` as a **snapshot**
at instantiation time; editing the template's checklist later never rewrites an
already-generated task's checklist.

#### Experimental Cycle Templates
`experimental_cycle_templates` (program-scoped: code, name, description, `is_active`,
`deleted_at`) is the reusable workflow blueprint itself — e.g. "Androgenèse — Brachypodium".
Archiving (`deleted_at`) blocks new instantiation but never affects cycles already generated.

#### Experimental Cycle Template Tasks
`experimental_cycle_template_tasks` is one ordered step of a template: a `task_template_id`
plus `start_offset_days` (minimum offset from the cycle's start date — dependencies can push a
step later, never earlier), `duration_days`, an optional `default_assigned_to`, and
`sort_order`. `move_cycle_template_task(template_id, step_id, step)` reorders a step by
swapping `sort_order` with its neighbour (the same pattern as `move_module_trait`, 000016).
Unlike historical-record tables, this is a composition/builder table and has a DELETE policy
(removing a step while editing a template is a normal, safe structural edit, matching the
`phenotyping_module_traits` precedent) — its `task_template_id` FK is `ON DELETE CASCADE` so
that deleting an organization/program still cascades cleanly all the way down.

#### Experimental Cycle Template Dependencies / Task Dependencies
`experimental_cycle_template_dependencies` (between two steps of the *same* template) and
`task_dependencies` (between two *real* tasks) both model **finish-to-start-only** edges —
MVP does not implement start-to-start/finish-to-finish/start-to-finish — with an integer
`lag_days >= 0`:

```
successor.planned_date >= predecessor.due_date + 1 + lag_days
```

Both tables reject, via a `BEFORE INSERT OR UPDATE` trigger (`validate_template_dependency` /
`validate_task_dependency`), anything that would break the model's invariants: self-reference
and exact duplicates (`CHECK`/`UNIQUE`), an edge between two different templates, between two
different programs, between two different experimental cycles, to an archived/deleted or
cancelled task, and — using a recursive CTE that computes every template-task/task reachable
**forward** from the successor and checks whether the predecessor is already in that set —
any edge that would close a cycle in the dependency graph. Both tables are composition data
(not historical scientific records) and so, like `experimental_cycle_template_tasks`, carry a
DELETE policy.

#### Scheduling: `compute_cycle_template_schedule`, `instantiate_experimental_cycle`, `recalculate_cycle_schedule`

`compute_cycle_template_schedule(template_id, start_date)` is the **single** SQL function
behind both the read-only schedule preview and real instantiation, so the two can never
diverge. It walks the template's dependency graph in **topological order** (Kahn's algorithm,
via a `pg_temp` working table — never template `sort_order`) and for each step computes:

```
base_start       = cycle_start + start_offset_days
dependency_start = MAX(predecessor.due_date + 1 + lag_days) over all its predecessors
planned_date     = GREATEST(base_start, dependency_start)
due_date         = planned_date + duration_days - 1
```

`instantiate_experimental_cycle(template_id, cycle_name, start_date)` is a single
transactional function: it creates the `experimental_cycles` row (`source_template_id` set),
one `tasks` row per step with its template fields **copied at this moment only** (title,
description, priority, zone, sop_code, expected_deliverable — a snapshot, exactly like
Task Template Checklist Items above), the matching `task_dependencies` edges, and each task's
checklist snapshot, then sets the cycle's `end_date` to the latest generated task's `due_date`.
Either everything is created or nothing is (a plain Postgres transaction) — an unknown,
archived or inaccessible template raises before any row is written.

`recalculate_cycle_schedule(task_id, new_planned_date, new_due_date)` is "Enregistrer et
recalculer les dépendances": it applies the new dates to one task, then walks the *same*
cycle's dependency graph in topological order, moving only the downstream tasks whose computed
`dependency_start` now exceeds their current `planned_date`, while preserving each moved
task's own `duration_days`. A task's own schedule is checked against its *own* predecessors
first. It raises (rolling back the whole call, so nothing is partially applied) if the new
dates would leave it violating its own predecessors, or if propagation would require moving a
task whose `status = 'completed'` — actual completion time is operational history and is never
silently rewritten; the caller must resolve the conflict by hand. Completing a task later or
earlier than planned never itself reshuffles the plan: propagation only happens from this
explicit, user-initiated date change.

Dependency **readiness** (ready / waiting-on-a-dependency / completed / cancelled) is derived
in the application from task status and predecessor statuses, not persisted, and is distinct
from the manual `blocked` task status — a task can be `not_started` while structurally waiting
on a predecessor.

#### `plan_filter` and whole-table `UPDATE`s
This project's Postgres loads the `plan_filter` extension, which rejects any `UPDATE` without
a `WHERE` clause for a non-superuser role — including PostgREST's `authenticated` role, which
is what every RPC above actually executes as. The topological-sort helpers intentionally
recompute an `indegree` column for **every** row of their `pg_temp` working table; that
`UPDATE` carries a harmless `WHERE true` specifically so it still passes under `plan_filter`
when called through the API (a superuser `psql` session does not hit this, which is why it is
easy to miss when first testing a function directly).

### Experimental Cycles
Organizes tasks into experimental cycles. `source_template_id` (nullable, `ON DELETE SET
NULL`) records which cycle template a cycle was generated from, for traceability only —
editing or archiving the template never changes cycles already generated from it. A cycle
created manually (the original, still-supported flow) leaves it `NULL` and keeps supplying
`start_date`/`end_date` directly.

### Tasks
Records specific tasks within experimental cycles, generated from a template or created
manually. `task_template_id` is kept for traceability; `set_task_status()` (000011) is the
only sanctioned path for status changes and was extended (never replaced) in 000019 to reject
`completed` while the task has any incomplete *required* checklist item, with the exact
user-facing message `"Cette tâche comporte encore des contrôles obligatoires non terminés."`
(optional items never block completion). A task's duration is derived from
`due_date - planned_date + 1`, never a separately persisted column.

### Task Checklist Items
Tracks checklist items for tasks; `sort_order` (added in 000019) keeps template-generated and
manually added items in a stable order. `complete_checklist_item(item_id, completed, comment)`
is the only sanctioned way to toggle one: `completed_by`/`completed_at` are always derived
server-side from `auth.uid()`, never trusted from the client.

### Audit Logs
Records all significant actions for audit purposes. There is no direct client INSERT
policy since migration 000012; writes go only through narrowly-scoped `SECURITY DEFINER`
functions. `record_user_admin_event` covers the auth-administration actions;
`record_import_export_event` (000020) covers exactly the `import`/`export` actions
PROMPT.md §13 requires, one row per batch run (not one per imported row). No general
per-row business-data audit facility exists for the breeding/inventory/operations
domains — a pre-existing gap this migration does not attempt to solve beyond its own
two required actions.

### Import / Export (migration 000020)
Adds `tasks.task_code` (the only business-code gap among PROMPT.md §12's seven
idempotency keys — `next_breeding_business_code` extended with entity type `task`,
prefix `T`) and seven `import_*` functions, one per importable entity (parent lines,
crosses, families, seed lots, phenotypes, inventory lots, tasks), same `SECURITY
DEFINER` + explicit `can_write_program`/`can_write_team` re-check idiom as
`create_inventory_lot_with_receipt`/`record_user_admin_event`. Each function takes a
scope id and a JSONB array of rows, re-derives create-vs-update itself from the row's
business code (never trusts a client-supplied decision), and aborts its entire call on
any row that fails an invariant (archived match, unresolved reference, immutable-field
conflict) — a plain Postgres transaction, so a batch is never left half-applied.
Matching is strictly by business code (or, for inventory lots, item name + batch
number); there is no fuzzy matching anywhere. Identity/provenance fields (the code
itself, parent/cross/family/seed-lot/cycle references) are immutable once set — a
later import row that tries to change one is rejected, never silently applied. New
inventory stock always goes through a `receipt` movement (not a direct
`current_quantity`/`initial_quantity` write), exactly like
`create_inventory_lot_with_receipt`. Out of V1 scope, deliberately: germination tests
and phenotype evaluations (server-computed scores) remain manual-entry-only; task
`assigned_to` and status transitions are not importable. Application layer lives in
`src/lib/import-export/` (parser, column-mapping, read-only preview, CSV/XLSX export)
and `src/app/app/import-export/` (the `/app/import-export` page and its Server
Actions/Route Handlers); see that page and `agend.md`'s 2026-10-28 session entry for
the full design and its one documented limitation (preview can't see an archived
business-code match the way the `SECURITY DEFINER` apply functions authoritatively
can, since the normal RLS read policies filter `deleted_at`).

### Business Completion (migration 000022)
Four additive, independent gaps closed; none of migrations 000001-000021 modified.

**Seed lot operational lifecycle** — `seed_lots.status` (present since 000001, previously
always `'active'` and never read or written by the application) is now constrained to
`available`/`quarantined`/`depleted`, validated by the `validate_seed_lot_status_transition`
trigger (`depleted` is terminal). This is a different axis from `genetic_purity_status`
(unchanged) and from archival (`deleted_at`, unchanged) — all three stay independently
visible in the UI. Transitions go through `update_seed_lot_status(target_lot_id, new_status)`,
which records the change in `audit_logs` in the same transaction as the mutation (the same
atomicity pattern as migration 000021's import audit).

**Eliminatory criteria** — `selection_criteria.is_eliminatory`/`eliminatory_threshold`
(present since 000001, previously never read by any calculation) now gate
`refresh_phenotype_evaluation()`: an active criterion whose `raw_score` is below its
`eliminatory_threshold` (a minimum, like every other `minimum_*` column in this schema)
forces `automatic_decision = 'eliminate'`, independent of the weighted score. A missing
score on an active eliminatory criterion is treated as a failure (fail-safe); a criterion
with no threshold configured never eliminates. New columns `phenotype_evaluations.is_eliminated`
and `.elimination_reasons` (one human-readable string per failing criterion) record why.

**Equipment register** — new `equipment` table, organization-scoped like `inventory_items`
(same RLS idiom: `can_access_team` read, `can_write_team` write, no DELETE policy, archival
via `deleted_at` only), but with no quantity or movement ledger — conceptually distinct from
reagent-lot inventory.

**Inventory stock coverage** — new `inventory_item_coverage` view (`security_invoker`, same
convention as `inventory_lot_status`): average weekly consumption over a fixed trailing
90-day window, counting only `movement_type = 'consumption'` (never receipts or
adjustments/destruction/transfer). Returns `NULL` for `average_weekly_consumption`/
`estimated_weeks_remaining` — never a fabricated `0` — when `has_sufficient_data` is false.
`low_coverage` flags under 4 weeks remaining when data is sufficient.

See `agend.md`'s 2026-10-29 "Business Completion" session entry for the full design
rationale, the application-layer changes (dashboard charts/filters, contextual exports,
including the new phenotype-selection-matrix export), and known limitations.

### Media Assets (Plant Media)
`media_assets` (migration 000018) holds metadata for real plant/scientific images attached
to a breeding record; the binary itself lives in the private Supabase Storage bucket
`breedops-media` (`public = false`, 10 MiB limit, `image/jpeg`/`image/png`/`image/webp`
only), created by the migration itself (`INSERT INTO storage.buckets ...`) so it exists
identically on every environment that applies it, local or hosted — never created by hand
in Studio. A signed URL is generated on demand (TTL 300s) and never persisted; no public or
signed URL is ever stored in PostgreSQL.

Supported targets are exactly `parent_line_id`, `family_id`, `seed_lot_id` and
`phenotype_evaluation_id` (crosses are intentionally out of scope). A `CHECK` using
`num_nonnulls()` enforces exactly one target per row. `organization_id`/`program_id` are
never trusted from the client: a `BEFORE INSERT` `SECURITY DEFINER` trigger
(`validate_media_asset_target`) resolves them from the target entity itself and overwrites
whatever the client sent, so a forged or mistaken value cannot attach media to another
team's record. `guard_media_asset_identity` then makes the target and storage identity
immutable after creation (only presentation metadata, primary status and archive state may
change); `created_by` is deliberately excluded from that guard because it is
`ON DELETE SET NULL` against `profiles` — including it there made deleting the author's
profile fail with "immutable" instead of nulling the reference.

At most one *active* (non-archived) image per target may be `is_primary`, enforced by four
partial unique indexes (`WHERE is_primary AND archived_at IS NULL`). `set_media_primary(id)`
(SECURITY INVOKER) does the unset-then-set two-step atomically so it never transiently
violates the index. A `BEFORE INSERT OR UPDATE` trigger clears `is_primary` whenever a row
is archived, so an archived primary image is never left flagged primary and a later restore
never silently re-promotes it — "no primary" is an allowed, temporary state.

Media is archived (`archived_at`/`archived_by`), never hard-deleted: there is no DELETE
policy, matching every other breeding lifecycle table. Archiving the owning breeding entity
does not touch its media; historical images remain fully readable. The authorization model
reuses the existing `can_access_team`/`can_write_team` RLS helpers on `media_assets` itself
— no new role, no separate Storage RLS policy. Storage object operations (upload, signed
URL, delete) always go through the service-role admin client, and only after the metadata
layer's RLS check has already passed; the browser never receives the service-role key.
Storage and Postgres are not transactional with each other: if the metadata insert fails
after a successful upload, the server compensates by deleting the just-uploaded object
(`removeMediaObject`), so no orphan is left behind. `scripts/check-media-orphans.mjs` is a
read-only maintenance check that diffs the bucket's objects against
`media_assets.storage_path` and reports (without deleting) any orphan object or dangling
row.

### Advanced media: acquisition metadata and annotations (V2-03, migration 000026)

Additive only; `000018` and every earlier migration are untouched. Nine new nullable
columns on `media_assets`: `captured_at_time` (an optional companion to the existing
`captured_at` DATE — never reinterprets a historical row, and a CHECK forbids setting it
without a date), `developmental_stage` (a bounded ≤60-character free label, deliberately
not an enum — BreedOps programs span different species, so a single universal growth
ontology would be wrong for most of them), `viewpoint` and `imaging_modality` (controlled
vocabularies — `top`/`side`/`front`/`back`/`macro`/`microscope`/`other` and
`visible`/`fluorescence`/`microscopy`/`scanner`/`other` respectively, both genuinely stable
across every current context, unlike developmental stage), `operator_id` ("image acquired
by", a `profiles` FK distinct from the existing `created_by` — "uploaded by" — `ON DELETE
SET NULL` like `created_by`, and validated same-organization by extending
`validate_media_asset_target()`), and `scale_value`/`scale_unit`/`scale_note` (an optional
physical calibration reference, distinct from the existing pixel `width`/`height`; a CHECK
requires `scale_unit` whenever `scale_value` is set). `EXIF_STATUS=DEFERRED`: no
EXIF-reading dependency was introduced this milestone — every field above is entered
manually, and embedded file metadata was never trustworthy as authoritative scientific
data anyway. Capture-precision (unknown/date/datetime) is never a stored column — it is
derived purely from which of `captured_at`/`captured_at_time` are present, with the
temporal ordering rule (precise timestamp, else capture date, else `created_at` as a
last-resort fallback for undated images — which always trail every dated image in both
sort directions) implemented once in `src/lib/media/temporal.ts`.

`media_annotations` is a new, dedicated, non-destructive overlay model — `point`,
`rectangle` or `text` — over an image; the source Storage object is never touched.
Coordinates are normalized to the original image (`x`/`y`/`width`/`height` ∈ [0,1], never
screen pixels), with CHECK constraints enforcing a rectangle never claims to extend past
the image (`x + width <= 1`, `y + height <= 1`), a point/text carries no width/height, and a
text annotation always has a non-null label. RLS never stores a redundant
`organization_id` on this table (nothing to drift or be spoofed): every policy derives
authorization by joining back to the row's own `media_assets.organization_id` via
`can_access_team`/`can_write_team`. A new annotation may not normally be created once its
underlying media is already archived (`WITH CHECK ... AND ma.archived_at IS NULL` on the
INSERT and UPDATE policies) — existing annotations on media archived afterward remain
fully readable, just no longer writable, until the media is restored.
`guard_media_annotation_identity` mirrors `guard_media_asset_identity`: only
`media_asset_id`, `annotation_type` and `created_at` are immutable after creation: label,
coordinates and archive state may all change.

Temporal comparison (an opt-in "Chronologie et comparaison" view, never the default gallery
grid's own query) reuses the gallery's existing single-target scope for `parent_line`/
`family`/`seed_lot`. For `phenotype_evaluation` it widens to every sibling evaluation
sharing the same `phenotype_id` — the actual stable biological specimen; a single
`phenotype_evaluation` is a scoring *event*, not the specimen itself, audited against this
schema before deciding the widening was scientifically safe to do via the existing FK
rather than inventing a new relation.

### Trait analytics (V2-04, migration 000027)

`analytics_runs` is the only new table: a reproducible provenance record for an explicitly
saved trait-analysis snapshot. It never stores raw observations — `specification` is the
exact, server-validated filter set used (program/trait/date-range/cohort filters),
`result` is a compact structured summary (descriptive stats, QC, eligibility diagnostics,
a bounded outlier list), and both JSONB columns are size-capped at the database level
(`octet_length(...) <= 20000`/`200000`) so a bug can never turn this table into a raw-data
dump. `dataset_fingerprint` is a sha256 hex digest over the canonically-ordered
observation tuples that fed the run (see `src/lib/analytics/fingerprint.ts`); reading a
saved run recomputes the current fingerprint for its own stored specification and flags a
mismatch as stale (`PÉRIMÉE` in the UI) rather than silently presenting it as current.
`organization_id` is re-derived from `program_id` by trigger — the same forged-value
override pattern `media_assets`/`notifications` already use — and `trait_id`/
`secondary_trait_id` are cross-checked to belong to that same organization. There is
deliberately **no UPDATE and no DELETE grant at all** (not merely no policy): a saved
analysis run is a fact about what was computed, when, and from what data; if the question
or the data changes, a new run is created rather than editing an old one in place.

Two new `SECURITY INVOKER` SQL functions are the sole server-side readers every V2-04
chart/table is built from — no action queries `phenotype_trait_values`/
`phenotype_evaluations`/`phenotypes` directly:

- `trait_observation_dataset(...)` returns the canonical per-observation rows for one
  program/trait (plus optional date-range/family/seed-lot/block/replicate/location
  filters and an archived-inclusion flag), capped server-side at 5000 rows
  (`LIMIT LEAST(row_limit, 5000)` — a caller cannot raise the cap) and restricted to
  `numeric`/`integer`/`ordinal` traits only; a categorical/boolean/date/text trait is
  refused at the SQL level, not just in the UI.
- `program_evaluation_dataset(...)` returns every scoring event for the same cohort,
  trait-independent — the real, schema-honest denominator for "missing" (BreedOps does
  not require every evaluation to score every active trait; see `submit_trait_evaluation`,
  migration 000016).

Both are `SECURITY INVOKER`, so the pre-existing RLS policies on all three joined tables
still apply in full underneath; each also carries its own explicit `can_access_program()`
check, the same belt-and-suspenders pattern `program_active_traits()` already uses.

The statistical engine itself (`src/lib/analytics/*`) is plain, dependency-free
TypeScript — no Python subprocess, no new runtime. The one calculation that could be
mistaken for "a mixed model" (repeatability/ICC) is a one-way random-effects ANOVA, which
has an exact closed form (no REML/BLUP iteration); see `docs/ANALYTICS.md` for the full
architecture decision and formula references. Heritability is hard-coded
`NOT_ESTIMABLE` in V2-04: no genotype entity, validated experimental design, or
normalized environment model exists yet to support it (see `docs/ANALYTICS.md` §7).

### Multi-environment & G×E stability (V2-05, migrations 000028-000030)

A normalized model for multi-environment trials (MET), additive only — every existing
`phenotypes` row keeps working unchanged, and raw phenotype/evaluation/trait-value data
is never rewritten. `experimental_cycles` (migration 000001) was audited first and found
unsuitable: it is a scheduling concept (name/dates/status), with no site dimension and no
link to phenotype data at all.

New tables:

- **`sites`** — a normalized physical/organizational location, organization-scoped.
  Distinct from the pre-existing free-text `phenotypes.location`, which is never
  auto-migrated into a site (see the mapping workflow below).
- **`environments`** — one MET environment = one site observed under one campaign/
  management context, program-scoped. `campaign` reuses the exact free-text season/year
  convention already established by `programs.campaign`.
- **`trials`** — a named multi-environment trial, program-scoped: an explicit set of
  environments (`trial_environments`) and entries (`trial_entries`) analyzed together.
- **`trial_environments`** — join table (no own `organization_id`/`program_id`; RLS
  derives scope by joining to `trials`), with a trigger cross-checking the environment's
  own program matches the trial's program.
- **`trial_entries`** — the experimental material compared across a trial's environments.
  `scientific_role` (`genotype`/`family`/`population`/`seed_lot`/`other`) is always an
  explicit, user-stated classification — never inferred from which optional lineage FK
  (`parent_line_id`/`family_id`/`seed_lot_id`) happens to be set. Only a `genotype`-role
  entry may ever be labelled G×E in the UI; every other role is Entry×Environment.
- **`phenotypes.environment_id`/`phenotypes.trial_entry_id`** (nullable, additive) — the
  only new columns on an existing table. A `validate_phenotype_met_links` trigger
  enforces that both resolve to the phenotype's own program, and that when both are set,
  the environment is actually one of the entry's own trial's `trial_environments`.

All four new tables' `*_read` SELECT policies deliberately do **not** filter
`deleted_at IS NULL` (`sites_read`/`environments_read`/`trials_read`/`trial_entries_read`
check only `can_access_team`/`can_access_program`) — matching the established convention
(`equipment`/`task_templates`/`selection_criteria`, see migration 000022 §E): `deleted_at`
is lifecycle state, not an authorization boundary, and PostgreSQL re-checks a table's
SELECT policy against the post-UPDATE row for a plain `UPDATE ... SET deleted_at = now()`
with no explicit `WITH CHECK` override of it — a `deleted_at IS NULL` SELECT policy would
otherwise reject the archive operation itself. An archived row stays readable so it can be
inspected and restored, same as every other reversible BreedOps lifecycle record.

`analytics_runs.analysis_type` gains `'multi_environment'` (sibling of `'trait_intelligence'`,
never a replacement); `trial_id` is nullable and required exactly when
`analysis_type = 'multi_environment'` (enforced by the replaced
`validate_analytics_run_scope()`), with its program cross-checked against the run's own
`program_id`. The engine/version provenance reuses the already-generic
`engine_name`/`engine_version` columns — `breedops-r-mixed-models`/`sommer`'s version for a
completed `met_base_v1` run, `metan`'s for AMMI/WAASB/GGE/Finlay-Wilkinson.

New `SECURITY INVOKER` SQL functions:

- **`met_observation_dataset(target_trial_id, target_trait_id, include_archived, row_limit,
  target_evaluation_date)`** — the one server-side reader every V2-05 analysis is built
  from, mirroring `trait_observation_dataset`'s filter-before-cap pattern exactly (`LIMIT
  LEAST(row_limit, 5001)`, a caller can never raise it; a result of exactly `row_limit`
  rows is the deterministic `dataset_too_large` signal, never a silently truncated
  dataset). `target_evaluation_date` (migration 000031, independent review hardening)
  restricts to one explicit measurement occasion; required whenever the same phenotype
  has more than one dated evaluation for this trait
  (`src/lib/met/design-summary.ts`'s `detectMetLongitudinalAmbiguity`), so repeated
  longitudinal measurements of the same Entry×Environment unit are never silently pooled
  as if they were independent replicates.
- **`legacy_phenotype_location_summary(target_program_id)` /
  `legacy_phenotype_material_summary(target_program_id)`** (migration 000029) — read-only
  summaries of which free-text `location` values and `(family_id, seed_lot_id)`
  combinations still have no `environment_id`/`trial_entry_id`, for the mapping workflow
  below to offer as candidates.

New `SECURITY DEFINER` functions, each with an explicit `can_write_program()` check (the
same belt-and-suspenders convention `import_phenotypes` already uses):

- **`map_legacy_location_to_environment(target_program_id, target_location,
  target_environment_id)` / `map_legacy_material_to_trial_entry(target_program_id,
  target_family_id, target_seed_lot_id, target_trial_entry_id)`** (migration 000029) — the
  legacy mapping workflow itself. Legacy `location`/`family_id`/`seed_lot_id` are never
  auto-interpreted as a normalized environment/entry (B8/B41): a human picks one explicit
  mapping, applied in bulk to every still-unmapped phenotype sharing that exact value.
  Never overwrites an existing mapping (only touches rows where the target FK is still
  `NULL`). The material mapping skips (rather than aborting the whole batch on) any row
  whose existing `environment_id` is not part of the target trial — `validate_phenotype_
  met_links` would otherwise reject that one row and roll back the entire `UPDATE`.
- **`import_met_observations(target_program_id, target_trial_id, target_trait_id, rows)`**
  (migration 000030) — bulk CSV import of MET *observations* into an already-defined
  trial, following `import_phenotypes`' exact convention (one JSONB rows array, any row
  failing an invariant `RAISE`s and aborts the whole import, idempotent on
  `phenotype_code`). Never creates a `trial_entry` or `environment` from the file — both
  must already exist; `entry_code`/`environment_code` are resolved against the target
  trial only. On re-import, `entry_code`/`environment_code` are treated as immutable
  identity fields (same rule `import_phenotypes` already applies to family/seed lot) — a
  row may only update its numeric value, never silently move to a different
  entry/environment.

The statistical engine is a server-only R runtime (`analytics-r/`, driven from Node via
`src/lib/met/r-runner.ts`) — see `docs/DEPLOYMENT_GUIDE.md` for the subprocess
environment/renv setup and the full architecture rationale. No REML/BLUP/mixed-model math
is hand-rolled in TypeScript. Heritability remains out of scope for V2-05 for the same
reason as V2-04 (no validated genotype-identity/replication model); the factor-analytic
MET model is formally **deferred** (not implemented) — see `agend.md`'s decision log for
the full justification.

## Relationships

```mermaid
erDiagram
    ORGANIZATION ||--o{ PROGRAM : contains
    PROGRAM ||--o{ PARENT_LINE : contains
    PROGRAM ||--o{ CROSS : contains

    PARENT_LINE ||--o{ CROSS : female_parent
    PARENT_LINE ||--o{ CROSS : male_parent

    CROSS ||--o{ FAMILY : produces
    FAMILY ||--o{ SEED_LOT : produces
    SEED_LOT ||--o{ GERMINATION_TEST : receives

    SEED_LOT ||--o{ PHENOTYPE : generates
    PHENOTYPE ||--o{ PHENOTYPE_EVALUATION : receives
    PHENOTYPE_EVALUATION ||--o{ PHENOTYPE_SCORE : contains
    PHENOTYPE_EVALUATION ||--o{ PHENOTYPE_TRAIT_VALUE : contains

    ORGANIZATION ||--o{ PHENOTYPE_TRAIT : defines
    ORGANIZATION ||--o{ PHENOTYPING_MODULE : defines
    PHENOTYPING_MODULE ||--o{ PHENOTYPE_TRAIT : groups
    PROGRAM ||--o{ PHENOTYPING_MODULE : follows
    PHENOTYPE_TRAIT ||--o{ PHENOTYPE_TRAIT_VALUE : measures
    PHENOTYPE_TRAIT ||--o{ SELECTION_CRITERION : weights

    ORGANIZATION ||--o{ INVENTORY_ITEM : manages
    INVENTORY_ITEM ||--o{ INVENTORY_LOT : contains
    INVENTORY_LOT ||--o{ INVENTORY_MOVEMENT : tracks

    PROGRAM ||--o{ TASK_TEMPLATE : defines
    PROGRAM ||--o{ EXPERIMENTAL_CYCLE_TEMPLATE : defines
    TASK_TEMPLATE ||--o{ TASK_TEMPLATE_CHECKLIST_ITEM : defines
    EXPERIMENTAL_CYCLE_TEMPLATE ||--o{ EXPERIMENTAL_CYCLE_TEMPLATE_TASK : orders
    EXPERIMENTAL_CYCLE_TEMPLATE_TASK }o--|| TASK_TEMPLATE : uses
    EXPERIMENTAL_CYCLE_TEMPLATE_TASK ||--o{ EXPERIMENTAL_CYCLE_TEMPLATE_DEPENDENCY : links
    EXPERIMENTAL_CYCLE_TEMPLATE ||--o{ EXPERIMENTAL_CYCLE : generates

    PROGRAM ||--o{ EXPERIMENTAL_CYCLE : contains
    EXPERIMENTAL_CYCLE ||--o{ TASK : generates
    TASK ||--o{ TASK_DEPENDENCY : links
    TASK ||--o{ TASK_CHECKLIST_ITEM : requires

    PARENT_LINE ||--o{ MEDIA_ASSET : illustrates
    FAMILY ||--o{ MEDIA_ASSET : illustrates
    SEED_LOT ||--o{ MEDIA_ASSET : illustrates
    PHENOTYPE_EVALUATION ||--o{ MEDIA_ASSET : illustrates
```

## Data Types and Constraints

All tables follow the naming conventions:
- `id` (UUID)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `created_by` (UUID)
- `updated_by` (UUID)
- `deleted_at` (timestamp for soft deletes)
- `organization_id` (UUID)
- `program_id` (UUID, when relevant)

## Security and RLS

Row-Level Security (RLS) policies are implemented on all tables to ensure proper data isolation:
- Users can only access data within their organization
- Program access inherits the authenticated profile's team
- Pending Auth identities have no profile, tenant membership or business-data access
- User invitation, creation, activation, role/team changes and administrator password resets are audited
- `phenotype_trait_values` has no client insert policy: it is written only by the
  `submit_trait_evaluation` SECURITY DEFINER function, which re-checks `can_write_program`
  and every trait's constraints before writing
- `media_assets` reuses `can_access_team`/`can_write_team` directly for SELECT/INSERT/UPDATE;
  `organization_id`/`program_id` are derived server-side from the target entity (never
  trusted from the client) and the row's target/storage identity is immutable after
  creation; there is no DELETE policy (archive only)
- Every experimental-workflow table (`experimental_cycle_templates` and its steps/
  dependencies, `task_dependencies`, `task_template_checklist_items`) reuses
  `can_access_program`/`can_write_program` exactly as `task_templates`/`tasks` already did —
  no new role, no new RLS helper. A dependency or a template step can never bridge two
  programs or two organizations: the integrity triggers check this directly, and RLS alone
  would not be enough since both rows could otherwise belong to programs the same
  `team_admin` can write. `task_templates_read` and `experimental_cycle_templates_read` have
  no `deleted_at` filter (so archived definitions remain listable); every other
  experimental-workflow table still filters `deleted_at`/hides archived rows exactly as
  before.

## Calculations and Functions

### Germination Rate Calculation
```sql
germination_rate = (seeds_germinated / seeds_tested) * 100
```

### Seed Yield Calculation
```sql
seed_yield_per_pollinated_unit = total_seeds / pollinated_units
```

### Score Calculations
- Weighted score: sum of weighted criterion scores
- Normalized score: weighted score / maximum score * 100
- Automatic decision: based on score and stability thresholds, overridden to `eliminate`
  independent of the score when any active `is_eliminatory` criterion's `raw_score` is
  below its `eliminatory_threshold` (migration 000022; see that migration's header comment
  for the fail-safe missing-value semantics)

### Stock Calculations
```sql
current_quantity = initial_quantity + total_positive_movements - total_negative_movements
days_before_expiration = expiration_date - current_date
```

### Stock Coverage Calculation (migration 000022)
```sql
average_weekly_consumption = sum(consumption movements in trailing 90 days) / (90.0 / 7)
estimated_weeks_remaining  = current_quantity / average_weekly_consumption
```
`NULL` (not `0`) when there is no consumption movement in the window — see
`inventory_item_coverage`.

### Delay Calculation
```sql
delay_days = max(0, current_date - due_date)
```

## Indexes

All tables have appropriate indexes for performance:
- Foreign key indexes
- Frequently queried columns
- Composite indexes for complex queries
- Audit log indexes for performance

## Migration Strategy

Database migrations are versioned and sequential:
- One migration file per logical change
- Migrations are never edited after being applied
- All migrations are tested on a clean database
- Functions and policies are part of the migration files
