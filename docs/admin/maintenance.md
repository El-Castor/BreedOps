# Maintenance

## Before an upgrade

1. create a verified backup;
2. record the current release/commit;
3. stop the application cleanly;
4. update the release checkout;
5. install dependencies;
6. apply migrations;
7. restore/update the R environment if `renv.lock` changed;
8. build;
9. restart;
10. run smoke tests.

## Health checks

Application:

```bash
curl -fsS http://127.0.0.1:3107/api/health
```

R:

```bash
cd analytics-r
LC_ALL=C.UTF-8 LANG=C.UTF-8 RENV_CONFIG_STARTUP_QUIET=TRUE   Rscript scripts/health_check.R
```

Monitor disk usage and backup storage growth regularly.
