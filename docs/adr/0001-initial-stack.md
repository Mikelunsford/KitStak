# ADR 0001: Initial Stack and Foundational Decisions

Date: 2026-05-17
Status: Accepted

## Context

Kitstak is a multi-tenant whitelabel ERP for 3PL, manufacturing, and co-pack operators. The chassis must support BIGINT cents math, row-level security at every tenant-scoped table, append-only audit with a hash chain, and idempotent state-changing endpoints from day one. Pillars beyond the first ship plumbed but gated.

## Decision

- Vite plus React 18 SPA, TypeScript strict.
- Supabase Postgres plus Edge Functions (Deno).
- pnpm 9 workspaces, Node 20 LTS.
- Vercel hosting in `us-west-1` to co-locate with the Supabase project.
- Tailwind plus hand-rolled primitives. No component library dependency.
- TanStack Query for server state. React Context plus useState for client state.
- Zod for input validation. Schemas byte-mirrored between the SPA and the edge runtime.
- Money stored as BIGINT cents. `roundHalfEven` rounding. Helpers byte-mirrored across SPA and edge.
- Idempotency keys with PK `(key, user_id, org_id, route_hash)` from migration 0001.
- Audit log with `prev_hash` and `payload_hash` columns active from migration 0001.

## Consequences

- The bundle budget is tight (40 kB gzip on the index chunk). New top-level dependencies require an ADR.
- Migrations are forward-only. A wrong decision is corrected by a new forward migration, not by editing a numbered file.
- The role/capability policy is the server's authority. The SPA mirrors it for button hiding only.
- The whitelabel theme is server-rendered. The SPA reads tenant tokens at boot, not from localStorage.
