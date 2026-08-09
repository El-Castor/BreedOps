<p align="center">
  <img src="assets/breedops_banner.png" alt="BreedOps banner" width="100%" />
</p>

<p align="center">
  <img src="assets/breedops_logo.png" alt="BreedOps logo" width="220" />
</p>

<!--
When your animated logo is ready, replace the static logo block above with this:

<p align="center">
  <img src="assets/breedops_logo.gif" alt="BreedOps animated logo" width="220" />
</p>
-->

<h1 align="center">BreedOps</h1>

<p align="center">
  <strong>The operating platform for modern plant breeding.</strong>
</p>

<p align="center">
  BreedOps is a secure, data-driven operating platform for modern plant breeding,
  built to manage parent lines, crosses, families, seed lots, phenotype scoring,
  laboratory inventory, experimental workflows, scheduling, traceability,
  and breeding analytics within a single integrated system.
</p>

<p align="center">
  <a href="#core-platform">Core Platform</a> •
  <a href="#from-cross-to-decision">Workflow</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#data-model">Data Model</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-in%20development-0A8F8F?style=for-the-badge" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15+-111111?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Relational%20DB-336791?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%26%20RLS-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-TBD-6B7280?style=for-the-badge" />
</p>

Overview

BreedOps centralizes the operational backbone of a modern breeding program.

Instead of scattering data across spreadsheets, disconnected lab notes, local folders,and ad hoc tracking files, BreedOps provides a unified system to organize and connect:

parent lines

crosses

families

seed lots

phenotype evaluations

inventory and stock movements

experimental cycles and task planning

quality control and audit trails

data-driven dashboards and breeding decisions

BreedOps is designed for research teams, breeding programs, floriculture pipelines,and scientific plant improvement workflows that require both traceability and operational efficiency.

Why BreedOps?

Modern breeding programs generate complex, multi-layered data:

genetic lineage and crossing records

propagation and seed lot history

phenotype scoring and weighted selection

reagent, consumable, and equipment tracking

experimental calendars and compliance workflows

progress monitoring and reporting

BreedOps transforms these fragmented records into a secure, structured, and actionable platformfor breeding operations management.

From Cross to Decision

flowchart LR
    A[Parent Lines] --> B[Crosses]
    B --> C[Families]
    C --> D[Seed Lots]
    D --> E[Phenotypes]
    E --> F[Evaluations]
    F --> G[Selection]
    G --> H[Breeding Decision]

<p align="center">
  <strong>BreedOps transforms breeding records into traceable selection decisions.</strong>
</p>

Core Platform

🧬 Genetics & Lineage

BreedOps manages the upstream genetic and crossing workflow:

Parent lines

Cross registry

Family tracking

Generational structure

Seed lots

Germination testing

Genetic verification status

Traceable historical records

🌱 Phenotyping & Selection

BreedOps supports structured, weighted evaluation of breeding material:

Phenotype registry

Weighted scoring models

Configurable criteria and coefficients

Evaluator-based assessments

Automatic score calculation

Normalized selection score

Automatic decision categories

Ranking and comparison between individuals

Example selection logic:

Weighted Score =
Vigor × 1
+ Architecture × 1
+ Yield × 2
+ Sanitary Quality × 2
+ Analytical Quality × 3
+ Stability × 4

📦 Inventory & Laboratory Operations

BreedOps connects breeding workflows to laboratory and operational logistics:

Inventory items

Reagent and consumable lots

Equipment registry

Stock movements

Minimum stock thresholds

Expiration tracking

Storage conditions

PPE and compliance information

📅 Experimental Workflow

BreedOps structures experimental execution:

Experimental cycles

Task templates

Scheduling

Calendar view

Gantt view

Zone-based workflow tracking

SOP compliance

Deliverables and milestone validation

Delay calculation and operational alerts

📊 Dashboard & Analytics

BreedOps provides a high-level view of the breeding pipeline:

active crosses

seed lots

germination performance

phenotype selection outcomes

inventory alerts

task progress and delays

quality control indicators

program-level KPI monitoring

Breeding Intelligence Snapshot

Selection Score Example

Vigor             × 1   ████████░░  8
Architecture      × 1   █████████░  9
Yield             × 2   ████████░░  8
Quality           × 2   █████████░  9
Analytical trait  × 3   █████████░  9
Stability         × 4   ██████████ 10

────────────────────────────────────────

Weighted Score        115 / 130
Normalized Score       88.5 %
Decision               ★ ELITE

Feature Matrix

Domain

Capability

MVP

Future

Genetics

Parent lines

✅



Genetics

Cross registry

✅



Genetics

Families

✅



Genetics

Seed lots

✅



Genetics

Interactive pedigree



🔜

Phenotyping

Weighted scoring

✅



Phenotyping

Selection models

✅



Phenotyping

Image-assisted scoring



🔜

Inventory

Stock movements

✅



Inventory

Expiration alerts

✅



Inventory

QR-based traceability



🔜

Workflow

Calendar

✅



Workflow

Gantt

✅



Workflow

Notifications



🔜

Analytics

Dashboard

✅



Analytics

Advanced statistics



🔬

Platform

Security and audit

✅



Platform

Offline sync



🔜

Interactive Platform Sections

<details>
<summary><strong>🧬 Genetics & Lineage</strong></summary>

<br>

BreedOps handles the full traceability chain of breeding material:

parent lines

crosses

families

generations

seed lots

germination tests

lot status and verification

historical linkage between records

</details>

<details>
<summary><strong>🌱 Phenotyping & Selection</strong></summary>

<br>

BreedOps enables rigorous evaluation workflows:

phenotype registration

evaluation models

weighted criteria

coefficient-based scoring

normalized results

automated decisions

elite candidate identification

reviewer and validation workflows

</details>

<details>
<summary><strong>📦 Inventory & Lab Operations</strong></summary>

<br>

BreedOps supports operational and laboratory management:

reagents and consumables

inventory lots

expiration dates

storage conditions

stock levels

movement logs

consumption history

operational alerts

</details>

<details>
<summary><strong>📅 Workflow & Scheduling</strong></summary>

<br>

BreedOps helps structure experimental execution:

cycle templates

tasks

priorities

deadlines

zones and locations

SOP compliance

calendar visualization

Gantt scheduling

delay detection

</details>

<details>
<summary><strong>📊 Dashboards & Reporting</strong></summary>

<br>

BreedOps gives rapid insight into breeding progress:

program KPIs

germination trends

selection outcomes

inventory alerts

delayed tasks

overall progress

cross-family comparison

operational bottlenecks

</details>

Architecture

flowchart TB

    USER[Researcher / Breeder / Analyst]

    subgraph BreedOps
        UI[Next.js Frontend]
        API[Server Layer]
        AUTH[Authentication & Authorization]
    end

    subgraph Data
        PG[(PostgreSQL)]
        STORAGE[Object Storage]
        AUDIT[Audit Log]
    end

    USER --> UI
    UI --> API
    API --> AUTH
    API --> PG
    API --> STORAGE
    API --> AUDIT

Technology Stack

Frontend: Next.js, React, TypeScript, Tailwind CSS

Backend: Next.js server layer + Supabase

Database: PostgreSQL

Auth: Supabase Auth

Security: Row-Level Security (RLS), role-based access control

Validation: Zod

Forms: React Hook Form

Tables: TanStack Table

Testing: unit, integration, and end-to-end testing

Deployment: web-ready SaaS architecture

Data Model

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

Security by Design

BreedOps is designed with security, data integrity, and traceability as core principles.

Security foundations

authentication required

role-based access control

server-side authorization

PostgreSQL Row-Level Security

organization-level and program-level data isolation

audit logging

soft deletion for critical scientific records

versioned migrations

controlled imports and exports

traceable modifications to sensitive data

Target roles

system_admin

organization_admin

program_manager

technician

analyst

viewer

auditor

Security claims should only be presented as production guarantees once the corresponding controls are fully implemented and verified.

Repository Structure

BreedOps/
├── assets/
│   ├── breedops_logo.png
│   └── breedops_banner.png
├── docs/
├── src/
├── supabase/
├── tests/
├── PROMPT.md
├── CLAUDE.md
├── agend.md
├── README.md
└── ...

Quick Start

The following setup assumes the application stack will be initializedwith Next.js + TypeScript + Supabase.

1. Clone the repository

git clone https://github.com/your-username/BreedOps.git
cd BreedOps

2. Install dependencies

npm install

3. Configure environment variables

Create a .env.local file from .env.example:

cp .env.example .env.local

Fill in the required variables.

4. Run the development server

npm run dev

5. Open the app

http://localhost:3000

Development Roadmap

BreedOps is being developed in structured phases.

MVP modules

Authentication and roles

Crosses, families, and seed lots

Phenotype scoring

Inventory and stock movements

Calendar, alerts, Gantt, and dashboard

Planned future modules

Interactive pedigree

QR codes

Photograph workflows

Notifications

Advanced breeding statistics

Multi-year comparison

Genotype × environment analysis

Offline-first synchronization

AI-assisted breeding analytics

Roadmap

timeline
    title BreedOps Roadmap

    MVP
        Authentication & roles
        Cross registry
        Families & seed lots
        Phenotype scoring
        Inventory & movements
        Calendar & Gantt
        Dashboard & alerts

    V1
        Interactive pedigree
        QR codes
        Image workflows
        Notifications

    V2
        Statistical analysis
        Multi-year comparison
        GxE exploration
        Offline mode

    Future
        Genomics integration
        Genomic prediction
        AI-assisted breeding intelligence

Documentation

Project documentation will be organized into:

docs/architecture.md

docs/database.md

docs/security.md

docs/deployment.md

docs/user-guide.md

Additional operational planning is tracked in:

agend.md

Contributing

Contributions are welcome once the base architecture is stabilized.

Future contribution guidelines will cover:

code style

branching strategy

migrations

testing expectations

security review requirements

pull request workflow

Status

BreedOps is currently in active development.

The repository is evolving toward a first secure MVP focused on:

breeding lineage tracking

phenotype selection workflows

inventory operations

experimental planning

traceable analytics

Vision

BreedOps is not only a breeding database.

It is intended to become a complete operating system for breeding operations:a unified platform where genetics, phenotypes, inventory, workflows,quality control, and analytics converge into a single decision-making environment.

License

License information will be added here.

Acknowledgments

BreedOps is designed at the intersection of:

plant breeding

floriculture operations

scientific data systems

traceability and quality control

secure web platform engineering

<p align="center">
  <strong>BreedOps — from crosses to cultivars.</strong>
</p>