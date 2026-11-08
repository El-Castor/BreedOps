# Third-party software notices

BreedOps depends on third-party open-source software distributed under its own
licenses. Those licenses remain applicable to the corresponding components.

The authoritative dependency lists are:

- `package.json` / `package-lock.json` for Node.js dependencies.
- `analytics-r/renv.lock` for R dependencies.
- The Supabase CLI/runtime and container images used by the deployment.

This file does **not** replace the licenses of those projects.

Before a public or institutional distribution, generate and archive a
third-party license inventory for the exact release. At minimum:

```bash
npm ci
npx license-checker --production --json > third-party-node-licenses.json
```

For R, review the `License` field of packages recorded in `analytics-r/renv.lock`
and the installed package metadata in the validated `renv` library.

If BreedOps is distributed beyond a limited pilot, this notice should be
completed with the exact required attribution texts for the selected release.
