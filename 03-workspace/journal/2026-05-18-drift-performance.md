# Drift audit — Performance posture
- Wave: Phase 6 chassis (drift audit)
- Date: 2026-05-18
- Auditor: Performance Engineer (read-only)
- Status: YELLOW. Bundle gate is wired and TanStack Query is correctly configured. Three inventory list endpoints in `inventory-api` are unbounded today (RED-leaning but pre-customer-zero, low row counts). The Lighthouse workflow is gated by a repo variable that is not asserted to be `true`, so perf budgets are not actually being measured in CI on PRs. Several list endpoints emit `next_cursor: null` unconditionally, which means clients cannot paginate past `limit`.

## Summary

The performance chassis is largely on-spec. The 40 kB gzip budget on the SPA index chunk is configured (`apps/web/.size-limit.cjs`) and enforced in `ci.yml` via `pnpm --filter web bundle-budget` on every PR. The TanStack `QueryClient` in `apps/web/src/main.tsx:14-22` matches the constitutional spec exactly: `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1`. Route-level lazy code splits are correctly authored in `apps/web/src/routes.ts` with `Suspense` in `App.tsx:39`. The HTTP wrapper `apps/web/src/lib/apiClient.ts` is lean — no middleware overhead beyond an auth session lookup and Zod envelope check.

The findings that follow are not chassis breaks; they are latent risks that will bite once a single tenant grows beyond the synthetic-fixture scale. The most acute is in `inventory-api`, where three GET endpoints return every row in the tenant with no `.limit()` and no cursor. The second is that several handlers (`quotes-api`, `projects-api`, `sales-config-api` `genericList`) implement pagination by fetching `limit + 1` rows but then return `next_cursor: null` regardless of overflow — clients have no way to fetch page 2. The third is that the Lighthouse workflow is wrapped in `if: vars.LIGHTHOUSE_ENABLED == 'true'`; until the operator flips that variable, LCP/CLS/TBT budgets are documented but not gated.

## 1. Bundle budget compliance — GREEN (config), UNKNOWN (current size)

- Config: `apps/web/.size-limit.cjs` declares a single entry — `SPA index chunk`, path `dist/assets/index-*.js`, limit `40 KB`, gzip true. Matches `00-canon/01-architecture.md:175` exactly.
- CI: `.github/workflows/ci.yml:28` runs `pnpm --filter web bundle-budget` on every push to main and every PR. Build precedes it (line 27), so the gate has real artifacts to measure.
- Dependencies sampled from `apps/web/package.json`:
  - `react` + `react-dom` 18.3.1 (expected)
  - `react-router-dom` 6.26.0 (expected)
  - `@tanstack/react-query` 5.51 (expected; v5 is the smallest)
  - `@supabase/supabase-js` 2.45 — the heaviest legitimate dep, around 30 kB gzip on its own. This is the only realistic candidate for forcing a split if the index chunk grows.
  - `zod` 3.23 — typically 12-15 kB gzip
  - `lucide-react` 0.439 — tree-shakes by-import, no concern if usage stays per-icon
  - `sonner` 1.5 — small
  - No `axios`, `dayjs`, `lodash`, `formik`, `radix`, `redux`. Banned list clean.
- I could not query GitHub Actions run history (`gh` blocked by the harness sandbox), so I cannot confirm whether the most recent CI bundle measurement was under budget. The configuration is correct, however. Recommend the operator run `pnpm --filter web bundle-budget` locally on `main` and attach the number to the next wave closeout.

## 2. TanStack Query configuration — GREEN

- `apps/web/src/main.tsx:14-22` sets `defaultOptions.queries = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 }`. Byte-perfect match for the spec.
- Per-query overrides sampled (no `refetchInterval` anywhere in the SPA):
  - Most hooks restate `staleTime: 30_000`, harmless.
  - `useBranding.ts:21` and `useCurrencies.ts:10` use 5 min — defensible: branding tokens and currency master list change rarely.
  - `useCrossCutting.ts:126,169` use 60_000; line 151 (`useGlobalSearch`) uses 15_000. Search results change fast; 15s is reasonable.
  - `useInventory.ts:16` defines `const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 }` and spreads it into every hook — matches spec.
- No `refetchInterval` (polling) found anywhere. No `cacheTime` overrides that would balloon memory.

## 3. Query plan / N+1 risk — YELLOW (1 endpoint), GREEN (3 endpoints)

Sampled five list endpoints. WHERE clauses and indexes line up cleanly in the four core domains; one cross-cutting endpoint has a real N+1 shape.

| Endpoint | File:line | Filters | Index supporting it |
|---|---|---|---|
| `GET /customers` | `crm-api/handlers/customers.ts:92-129` | `org_id`, `deleted_at`, optional `status`, `kind`, `ilike(display_name)`, cursor on `(created_at,id)` | `customers_org_status_idx` (`org_id, status`) and `customers_org_display_name_idx` (`org_id, lower(display_name))` partial `deleted_at is null` (`0007_crm_customers_contacts.sql:55,59`). Covering. |
| `GET /invoices` | `invoicing-api/handlers/invoices.ts:110-144` | `org_id`, `deleted_at`, optional `status`, `customer_id`, cursor | `invoices_org_status_idx` `(org_id, status, created_at desc)` and `invoices_customer_idx` `(customer_id, created_at desc)`, both partial (`0018_invoicing_invoices.sql:68-71`). Excellent. |
| `GET /quotes` | `quotes-api/index.ts:27-44` | `org_id`, `deleted_at`, optional `state` | `quotes_org_state_idx`, `quotes_created_idx` partial (`0014_sales_quotes.sql:81-86`). Covering. |
| `GET /quotes/:id` | `quotes-api/index.ts:46-62` | parent quote + lines fetched in 2 queries | Two sequential round-trips (quote, then lines). Not strictly N+1 (it is N=2 deterministically), but `getProject` and `getQuote` could use a single `select('*, lines:quote_line_items(*)')` PostgREST embed if latency matters. INFO. |
| `GET /dashboard/summary` | `dashboard-api/index.ts:53-105` | parallel `count(*)` per tile + one `sum(balance_cents)` over open invoices | `sumColumn` (line 31-51) **pulls every open-invoice row's `balance_cents` to the edge function and sums in TypeScript**. At any scale beyond a hundred open invoices this is wasteful bandwidth and CPU. Should be a `create function org_ar_balance(org_id uuid) returns bigint` RPC or a postgres view. YELLOW (R-Wave6-PERF-01). |

No classical N+1 (loop-issuing-queries) was found in the sample. `Promise.all` is used correctly in the dashboard and in idempotency replay paths.

## 4. Code splitting — GREEN

- `apps/web/src/routes.ts` uses `lazy(() => import(...))` for every page (lines 25-397). Every route in `ROUTES` (lines 399-728) references a lazy component. No static page imports leak into the index chunk.
- `App.tsx:1` imports `Suspense`, line 39 wraps the router. Fallback in place.
- Side-effectful libs (toast `sonner`, `@supabase/supabase-js`, `@tanstack/react-query`, router) are intentionally eager — that is the index chunk's job.

## 5. API client overhead — GREEN

`apps/web/src/lib/apiClient.ts` is 113 lines. Per request:
1. `supabase.auth.getSession()` (line 61) — local-storage read, no network.
2. Build headers; for non-GET, generate an `Idempotency-Key` via `crypto.randomUUID()` (line 71).
3. Single `fetch()`.
4. Read `x-request-id`, parse JSON once, validate with `EnvelopeSchema` or `ErrorEnvelopeSchema` (Zod safeParse).
5. Throw `ApiError` or return `data`.

No retries (the constitutional retry policy lives in TanStack Query's `retry: 1`, applied per-query). No logging middleware. No telemetry hook. The Zod envelope check is fast (two-field shape) and is the right place to catch upstream wire breaks. Lean.

## 6. Lighthouse CI — YELLOW (gated by a repo var)

- `.github/workflows/lighthouse.yml:23` gates the whole job on `vars.LIGHTHOUSE_ENABLED == 'true'`. While the variable is not set or is `false`, the workflow logs a no-op. The header comment (lines 11-14) explains: Vercel preview Deployment Protection 401-redirects break Lighthouse, so the gate is correct — but the budget is not actually being measured today.
- `apps/web/.lighthouserc.cjs:13-15` asserts LCP < 2500ms, CLS < 0.1, TBT < 200ms (matches `00-canon/01-architecture.md:178` exactly). Three runs per probe (line 9). `staticDistDir: ./dist`, which means Lighthouse measures the built bundle locally on the runner, not the deployed preview URL — that is fine for a budget gate, slightly less realistic for real-world LCP.
- Recommendation: once Vercel preview protection has a bypass token, set `LIGHTHOUSE_ENABLED=true` on the repo. Without it the budgets in `00-canon` are aspirational only. Track as `F-Wave6-PERF-02`.

## 7. Pagination posture — YELLOW (3 RED-leaning endpoints + 4 stub-cursor endpoints)

**Unbounded list endpoints (RED-leaning, mitigated by low expected row counts pre-customer-zero):**

- `GET /warehouses` — `inventory-api/index.ts:60-72`. Orders by `display_name` ascending and returns everything. A 3PL operator with 50 warehouses is fine; one with 500 is not. No `.limit()`, no cursor.
- `GET /stock-levels` — `inventory-api/index.ts:140-157`. Filterable by `warehouse_id` and `item_id` but unbounded otherwise. `stock_levels.org_id` cardinality for a multi-warehouse multi-SKU customer is `warehouses * items`; this can be tens of thousands.
- `GET /bom-items` — `inventory-api/index.ts:179-193`. Optional `parent_item_id` filter, otherwise pulls every BOM line in the tenant.

These three should be brought onto `listOrgScoped`-style cursor pagination, matching `vendors-api/shared.ts:56-94`. The constitution explicitly mandates cursor-paginated lists (`00-canon/01-architecture.md:152-156`). RED if customer zero onboards before the fix; YELLOW today because fixtures are small. Track as `R-Wave6-PERF-01`.

**Hard-capped, no cursor (acceptable for now):**

- `GET /receiving-orders`, `GET /production-runs`, `GET /shipments` — all in `ops-api/index.ts:158-373`, all hard-cap at `.limit(200)` with no cursor. Bounded, but a power user with 201+ shipments will silently see only the most recent 200. YELLOW.
- `GET /stock-movements` — `inventory-api/index.ts:160-176` — same shape, hard-cap 200.

**Stub-cursor endpoints (cursor accepted but always returns `null`):**

- `quotes-api/index.ts:43` — `return ok({ items: rows.slice(0, limit), next_cursor: null })` after fetching `limit + 1` rows. Overflow detection happens but the cursor is dropped.
- `projects-api/index.ts:52` — same pattern.
- `sales-config-api/index.ts:134-135` (`genericList`) — same pattern. Applies to `/taxes`, `/payment-methods`, `/pricing-tiers`, `/items`, `/item-categories`, `/units`, `/value-added-services`, `/job-types` — eight endpoints share this defect.
- `sales-config-api/index.ts:322` (`listExchangeRates`) — same pattern.

These endpoints honor `?limit=` (clamped 1-200 by `parseLimit`) but cannot serve page 2 to a client. For most config tables this is fine (tenants rarely have > 200 tax codes or units), but for `/items` and `/exchange_rates` it is a real ceiling. Use `encodeCursor` from `_shared/handler-helpers.ts:101` and emit a cursor when `rows.length > limit`. YELLOW. Track as `R-Wave6-PERF-02`.

**Properly paginated:** `crm-api/customers`, `invoicing-api/invoices`, `finance-api/journal_entries`, `vendors-api/vendors` (via `listOrgScoped`), and `crm-api/leads/opportunities/activities/contacts` all implement cursor pagination correctly with `decodeCursor` + `paginate` from `_shared/handler-helpers.ts`.

**Search-api:** `search-api/index.ts:19` uses `TOP_PER_GROUP = 10` per entity type, intentionally bounded. Correct.

## Recommendations and owners

| ID | Owner | Severity | Item |
|---|---|---|---|
| R-Wave6-PERF-01 | Backend Engineer (inventory) | YELLOW (RED at scale) | Replace `inventory-api/index.ts` `GET /warehouses`, `/stock-levels`, `/bom-items` unbounded queries with cursor pagination via `_shared/handler-helpers.ts` `parseLimit` + `paginate`. |
| R-Wave6-PERF-02 | Backend Engineer (sales, projects, quotes) | YELLOW | Emit `next_cursor` in `quotes-api`, `projects-api`, and `sales-config-api` `genericList`. The `limit + 1` fetch is already in place; one helper call away from being correct. |
| R-Wave6-PERF-03 | Migrations Engineer | YELLOW | Replace `dashboard-api/index.ts` `sumColumn` with a Postgres RPC `org_ar_balance(uuid) returns bigint`. Avoids row-by-row transfer to the edge for the AR balance tile. |
| F-Wave6-PERF-04 | Operator | INFO | Set repo variable `LIGHTHOUSE_ENABLED=true` once Vercel Deployment Protection bypass is configured. LCP/CLS/TBT budgets in `.lighthouserc.cjs` are not gating PRs today. |
| F-Wave6-PERF-05 | Backend Engineer (ops) | INFO | Convert `ops-api` `.limit(200)` lists to cursor pagination; today they silently truncate at row 201. |

## Constitutional invariants verified

- Bundle gate present and run in CI: yes (`ci.yml:28`).
- TanStack Query defaults match constitution: yes (`main.tsx:14-22`).
- Routes lazy-loaded with `React.lazy` and a flat `ROUTES` table: yes (`routes.ts`).
- No banned dependency leaks in `apps/web/package.json`: yes.
- No `refetchInterval` polling (not banned but constitutionally discouraged): confirmed absent.

## Out of scope (delegated)

- TODOs and dead code: Tech Debt Auditor.
- RLS posture / dependency security: Security Reviewer.
- Constitution structure / migration headers / branding compliance: PM Architect.
