# 11 — Trait analytics

Trait analytics summarize observed phenotype data.

## Suitable traits

Numeric, integer and ordinal traits can be used for numerical statistics.
Categorical or text traits should not be forced into numerical analyses.

## Outputs

Depending on the data, BreedOps can show:

- counts and missingness;
- mean, median, standard deviation and coefficient of variation;
- histogram and box plot;
- potential outliers;
- longitudinal trajectories;
- rank stability between dates;
- repeatability where estimable;
- phenotypic associations with other traits.

## Important interpretation rule

Phenotypic correlation is not genetic correlation.
Repeatability is not heritability.

BreedOps intentionally reports some quantities as **NOT ESTIMABLE** when the
experimental structure does not support a defensible estimate.

## Saved analyses

Saved analyses include a reproducibility fingerprint. If the underlying data
change, BreedOps can mark the old result stale.
