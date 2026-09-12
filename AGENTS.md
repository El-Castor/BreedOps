# AGENTS.md — BreedOps

These instructions apply to every coding agent, AI assistant and automation
operating in the BreedOps repository.

They define cross-agent engineering, security, data, validation and project-state
rules.

Agent-specific instructions may exist in files such as `CLAUDE.md`, but they must
not override this file's project-wide safety and correctness requirements.

---

## 1. Mission

BreedOps is a secure web application for managing plant breeding and floriculture
programs.

The MVP covers five main functional domains:

1. crosses, families and seed lots;
2. phenotypic evaluation and selection;
3. inventory and stock movements;
4. experimental scheduling, calendar and Gantt;
5. dashboards, alerts, import/export and operational reporting.

The application must prioritize:

- scientific traceability;
- data integrity;
- reproducibility;
- authorization correctness;
- auditability;
- maintainability;
- secure multi-user operation.

Do not optimize for feature count at the expense of data integrity or security.

---

## 2. Canonical project files and their roles

The root project files have distinct responsibilities.

### `PROMPT.md`

Functional and product specification.

It defines what BreedOps is expected to provide.

### `AGENTS.md`

Cross-agent engineering, security and development rules.

This file applies to every coding agent.

### `CLAUDE.md`

Claude Code-specific execution instructions only.

Cross-agent project rules must not exist exclusively in `CLAUDE.md`.

### `agend.md`

Operational roadmap and last reconciled project-state index.

It records:

- completed work;
- incomplete work;
- blockers;
- milestones/phases;
- observed validation state;
- next recommended work.

`agend.md` is NOT authoritative over executable repository evidence.

If it disagrees with the repository, tests, migrations or observed outputs,
reconcile and update `agend.md`.

---

## 3. Canonical repository root

At the beginning of a working session determine the repository root with:

`git rev-parse --show-toplevel`

That Git repository is the only writable BreedOps project root.

All project paths must resolve inside that repository.

Never:

- recreate historical/legacy BreedOps directories;
- write project files outside the canonical Git root;
- silently operate from a parent workspace instead of the repository;
- assume the current working directory is the repository root without checking.

Repository evidence is authoritative for current implementation state.

---

## 4. Truth hierarchy

When sources disagree, use the following hierarchy.

1. executable repository evidence;
2. passing tests, migrations and observed runtime outputs;
3. current database schema and security behavior;
4. current ADRs and accepted specifications;
5. `PROMPT.md`;
6. `agend.md` and technical documentation;
7. curated Basic Memory;
8. historical session/chat context.

Never mark work complete solely because documentation says it is complete.

Never repeat previously validated work merely because a stale roadmap or memory
entry says it is incomplete.

Record material inconsistencies instead of silently selecting whichever source is
most convenient.

---

## 5. Persistent memory

BreedOps durable cognitive memory uses Basic Memory MCP.

Canonical Basic Memory project:

`research-memory`

Do not use Basic Memory project `main` for BreedOps.

Persistent memory is used for durable knowledge such as:

- canonical BreedOps Project state;
- Directives;
- accepted Decisions;
- architecture decisions;
- reusable Methods;
- significant Experiment/Validation Results;
- Session Checkpoints;
- durable limitations or blockers.

Do NOT store:

- raw logs;
- command output;
- secrets;
- passwords;
- tokens;
- environment-variable values;
- transient debugging details;
- one note per source file;
- information already adequately represented by Git history.

Search before creating a new persistent entity.

Prefer updating a canonical existing entity over creating duplicates.

For a coherent milestone memory update:

1. WRITE/EDIT the required durable entities;
2. SEARCH-BACK once after the coherent write batch;
3. READ-BACK the affected canonical entities;
4. VERIFY that persistence matches repository evidence.

Do not perform redundant search/read cycles after every small edit when several
writes belong to the same atomic milestone update.

Never claim persistence succeeded without successful verification.

---

## 6. Session startup and state reconciliation

Run the complete reconciliation gate once at session startup before substantial
implementation.

1. Resolve the canonical Git root.
2. Inspect current branch and working-tree state.
3. Retrieve only the minimum relevant Basic Memory context:
   - canonical BreedOps Project;
   - active BreedOps Directives;
   - latest relevant Session Checkpoint;
   - Decisions relevant to the current work.
4. Read:
   - `agend.md`;
   - the relevant parts of `PROMPT.md`;
   - applicable architecture/database/security documentation.
5. Inspect Git history and executable repository evidence only as needed to
   verify the claimed project state.
6. Reconcile discrepancies using the truth hierarchy.
7. Determine the smallest coherent next milestone.

Do not load the complete repository, complete Basic Memory graph or complete
project history merely as part of startup.

Do not repeat the entire startup reconciliation between related milestones in
the same session unless project state became materially inconsistent.

---

## 7. Selected technical stack

Unless an accepted Decision/ADR explicitly changes it, BreedOps uses:

### Application

- Next.js App Router;
- React;
- TypeScript strict mode;
- Tailwind CSS;
- React Hook Form;
- Zod;
- TanStack Table;
- Recharts;
- date-fns.

### Backend and data

- Supabase;
- PostgreSQL;
- Supabase Auth;
- Row-Level Security;
- versioned SQL migrations;
- PostgreSQL functions for critical business calculations.

### Quality

- ESLint;
- Prettier;
- Vitest;
- Playwright;
- strict TypeScript validation;
- GitHub Actions when CI is introduced.

Do not replace the selected stack without a documented technical reason and an
accepted architectural decision.

Avoid unnecessary infrastructure or framework proliferation.

---

## 8. Development environment

Development tooling should be isolated and reproducible.

When Node.js/npm are managed through a dedicated Conda environment, use the
BreedOps development environment rather than installing conflicting global
runtime versions.

Before depending on a runtime or tool, verify it with commands such as:

- `node --version`
- `npm --version`
- `npx --version`

Do not assume globally installed tooling exists.

Do not commit:

- `node_modules`;
- local environment files;
- local Supabase runtime state;
- machine-specific caches;
- credentials.

Pin or document the supported Node.js version once validated against the selected
Next.js/tooling stack.

---

## 9. Database and migration discipline

PostgreSQL is the authoritative persistence layer.

Use:

- UUID primary keys;
- explicit foreign keys;
- explicit constraints;
- indexes justified by access patterns;
- UTC timestamps;
- normalized relational structures;
- versioned SQL migrations.

Applied migrations are immutable.

Never edit a migration that has already been applied to a persistent retained
environment.

A migration that has never been applied anywhere persistent may still be corrected
before its first validated application.

Every database change must be represented by migration evidence.

Migrations must be tested from a clean database when affected by the current
milestone.

Do not modify database state manually as a substitute for migrations.

---

## 10. Data lineage and auditability

BreedOps manages scientific and operational data.

Preserve provenance for important records.

Where applicable, entities should retain:

- `id`;
- `created_at`;
- `updated_at`;
- `created_by`;
- `updated_by`;
- `organization_id`;
- `program_id`;
- `deleted_at`.

Derived values must be traceable to their inputs and calculation version where
scientifically relevant.

Do not overwrite historical observations merely to reflect a newer derived value.

---

## 11. Critical business calculations

Critical scientific/business values must not rely on client-side calculations as
their authoritative implementation.

Authoritative values should be calculated server-side or in PostgreSQL where
appropriate.

This includes, when relevant:

- germination rate;
- yield per pollinated unit;
- weighted phenotype scores;
- normalized scores;
- automatic selection decisions;
- inventory quantities;
- estimated stock coverage;
- schedule delays;
- other values affecting scientific or operational decisions.

Frontend calculations may be used for previews or display only when authoritative
values are still validated server-side.

Every critical calculation must have deterministic tests.

---

## 12. Authentication and authorization

BreedOps uses layered authorization.

Authorization must be enforced at three levels where applicable:

1. user interface;
2. server/application layer;
3. PostgreSQL Row-Level Security.

UI restrictions are never a security boundary by themselves.

Server-side authorization does not replace RLS.

RLS does not eliminate the need for server-side authorization.

The current role vocabulary includes:

- `system_admin`;
- `organization_admin`;
- `program_manager`;
- `technician`;
- `analyst`;
- `viewer`;
- `auditor`.

Do not invent role capabilities that have not been approved.

Do not allow client-side code to:

- assign privileged roles;
- bypass RLS;
- use service-role credentials;
- bootstrap privileged tenants/users without a controlled server-side path.

---

## 13. Unresolved authorization decisions

The following topics require explicit resolution before authentication and
authorization are considered production-ready:

- organization bootstrap;
- initial administrator provisioning;
- exact organization membership semantics;
- exact program membership semantics;
- organization-wide vs program-scoped access;
- role-permission matrix;
- behavior of `system_admin`;
- organization RLS policies;
- deletion/cascade semantics.

Do not silently invent these rules.

If implementation requires one of these unresolved choices and no accepted
Decision/ADR exists, stop and request human approval.

Permissive RLS policies such as unrestricted `USING (true)` or
`WITH CHECK (true)` on tenant-sensitive tables must not be accepted as secure
final behavior.

---

## 14. Tenant isolation

Multi-tenant access must be enforced using database and server evidence.

At minimum, authorization tests must eventually prove that:

- unauthenticated access is denied where required;
- users cannot read another tenant's data;
- users cannot modify another tenant's data;
- program-scoped access cannot escape the authorized program scope;
- administrative privileges cannot be self-assigned;
- server-side authorization and RLS agree.

Never infer tenant isolation from UI behavior.

---

## 15. Soft deletion and destructive operations

BreedOps requires soft deletion for business data unless an accepted decision
explicitly establishes otherwise.

`deleted_at` is the normal deletion mechanism for persistent business entities.

Normal application flows must not physically destroy scientific, operational or
audit history.

Review `ON DELETE CASCADE` relationships carefully.

Use destructive cascade only where the dependent data is genuinely technical and
has no independent historical/audit value.

Prefer `RESTRICT` / `NO ACTION` where deleting a parent could destroy meaningful
history.

Any destructive migration or irreversible data operation requires explicit human
approval and a backup/migration strategy.

---

## 16. Secrets and Supabase credentials

Never commit or persist secrets.

Secrets belong only in:

- environment variables;
- approved local secret stores;
- deployment secret management.

Never place secrets in:

- source code;
- Git history;
- `PROMPT.md`;
- `AGENTS.md`;
- `CLAUDE.md`;
- `agend.md`;
- Basic Memory;
- Obsidian;
- test fixtures;
- logs.

Supabase `service_role` credentials must never reach browser/client code.

`.env.example` contains placeholders only.

---

## 17. Local Supabase and test environments

Prefer disposable/local test infrastructure before relying on persistent cloud
environments when practical.

Local Supabase/PostgreSQL environments may be used for:

- clean migration tests;
- RLS validation;
- test fixtures;
- destructive integration tests;
- authorization experiments.

Never run destructive tests against production or irreplaceable data.

A hosted Supabase project must not be assumed available unless it has actually
been provisioned and linked.

---

## 18. Testing strategy

Use progressive validation.

### During implementation

Run the smallest useful checks first:

- tests directly related to changed behavior;
- targeted TypeScript checks;
- targeted linting;
- targeted database/RLS tests;
- targeted integration tests.

After fixing a failure, rerun the failing or directly affected check first.

Do not repeatedly run the entire repository validation while actively editing.

### Final milestone gate

After the final relevant code change, run each required broad validation category
once:

1. required test suite;
2. strict TypeScript validation;
3. lint/format checks;
4. affected database/migration tests;
5. affected authorization/RLS tests;
6. affected integration tests;
7. required security checks;
8. production build when the milestone affects application buildability.

Do not repeat a passing broad validation unless subsequent changes could affect
its result.

Use the strongest required environment directly.

For example, do not run a complete suite that skips database tests immediately
before running the same complete suite again with the database enabled.

---

## 19. Test requirements

Tests must be meaningful rather than written merely to increase test counts.

Use:

- Vitest for unit and integration tests;
- dedicated database/RLS tests for authorization;
- Playwright for end-to-end flows that genuinely require a browser.

Do not introduce Playwright tests before there is an actual browser workflow to
validate.

Tests should cover behavior and security boundaries, not implementation details
without value.

Critical calculations require deterministic unit tests.

Authorization requires negative tests, not only successful-access tests.

---

## 20. Import and export discipline

Imports must eventually be:

- validated;
- previewable;
- transactional;
- idempotent where practical;
- mapped explicitly from source columns;
- capable of generating actionable error reports.

Never silently discard invalid rows.

Business identifiers should be used where appropriate to avoid duplicate imports.

Exports must preserve sufficient identifiers and metadata for traceability.

Functional backup/export is distinct from database backup.

---

## 21. Scientific integrity

Do not fabricate scientific values, breeding observations, phenotypes, germination
results, inventory values or experimental dates.

Fixtures and demo data must be explicitly identifiable as synthetic/demo data.

Synthetic test data must never be presented as experimental evidence.

Calculations used for selection or scientific interpretation must be deterministic
and reproducible.

---

## 22. Security discipline

Treat all external/user-provided data as untrusted.

Apply appropriate protections against:

- SQL injection;
- XSS;
- CSRF;
- insecure direct object references;
- privilege escalation;
- tenant escape;
- insecure file access;
- unsafe redirects;
- leaked credentials;
- authorization bypass.

Server Actions and API routes must perform explicit authorization.

Security-sensitive changes require focused validation before completion.

Do not weaken a security control merely to make a test or implementation pass.

---

## 23. Git discipline

Before modifying files:

- inspect current working-tree state;
- preserve unrelated user changes;
- do not overwrite pre-existing work without understanding it.

Prefer one clean validated commit per coherent milestone.

Before committing:

1. inspect the changed/staged file set;
2. ensure secrets and generated local state are excluded;
3. ensure unrelated changes are not accidentally included;
4. ensure required validation passed.

Do not:

- force-push;
- rewrite validated shared history;
- push automatically;
- discard user changes;
- commit unrelated machine-local configuration.

Local commits are allowed.

The user decides when to push unless explicit permission has been given.

---

## 24. Milestone execution

Work in coherent milestones derived from `agend.md`, `PROMPT.md` and executable
repository state.

For each milestone:

1. define the smallest coherent scope;
2. state the acceptance gate;
3. implement only what is required;
4. use progressive validation during development;
5. run the complete milestone-required validation once after the final relevant
   change;
6. classify the result as:
   - PASS;
   - HOLD;
   - FAIL;
7. update `agend.md` using observed evidence;
8. update relevant technical documentation only where implementation changed;
9. persist only durable knowledge to Basic Memory when justified;
10. create a clean local Git commit.

Do not mark a milestone PASS if required validation could not be executed.

Do not equate "file exists" with "feature works".

---

## 25. Continuous work and context efficiency

Milestones are implementation units, not mandatory session boundaries.

Agents may continue to another milestone in the same session when:

- the next milestone is closely related;
- current context remains useful;
- repository state is clean and reconciled;
- no human decision is required.

Before loading the next milestone, assess whether current context remains
efficient.

When substantial debugging, logs, completed work or unrelated history dominate
the conversation, stop at the clean milestone boundary and recommend context
compaction or a fresh session.

Do not start the next milestone and only afterward decide that the session should
have been reset.

Avoid unnecessary context growth:

- use targeted repository inspection;
- avoid repeatedly reading the same files;
- prefer symbol-level/code-navigation tools when available;
- keep command output bounded;
- do not repeatedly run `git status`, `git diff` and `git log` to establish the
  same state;
- do not load generated configuration files in full unless directly relevant.

---

## 26. Documentation discipline

Documentation must describe validated behavior, not planned behavior as if already
implemented.

Update documentation when implementation materially changes.

Do not create documentation solely to record trivial implementation steps.

Prefer:

- code and tests for executable truth;
- `agend.md` for operational progress;
- ADR/Decision records for durable architectural choices;
- Basic Memory for durable cross-session knowledge.

Avoid duplicate status documents describing the same state.

---

## 27. Human approval gates

Stop and request explicit user input before:

- resolving an unapproved authorization model;
- changing tenancy semantics;
- defining privileged-role bootstrap behavior;
- materially changing role permissions;
- weakening RLS;
- introducing a public unauthenticated service;
- adding paid infrastructure or services;
- applying destructive migrations to persistent data;
- deleting or rewriting persistent user/scientific data;
- changing the required technology stack;
- handling real credentials not already provisioned securely;
- making a material architectural choice with multiple reasonable alternatives.

Do not manufacture a decision in order to keep working.

---

## 28. Stop conditions

Stop the current milestone when:

- acceptance criteria cannot be satisfied;
- required tooling/environment is unavailable;
- a required credential/environment requires user provisioning;
- an unresolved human approval gate is reached;
- a security issue prevents safe continuation;
- repository and persistent-memory state cannot be reconciled;
- requirements are materially ambiguous;
- continuing would risk destructive or irreversible changes.

Classify the milestone as HOLD or FAIL as appropriate and report the exact
blocking condition.

---

## 29. Definition of done

A BreedOps feature is done only when the applicable combination of the following
agree:

- implementation exists;
- types are valid;
- tests pass;
- authorization is verified;
- RLS is verified where applicable;
- migrations are valid where applicable;
- critical calculations are tested;
- build succeeds where applicable;
- documentation reflects implementation;
- `agend.md` reflects observed state;
- durable decisions/checkpoints are persisted when required.

A milestone is not done merely because code compiles.

A task is not complete merely because a file exists.

---

## 30. Current project-state principle

Do not encode transient project status in `AGENTS.md`.

The current implementation state belongs in `agend.md` and executable repository
evidence.

When resuming work:

repository evidence
→ reconcile `agend.md`
→ retrieve relevant Basic Memory
→ determine next coherent milestone
→ implement
→ validate
→ commit
→ update durable state.