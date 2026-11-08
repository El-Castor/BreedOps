# 6 — Trials and phenotyping

Phenotyping turns observations into structured evidence.

## 1. Define traits

A trait describes **what is measured**. Its metadata can include type, unit,
bounds, allowed values and selection direction.

## 2. Group traits into modules

Modules let the team reuse coherent sets of traits.

## 3. Activate the relevant configuration for the programme

Only active traits appear in new evaluation forms.

## 4. Create phenotypes and evaluations

A phenotype represents the observed material/entity in the operational
workflow. An evaluation represents measurements made at a given time.

BreedOps validates values against the trait definition before storing them.

## Weighted selection model

Traits can contribute to a weighted score. A criterion may also be
**eliminatory**. An eliminatory failure can force an evaluation to be rejected
even if its weighted score is otherwise high.

This distinction is important: a high global score does not override a
scientifically mandatory threshold.

## Partial measurements

If all weighted information required for ranking is not available, BreedOps can
retain the observation without pretending that a complete ranking exists.

## Images

Images are supplementary evidence. They can carry acquisition metadata and
annotations, but they do not silently change numerical phenotype scores.
