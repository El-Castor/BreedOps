# Analytics engine

BreedOps uses server-side R scripts stored under `analytics-r/`.

## Reproducibility

`analytics-r/renv.lock` pins the R package environment.

## Health check

```bash
cd analytics-r
Rscript -e 'install.packages("renv"); renv::restore()'
LC_ALL=C.UTF-8 LANG=C.UTF-8 RENV_CONFIG_STARTUP_QUIET=TRUE   Rscript scripts/health_check.R
```

## Models

The engine includes multi-environment and selection workflows such as mixed
models, AMMI, GGE, WAASB/WAASBY, Finlay–Wilkinson, MGIDI and MTSI.

The Node.js application passes a restricted environment to R subprocesses
rather than forwarding all server secrets.
