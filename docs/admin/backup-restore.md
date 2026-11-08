# Backup and restore

BreedOps has two distinct backup layers.

## Functional export

Useful for portable scientific/business data exchange. It is not a complete
disaster-recovery backup.

## Infrastructure backup

Must include:

- PostgreSQL data;
- authentication records/configuration required by the deployment;
- private media binaries and metadata.

Use the repository backup/restore scripts and store copies away from the host
machine.

Recommended pilot policy:

- daily rotating backup;
- backup before each upgrade/migration;
- weekly retained copy;
- periodic restore drill on disposable infrastructure.

A backup strategy is not validated until a restoration has succeeded.
