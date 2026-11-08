# 10 — Import and export

## Import

BreedOps supports structured CSV/XLSX import for supported registers.

Recommended workflow:

1. choose the entity type;
2. load the file;
3. map input columns to BreedOps fields;
4. preview;
5. correct blocking errors;
6. import.

The preview distinguishes creation, update, warning and error states. Imports
use stable business identities and are designed to avoid silent fuzzy matching.

## Export

Exports are useful for exchange, review and independent analysis.

A functional backup workbook is **not** the same as an infrastructure backup.
It does not replace PostgreSQL + media backup for disaster recovery.

See [Backup and restore](../admin/backup-restore.md).
