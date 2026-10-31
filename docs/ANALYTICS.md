# Trait Analytics (V2-04)

Scope, statistical definitions, and the exact boundary between what this engine
computes and what it refuses to compute. This document is the companion to
`src/lib/analytics/*` and migration `000027_trait_analytics.sql`.

## 1. Scientific scope

V2-04 answers eight questions about one numeric/integer/ordinal trait at a time,
for an explicit program/date-range/filter cohort:

1. What data exist for this trait?
2. Are the measurements clean/reliable?
3. Is the trait reproducible?
4. How does it evolve through time?
5. Is ranking stable through time?
6. Are early observations associated with later outcomes?
7. Which traits may be useful as early selection proxies?
8. Is the current experimental design sufficient for stronger inference?

It never silently upgrades a phenotypic/exploratory finding into genetic or
causal evidence. Where the current data model cannot support a scientifically
valid interpretation, the engine returns a structured `NOT_ESTIMABLE` result
with the exact missing requirement, never a fabricated number.

Out of scope for V2-04 (deferred to V2-05/V2-06 — see `agend.md`'s roadmap
reconciliation): full normalized multi-environment model, G×E decomposition,
AMMI, GGE biplots, WAASB/WAASBY, broad/specific adaptation, genetic gain over
generations, Smith-Hazel selection indices, MGIDI, MTSI, genomic
selection/GBLUP.

## 2. Terminology discipline

Allowed, used throughout the UI: *phenotypic correlation*, *repeatability*,
*within-entity stability*, *rank stability*, *potential outlier*, *candidate
early-selection proxy*, *association*.

Never used without explicit, demonstrated proof that the schema supports it:
*genetic correlation*, *breeding value*, *heritability* (as an estimate),
*genetic stability*, *causal effect*, *genetic gain*. These belong to later
milestones, once the data model explicitly supports them.

## 3. Canonical dataset

Every analysis is built from one server-side reader:
`src/lib/analytics/dataset.ts#buildObservationDataset`, which calls the
`trait_observation_dataset(...)` SQL function (migration 000027). No chart or
action queries `phenotype_trait_values` / `phenotype_evaluations` /
`phenotypes` directly. A canonical observation record
(`src/lib/analytics/types.ts#ObservationRecord`) carries: trait metadata
(id/code/name/unit/direction/target value), phenotype id/code,
family/seed-lot id, block/replicate/location, evaluation id/date/evaluator,
and the trait value's id/numeric value.

Only `numeric`/`integer`/`ordinal` traits are eligible for this dataset (and
for every numeric statistic below); `trait_observation_dataset` refuses a
categorical/boolean/date/text trait at the SQL level, not just in the UI.
Categorical/boolean traits get a separate frequency-only summary
(`CategoricalSummary` in `types.ts`); the engine never computes a mean/SD for
them.

**Performance limits** (task §40): `MAX_OBSERVATION_ROWS = 5000` observations
per analysis, enforced inside the SQL function itself
(`LIMIT LEAST(row_limit, 5000)`) — a caller cannot override the cap upward.
Individual trajectories are capped at `MAX_INDIVIDUAL_TRAJECTORIES = 25`
(population summary and derived features are still computed over every
fetched row; only the line-chart overlay is capped, to avoid an unreadable
"spaghetti plot" — see task §15). A rank-stability matrix is capped at the
`MAX_RANK_STABILITY_TIMEPOINTS = 6` most-observed distinct dates.

**Archived data** (task §42): `trait_observation_dataset` excludes
`deleted_at`-archived phenotypes/evaluations by default; the analytics page's
"Inclure les éléments archivés" checkbox is an explicit, user-driven opt-in —
archived and active material is never silently combined.

## 4. Descriptive statistics (`src/lib/analytics/stats.ts`)

All formulas are closed-form, textbook statistics with no iterative fitting —
every one is unit-tested against hand-derived or well-known reference values
in `tests/analytics-stats.test.ts`.

- **Mean, sample variance/SD** use Bessel's correction (`n-1`), the standard
  convention for an observed sample.
- **Quartiles** use linear interpolation between order statistics (R's
  `quantile(type = 7)` / numpy's default `percentile`), so values match a
  scientist's own re-analysis of the exported dataset exactly.
- **IQR** = Q3 − Q1. **MAD** = median of `|x - median(x)|`.
- **CV** (coefficient of variation) is computed as `SD / mean × 100` only when
  numerically meaningful. It is reported as `NOT_APPLICABLE` with a stated
  reason when: the mean is exactly zero (division by zero); the data spans
  both positive and negative values (no coherent ratio scale); or `|mean|` is
  under 5% of the observed range (numerically unstable/misleading).
- **Outliers**: Tukey's fences, `[Q1 − 1.5×IQR, Q3 + 1.5×IQR]`. Flagging is
  purely informational — the UI says "Valeur potentiellement aberrante"
  (potential outlier), never "bad measurement", and no outlier is ever deleted
  or modified automatically. Each flagged row shows its phenotype code,
  value, date, block, replicate, and family/seed lot for inspection.
- **Missing data**: `n_total` is the count of scoring *events* recorded for
  the same cohort (program/date-range/filters), independent of trait — see
  `program_evaluation_dataset` (migration 000027) — minus the observed count
  for this trait. BreedOps does not require every evaluation to score every
  active trait (`submit_trait_evaluation`, migration 000016, accepts a
  partial submission), so this is the honest, schema-supported definition of
  "expected but missing", not an invented denominator.

## 5. Longitudinal analysis (`src/lib/analytics/analysis.ts`)

The repeated-measure subject is `phenotype_id`; multiple evaluation dates for
the same phenotype are **never** treated as independent biological
replicates (task §14).

- **Population trajectory**: per distinct evaluation date, n/mean/median/Q1/Q3
  across all phenotypes observed that date.
- **Individual trajectories**: per-phenotype value-over-date lines, capped at
  25 entities (selected deterministically by phenotype code) to stay
  readable; the population summary and every derived feature below are still
  computed over the full dataset regardless of this display cap.
- **AUC**: trapezoidal integration (`trapezoidalAuc`) over actual elapsed
  days between an entity's own observations (never an assumed equal
  spacing). Time unit is days since the Unix epoch, truncated to each date's
  midnight UTC. Requires ≥2 distinct dates for that entity; `NOT_ESTIMABLE`
  otherwise.
- **Slope**: ordinary least squares of value on elapsed days
  (`linearSlope`). Requires ≥3 observations *and* real variability in time
  (not all on the same date); `NOT_ESTIMABLE` otherwise. Reported with its
  intercept and R².
- **Relative change**: `(last - first) / first`; reported as `null` (not a
  divide-by-zero) when the first value is exactly zero. The absolute change
  is always reported regardless.
- **Rank stability**: Spearman's ρ between every pair of the (at most 6)
  most-observed distinct dates, over phenotypes measured at both. A pair is
  shown with `insufficientN: true` (ρ withheld, `n` still shown) below
  `MIN_RANK_STABILITY_PAIRED_N = 8` paired entities — the sample size is
  never hidden, and ρ is never labelled a genetic correlation.
- **Within-entity stability**: per phenotype with ≥3 observations, SD, CV
  (same eligibility rule as above), range, and a per-entity slope. These
  describe measurement/phenotypic stability — explicitly *not* genetic
  stability (task §19).

## 6. Repeatability / ICC (`src/lib/analytics/icc.ts`)

**Why not a Python/REML engine.** The task brief's warning against hand-rolled
REML/BLUP targets general-purpose mixed models, which require iterative
variance-component optimization with no closed form. Repeatability here needs
only the *simplest* mixed model — a single random intercept per entity, no
fixed effects beyond the grand mean — which has an exact, closed-form solution
via one-way random-effects ANOVA (Lessells & Boag 1987; Searle 1971 for the
unbalanced-data adjustment `n₀`). This is the same formula R's `irr::icc`,
`psych::ICC`, and the single-random-effect case of `rptR` use. Introducing a
server-side Python subprocess (new runtime, process-invocation security
review, deployment-doc rewrite for macOS+Linux) would be disproportionate
scope for a statistic that reduces to sums of squares. `NEW_RUNTIME_REQUIRED
= NO`. A general mixed-model/REML foundation is explicitly deferred to
V2-05/V2-06, if and when a genuinely multi-factor model (e.g. G×E) requires
one — at that point this same architecture question should be re-audited.

**Eligibility** (`estimateRepeatability`): only entities with ≥2 observations
contribute (a singleton cannot inform within-entity variance); at least
`MIN_ICC_ENTITIES = 5` such entities are required. Zero variance both between
and within entities is `NOT_ESTIMABLE` (not a fabricated 0 or 1). Below the
threshold, every reason is spelled out, e.g. "Au moins 5 entités mesurées à 2
reprises ou plus sont nécessaires (trouvé : 3)."

**Confidence interval**: a cluster (entity-level) bootstrap percentile 95% CI
— resampling whole entities with replacement and recomputing the same
closed-form ICC each time (1000 replicates). This is a standard
non-parametric method (the same `rptR` offers for non-Gaussian repeatability)
requiring no special-function inverse CDF, unlike an F-distribution-based CI.
The seed (`20260401`) is explicit, fixed and persisted in the result, so the
interval is exactly reproducible (task §43).

## 7. Heritability

**Always `NOT_ESTIMABLE` in V2-04**, by design, with these stated reasons
(`src/lib/analytics/eligibility.ts#HERITABILITY_NOT_ESTIMABLE_REASONS`):

- No explicit genotype entity exists: `family_id`/`seed_lot_id` identify a
  breeding-population grouping, not a confirmed, repeated clonal/individual
  genetic identity.
- `block`/`replicate` are free-text/integer fields on each phenotype, not
  tied to a validated experimental design (randomization, complete blocks)
  that would let variance be partitioned into genetic vs. environmental
  components.
- No normalized environment model exists (`location` is free text) — a
  reliable heritability estimate needs to separate genetic and environmental
  effects, which the current schema cannot identify.

If a future milestone adds the missing genetic/experimental semantics
(explicit genotype identity, a validated design, a normalized environment),
heritability should be revisited with an explicit model formula, variance
components, an estimation method, and documented eligibility checks — never
retrofitted onto the current grouping columns.

## 8. Associations (`src/lib/analytics/associations.ts`)

For the primary trait against every other active numeric trait in the same
program: Pearson r and Spearman ρ, paired strictly by `evaluation_id` (the
same scoring event — never two different occasions for the same phenotype).
Pairs below `MIN_ASSOCIATION_PAIRED_N = 8` are shown with `n` but no
correlation value. A Benjamini-Hochberg FDR correction
(`benjaminiHochberg`) is applied across every pair actually tested in one
page view, exposing both the raw p-value and the adjusted q-value — never an
unqualified "significant" badge. Results are always labelled *phenotypic*
association, never genetic correlation.

## 9. Early-selection proxy explorer (`src/lib/analytics/proxy.ts`)

BreedOps has no "days after planting"/relative-time concept — only an
absolute `evaluation_date` per evaluation (audited: neither `phenotypes` nor
`programs` carries a trial-start or planting date). A "source window" and
"target window" are therefore explicit absolute date ranges the user picks.
A phenotype with multiple observations of a trait inside one window has them
averaged (mean value, mean date) rather than one arbitrarily chosen — a
deterministic, documented resolution of the ambiguity the schema itself
leaves open.

The evidence panel reports: paired entity count, median days earlier
(derived from the actual observation dates used, not assumed), Pearson r,
Spearman ρ, the source trait's own repeatability (if estimable), and the
fraction of source-window entities missing from the target window. The UI
never states a causal claim; it always appends: "Nécessite une validation
biologique indépendante avant toute utilisation comme critère de sélection."

## 10. Model eligibility & warnings

Every inferential result carries one of three states, never a silent
disabled control: `ELIGIBLE` (with its own diagnostics: n entities,
n observations, model definition), `NOT_ESTIMABLE` (with every missing
requirement spelled out), or a `CAUTION`/`INFO` warning (high missingness,
small sample, zero variance, insufficient temporal spread, mean near zero).
Warnings are rendered as plain visible text (`.analysis-warning`), not a
colour-only traffic light.

## 11. Analysis provenance & reproducibility

`analytics_runs` (migration 000027) is an explicit, user-triggered snapshot —
never an automatic save of every page view (which would make the table grow
unboundedly). It stores: organization/program/trait scope (re-derived
server-side from `program_id`, never trusted from the client — the same
pattern `media_assets`/`notifications` already use), a validated
`specification` (the exact filter set used), a `dataset_fingerprint`, a
compact structured `result` summary (never the full per-row dataset — both
JSONB columns are size-capped at the database level), `engine_name`/
`engine_version`, and `created_by`/timestamps.

**Immutability**: no UPDATE or DELETE grant exists on `analytics_runs` at
all (not just no policy) — a saved run is a fact about what was computed,
when, and from what data; if the question or the data changes, a new run is
created rather than editing an old one in place.

**Dataset fingerprint** (`src/lib/analytics/fingerprint.ts`): a sha256 hex
digest over the canonically-sorted `(evaluation_id, trait_value_id, trait_id,
phenotype_id, evaluation_date, numeric_value)` tuples that fed the run —
never a transient signed URL or presentation field. Reading a saved run
recomputes the current fingerprint for its own stored specification and
compares it; a mismatch means the underlying observations have changed since
the run was saved, and the UI marks it `PÉRIMÉE` (stale) rather than silently
presenting it as current.

## 12. R/Python interoperability

CSV and JSON export (`src/app/app/analytics/export/route.ts`) return the
exact tidy dataset an analysis was built from: trait metadata, phenotype
codes, family/seed-lot ids, block/replicate/location, evaluation dates, and
values — enough for an independent re-analysis in R, Python, JMP or SAS
without reverse-engineering BreedOps internals. No arbitrary executable
code is ever generated; no secret or internal auth field is ever included.

## 13. Security

- Every dataset read goes through the RLS-scoped client (`requireIdentity()`
  — never the service-role client) and the `trait_observation_dataset` /
  `program_evaluation_dataset` SQL functions, which are `SECURITY INVOKER`
  (the caller's own RLS on `phenotype_trait_values`/`phenotype_evaluations`/
  `phenotypes` still applies underneath, plus an explicit
  `can_access_program()` check).
- `analytics_runs` RLS requires `can_write_team` **and** `can_write_program`
  on INSERT, and re-derives `organization_id` from `program_id` via trigger
  — a forged `organization_id`/cross-team `program_id` pair cannot attach a
  run to the wrong team.
- No arbitrary code execution: the statistical engine is plain,
  dependency-free TypeScript running the exact closed-form formulas
  documented above — there is no code-evaluation path, no user-supplied
  formula string, no shell/process invocation at all.
- Tested in `tests/trait-analytics.sql` (pgTap: RLS, cross-team denial,
  scope validation, CHECK constraints, immutable provenance) and
  `tests/trait-analytics.integration.test.ts` (real HTTP + a second
  directly-authenticated client for the cross-team boundary).
