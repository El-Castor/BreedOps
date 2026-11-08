# Database

The authoritative schema is defined by versioned SQL migrations in
`supabase/migrations/`.

Do not edit historical migrations after they have been applied to retained
environments. Add a new migration instead.

The schema includes organization/program scoping, breeding lineage, phenotype
configuration/evaluations, inventory, workflows, analytics metadata, offline
synchronization receipts and supporting audit/security structures.

Row-Level Security is part of the security model and is tested by dedicated SQL
test suites.
