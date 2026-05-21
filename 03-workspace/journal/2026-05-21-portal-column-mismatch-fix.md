# customer-portal-api column mismatch fix

**Date:** 2026-05-21
**Decision:** Fix four wrong column references in `customer-portal-api/index.ts` that caused 404s on every `/portal/me` and 500s (cascading to disabled queries) on `/portal/invoices`, `/portal/quotes`, `/portal/projects`.
**Driven by:** Live debugging of a customer's empty portal page. The customer signed in via magic link, the JWT carried the correct claims, but `/portal/me` returned 404. Root cause turned out to be a SELECT against `customers.email` — a column that does not exist. The actual column is `primary_email`. Same issue propagated across the other three list endpoints.

## What was wrong

| Handler | Selected (broken) | Actual schema | Effect |
|---|---|---|---|
| `/portal/me` | `customers.email` | `customers.primary_email` | PG errors, handler swallows via `if (error \|\| !data) throw 404`, customer sees 404 |
| `/portal/invoices` | `invoices.number`, `issued_at`, `due_at` | `invoice_number`, `issue_date`, `due_date` | PG errors, handler throws 500 |
| `/portal/quotes` | `quotes.status`, `issued_at`, `expires_at` | `state`, no `issued_at` (use `sent_at`), `expiration_date` | PG errors, handler throws 500 |
| `/portal/projects` | `projects.status`, `started_at`, `expected_completion_at` | `state`, `start_date`, `due_date` | PG errors, handler throws 500 |

## Cascade observed in production

1. `usePortalMe` query → `/portal/me` returns 404 → `me.data` stays undefined.
2. `usePortalInvoices({ enabled: me.data !== undefined })` — query never fires.
3. Same for quotes/projects hooks.
4. SPA renders "No invoices yet. Your billing history will appear here." (the empty-state fallback for `[]`) on all three sections.
5. Header renders `Welcome, .` because `me.data?.display_name ?? '.'` falls through to the placeholder.

The empty-state UI masked a backend failure that would have been obvious if `/portal/me` returned 500 directly (the SPA's `isError` branch would have shown).

## Fix

PostgREST supports column aliasing via `column:source_name`. Used aliases in all four SELECTs so the response shape stays stable for the SPA — no SPA changes needed.

```typescript
// Before
.select('id, org_id, display_name, email')

// After
.select('id, org_id, display_name, email:primary_email')
```

Same pattern applied to invoices, quotes, projects. Also added `.is('deleted_at', null)` filter on the three list endpoints to honor the soft-delete contract (was missing). ORDER BY switched to `created_at` (always populated) instead of the historically-stamped issue_date / sent_at / start_date which are nullable.

## Why regression tests didn't catch this

The Vitest regression suite uses a `_helpers/supabase-mock.ts` stub client that ignores the `select(cols)` argument entirely — it returns the full row from the fixture regardless of which columns are requested. That makes the unit tests fast and avoids needing a real Postgres in CI, but it also means any column-name mismatch between the handler and the actual schema slips through.

Two ways to plug this gap in the future, both deferred:

- **`F-Wave9-PORTAL-API-SCHEMA-LINT-01`**: a static linter that parses the handler's `.select()` strings, joins to a schema snapshot (e.g. `pg_dump --schema-only`), and fails the build if any handler references a column that does not exist in the table.
- **`F-Wave9-PORTAL-STAGING-INTEGRATION-01`**: a CI job that hits the staging `/portal/*` endpoints with a real seeded customer_user and asserts the response shape matches the SPA's expected interface. Catches both column-name and column-type drifts.

Either would have caught this bug at PR time. For now the smoke-test rubric in PR #95 (Path B3) should add a "real-data render check" step that exercises one row through each endpoint on prod before the PR closes.

## Constitutional invariants

- **Forward-only migrations**: none touched.
- **RLS Pattern B**: the four routes still enforce `gatePortal` + the `caller.role === 'customer_user'` check + `.eq('org_id', caller.orgId).eq('customer_id', customerId)` tenant-scoping. The 9 regression assertions added in PR #95 continue to pass.
- **Money rules**: `total_cents` and `balance_cents` are unchanged (the existing column names were already correct).
- **Mirror parity / Zod canon**: untouched.
- **Capabilities**: untouched.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter web lint` | clean |
| `vitest run --config vitest.regression.config.ts customer-portal-api-list` | 9/9 |
| Manual prod query confirming actual column names | confirmed for customers / invoices / quotes / projects |

## Operator-side state during this fix

Mid-debugging discovery: the customer's `auth.users.raw_app_meta_data` was missing `kitstak_org_id` / `kitstak_org_role` claims because the Path B2 invite handler (`crm-api/handlers/customers.ts inviteCustomerToPortal`) never stamps them. Backfilled for the existing user via direct UPDATE to `auth.users`. That gap is filed as `F-Wave9-PORTAL-INVITE-CLAIM-STAMP-01` — separate from this column-mismatch fix, both contribute to the broken-portal observation. The CLAIM-STAMP fix is the next PR.

## Closes

- The customer-portal-api column mismatch class for `/portal/me`, `/portal/invoices`, `/portal/quotes`, `/portal/projects`.

## Spawns

- **`F-Wave9-PORTAL-API-SCHEMA-LINT-01`** (static schema-vs-handler check, deferred).
- **`F-Wave9-PORTAL-STAGING-INTEGRATION-01`** (real-Postgres integration test on staging, deferred).
- **`F-Wave9-PORTAL-INVITE-CLAIM-STAMP-01`** (already filed; the next PR will stamp `kitstak_org_id` + `kitstak_org_role` onto new portal users at invite time).
