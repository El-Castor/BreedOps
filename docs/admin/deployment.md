# Deployment

BreedOps is designed for self-hosted deployment because the analytics layer
requires a server-side R runtime in addition to Next.js and Supabase.

## Components

- Next.js application;
- Supabase/PostgreSQL/Auth/Storage;
- R + `renv`;
- HTTPS/reverse access layer for remote PWA use.

## Production separation

Use a dedicated production checkout and production environment. Never run the
retained pilot from the same checkout used for development.

## Minimal deployment sequence

```bash
git clone <release-repository-url> BreedOps-production
cd BreedOps-production
npm ci
npm run db:start
npm run local:configure
npm run local:provision-admin

cd analytics-r
Rscript -e 'install.packages("renv"); renv::restore()'
LC_ALL=C.UTF-8 LANG=C.UTF-8 RENV_CONFIG_STARTUP_QUIET=TRUE   Rscript scripts/health_check.R
cd ..

npm run build
npm run start -- --hostname 127.0.0.1 --port 3107
```

Before exposing the application remotely, configure HTTPS and keep all
database/Supabase internal ports private.

For a retained deployment, supervise the Next.js process and ensure the
Supabase/Docker stack restarts after host reboot.
