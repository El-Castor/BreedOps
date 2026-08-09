# CLAUDE.md — BreedOps project instructions

This file governs **how** work is done in this repository. It is deliberately distinct from the other two root files:

- `PROMPT.md` — the product specification and requirements (read-only reference; do not edit unless the spec itself changes).
- `agend.md` — the living roadmap and the **actual** implementation state (updated after every meaningful change).

Never conflate these three files. `PROMPT.md` says *what to build*, `agend.md` says *where we are*, this file says *how to work*.

---

## 1. Source of truth

- **Specification**: read `PROMPT.md` before any architectural or functional change.
- **Roadmap / actual state**: check `agend.md` before starting, update it after.
- **Process**: this file.

---

## 2. Stack (fixed unless changed with documented justification)

- **Frontend**: Next.js (App Router), TypeScript strict, React, Tailwind CSS, React Hook Form, Zod (with `@hookform/resolvers`), TanStack Table, Recharts (lightweight React charts), date-fns.
- **Backend / data**: Supabase, PostgreSQL, Supabase Auth, Row-Level Security, Supabase Storage only if the MVP needs it, versioned SQL migrations (one file per migration, sequential, applied once), PostgreSQL functions for critical calculations.
- **Quality**: ESLint, Prettier, Vitest (unit + integration), Playwright (E2E), strict `tsc --noEmit`, GitHub Actions CI when the repo is hosted on GitHub.

Do not change a primary technology without documenting the precise justification in `agend.md` (decision log).

---

## 3. Verification discipline (critical)

- **Never assume filesystem state from instructions or memory.** Verify with the shell (`ls`, `find`, `git status`) and by reading files before claiming something exists.
- **Never claim** a file, dependency, migration, test, configuration, or feature exists unless it has been directly verified.
- **Never mark a roadmap item complete merely because code was written.**

A task is complete only when: implementation exists, validation passes (strict `tsc`, lint), relevant tests pass, permissions are verified (server-side + RLS) where sensitive, and documentation is updated.

---

## 4. Per-task workflow

For every task:

1. Inspect the relevant existing code.
2. Check `PROMPT.md`.
3. Check the current state in `agend.md`.
4. Implement the smallest coherent increment.
5. Add or update tests.
6. Run relevant tests.
7. Run `tsc --noEmit` and lint when relevant.
8. Update documentation.
9. Update `agend.md`.

Work in small, testable, documented increments. Do not stop mid-task unless a genuinely indispensable piece is missing; in that case complete everything possible and record the blocker in `agend.md`.

---

## 5. Engineering principles

- TypeScript strict mode; no `any` without justification.
- Prefer simple, maintainable implementations; preserve existing functional code.
- **Authorization is enforced at three layers**: UI hint, server-side check, and PostgreSQL RLS. A hidden button is never sufficient.
- Database migrations are versioned — sequential, never edited after being applied.
- **Never trust browser-sent computed values.** Recalculate critical business values server-side or in PostgreSQL (germination rate, yield, weighted/normalized score, stock levels, delays).
- Soft-delete scientific data (`deleted_at`); preserve referential integrity.
- Never expose secrets; service-role keys are server-side only; `.env.example` holds no real values.
- Transactions for multi-step operations; validate imports; prevent silent duplicates (use business codes for idempotency).
- Web hardening: CSP, security headers, HttpOnly/Secure/SameSite cookies, Zod validation, parameterized queries, no unescaped HTML injection.
- Do not bypass tests to pass CI. Never weaken a security check to fix a bug.

---

## 6. Conventions

- **Naming**: kebab-case for files and SQL migration names; camelCase for TS variables/functions; PascalCase for React components and types; snake_case for SQL identifiers and PostgreSQL functions.
- **Git**: small, logical commits; conventional-style messages; end commit messages with the `Co-Authored-By: Claude` trailer. Commit only when the user asks.
- **UI**: French, professional, responsive (desktop/tablet/phone), accessible — keyboard navigable, screen-reader compatible, sufficient contrast, consistent across modules. Every page handles: loading, empty, error, forbidden, success, partial data, delete confirmation, and validating states. Errors must not leak sensitive internal information.
- **Data shape**: every main table carries, when relevant — `id` (UUID), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (soft delete), `organization_id`, `program_id`, appropriate foreign keys, indexes, and SQL comments.

---

## 7. Roles (authorization basis)

`system_admin` (full access) · `organization_admin` (org programs and users) · `program_manager` (their programs' data) · `technician` (create/edit permitted experimental data) · `analyst` (read + add analytical results, cannot modify validated raw data) · `viewer` (read-only) · `auditor` (read + audit logs).

---

## 8. Demo & test data

- Seeded data is fictitious, coherent, and clearly labeled as demonstration data.
- Tests must cover at minimum the calculations and RLS scenarios listed in `PROMPT.md` §17 (unit calcs: germination, yield, weighted/normalized score, decision, stock coverage, threshold alerts, expiration alerts, delay; RLS: cross-org, unassigned program, role escalation, validated-score protection, audit-log tampering, direct stock mutation).

---

## 9. Out of MVP scope (architecture must allow later)

Interactive pedigree · QR codes · advanced photography · e-mail/push notifications · advanced statistics · inter-year comparison · offline mode (PWA) · native mobile · lab-instrument integration · LDAP/SSO. Use stable IDs, separated business services, and normalized relations so these can be added without a major refactor.
