# Database Design

## Overview

BreedOps uses a PostgreSQL database with Supabase for authentication and storage. The database schema is designed to be normalized and follow the requirements in the project specification.

## Core Entities

### Organizations
Stores information about organizations using the platform.

### Profiles
Stores user profile information linked to Supabase auth users.

### Programs
Manages breeding programs within organizations.

### Team membership
Migration 000003 removes program_members. Each profile belongs to one organization/team;
program access inherits that team. V1 uses system_admin, team_admin and user.
Migration 000005 guards profile identity and privileged-role boundaries and restricts
trigger-only calculation functions. The 17 auth/RLS assertions pass on local PostgreSQL.

### Parent Lines
Stores information about parent lines used in crosses.

### Crosses
Records crossing events between parent lines.

### Families
Organizes crosses into families.

### Seed Lots
Tracks seed lots generated from families.

### Germination Tests
Records germination test results for seed lots.

### Phenotypes
Stores phenotypic information about individuals.

### Selection Models
Defines models for phenotypic evaluation.

### Selection Criteria
Defines criteria for selection models.

### Phenotype Evaluations
Records evaluations of phenotypes.

### Phenotype Scores
Stores individual scores for each selection criterion.

### Inventory Items
Tracks inventory items (reagents, consumables, equipment).

### Inventory Lots
Manages lots of inventory items.

### Inventory Movements
Records movements of inventory items.

### Task Templates
Defines reusable templates for experimental tasks.

### Experimental Cycles
Organizes tasks into experimental cycles.

### Tasks
Records specific tasks within experimental cycles.

### Task Checklist Items
Tracks checklist items for tasks.

### Audit Logs
Records all significant actions for audit purposes.

## Relationships

```mermaid
erDiagram
    ORGANIZATION ||--o{ PROGRAM : contains
    PROGRAM ||--o{ PARENT_LINE : contains
    PROGRAM ||--o{ CROSS : contains

    PARENT_LINE ||--o{ CROSS : female_parent
    PARENT_LINE ||--o{ CROSS : male_parent

    CROSS ||--o{ FAMILY : produces
    FAMILY ||--o{ SEED_LOT : produces
    SEED_LOT ||--o{ GERMINATION_TEST : receives

    SEED_LOT ||--o{ PHENOTYPE : generates
    PHENOTYPE ||--o{ PHENOTYPE_EVALUATION : receives
    PHENOTYPE_EVALUATION ||--o{ PHENOTYPE_SCORE : contains

    ORGANIZATION ||--o{ INVENTORY_ITEM : manages
    INVENTORY_ITEM ||--o{ INVENTORY_LOT : contains
    INVENTORY_LOT ||--o{ INVENTORY_MOVEMENT : tracks

    PROGRAM ||--o{ EXPERIMENTAL_CYCLE : contains
    EXPERIMENTAL_CYCLE ||--o{ TASK : generates
```

## Data Types and Constraints

All tables follow the naming conventions:
- `id` (UUID)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `created_by` (UUID)
- `updated_by` (UUID)
- `deleted_at` (timestamp for soft deletes)
- `organization_id` (UUID)
- `program_id` (UUID, when relevant)

## Security and RLS

Row-Level Security (RLS) policies are implemented on all tables to ensure proper data isolation:
- Users can only access data within their organization
- Program-specific access is controlled via program membership
- All data operations are logged in the audit log

## Calculations and Functions

### Germination Rate Calculation
```sql
germination_rate = (seeds_germinated / seeds_tested) * 100
```

### Seed Yield Calculation
```sql
seed_yield_per_pollinated_unit = total_seeds / pollinated_units
```

### Score Calculations
- Weighted score: sum of weighted criterion scores
- Normalized score: weighted score / maximum score * 100
- Automatic decision: based on score and stability thresholds

### Stock Calculations
```sql
current_quantity = initial_quantity + total_positive_movements - total_negative_movements
estimated_coverage = current_quantity / average_weekly_consumption
days_before_expiration = expiration_date - current_date
```

### Delay Calculation
```sql
delay_days = max(0, current_date - due_date)
```

## Indexes

All tables have appropriate indexes for performance:
- Foreign key indexes
- Frequently queried columns
- Composite indexes for complex queries
- Audit log indexes for performance

## Migration Strategy

Database migrations are versioned and sequential:
- One migration file per logical change
- Migrations are never edited after being applied
- All migrations are tested on a clean database
- Functions and policies are part of the migration files
