# Architecture

BreedOps uses a Next.js application backed by Supabase/PostgreSQL.

```mermaid
flowchart TB
  U[Browser / installed PWA] --> N[Next.js]
  N --> A[Supabase Auth]
  N --> P[(PostgreSQL)]
  N --> S[Private Storage]
  N --> R[R analytics subprocess]
```

Critical scientific/database operations are validated server-side. PostgreSQL
RLS isolates organization-owned data. Statistical models execute in a pinned
`renv` environment.

The offline field subsystem uses local IndexedDB plus a server-side exact-once
synchronization protocol.
