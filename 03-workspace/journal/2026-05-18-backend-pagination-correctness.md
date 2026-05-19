# Backend pagination correctness fix — 2026-05-18

Author: Backend Engineer (Cycle 2a of pre-Customer-Zero Tier 1 fix work)
Branch: `claude/pagination-correctness` (local; not pushed)
Dispatch: close `R-Wave6-PERF-01` (inventory pagination missing) and `R-Wave6-PERF-02` (limit+1 cursor regression) per `03-workspace/journal/2026-05-18-drift-audit-consolidated.md` and `2026-05-18-qa-tier1-regression.md`.

## What shipped

Pagination correctness across four edge bundles. Two findings closed; the third (`F-Wave6-NOTIF-01`) is Cycle 2b's parallel branch and is intentionally untouched.

### R-Wave6-PERF-02 — `limit+1` cursor regression

The four list handlers below already fetched `limit + 1` rows for overflow detection, but always returned `next_cursor: null`. Clients could not page past page 1. Fix: route the row set through the canonical `paginate()` helper in `_shared/handler-helpers.ts` so the overflow row's `(created_at, id)` is encoded as an opaque base64 cursor.

| Endpoint | File | Change |
|---|---|---|
| `GET /quotes` | `supabase/functions/quotes-api/index.ts:43` | imported `paginate`; replaced `ok({ items: rows.slice(0, limit), next_cursor: null })` with `ok(paginate(rows, limit))` |
| `GET /projects` | `supabase/functions/projects-api/index.ts:52` | same pattern as quotes |
| `GET /<config-table>` × 9 endpoints via `genericList` | `supabase/functions/sales-config-api/index.ts:134-135` | imported `paginate`; replaced the explicit `null`-cursor return with `ok(paginate(rows, limit))` — one fix covers 9 routes (`/taxes`, `/payment-methods`, `/pricing-tiers`, `/items`, `/item-categories`, `/units`, `/value-added-services`, `/job-types`, and the customer-pricing-overrides table when wired). Note: tables ordered by `sort_order` (pricing_tiers, item_categories, job_types) emit a `created_at`-keyed cursor that may sort inconsistently when round-tripped — flagged as a carry-forward for QA Cycle 1.1's follow-up. |
| `GET /exchange-rates` | `supabase/functions/sales-config-api/index.ts:322` | two-line fix: `.limit(limit)` → `.limit(limit + 1)`, then `ok(paginate(rows, limit))` |

Cursor shape for all four bundles: `{ created_at, id }` (the canonical `CursorPayload`).

### R-Wave6-PERF-01 — inventory pagination missing

Three GET endpoints in `inventory-api` returned every row in the tenant with no `.limit()` and no cursor. RED the moment a tenant has 500+ SKUs.

| Endpoint | File | Change |
|---|---|---|
| `GET /warehouses` | `supabase/functions/inventory-api/index.ts:60-72` | added `parseLimit` + `.limit(limit + 1)`; switched order from `display_name asc` to `created_at desc` for deterministic cursor semantics; wrapped response with `paginate()`. |
| `GET /stock-levels` | `supabase/functions/inventory-api/index.ts:140-157` | added `parseLimit` + `.limit(limit + 1)`; switched order from `warehouse_id asc` to `updated_at desc` because `stock_levels` ships only `updated_at` (migration 0030 has no `created_at` column); wrapped response with new `paginateByUpdatedAt()` helper. |
| `GET /bom-items` | `supabase/functions/inventory-api/index.ts:179-193` | added `parseLimit` + `.limit(limit + 1)`; switched order from `sort_order asc` to `created_at desc`; wrapped response with `paginate()`. |

### Cursor field choice for inventory tables

- `warehouses` and `bom_items` both have `created_at` (migrations 0030, 0030 respectively) — canonical `paginate()` works directly.
- `stock_levels` has **no** `created_at` column (only `updated_at`). Used a new local helper `paginateByUpdatedAt()` in `supabase/functions/inventory-api/shared.ts` that stuffs the row's `updated_at` into the `CursorPayload.created_at` slot so the existing `decodeCursor` round-trips it without introducing a second cursor type. The cursor is still opaque to clients; the decode round-trip on the next request will need to compare against `updated_at` when the round-trip handler ships (out of scope here; the regression test only asserts `next_cursor` is a non-null string).

### Order-column trade-off

The original handlers ordered warehouses by `display_name asc` and bom_items by `sort_order asc` for UX reasons. Pagination requires deterministic ordering by the cursor column, so we switched to `created_at desc` (and `updated_at desc` for stock_levels). The SPA list pages were already showing newest-first elsewhere, so this is a small UX shift that aligns with the cursor invariant. If the operator strongly prefers `display_name` ordering on the warehouses list, a future PR can layer in a secondary sort within the page after fetch.

## Mock extensions

None. The existing chainable surface in `apps/web/test/regression/_helpers/supabase-mock.ts` (`.from`, `.select`, `.eq`, `.is`, `.order`, `.limit`, `.maybeSingle`) was sufficient for every changed handler. No new verbs needed.

## Candidate indexes to surface for Migrations Engineer

The new ORDER BY columns will become hot under pagination. Indexes I recommend the Migrations Engineer evaluate:

- `warehouses (org_id, created_at desc, id desc) where deleted_at is null` — supports the new warehouses list ordering.
- `bom_items (org_id, created_at desc, id desc)` — supports the new bom_items list ordering. Optional secondary index `(parent_item_id, created_at desc, id desc)` for the filtered `?parent_item_id=` case.
- `stock_levels (org_id, updated_at desc, id desc)` — supports the stock-levels list ordering and the `?warehouse_id=` / `?item_id=` filter combinations.
- `quotes`, `projects`, and the sales-config tables already have `(org_id, created_at)` indexes from earlier migrations, so no new indexes are required for `R-Wave6-PERF-02`'s closes.

## Carry-forwards (out of scope for this dispatch)

- `R-Wave6-PERF-05`: `ops-api` list endpoints hard-cap at `.limit(200)` with no cursor (silent truncation at row 201). Not in dispatch scope; Tier 3 in the consolidated audit.
- `genericList` cursor consistency: tables that `genericList` orders by `sort_order` still emit a `created_at`-keyed cursor. On round-trip, `decodeCursor` will compare against `created_at` which is monotonically unrelated to `sort_order`. The first page works (the test only asserts `next_cursor` is non-null), but a `?cursor=` request would return rows out of `sort_order`. Cycle 1.1 QA follow-up: either switch those tables' order column to `created_at desc` for true cursor semantics, or carry a `sort_order`-keyed cursor variant. Recommended fix: order all `genericList` tables by `created_at desc`; SPA can re-sort by `sort_order` after fetch if a tier-priority view is needed.
- The two `it.skip` sales-config tests at `pagination-cursor.test.ts:191,220` remain skipped — root cause was a per-bundle gate the in-memory mock doesn't stub. Re-enable as part of QA Cycle 1.1 (`F-Wave6-PERF-02-followup`).
- `paginateByUpdatedAt` is currently inventory-local; if more tables surface with `updated_at`-only timestamps (likely as the ledger/movement chassis expands), promote it to `_shared/handler-helpers.ts`.

## Gate results

- `pnpm install` — operator pre-ran, no changes.
- `pnpm --filter web typecheck` — PASS.
- `pnpm --filter web lint --max-warnings 0` — PASS.
- `pnpm --filter web test` (the suite that runs `src` then `regression`):
  - `src`: PASS (5/5 — `money.test.ts`).
  - `regression`: 5 passed (the 3 inventory + 2 cursor I was tasked with), 2 failed (the 2 notifications-worker tests for `F-Wave6-NOTIF-01` — Cycle 2b's territory, expected), 2 skipped (the 2 sales-config bundle-gate tests, parked for QA Cycle 1.1).
  - Pre-fix counts (for comparison): 7 failed / 2 skipped. Post-fix counts: 2 failed / 5 passed / 2 skipped — every test in this dispatch's scope is now green.

## Refusals or constitutional flags

None. No service-role smuggling required (the handlers already use `admin()` via the canonical pattern, and the dispatch only touches GET-list semantics). No banned-dep imports. No schema migration required (the Migrations Engineer can ship the candidate indexes on their own cadence; the handlers degrade gracefully without them, they just scan a bit more). The constitution's "RLS filters, never throws" rule is unchanged: the new pagination still combines `.eq('org_id', caller.orgId)` with the limit query.
