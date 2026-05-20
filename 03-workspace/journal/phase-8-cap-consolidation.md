# Phase 8 cap consolidation (F-Wave2-AGENT-A-05)

Date: 2026-05-20
Baseline: `a00177b`
Branch: `phase-8/canon/cap-consolidation`

## Motivation

D-011 was always an interim pattern. The Wave 2 multi-agent dispatch shipped
six domain agents, each landing a capability matrix in its own side-car
(`_shared/capabilities/<domain>.ts` + the SPA mirror), with a per-bundle
`requireXxxCap` shim that read that side-car directly. The decision log
recorded this as a tactical move: the singular `_shared/capabilities.ts`
canon would be composed at wave close once cross-domain collisions had
been audited.

A prior audit confirmed the audit input: zero cap-name collisions across
the six side-cars (203 caps total, namespaced by domain) and identical
8-role enums on every side-car. The merge was a strict union with no
semantic decision required. Operator authorised the 54-file scope at
phase 8.

## Shape

### Inputs (deleted at the end)

- `supabase/functions/_shared/capabilities/{crm,cross_cutting,finance,identity,sales,vendors_inventory_ops}.ts`
- `apps/web/src/lib/capabilities/{crm,cross_cutting,finance,identity,sales,vendors_inventory_ops}.ts`

### Output

- `supabase/functions/_shared/capabilities.ts`: full `Capability` union
  (203 entries) plus `CAPABILITIES_BY_ROLE` for all 8 roles. Domain order
  is `org.*` (the original 14) then alphabetical: crm, cross_cutting,
  finance, identity, sales, vendors_inventory_ops.
- `apps/web/src/lib/capabilities.ts`: byte-identical copy (asserted by
  `parity.test.ts`).

### Shim removal

- `quotes-api/_helpers.ts`, `projects-api/_helpers.ts`,
  `sales-config-api/_helpers.ts`: deleted entirely (cap-shim only).
  Imports re-pointed at `requireCap` from `_shared/handler-helpers.ts`.
  `sales-config-api`'s `SalesCapability` return-type for `capFor{Read,Write}`
  helpers swapped to the unified `Capability`.
- `invoicing-api/_helpers.ts`, `crm-api/_helpers.ts`: cap-shim removed;
  `BUNDLE` constant preserved (idempotency route-key shape).
- `finance-api/_helpers.ts`: cap-shim removed; `BUNDLE` and
  `requireFinanceJeFlag` (per-route `finance.journal_entries.enabled`
  gate) preserved. The flag gate stays bundle-local because it is a
  per-route flag check, not a cap check.
- `vendors-api/shared.ts`, `inventory-api/shared.ts`: re-export
  `requireCap` from the singular `handler-helpers.ts` so handler imports
  are unchanged structurally.
- `ops-api/index.ts`: inline `requireVioCap` definition deleted; imports
  `requireCap` from `_shared/handler-helpers.ts`.
- `tenants-api/index.ts`, `settings-api/index.ts`, `auth-api/index.ts`,
  `admin-console-api/index.ts`: inline `requireIdentityCap` definitions
  deleted; same swap. `auth-api/me/capabilities` now returns the full
  unified cap list for the caller's role (previously returned only the
  identity side-car subset; the wire schema is `string[]` either way).

### Cross-cutting bundle posture conversion

The six cross-cutting bundles where 403-on-deny was the established
posture converted from `hasCrossCuttingCap(role, cap)` boolean checks to
`requireCap(caller, cap)`:

- `collaboration-api` (10 sites)
- `dashboard-api` (1 site)
- `exports-api` (1 site)
- `imports-api` (2 sites)
- `pdf-worker` (2 sites)
- `search-api` (1 site)

### customer-portal-api carve-out

`customer-portal-api/index.ts` deliberately keeps the boolean check plus
explicit 404 return on every route:

```
if (!hasCap(caller.role, 'portal.<resource>.read')) {
  throw new ApiError('NOT_FOUND', 404);
}
```

This is Pattern B RLS in action: a customer_user calling the portal must
not be able to distinguish "this resource exists but you cannot see it"
from "this resource does not exist". The cap denial here is structurally
the same as a non-tenant trying to reach the bundle, and the
constitutional rule that workflow POSTs across tenants return 404
extends to the read posture for the portal surface. `requireCap` throws
403, which would leak existence; the boolean check plus explicit 404
preserves the constitutional posture.

The import path changed from `_shared/capabilities/cross_cutting.ts` to
`_shared/capabilities.ts` (file is gone), but the function shape is the
same and the unified `hasCap` accepts the portal caps because they were
folded into the union.

### Handler call-site swap

Roughly 100 call sites in the following handler families had their
`requireXxxCap` calls renamed to `requireCap`:

- `crm-api/handlers/*.ts`: `requireCrmCap` -> `requireCap`
- `finance-api/handlers/*.ts`: `requireFinanceCap` -> `requireCap`
- `invoicing-api/handlers/*.ts`: `requireFinanceCap` -> `requireCap`
- `vendors-api/handlers/*.ts`: `requireVioCap` -> `requireCap`
- `inventory-api/index.ts`: `requireVioCap` -> `requireCap`
- `ops-api/index.ts`: `requireVioCap` -> `requireCap`
- `quotes-api/index.ts`, `projects-api/index.ts`,
  `sales-config-api/index.ts`: were already aliasing
  `requireSalesCap as requireCap` at the import site, so the body code
  was already calling `requireCap`; only the import line changed.

Call signature is identical: `requireCap(caller, 'domain.resource.action')`.

### SPA hook

`apps/web/src/lib/hooks/useVioCapabilities.ts` retargeted to the unified
canon. `VendorsInventoryOpsCapability` is now a type alias for the
unified `Capability` so the 14 page-level call sites that import the
hook do not need to change. The hook returns `{ role, can }` with the
same shape; `can(cap)` now accepts any cap in the union (broader than
before, no behavioural regression for VIO caps).

## Pair count delta

- Pre-merge: 23 pairs (5 singular + 6 domains × 3 kinds: types, workflow,
  capabilities).
- Post-merge: 17 pairs (5 singular + 6 domains × 2 kinds: types,
  workflow). `capabilities` dropped from `SIDE_CAR_KINDS`.

The earlier STATUS.md "26 pairs" claim was inaccurate; the actual count
in `parity.test.ts` before this PR was 23. Both numbers were corrected
in the STATUS.md edits this session.

## Verification posture

All gates run from the worktree root, in order:

- `pnpm typecheck` -> zero errors
- `pnpm lint` -> zero errors, zero warnings
- `pnpm test` -> 19 passed, 2 skipped (the skipped pair are the
  pre-existing pagination-cursor regression skips, unrelated)
- `pnpm test:contract` -> 17 of 17 pairs (was 23 pre-merge; the 6 cap
  side-cars are gone and not re-asserted)
- `pnpm build` -> clean; SPA bundle 29.74 kB gzip against the 40 kB cap
- `pnpm bundle-budget` -> under cap (was 29.73 kB, now 29.74 kB; the
  small delta reflects the unified cap union being slightly larger as a
  type literal than the six side-cars summed)
- `node scripts/canon-steward-check.mjs` -> exit 0
- `node scripts/trigger-audit-check.mjs` -> exit 0

The 403 vs 404 posture rule is respected: `requireCap` throws 403
FORBIDDEN inside an authenticated, same-tenant context (cap denial); the
constitutional 404 rule applies to RLS filters, cross-tenant reads, and
workflow POSTs across tenants. `customer-portal-api` preserves its
existing 404-on-cap-miss posture because the portal surface
structurally treats cap denials as cross-tenant.

## Files touched

Three groups:

1. Canon files (2):
   - `supabase/functions/_shared/capabilities.ts` (rewritten)
   - `apps/web/src/lib/capabilities.ts` (byte-mirror)

2. Deleted (12):
   - 6 side-car files in `supabase/functions/_shared/capabilities/`
   - 6 side-car files in `apps/web/src/lib/capabilities/`
   - 3 cap-shim-only `_helpers.ts` files (quotes-api, projects-api,
     sales-config-api)

3. Edited (~40):
   - 4 helper files (`_helpers.ts` / `shared.ts`) with cap-shim portions
     removed
   - 4 inline `requireIdentityCap` removed (tenants-api, settings-api,
     auth-api, admin-console-api)
   - 1 inline `requireVioCap` removed (ops-api)
   - 6 cross-cutting bundle posture conversions
   - 1 customer-portal-api import-path swap (boolean check preserved)
   - ~20 handler files with call-site renames
   - 1 SPA hook retarget (useVioCapabilities)
   - 1 parity test update
   - STATUS.md updates

## Follow-ups spawned

None. The work is self-contained and the constitutional invariants
(byte-mirror parity, RLS posture, idempotency, audit log, money helpers)
were not touched. The unified canon is the authority going forward;
future per-domain cap additions land in `_shared/capabilities.ts` (and
mirror to the SPA) instead of a side-car.
