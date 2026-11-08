# 8 — Inventory

BreedOps uses a movement ledger rather than a freely editable stock number.

## Core objects

- inventory item: the material/reagent identity;
- inventory lot: a physical lot/batch;
- movement: receipt, consumption, return, destruction or justified adjustment;
- equipment: a separate equipment register.

## Why movements matter

A traceable stock is reconstructed from events. This makes it possible to
explain why the current quantity has a given value.

## Good practice

Use adjustments only when the physical count and recorded ledger genuinely
diverge, and record the reason.

BreedOps can derive low-stock and expiration alerts and estimate coverage from
real consumption history. Insufficient history is reported as insufficient
rather than converted into a fabricated rate.
