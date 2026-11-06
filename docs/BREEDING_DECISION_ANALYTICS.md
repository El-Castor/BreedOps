# Breeding Decision & Genetic Gain (V2-06)

Scope, statistical architecture, and the exact boundary between a **selection
decision** and a **genetic inference**. This document is the companion to
`src/lib/breeding-decision/*`, `analytics-r/scripts/selection_models.R`,
migration `000033`, `docs/ANALYTICS.md` (V2-04), and
`docs/MULTI_ENVIRONMENT_ANALYTICS.md` (V2-05), both of which V2-06 reuses
and extends — it is never a parallel system, and never a replacement for the
existing operational scoring workflow (§1).

## 1. The core scientific principle

**A selection decision is not a genetic inference.** Ranking candidates,
computing a selection differential, or running MGIDI/MTSI tells a breeder
*which candidates were chosen and how they differ on the traits measured* —
it never, by itself, tells them anything about additive genetic value,
heritability, or expected genetic gain. BreedOps V2-06 keeps these two
questions structurally separate everywhere: in the schema (§3), in the
candidate × trait matrix (§4), in every method's own output (§6-8), and in
the UI's mandatory "genetic validity panel" (§9), which never lets a decision
metric's availability imply that a genetic-inference metric is also
available.

Three identity rules apply throughout, inherited unchanged from V2-04/V2-05
and never relaxed for V2-06:

- `family_id`/`seed_lot_id`/`phenotype_id`/`trial_entry_id` are never
  auto-upgraded into an additive genetic identity.
- Only `trial_entries.scientific_role = 'genotype'` entries may be
  interpreted at genotype level — and even then, **genotype identity is not
  an additive breeding value** (no pedigree/genomic relationship model
  exists in BreedOps; see §9).
- Where the data cannot support a scientifically valid interpretation, the
  engine returns `NOT_ESTIMABLE` with the exact missing requirement — never a
  fabricated number. A correct refusal is a valid, complete V2-06 outcome.

## 2. The existing operational scoring workflow is untouched

`selection_models`/`selection_criteria`/`selection_decision_rules`,
`phenotype_evaluations.weighted_score`/`normalized_score`/
`automatic_decision`/`is_eliminated`, `refresh_phenotype_evaluation()`,
`set_program_trait_weight()`, and the ranking UI in
`src/app/app/phenotypes/page.tsx` are a **field/evaluation scoring workflow**:
one active model per program, a fixed trait-weighted sum, eliminatory
thresholds, a free-text decision label. V2-06 does not replace it, extend
it, or reinterpret its output as "genetic" — it is a separate, explicitly
labelled analytical decision-support layer a breeder runs *alongside* it.
`selection_models` is deliberately not reused for V2-06's own scenario
configuration: its semantics (one `maximum_score`, one set of
coefficient/eliminatory-threshold criteria) do not fit a multi-trait
analytical scenario (explicit direction/target per trait, named evidence
source, economic weights, a selection proportion). Where the UI shows the
existing workflow's own score, it is always labelled **"score pondéré
opérationnel"**, never "indice génétique" — see §10.

## 3. Schema

Migration `000033_breeding_decision_scenarios.sql` (full table-by-table
rationale in the migration's own comments):

- **`breeding_decision_scenarios`**: one reusable configuration — program,
  trial, `candidate_type` (fixed to `'trial_entry'` for V1 — a column, not a
  hard-coded assumption, so a future candidate entity does not need a schema
  rewrite), `candidate_eligibility` (`all` |
  `exclude_operationally_eliminated`), `selection_proportion` (0 < x ≤ 100 —
  **never** the standardized quantitative-genetics selection intensity `i`;
  these are deliberately distinct, non-interchangeable terms — see §8), soft
  delete. A scenario is mutable configuration, analogous to `selection_models`
  for the operational workflow; the immutable evidence is the
  `analytics_runs` row a run of it produces, never the scenario row itself.
- **`breeding_decision_scenario_traits`**: one row per selected trait —
  `direction` (reusing `phenotype_traits.direction`'s own vocabulary exactly;
  `'neutral'` is deliberately not a valid choice here, every trait actually
  used must have an explicit selection direction), `target_value` (required
  iff `direction = 'target_value'`), optional `weight`/`economic_weight`,
  and the explicit provenance pair `source_type`/`source_run_id` (§4) plus
  `evaluation_date` for occasion-filtered phenotypic sources.
- **`analytics_runs`** extended (never a parallel provenance table): new
  `analysis_type = 'breeding_decision'`, new `scenario_id` column,
  `trait_id` made nullable (a breeding-decision run is inherently
  multi-trait). `validate_analytics_run_scope()` was rewritten to add this
  third case without loosening the existing `trait_intelligence`/
  `multi_environment` guarantees (verified by the pgTap suite, §11).
- **`breeding_candidate_pool(trial_id)`**: `SECURITY INVOKER`, returns every
  `trial_entry` candidate for a trial plus an `operationally_eliminated`
  diagnostic flag read from the existing scoring workflow's
  `phenotype_evaluations.is_eliminated` on each candidate's most recent
  evaluation. It always returns every candidate — exclusion by
  `candidate_eligibility` is a disclosed, TypeScript-side decision, never a
  silent filter inside this function.

See `docs/database.md` for the complete column-level reference.

## 4. Source provenance and evidence levels

Every scenario trait names precisely where its candidate × trait value comes
from (`src/lib/breeding-decision/types.ts`):

| `source_type` | Evidence level | Resolved via |
| --- | --- | --- |
| `RAW_PHENOTYPIC` | `PHENOTYPIC` | `met_observation_dataset()` directly, one observation per candidate (ambiguous repeats rejected — see below) |
| `PHENOTYPIC_MEAN` | `PHENOTYPIC` | Same reader, averaged over every matching observation |
| `MET_ENTRY_PREDICTION` | `ADJUSTED_ENTRY` | A stored, completed V2-05 `met_base_v1` run's `entry_predictions[].blup` |
| `WAASBY_STABILITY_PERFORMANCE` | `ADJUSTED_ENTRY` | A stored, completed V2-05 `met_waasb_v1` run's `entries[].waasby` |
| `ADJUSTED_ENTRY_PREDICTION` | — | Allowed by the DB's `CHECK` for forward-compatibility only — **no resolver exists**; rejected with an explicit "not yet supported" reason, never silently treated as one of the above |

A run's overall `evidenceLevel` is the **weakest** level across every
selected trait (`weakestEvidenceLevel()`) — never upgraded because one trait
happens to carry stronger evidence. `GENOTYPIC`/`ADDITIVE_GENETIC` are
defined in the type but have no implemented resolver in V1 (no method
currently produces genotype- or additive-level evidence — see §9).

`RAW_PHENOTYPIC`/`PHENOTYPIC_MEAN` reuse V2-05's own canonical reader
(`buildMetObservationDataset`) and its longitudinal-occasion-ambiguity guard
(`detectMetLongitudinalAmbiguity`, migration 000031): if the same candidate
has 2+ distinct dated evaluations and the scenario trait has not pinned one
`evaluation_date`, the trait is rejected rather than silently pooled.
`RAW_PHENOTYPIC` additionally requires *exactly* one observation per
candidate (never averaged implicitly) — use `PHENOTYPIC_MEAN` or an explicit
occasion for anything else.

`MET_ENTRY_PREDICTION`/`WAASBY_STABILITY_PERFORMANCE` each validate their
`source_run_id` independently: it must be a `completed`, `multi_environment`
run of the exact matching model type, for the exact same trial — a
cross-trial, cross-model, or non-completed source run is rejected with a
precise reason, never silently accepted.

## 5. The canonical candidate × trait matrix

`buildCandidateTraitMatrix()` (`src/lib/breeding-decision/dataset.ts`) is the
**one** server-side builder every selection method consumes — no method ever
reconstructs its own candidate × trait data. It starts from
`fetchBreedingCandidatePool()` (the RLS-scoped `breeding_candidate_pool()`
SQL function), applies the scenario's `candidate_eligibility` policy, then
resolves every selected trait's values via `resolveBreedingTraitValues()`
(§4). The result (`BreedingCandidateTraitMatrix`) carries, alongside the
cell values: the matrix's overall `evidenceLevel`, and `coverage`
diagnostics (`candidateCount`, `traitCount`, `completeCandidateCount`,
`missingCells`, `coverage` ratio) — missing cells are **never imputed**;
`getCell()` returns `null` and every downstream consumer must decide
explicitly how to treat it.

MTSI does not consume this matrix (it needs a real `waasb`-class R fit, not
a JSON summary — see §7): `buildMtsiRawDataset()` instead assembles the raw,
long-format multi-environment rows for every selected (necessarily
`WAASBY_STABILITY_PERFORMANCE`) trait, validating that every trait's source
run is for the same trial and that every source run's own
`performance_weight` is **identical** (harmonized) — never a silent average
of divergent weights.

## 6. Eligibility (before any R call)

`evaluateSelectionMethodEligibility()` (`src/lib/breeding-decision/
eligibility.ts`) runs before the R engine is ever invoked, mirroring the
guards `analytics-r/scripts/selection_models.R` itself enforces — the R
engine remains the final authority, this is a fast preflight:

- **MGIDI**: at least 2 traits (`metan::mgidi()` itself refuses a single
  variable); **strictly more complete-case candidates than traits** — a real
  gap in `metan::mgidi()` found and closed here: below this threshold, every
  pairwise trait correlation in the candidate × trait matrix is exactly ±1
  (a perfectly saturated, statistically meaningless matrix), yet
  `metan::mgidi()` "succeeds" anyway. Verified empirically by direct
  inspection of `mgidi()`'s own `$cormat` output
  (`analytics-r/tests/test_selection_mgidi.R`) — the same non-arbitrary,
  identifiability-based discipline as `met_base_v1`'s within-cell
  replication rule (V2-05).
- **MTSI**: at least 2 traits, and no `target_value` traits (WAASB/WAASBY's
  own direction argument only knows higher/lower, no distance-to-target
  concept). The data-dependent half of MTSI's eligibility — strictly more
  than 2 entries **and** more than 2 environments in the underlying
  multi-environment design (reusing V2-05's own `met_waasb_v1` guard
  verbatim), and the harmonized-performance-weight check — needs the raw
  dataset and is therefore layered in at matrix/raw-dataset build time
  (§5), never re-litigated in this pure eligibility module.

Every eligibility failure is disclosed with the exact missing requirement
and is itself saved as the run's result (`status = 'not_estimable'`,
`result.eligibility.reasons`) — never silently discarded.

## 7. The R statistical engine

Extends the existing safe R infrastructure (`src/lib/met/r-env.ts`, reused
**unchanged** — same subprocess environment allowlist, stdin JSON,
`zod`-validated stdout, timeout, stdout/stderr caps; see
`docs/DEPLOYMENT_GUIDE.md`). `src/lib/breeding-decision/r-model-types.ts`
lists all four conceptually planned model types
(`SELECTION_MODEL_TYPES`); only `selection_mgidi_v1`/`selection_mtsi_v1` are
implemented and allowlisted end-to-end in `r-runner.ts` and
`analytics-r/scripts/selection_models.R` — `selection_smith_hazel_v1`/
`selection_multitrait_covariance_v1` are formally deferred (§9). No
client-supplied formula ever reaches R.

### 7.1 `selection_mgidi_v1` — MGIDI

`metan::mgidi()`, pinned. Input: the candidate × trait matrix's complete-case
subset, each trait's explicit direction/target/weight, the scenario's
selection proportion. Output: per-candidate MGIDI value, rank, `selected`
flag; factor loadings and per-candidate factor contributions (the
"strengths/weaknesses" evidence — §10); PCA summary. **Lower MGIDI = closer
to the ideotype.** Never presented as a genetic value — it is an index over
whichever evidence level the scenario's traits actually carry (§4).
Cross-validated against direct `metan::mgidi()` calls in
`analytics-r/tests/test_selection_mgidi.R` (15/15 checks), including an
independent reproduction of the degenerate-correlation defect above.

### 7.2 `selection_mtsi_v1` — MTSI

Refits `metan::waasb()` on all selected traits at once (long-format rows
from `buildMtsiRawDataset()`) with the scenario's own harmonized
`wresp`/performance weight, then `metan::mtsi()` on that fit. **`index` is
hardcoded to `"waasby"` — never a client-selectable option.** A genuine,
confirmed `metan` 1.19.0 bug: `mtsi(index = "waasb", ideotype = <non-NULL>)`
crashes with `object 'df_ideotype' not found` regardless of ideotype
content, reproduced independently both inside and outside the production
script, with and without `wresp`, with every ideotype syntax `metan`
accepts. Never patched (an upstream package limitation, not a BreedOps
bug) — documented in code comments and in
`analytics-r/tests/test_selection_mtsi.R` (13/13 checks, including an
independent reproduction of this crash) so it is never silently
"rediscovered". A separate, unrelated robustness bug was found and fixed in
the R script itself: `as.numeric(NULL)` evaluates to `numeric(0)`, and
`is.na(numeric(0))` to `logical(0)`, which crashes R's `if()` the moment an
options field (e.g. `selection_proportion`, `performance_weight`) is simply
absent from the request JSON rather than explicitly `null` — fixed via a
shared `get_numeric_option()` helper applied at every numeric-option read
site.

### 7.3 Smith-Hazel and multi-trait covariance — formally deferred

`selection_smith_hazel_v1` and `selection_multitrait_covariance_v1` are
**not implemented** in this V1, with the full justification recorded in
`agend.md`'s decision log (§6 of the V2-06 section). Summary: Smith-Hazel is
not "just a weighted score" — it requires a genuinely estimated genetic
covariance matrix `G` and phenotypic covariance matrix `P`
(`b = P⁻¹ G a`), never a substitute of sample covariance of BLUPs for `G` or
phenotypic correlation for genetic correlation. The underlying mechanism
*is* technically reachable (`sommer::mmes()` + `stackTraits()` +
`vsm(usm(trait), ism(...))`, verified empirically in-session on a
known-covariance synthetic dataset), but a production-quality
implementation — robust numerical conditioning checks for `P`/`G`, a
realistic BreedOps candidate population genuinely `genotype`-role and
replicated enough for a multi-trait REML fit, economic-weight validation,
and a full reference-test suite with known synthetic covariance recovery —
is a disproportionate engineering effort relative to the rest of this
milestone's equally mandatory scope. `SMITH_HAZEL = NOT_ESTIMABLE` (reason:
no validated multi-trait genetic covariance model) is the explicitly
sanctioned outcome rather than a fabricated result. This may be revisited in
a later iteration if a specific need is identified — it is never silently
dropped from the roadmap (see `agend.md`'s roadmap table, V2-06 row).

## 8. Selection differential, selection proportion vs. selection intensity

`computeSelectionDifferentials()` (`src/lib/breeding-decision/
selection-differential.ts`, pure, independent of any R model) computes, per
trait: population mean/N, selected mean/N (both over non-null values only —
never requiring complete cases across *other* traits), absolute
differential, percentage differential (**`null` whenever the population
mean is exactly 0** — a percentage against a zero denominator is never
shown as a misleading number), and `directionAchieved` (whether the
differential actually moves the way the breeder wants — `null` when either
side has zero supporting candidates; a precise tie reports `false`, never a
rounding artifact). This is always computed and shown — it is never
automatically "genetic gain" (§9).

**Selection proportion ≠ selection intensity.** `selection_proportion` (the
scenario's own %, stored directly) is the fraction of candidates retained.
The standardized quantitative-genetics selection intensity `i` is a distinct
quantity (derived from the standard normal distribution for the given
proportion) that would only ever be computed separately, in TypeScript,
where a genetic-response equation needed it — and no such equation is
implemented in V1 (there is no validated genetic variance to multiply it
by). The two terms are never conflated in code, storage, or UI copy.

## 9. The genetic validity panel

`buildGeneticValidityPanel()` (`src/lib/breeding-decision/
genetic-validity.ts`) is attached to **every** run and is the UI's
mandatory, structural separation of decision metrics from genetic
inference — never left implicit in copy alone. Each of its seven fields is
`AVAILABLE` / `NOT_ESTIMABLE` / `DEFERRED`, always with a `reason` when not
`AVAILABLE`:

| Field | Status in V1 | Why |
| --- | --- | --- |
| `candidateRanking` | `AVAILABLE` whenever a method produced one | Decision metric |
| `selectionDifferential` | Always `AVAILABLE` | Decision metric, computed independently of any R model (§8) |
| `multiEnvironmentStability` | `AVAILABLE` iff a selected trait used `WAASBY_STABILITY_PERFORMANCE` | Decision metric |
| `broadSenseGenotypicResponse` | `AVAILABLE` iff heritability is `ESTIMABLE` (below) | Boundary case — see below |
| `geneticCorrelation` | Always `NOT_ESTIMABLE` | No multi-trait genetic covariance model (§7.3) |
| `additiveBreedingValue` | Always `NOT_ESTIMABLE` | No additive relationship model (pedigree/genomic) exists in BreedOps |
| `expectedAdditiveGain` | Always `NOT_ESTIMABLE` | Same reason as above |

**Heritability is revisited, correctly, in V2-06** (V2-04/V2-05 both
correctly left it `NOT_ESTIMABLE`): `computeBroadSenseHeritability()`
computes broad-sense heritability on an entry-mean basis,
`H² = σ²_G / (σ²_G + σ²_GE/e + σ²_e/(e·r))`, directly from an already-
completed V2-05 `met_base_v1` run's own variance components — no new R
model — **but only when every candidate in the trial is explicitly
declared `scientific_role = 'genotype'`**. This is still broad-sense only;
it is never presented as narrow-sense/additive heritability, and
`broadSenseGenotypicResponse` is explicitly distinguished from "transmitted
breeding value"/"additive genetic gain" in every label it is shown under.

**Genetic-gain terminology is never interchangeable**: selection
differential, predicted response, genotypic gain, additive genetic gain,
and realized trend are five distinct concepts; V2-06 implements the first
and the broad-sense genotypic-response case of the third (when heritability
is estimable), and explicitly refuses the rest rather than fabricate them.

### 9.1 Genetic progress over cycles/generations — `GENETIC_PROGRESS_TREND = DEFERRED`

The spec asked V2-06 to audit whether a reliable cohort/generation axis
exists before exposing any "genetic progress trend" claim. It does not:
`programs.campaign`/`environments.campaign` are free-text season/year labels
(not a structured, ordered sequence); `parent_lines.generation`/
`crosses.generation`/`families.generation` are independent integer fields
set per record, never derived from one another or from any shared counter;
`experimental_cycles` is a scheduling/workflow concept (task
dependency/timing) with no relationship to genetic generation numbering.
None of these are validated as interchangeable, and no reliable mapping
from a trial/candidate to a genetic generation number exists in the current
schema. **`GENETIC_PROGRESS_TREND = DEFERRED`** — not implemented, not
`NOT_ESTIMABLE` (which would imply a specific run's own data was
insufficient), because the underlying cross-cycle axis itself does not yet
exist as a validated concept. Revisiting this needs a deliberate schema
decision (which of these fields, if any, becomes the authoritative
generation/cohort axis), not a V2-06-time R model.

### 9.2 Parent/mating optimization — `PARENT_MATING_OPTIMIZATION = DEFERRED`

No automatic parent-pair or mating recommendation is derived from a
candidate ranking alone. Doing so soundly requires a quantitative
relationship/inbreeding model (a pedigree A-matrix or a genomic
relationship matrix) — the exact same additive relationship model that
`additiveBreedingValue` is `NOT_ESTIMABLE` for lack of (§9). Since no such
model exists in BreedOps, **`PARENT_MATING_OPTIMIZATION = DEFERRED`**.
GBLUP/genomic prediction, SNP matrices, kinship/pedigree A-matrices, and
optimal contribution selection are explicitly out of scope until the
underlying relationship data genuinely exists — never introduced
speculatively ahead of it.

## 10. No opaque AI recommendation

The UI never says "BreedOps recommends selecting G42". Every selected
candidate is attributed to the method and scenario that selected it
("Sélectionné par MGIDI" under this run), with the evidence (ranking,
factor contributions, selection differential) shown alongside — the breeder
remains the decision maker. `selectionCoincidence()`
(`method-comparison.ts`) additionally supports showing "selected by N/M
evaluated methods" when several runs are compared (§... below), still never
phrased as an automated recommendation.

## 11. Method comparison and decision stability

`method-comparison.ts` (pure, reusing `spearmanCorrelation` from
`src/lib/analytics/stats.ts` rather than a second rank-correlation
implementation) provides `compareMethodRankings()` (Spearman ρ over shared
candidates — `null` below 3 shared, never fabricated; selected-by-both/
only-A/only-B; overlap proportion), `selectionCoincidence()`, and
`compareAllMethodRankings()` for N-way comparison. **Never declares one
method universally "best".**

This is wired into the UI as `compareBreedingDecisionRuns()`
(`src/app/app/analytics/breeding-decision-actions.ts`): a breeder picks two
already-saved runs from a scenario's history and sees their comparison
directly — this is how V2-06 satisfies "decision stability/sensitivity
across selection proportions, trait weights, and performance/stability
weight" (two runs made with different scenario settings are compared
directly) **without** BreedOps ever running an automated parameter sweep.
Every configuration a breeder actually runs is already recorded in full in
its own `analytics_runs.specification` — there is no separate "sensitivity
analysis" artifact beyond comparing the runs a breeder chose to make.
Comparison is refused (returns `null`) whenever either selected run is not
`status = 'completed'` (e.g. `NOT_ESTIMABLE`) — there is no ranking to
compare in that case.

## 12. Candidate shortlist and immutability

A breeding-decision run never mutates any biological source record: no
phenotype/trait value, trial entry, family, seed lot, parent line, or
existing operational selection score (`automatic_decision`, weighted/
normalized scores, `is_eliminated`) is ever written by this milestone's
code. A run's own analytical shortlist (the `selected` flag on each
candidate in its stored `result.candidates`) lives **only** inside that
immutable `analytics_runs` row — it is evidence to act on, never a silent
business-state write.

## 13. Staleness

A breeding-decision run becomes stale, in the same sense as V2-04/V2-05
runs, whenever the data it was built from changes after the fact: the
underlying trait observations change, a V2-05 source run it depended on
(`MET_ENTRY_PREDICTION`/`WAASBY_STABILITY_PERFORMANCE`) is superseded or
itself becomes stale, the candidate pool changes (entries added/removed/
role changed), a selected trait's direction/target/source configuration
changes, or the scenario definition itself changes. `datasetFingerprint`
(a custom sha256 over the exact candidate × trait cells for MGIDI, or over
the exact raw long-format rows for MTSI — adapted from V2-04/V2-05's own
mechanism because a breeding-decision matrix cell can come from several
source types with no single uniform row-level provenance to hash directly)
changes whenever the underlying evidence changes, so a later comparison
against the live data can detect drift. The UI never presents a stale
ranking as current without this signal.

## 14. UI

`/app/analytics/breeding-decision` — never a replacement for
`/app/breeding` (the operational register) or `/app/phenotypes` (the
operational scoring workflow). Workflow: pick a trial → create/select a
scenario (candidate eligibility policy, selection proportion) → add traits
(direction, optional weight/target, explicit source) → run a method →
inspect the result (ranking table, selection-differential table, genetic
validity panel, factor-contribution strengths/weaknesses for MGIDI/MTSI) →
export (§15) → optionally compare against another saved run (§11). Every
step's configuration is visible in the form — never hidden behind a
default. A `NOT_ESTIMABLE` result renders its exact reasons, never a
ranking table. `/app/trials` gained a "Décision d'amélioration" link
alongside its existing "Analyser cet essai" link.

## 15. Export

`src/app/app/analytics/breeding-decision/export/route.ts` exports the
latest saved run for a program/trial: JSON (the full scenario
specification, status, dataset fingerprint, and result — candidates,
selection differentials, genetic validity panel, provenance) or CSV
(`candidate_id,rank,index,selected`). Scoped entirely through the existing
RLS-scoped `getLatestBreedingDecisionRun()` — a run belonging to another
organization/program never reaches this route. Never exports a secret: the
stored run's own specification/result are already the exact size-capped,
non-raw-observation summary the server action persisted.

## 16. Security

- Every new table is program-scoped, gated by `can_access_program()`/
  `can_write_program()` — never trusting a scope id the client sends;
  `validate_breeding_decision_scenario_scope()`/
  `validate_breeding_decision_scenario_trait_scope()` re-derive
  `organization_id` server-side and independently reject a cross-program
  `trial_id`, a cross-organization `trait_id`, and a cross-program
  `source_run_id` — belt-and-suspenders with RLS, not a substitute for it.
- `breeding_candidate_pool()` is `SECURITY INVOKER` with an explicit
  `can_access_program()` check in its own `WHERE` clause — a cross-org call
  returns zero rows, not a permission error, exactly like
  `met_observation_dataset()` (V2-05).
- No arbitrary code execution: `model_type` is a fixed allowlist, never a
  client-supplied formula; same R subprocess contract as V2-05 (stdin JSON,
  `zod`-validated stdout, timeout, output caps, environment allowlist).
- Tested in `tests/breeding-decision.sql` (pgTap: cross-org RLS on all
  three new/extended tables, cross-program scope triggers, the CHECK
  constraints that keep provenance explicit, `breeding_candidate_pool`'s
  RLS/eliminated-flag behaviour, soft-delete lifecycle, anon grants, and
  non-regression checks on `trait_intelligence`/`multi_environment`'s own
  `validate_analytics_run_scope()` branches — 34/34 assertions), unit tests
  in `tests/breeding-decision-*.test.ts` (types, selection differential,
  method comparison, eligibility, genetic validity — all pure functions),
  R reference tests in `analytics-r/tests/test_selection_mgidi.R` (15/15)
  and `test_selection_mtsi.R` (13/13), and
  `tests/breeding-decision.integration.test.ts`/`e2e/breeding-decision.spec.ts`
  (real HTTP/browser, including the first real end-to-end proof of the
  TS → R round trip for both implemented methods through the actual running
  app, the `NOT_ESTIMABLE` demonstration, export, and the method-comparison
  UI).

## 17. What this file deliberately does not cover

`dataset.ts`'s own candidate-alignment validation branches (a source run
for a different trial, a different measurement occasion, a different
scientific role, no cross-population mixing between distinct source runs)
are enforced in code (§4-5) and exercised through the integration test
(the one real HTTP path a breeder can reach), not through a direct unit
test of `dataset.ts` itself — that module carries `"server-only"` and
cannot be imported from Vitest at all, the same constraint V2-05's
`src/lib/met/dataset.ts` has. See
`tests/breeding-decision.integration.test.ts`'s own header comment for the
exact division of coverage between the pgTap suite, the pure-TS unit
tests, and this integration test.
