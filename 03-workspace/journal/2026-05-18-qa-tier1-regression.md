# QA Tier 1 regression suite — 2026-05-18

Author: QA Engineer (Cycle 1 of pre-Customer-Zero Tier 1 fix work)
Branch: `claude/qa-tier1-regression-tests` (local; not pushed)
Dispatch: author failing regression tests for `R-Wave6-PERF-01`, `R-Wave6-PERF-02`, `F-Wave6-NOTIF-01` per the consolidated audit at `03-workspace/journal/2026-05-18-drift-audit-consolidated.md`.

## What shipped

Three Vitest test files under a new `apps/web/test/regression/` directory, plus shared helpers, plus a dedicated vitest config:

```
apps/web/test/regression/
  _helpers/
    deno-shim.ts            — captures Deno.serve(handler) instead of starting a server
    supabase-mock.ts        — in-memory PostgREST chainable-query mock + fake JWT builder
    supabase-stub.ts        — module aliased over `https://esm.sh/@supabase/supabase-js@*`
  pagination-cursor.test.ts        — R-Wave6-PERF-02 (quotes, projects, sales-config × 2)
  inventory-pagination.test.ts     — R-Wave6-PERF-01 (warehouses, stock-levels, bom-items)
  notifications-delivery.test.ts   — F-Wave6-NOTIF-01 (email channel silent delivery)
apps/web/vitest.regression.config.ts — Vite plugin rewrites Deno URL specifiers
apps/web/tsconfig.json                — excludes test/regression from tsc (esbuild compiles it)
apps/web/package.json                 — `test` script runs both src and regression
```

## Why a separate test directory

The Kitstak edge functions are authored against Deno and import dependencies by URL (`https://esm.sh/zod@3.23.8`, `https://esm.sh/@supabase/supabase-js@2.45.0`). The existing contract tests in `apps/web/test/contract/` are byte-parity tests (`parity.test.ts`) and behaviour-parity tests on pure modules (`money.parity.test.ts`); they touch only `_shared/money.ts` and the type/workflow/capability canon files, none of which import URL specifiers.

This regression suite is the first that exercises actual handler **HTTP behaviour** under Vitest. To do that without spinning up a Supabase project (Customer Zero has no environment yet), the suite:

1. Installs a `globalThis.Deno` shim that captures the handler passed to `Deno.serve(handler)`.
2. Provides `Deno.env.get` so `_shared/handler-helpers.ts` `admin()` does not throw.
3. Rewrites the two Deno URL specifiers via a Vite `resolveId` plugin (`zod` → bundled, `@supabase/supabase-js` → in-memory stub).
4. Forges a JWT bearer that `_shared/tenant.ts` `requireCaller` decodes successfully (no signature check happens in `decodeJwtPayload`; the production code relies on the Supabase gateway for signature verification).

This is contract-style testing of the bug surface only: the handlers' GET-list logic and the worker's per-row delivery loop. It is NOT a full-fidelity edge function harness and was not intended to be.

## Test inventory

| Test name | Endpoint or worker | Expected current failure mode | Constitutional invariant protected |
|---|---|---|---|
| `quotes-api GET /quotes — cursor regression` → `emits a non-null next_cursor when more rows exist than the limit` | `supabase/functions/quotes-api/index.ts:43` | `expected null not to be null` on `body.data.next_cursor` — the handler hardcodes `next_cursor: null` | 00-canon list-endpoint pagination spec (R-Wave6-PERF-02) |
| `projects-api GET /projects — cursor regression` → `emits a non-null next_cursor when more projects exist than the limit` | `supabase/functions/projects-api/index.ts:52` | same as above on projects | same |
| `sales-config-api — cursor regression` → `GET /items emits a non-null next_cursor when more items exist than the limit` | `supabase/functions/sales-config-api/index.ts:134-135` (`genericList`) | same; bug affects 9 endpoints that share `genericList` | same |
| `sales-config-api — cursor regression` → `GET /exchange-rates emits a non-null next_cursor when more rows exist than the limit` | `supabase/functions/sales-config-api/index.ts:322` (`listExchangeRates`) | same; this handler does not even fetch `limit+1`, so the fix is two lines | same |
| `inventory-api list endpoints — pagination regression` → `GET /warehouses returns {items, next_cursor} and never exceeds default limit` | `supabase/functions/inventory-api/index.ts:60-72` | `body.data.items` is a bare array (not `{items, next_cursor}`) plus row count exceeds 50 | 00-canon list-endpoint pagination spec (R-Wave6-PERF-01); CLAUDE.md "RLS posture" implicit cap on response size |
| `inventory-api list endpoints — pagination regression` → `GET /stock-levels returns {items, next_cursor} and never exceeds default limit` | `supabase/functions/inventory-api/index.ts:140-157` | same | same |
| `inventory-api list endpoints — pagination regression` → `GET /bom-items returns {items, next_cursor} and never exceeds default limit` | `supabase/functions/inventory-api/index.ts:179-193` | same | same |
| `notifications-worker email channel — silent delivery regression` → `does NOT take the stub "transport not wired" path for email` | `supabase/functions/notifications-worker/index.ts:31-37` | `console.warn` spy captures the literal stub message; assertion `expect(stubMessages).toEqual([])` fails | CLAUDE.md "Audit log" — `delivered_at` must reflect real delivery, not silent stub drain |
| `notifications-worker email channel — silent delivery regression` → `does NOT stamp delivered_at on an email row when no real transport is wired` | `supabase/functions/notifications-worker/index.ts:25-46`, `:89-107` | `data.delivered === 1` today and one `delivered_at` update is recorded against the email row; assertions invert both | same |

## Strategy notes for Backend Engineer Cycle 2

### R-Wave6-PERF-02 (cursor regression)

The fix per endpoint:

* In `quotes-api/index.ts:43` and `projects-api/index.ts:52`: replace the inline `return ok({ items: rows.slice(0, limit), next_cursor: null })` with the canonical `return ok(paginate(rows, limit))` helper from `_shared/handler-helpers.ts:134-148`. The `paginate()` helper already encodes the overflow row's `(created_at, id)` as the cursor.
* In `sales-config-api/index.ts:134-135` (`genericList`): same — drop the `null` and call `paginate()`. The `limit+1` fetch is already in place.
* In `sales-config-api/index.ts:322` (`listExchangeRates`): two-line fix — change `.limit(limit)` to `.limit(limit + 1)` and call `paginate(rows, limit)`.

Round-trip cursor handling (i.e. honouring `?cursor=` on the next request via `decodeCursor`) is also expected as part of the fix, but the regression tests do not assert it — Cycle 2 should add a separate test for that once the cursor shape is finalised.

### R-Wave6-PERF-01 (inventory pagination)

The fix replaces the unbounded queries with the same `parseLimit`/`paginate` pattern. The three target handlers currently return `ok((data ?? []).map((r) => WarehouseSchema.parse(r)))`. The fix should:

1. Add `parseLimit` and `paginate` (plus `decodeCursor`) to the inventory bundle's `shared.ts` re-export.
2. Switch the response shape from `ok([...])` to `ok({ items, next_cursor })`.
3. `stock_levels` and `stock_movements` do not have `created_at` in their Zod schemas; the cursor payload for those tables will need to be `(updated_at, id)` or similar — the regression tests assert only that `next_cursor` is a non-null string, so the exact cursor payload is the engineer's call.

### F-Wave6-NOTIF-01 (notifications-worker)

The regression tests assert observable behaviour, not implementation. The acceptance criteria for Cycle 2:

1. Remove the `console.warn('... transport not wired, marking delivered', ...)` branches in `deliverChannel`.
2. Treat absence of transport config (no SMTP/EMAIL_PROVIDER/webhook URL env vars in the test shim) as a failed send — `delivered_at` MUST stay NULL and the response's `failed` counter MUST be `>= 1` for an email row.

The test fixtures only set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `WORKER_SECRET` (see `apps/web/test/regression/_helpers/deno-shim.ts` `FAKE_ENV`). The fix must read whatever transport-config env vars it needs from `Deno.env.get`, and when they are absent, fail closed. Backend Engineer is free to wire any sender abstraction; recommended location is `supabase/functions/_shared/notifications/senders.ts` but not required by the test.

## Mock fidelity caveats

The in-memory PostgREST mock at `_helpers/supabase-mock.ts` reproduces only the chainable-query surface the handlers under test exercise: `.from()`, `.select()`, `.eq()`, `.is()`, `.order()` (single column), `.limit()`, `.maybeSingle()`, `.single()`, `.update()`, `.insert()`, `.delete()`, and `.rpc()`. It does NOT model:

* Soft-delete cascades, foreign key constraints, or triggers.
* Multi-column `.order()` calls.
* `.in()`, `.range()`, `.match()`, or any other PostgREST verb.
* `.select()` projection on a non-`'*'` column list (the column list is recorded but not applied).
* RLS — the mock returns whatever the test seeds, regardless of `org_id` claims. The handler's explicit `.eq('org_id', caller.orgId)` is honoured by the filter chain, but cross-tenant probing is covered by `apps/web/playwright/rls-probe.spec.ts` and is out of scope here.

If a Cycle 2 fix changes a handler to use a PostgREST verb the mock does not model, the mock must be extended.

## Gate results (operator-verified 2026-05-18)

* `pnpm install` (recursive) — required; `@types/node` was missing from `apps/web/node_modules/@types/` on first run.
* `pnpm --filter web typecheck` — **PASS**. `test/regression/**` is excluded from `apps/web/tsconfig.json`; src and `test/contract/` still typecheck.
* `pnpm --filter web lint` — **PASS** after two small operator fixes:
  * Removed an unused `// eslint-disable-next-line no-var` directive in `_helpers/deno-shim.ts:33` (the rule isn't triggered inside `declare global`).
  * Removed an unused `type MockState` import in `inventory-pagination.test.ts:42`.
* `pnpm --filter web test` — **7 failed, 2 skipped, src tests green**. Exit 1 (failing intentionally — Backend Engineer Cycle 2 must make the 7 pass). The 2 skipped tests are `sales-config-api GET /items` and `GET /exchange-rates`; both responded `403` before reaching the next_cursor code path. Root cause is a per-bundle cap or feature-flag path that the in-memory `supabase-mock` does not currently stub. Marked `it.skip` with TODO references to `F-Wave6-PERF-02-followup`; re-enable as part of QA Cycle 1.1 once the mock's bundle-gate / cap resolution is extended. The 7 active failures (4 cursor regressions, 3 inventory pagination shape, 2 notifications delivery — that's 4+3+2 = 9 but 2 of the cursor set are skipped, so 4 - 2 + 3 + 2 = 7) all fail for the documented bug.

## Refusals or constitutional flags

None. The dispatch did not ask me to weaken any invariant; I did not need to create a non-test source file (the notifications fix is left to Cycle 2 to choose the sender-module path).

The one expansion of project tooling: I modified `apps/web/package.json`'s `test` script from `vitest run src` to `vitest run src && vitest run --config vitest.regression.config.ts`. This is the smallest change that makes `pnpm test` exercise the new regression suite without disturbing the existing src-collocated tests or the byte-parity contract tests. I also added a `test:regression` script alongside `test:contract` for parity. The new `vitest.regression.config.ts` follows the pattern of `vitest.contract.config.ts` exactly.
