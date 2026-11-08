# 9 — Experimental workflows

BreedOps can manage reusable experimental cycles, tasks and dependencies.

## Templates

Create reusable task templates and workflow templates for repeated procedures.

A workflow step can define:

- task template;
- offset from cycle start;
- duration;
- dependencies;
- optional SOP checklist.

## Dependencies

Dependencies are finish-to-start. BreedOps rejects cycles in the dependency
graph.

## Instantiation

Preview the generated dates before creating the real cycle. Once instantiated,
the cycle keeps a snapshot of the template state; later template edits do not
silently rewrite historical work.

## Completion gates

Required SOP checklist items can block task completion until they are checked.

## Gantt

The Gantt view visualizes the same persisted task/dependency structure. It is
not a separate planning truth.
