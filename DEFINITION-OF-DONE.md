# Definition of Done

What "done" looks like at three altitudes: the PR, the wave, and v1. Every gate is enforced.

## At the PR level

### Smoke matrix (automated gates, all green)

1. `pnpm lint`. Banned imports caught. Zero warnings, zero errors.
2. `pnpm typecheck`. Zero errors. Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
3. `pnpm test`. All Vitest specs pass.
4. `pnpm test:contract`. SPA `lib/types.ts` byte-identical to `_shared/types.ts`. SPA `lib/workflow.ts` byte-identical to `_shared/workflow.ts`. SPA `lib/money.ts` parity-tested against `_shared/money.ts`. SPA `lib/capabilities.ts` role policy mirrors `_shared/capabilities.ts`.
5. `pnpm test:rls`. Cross-tenant probe matrix all green. Reads return `200 + []`. Workflow POSTs across tenants return `404`. Bundle gate misses return `404`. Per-route flag misses return `403 FEATURE_DISABLED`.
6. `pnpm build`. SPA index chunk under 40 kB gzip.
7. `supabase db reset`. Every migration applies forward-only on a fresh DB.
8. `pnpm test:e2e`. Playwright smoke flow passes.
9. CI Lighthouse run. LCP under 2.5s, CLS under 0.1, TBT under 200ms on dashboard.
10. CI deploy workflow gate. `migrate` `workflow_run` on `deploy-prod` succeeded against the same `head_sha`.

### Structural gates

- Migration header valid: Wave, Phase, Closes (risk IDs), DOWN MIGRATION block, date stamp.
- Every state-changing endpoint uses `respondWithIdempotency`.
- Every state-changing endpoint calls `requireCap(caller, <cap>)`.
- Every new tenant-scoped table has RLS policies (Pattern A, B, or C) from the migration that creates it.
- Every new state machine has transitions defined in `_shared/workflow.ts` AND `apps/web/src/lib/workflow.ts` AND a parity test entry.
- Every new state machine has an auto-state-transition audit trigger writing to `audit_log`.
- Every new auto-JE trigger has an `EXISTS source_type+source_id+status='posted'` idempotency guard.
- Every new RPC is `SECURITY DEFINER`, `SET search_path = public`, with explicit grants.
- Every PR cites: risk closed, follow-up spawned, constitutional invariants verified.

### Smell test gates (human review)

- Banned dependency? Reject.
- Em dashes, double hyphens, or emojis in user-facing copy? Reject.
- `writeAudit` from a handler when a trigger should write it? Reject.
- Two-step UPDATE where an atomic RPC is the right answer? Reject.
- RLS, money, idempotency, or audit_log changes without operator approval? Stop.

## At the wave level

A wave closes when:

- All PRs in the wave are merged.
- The wave's closeout journal is committed at `03-workspace/journal/wave-<N>-<slug>.md`.
- Every `R-W<wave>-<seq>` opened in the wave is closed or carried with a follow-up ID.
- README's per-wave table updated.
- CHANGELOG entry appended.
- Cross-tenant probe matrix is green.
- Bundle budget is green.
- Pre-flight migration for the next wave (if any) is on a branch.

## At the v1 product level

Kitstak v1 ships when:

- The first operator is live on production.
- One paying external customer signs before v1 is declared shipped.
- Cross-tenant RLS probe runs green nightly for 30 consecutive days.
- Audit hash chain verification job runs green nightly for 30 consecutive days.
- Zero P0 production incidents in the trailing 30 days.
- All migrations forward-only on production.
- Marketing site live with all five pillars described.
- `docs/users/` complete for every Pillar-1 surface.
