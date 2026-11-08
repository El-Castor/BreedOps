# 12 — Multi-environment analysis

Multi-environment analysis asks whether material performs consistently across
defined environments.

## Structure first

Define:

- sites;
- environments;
- trial;
- trial entries;
- the scientific role of each entry.

BreedOps only uses G×E terminology when the entry is explicitly treated as a
genotype. Otherwise, interpret the result more generally as
**Entry × Environment**.

## Design diagnostics

Before model fitting, BreedOps checks whether the data are sufficient for the
requested analysis. A non-estimable design should remain non-estimable.

## Available models

The R engine includes:

- base mixed model;
- AMMI;
- GGE;
- WAASB / WAASBY;
- Finlay–Wilkinson.

Use the model appropriate to the biological question and design. Do not select
a method solely because it produces a ranking.

For background, read
[Multi-environment trials](../concepts/multi-environment-trials.md).
