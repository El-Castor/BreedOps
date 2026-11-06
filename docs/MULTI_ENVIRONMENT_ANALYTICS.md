# Multi-environment & G×E Stability (V2-05)

Scope, statistical architecture, and the exact boundary between what this engine
estimates and what it refuses to estimate. This document is the companion to
`src/lib/met/*`, `analytics-r/`, migrations `000028`-`000030`, and
`docs/ANALYTICS.md` (V2-04, which this milestone extends — it is never a parallel
system).

## 1. Scientific scope

V2-05 answers questions about one trial — an explicit set of environments and
entries — observed for one numeric/integer/ordinal trait at a time:

1. Is the experimental design actually sufficient to estimate an Entry×Environment
   effect at all?
2. How much do entries vary, how much do environments vary, and how much is
   genuine Entry×Environment interaction (as opposed to residual noise)?
3. Does an entry's ranking stay stable across environments, or does it reverse
   (a true crossover) rather than merely scale?
4. How responsive is each entry to the environmental index (Finlay-Wilkinson), and
   how stable is that response?
5. Which entries show broad adaptation (good and stable everywhere) versus
   specific adaptation (good only in particular environments) — AMMI/GGE/WAASB.

It never upgrades `family_id`/`seed_lot_id` into a genotype identity, or free-text
`phenotypes.location` into a normalized environment, by inference. Where the
current data (design, replication, identity) cannot support a scientifically
valid interpretation, the engine returns a structured `NOT_ESTIMABLE` result with
the exact missing requirement, never a fabricated number — exactly the same
discipline V2-04 established.

Out of scope for V2-05 (see §9 for the one deliberate in-milestone deferral, and
`agend.md`'s roadmap reconciliation for what moves to V2-06): multi-trait
selection indices (Smith-Hazel), MGIDI/MTSI, genomic selection/GBLUP, genetic gain
over generations.

## 2. Terminology discipline

An entry is only ever called a **genotype**, and the interaction only ever called
**G×E**, when `trial_entries.scientific_role = 'genotype'` — an explicit, human-
stated classification, never inferred from which optional lineage FK
(`parent_line_id`/`family_id`/`seed_lot_id`) happens to be set. Every other role
(`family`, `population`, `seed_lot`, `other`) is always **Entry×Environment**, in
every piece of UI copy and every stored/exported field name.

`heritability` stays hard-coded `NOT_ESTIMABLE`, for the same reason as V2-04: no
validated genotype-identity/replication structure exists yet to support it (see
`docs/ANALYTICS.md` §7-8).

## 3. Schema and canonical dataset

See `docs/database.md` ("Multi-environment & G×E stability") for the full table-
by-table description of `sites`/`environments`/`trials`/`trial_environments`/
`trial_entries` and the additive `phenotypes.environment_id`/`trial_entry_id`
links. The one server-side reader every analysis is built from is
`met_observation_dataset()` (SQL) / `buildMetObservationDataset()`
(`src/lib/met/dataset.ts`), mirroring V2-04's filter-before-cap pattern exactly:
`MAX_MET_OBSERVATION_ROWS = 5000`, and a result of exactly that many rows is the
deterministic `dataset_too_large` signal — never a silently truncated dataset.

## 4. Design diagnostics (eligibility, before any model)

`evaluateMetEligibility()` (`src/lib/met/eligibility.ts`) runs before any
statistical model is attempted, mirroring the same three hard checks
`analytics-r/scripts/met_models.R` itself enforces, in the same order, so a
dataset never gets a different verdict from the UI and the R engine:

1. At least `MIN_ENVIRONMENTS = 2` distinct environments.
2. At least `MIN_ENTRIES = 2` distinct entries.
3. At least `MIN_SHARED_ENTRIES = 2` entries observed in 2+ environments — without
   this, the Entry×Environment effect is not identifiable at all.

Non-blocking warnings (missing entry×environment cells, single-observation cells)
are reported separately and never upgrade into a blocking reason on their own.

### 4.1 Measurement occasion (never pool dated repeats as replicates)

`met_observation_dataset()` can return several dated evaluations of the exact
same phenotype (one physical Entry×Environment unit) if it was measured more
than once for the same trait — e.g. a trait recorded on several dates.
Feeding all of them into one G×E model at once would silently turn a
longitudinal/repeated measurement into a fake independent replicate,
corrupting the Entry×Environment and residual variance estimates.

Before building the dataset actually used for diagnostics or modelling, an
unfiltered ("discovery") fetch is run through
`detectMetLongitudinalAmbiguity()` (`src/lib/met/design-summary.ts`): if the
SAME phenotype has 2+ distinct `evaluation_date` values, and the caller has
not explicitly selected one, `evaluateMetOccasionEligibility()`
(`src/lib/met/eligibility.ts`) returns `NOT_ESTIMABLE` instead of pooling
them. Different phenotypes simply having been measured on different
calendar dates (the normal case — each environment is its own campaign)
never triggers this.

Once an occasion is selected (or there was never any ambiguity), the actual
dataset is re-fetched with `met_observation_dataset()`'s
`target_evaluation_date` parameter (migration 000031) — filtered server-side
in SQL, not by post-fetch filtering in TypeScript, so the N+1 row-cap
overflow-detection stays scoped to the occasion actually analyzed. The
selected occasion is stored in `analytics_runs.specification.evaluationDate`,
changes the dataset fingerprint (each row's `evaluation_date` is already
part of it), is shown in the UI (design-diagnostics card, latest-run card,
run history), and is carried through to the raw-observations CSV/JSON
export via an `occasion` query parameter.

### 4.2 Model-specific eligibility

Some models have requirements beyond the generic gate above —
`evaluateMetModelEligibility(modelType, rows)` layers them on top (the R
engine remains the final authority; this is a fast preflight for UI
diagnostics):

- **`met_base_v1`**: at least one Entry×Environment cell must have 2+
  observations (within-cell replication) — otherwise the Entry×Environment
  and residual variances are not separately identifiable (validated against
  `lme4::lmer()`'s own grouping-factor check, not an arbitrary threshold).
  Diagnostics expose populated/total/replicated cell counts; partial
  replication is allowed but surfaced as a warning.
- **`met_waasb_v1`/`met_ammi_v1`**: strictly more than 2 entries AND more
  than 2 environments (`metan::waasb()`/`metan::performs_ammi()`'s own
  minimum — stricter than the base model's 2/2).
- **`met_ammi_v1`/`met_gge_v1`**: `metan::performs_ammi()`/`metan::gge()`
  both silently impute a missing Entry×Environment cell (EM-SVD) rather than
  excluding it — disclosed as a warning, never silent.
- **`met_finlay_wilkinson_v1`**: every entry needs 2+ environments of its
  own (`metan::ge_reg()` otherwise returns a confident-looking but
  degenerate single-point fit for an under-observed entry).

## 5. The R statistical engine

A server-only R runtime (`analytics-r/`), per the architecture decided with the
project owner: **`sommer`** as the primary REML/mixed-model/BLUP-BLUE engine,
**`lme4`** as an optional reference/validation engine, **`metan`** for the
MET-specialized methods (AMMI/WAASB/Finlay-Wilkinson/GGE). No REML/BLUP/mixed-
model math is hand-rolled in TypeScript, and no client-supplied formula ever
reaches R — `model_type` is restricted to a small fixed allowlist
(`MET_MODEL_TYPES` in `src/lib/met/r-runner.ts`, which must mirror
`ALLOWED_MODEL_TYPES` in `analytics-r/scripts/met_models.R`).

See `docs/DEPLOYMENT_GUIDE.md` ("R statistical engine") for installation, the
required subprocess environment (`LC_ALL=C.UTF-8`, `RENV_CONFIG_STARTUP_QUIET=TRUE`),
and `renv` version pinning. `src/lib/met/r-runner.ts` spawns
`Rscript analytics-r/scripts/met_models.R <model_type>`, feeds it one JSON request
over stdin, and validates the JSON response with a strict per-model `zod` schema
before it ever reaches a caller — enforcing a timeout (default 120s), a
defense-in-depth row cap mirroring the R script's own `MAX_ROWS = 50000`, and a
10 MiB stdout cap.

### 5.1 `met_base_v1` — base mixed model

`sommer::mmer()`, fixed `value ~ environment`, random
`~ entry + entry:environment [+ block(environment)]`. Returns variance components
(entry, Entry×Environment, block(environment), residual), fixed effects per
environment with standard errors, and BLUPs (entry and entry×environment) with
their own prediction-error-variance-derived standard errors — uncertainty is
always shown alongside the point estimate, never a bare number.
Cross-validated **exactly** against `lme4::lmer()` on a strong-crossover-
interaction synthetic dataset (fixed effects and variance components matched to
1e-4/1e-3 tolerance) — see `analytics-r/tests/test_met_base_v1.R`.

### 5.2 `met_finlay_wilkinson_v1` — joint regression (Eberhart & Russell)

`metan::ge_reg()`. Per entry: `slope` (responsiveness to the environmental index
— **1 is the reference value, not 0**: Eberhart & Russell's own convention, not an
ordinary centered regression slope), its significance test against
`H0: slope = 1`, the deviation-from-regression variance `s2di` (the stability
measure proper, independent of responsiveness), its significance test, RMSE, and
R². Validated with a fixture whose per-entry sensitivities are assigned
deterministically; the fitted slopes reproduce the exact designed ordering (see
`analytics-r/tests/test_met_finlay_wilkinson.R`).

### 5.3 `met_ammi_v1` — AMMI

`metan::performs_ammi()`. Principal components of the Entry×Environment
interaction matrix (variance explained, cumulative — non-increasing by
construction, checked), genotype and environment scores on those same axes (the
basis for a "which-won-where" biplot).

### 5.4 `met_waasb_v1` — WAASB/WAASBY

`metan::waasb()`, with a configurable, always-visible `performance_weight` (never
a hidden default): `WAASB` (stability — lower is more stable), `WAASBY` (the
weighted combination of raw mean performance and stability). **Stricter minimum
than the generic eligibility gate**: `metan::waasb()` requires *more than 2*
entries **and** *more than 2* environments (found via manual UI verification,
not by any R-level reference test that had exercised exactly 2 environments for
this model specifically); `run_met_waasb()` checks this explicitly before ever
calling `metan::waasb()`, because that function's own failure path for this case
writes a raw warning directly to stdout via a bare `cat()` — bypassing R's
condition system entirely, which `tryCatch()`/`suppressWarnings()` cannot
intercept, and would otherwise corrupt the "one JSON object on stdout" contract.
See the regression test in `analytics-r/tests/test_met_ammi_waasb.R`.

### 5.5 `met_gge_v1` — GGE biplot

`metan::gge()` (Yan's GGE: environment-centered SVD, distinct from AMMI's
doubly-centered decomposition — no `rep` argument needed, it aggregates
replicated rows to genotype×environment means internally). Genotype and
environment scores on the same axes, variance explained per axis, grand mean.

## 6. Entry×Environment rank-stability / crossover analysis

`computeEnvironmentRankStability()` (`src/lib/met/rank-stability.ts`) — the
Entry×Environment sibling of V2-04's time-pair `buildRankStability`, reusing the
same `spearmanCorrelation` primitive rather than a second implementation. Per
environment pair: Spearman's ρ over entries' mean performance (never a
fabricated ρ below `MIN_SHARED_ENTRIES_FOR_RANK_PAIR = 3` shared entries —
reported as `insufficientN` instead), and a **literal, non-threshold** crossover
signal: whether the single best-performing entry actually changes between the
two environments. This is deliberately not a cutoff on ρ (never fabricate a
categorical judgment from an arbitrary threshold when a direct signal is
available).

## 7. UI

`/app/trials` — CRUD for `sites`/`environments`/`trials`/`trial_environments`/
`trial_entries`, scoped to the active program; also hosts the legacy mapping
workflow (§8). `/app/analytics/multi-environment` — design diagnostics, an
Entry×Environment heatmap (color intensity relative to *this dataset's own*
min/max, never an absolute scale, always paired with the numeric table), pairwise
rank-stability, a "run analysis" form covering all 5 model types, the most recent
result rendered by model type, run history, a raw-observations drill-down (every
result stays traceable to its source rows), and CSV/JSON export/import (§9).

## 8. Legacy location/material mapping workflow

Free-text `phenotypes.location` and existing `family_id`/`seed_lot_id` are never
auto-interpreted as a normalized environment/entry (B8/B41's explicit rule). A
human picks one explicit mapping per distinct legacy value
(`legacy_phenotype_location_summary`/`legacy_phenotype_material_summary` list
candidates; `map_legacy_location_to_environment`/`map_legacy_material_to_trial_entry`
apply it in bulk) — see `docs/database.md` for the SQL-level detail.

## 9. Import/export

Export (`src/app/app/analytics/multi-environment/export/route.ts`) reuses
`buildMetObservationDataset` directly — the exact sibling of V2-04's own export
route. Import (`importMetObservations`, migration 000030's
`import_met_observations`) is a **deliberately reduced scope** versus the generic
column-mapping engine in `src/app/app/import-export/`: a fixed-column CSV
importing *observations* into an already-defined trial, never creating a
`trial_entry` or `environment` from the file (both must already exist). This
scope reduction is recorded here rather than left silent.

## 10. Model comparison / factor-analytic model — formally deferred

The factor-analytic (FA) MET model is **DEFERRED**, not implemented, with its
justification recorded in `agend.md`'s decision log: `metan` exposes no FA
function for MET data, and a correctly specified FA model needs an unstructured
factor-analytic covariance (typically ASReml-R, or a substantially more complex
`sommer` setup than `mmer()`) whose independent numerical validation would take
disproportionate engineering effort given that the base model + AMMI + GGE +
WAASB + Finlay-Wilkinson already provide well-validated broad/specific
adaptation and scale/crossover-instability evidence. This is an internal
deferral within V2-05, not a scope reduction of the milestone's own delivery.

## 11. Analysis provenance & reproducibility

Reuses the existing `analytics_runs` table (migration 000027) — never a parallel
provenance system — with `analysis_type = 'multi_environment'` and `trial_id`
(required exactly for that analysis type, cross-checked against the run's own
program). Same immutability guarantee as V2-04 (no UPDATE/DELETE grant at all),
same `dataset_fingerprint` mechanism. A `NOT_ESTIMABLE` verdict — whether from the
eligibility gate before the R engine ever runs, or from the R engine itself — is
saved exactly like a successful run: it is a correct, reproducible result, never
hidden or silently discarded.

## 12. Security

- Every dataset read goes through the RLS-scoped client and `met_observation_
  dataset()`, `SECURITY INVOKER` with an explicit `can_access_program()` check.
- The four new tables' SELECT policies never check `deleted_at` (see
  `docs/database.md` for the full rationale) — `deleted_at` is lifecycle state,
  not an authorization boundary; `can_access_team`/`can_access_program` remain
  the only gate, unchanged.
- The legacy-mapping and import bulk-update functions are `SECURITY DEFINER`
  with an explicit `can_write_program()` check, following `import_phenotypes`'
  own established convention — never a privilege-escalation path, and the
  caller's own RLS/trigger invariants still apply to every row they touch.
- No arbitrary code execution: `model_type` is a fixed allowlist, never a
  client-supplied formula; the R subprocess receives only a validated JSON
  payload over stdin and returns only a `zod`-validated JSON response.
- Tested in `tests/multi-environment.sql`, `tests/legacy-met-mapping.sql`,
  `tests/met-import.sql` (pgTap: RLS, cross-org denial, lineage/consistency
  triggers, idempotency, immutable-identity rejection), unit tests in
  `tests/met-*.test.ts` (eligibility, design summary, rank-stability — all pure
  functions, directly unit-tested), R reference tests in `analytics-r/tests/`
  (numeric cross-validation against `lme4`, each model's own NOT_ESTIMABLE
  case), and `tests/multi-environment.integration.test.ts`/
  `e2e/multi-environment.spec.ts` (real HTTP/browser, including an explicit
  NOT_ESTIMABLE demonstration).
