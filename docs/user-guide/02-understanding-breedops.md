# 2 — Understanding BreedOps

BreedOps is not just a database. It connects three layers of work.

## Biological material

Parents, crosses, families, seed lots and phenotypes describe **what biological
material exists and where it came from**.

## Experimental evidence

Evaluations, images, environments, traits and analyses describe **what was
measured, under which conditions, and when**.

## Decisions

Scores, stability analyses and selection scenarios describe **how evidence is
summarized to support a decision**.

BreedOps deliberately keeps those layers separate. A plant can have an
excellent observed phenotype without that observation automatically becoming
a statement about additive genetic value.

## What BreedOps calculates automatically

Depending on the module, BreedOps can calculate or derive:

- germination percentage;
- cross yield;
- weighted/normalized phenotype scores;
- eliminatory-rule outcomes;
- descriptive statistics;
- repeatability where estimable;
- multi-environment model outputs;
- selection indices and differentials;
- stock levels and coverage indicators;
- task delays and dependency-aware dates.

The database or R engine performs the critical calculation; the browser does
not silently invent authoritative scientific results.
