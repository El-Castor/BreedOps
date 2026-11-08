# 7 — Offline field mode

The offline workspace is designed for phenotype capture where network access is
unreliable.

## Before leaving connectivity

1. Open **Terrain** while online.
2. Choose the relevant trial/material.
3. Make it available offline.
4. Confirm that the pack is present on the device.

The pack contains the records and active configuration required for field
entry.

## In the field

1. Open the installed BreedOps PWA.
2. Find the phenotype by code/search or use a QR link.
3. Enter the evaluation.
4. Save locally.

The operation is added to a local outbox if the server cannot be reached.

## When connectivity returns

BreedOps attempts synchronization. The server protects against duplicate
writes.

If the scientific configuration changed after the pack was prepared, the
operation can be marked `CONFIG_CHANGED` instead of being silently accepted
under a new configuration.

## Before signing out

Synchronize pending work first. BreedOps can block logout when unsynchronized
operations remain so field data are not accidentally abandoned.

## Requirement

Remote PWA/offline use requires HTTPS. Plain remote HTTP is not a secure browser
context and cannot register the service worker.
