# UI scan implementation plan: titles, headers, and list indexing

Date: 2026-06-17
Source scan: `kitstak-ui-indexing-scan.md` (read-only walk of the T1SS workspace)
Source prompt: operator implementation brief (three workstreams, behind a flag, tests, one PR per workstream)
Status: PLANNED. Awaiting operator sign-off to begin. Two design forks resolved by the operator (see Decisions).

## Goal

Three connected consistency improvements across the existing app. This is indexing and consistency work, not a rebuild.

- A. Lead with the human name, not the system number, via one shared title resolver.
- B. One shared detail header so identity (number, status, customer, money) appears once.
- C. A reusable server-side list toolbar (search, facets, sort, saved views) plus the indexes to back it.

Out of scope (separate tickets): the section-dashboard redesign and the inline quick-create picker. The toolbar and resolver are built as reusable pieces those can later consume.

## Verified ground truth (from a six-agent read-only sweep, 2026-06-17)

1. List filtering and pagination are CLIENT side today. Services fetch the full result set and slice in memory (`PAGE_SIZE=50`). The edge endpoints already support server side: `parseLimit()` (default 50, clamp 1 to 200), keyset cursor pagination (`paginate()` / `encodeCursor()`), `.eq()` filters, and `.ilike()` search. Customers already does server-side `q` search. Workstream C is largely wiring the SPA to existing server capability plus extending params.
2. Most btree indexes the scan recommends already exist: `(org_id, status|state)`, `(org_id, customer_id)`, `(org_id, created_at)` partials on quotes, invoices, customers, items, projects. Net-new DB work is `pg_trgm` plus trigram GIN for fast `ILIKE`, plus money and date btrees.
3. `pg_trgm` is available but NOT installed on prod. It needs a `CREATE EXTENSION` in migration 0123.
4. `DataTable` has no sortable headers (explicit `F-Wave10-UI-KIT-DATATABLE-SORT-01` placeholder). This plan closes it. `FilterBar`, `Pagination`, `Select`, `PageHeader`, `StatusBadge`, `StateStepper`, `DetailLayout` all exist and are reusable.
5. No shared detail header. Every page hand-rolls `PageHeader` plus inline `meta`. Title source is mixed: transactional entities (quote, invoice, project) use the system number as the H1; master data (customer, item, member) uses the human name.
6. `displayTitle` can be a PURE SPA helper. It needs no canon or contract change. `EntityLabel.tsx` already has a per-kind `format(code, displayName)` pattern to extend, and `fallbackLabel()` (breadcrumbFallback.ts) handles the UUID-in-flight race.
7. Flags: `org_feature_flags(org_id, flag_key, is_enabled, config)`, seeded default-off by `seed_org_settings()`. SPA reads via `useOrgFlags()` / `useFlags()` (TanStack, 30s stale, refetch on focus). Edge gates: `requireFlag` (403 FEATURE_DISABLED), `withFlag` HOF, `serveBundleWithGate` (404). The flag constant lives in a byte-identical `constants.ts` pair (apps/web/src/lib + supabase/functions/_shared), enforced by `pnpm test:contract`.
8. Money: `formatCents()` for display; `DollarInput` (apps/web/src/components/forms/DollarInput.tsx) is the correct cents input. `ReceivingOrderDetailPage.tsx:367` is the known raw-cents anti-pattern; do not copy it. This plan adds no money inputs (read-only filtering).
9. Bundle: 40 kB gz index budget, ~35.8 kB measured, ~4 kB headroom. All page routes are `lazy()`. New shared components stay out of the eager index as long as they are imported only by lazy pages, never by `AppShell` or `Topbar`.
10. Canon pairs `_shared/types.ts` and `apps/web/src/lib/types.ts` (plus the side-car domain files) and `_shared/money.ts` are byte-identical, enforced by parity tests.

## Decisions (operator-resolved 2026-06-17)

- Pagination for sorted lists: EXTEND KEYSET to carry the sort column. Cursor keyed on `(sort_col, id)` per allowed sort column. No `total_count`. The SPA `Pagination` moves to a cursor-stack Prev/Next model. Nullable sort columns use `COALESCE`-based ordering and cursor predicates.
- Saved views: FULL DB-BACKED now. New `saved_views` table with RLS, `SavedViewSchema` in the canon pair, `settings-api` CRUD with idempotency and capabilities, and save/load/delete UI in the toolbar.
- Flags: two flags, `feature.detail_header` (B) and `feature.list_toolbar` (C), for independent rollback. Workstream A is unflagged plumbing (no visible change until B uses it).
- Rollout for B: the four flagship detail pages first (quote, invoice, project, customer); the remaining detail pages are a deferred follow-up.

## Workstream A: displayTitle resolver (unflagged plumbing)

- New `apps/web/src/lib/displayTitle.ts`: `displayTitle(kind, record, relations?) => { title: string; number: string | null }`. Pure, no fetching. The page passes already-loaded relation labels (customer or project name it already loads for links and the breadcrumb). Reuses `fallbackLabel` for the UUID race.
- Per-entity rules (grounded in the real schemas):
  - quote: `title` else `number`. number chip = `number`.
  - project: `name`. chip = `number`.
  - customer: `display_name`. item: `sku` plus `name`. vendor: `display_name`. member: `display_name`.
  - lead or opportunity: `display_name` (or company or deal name).
  - invoice: no name. Derive customer plus project or number. chip = `invoice_number`.
  - payment or credit note: derive customer plus amount. chip = number.
  - sales order: `order_number` (no customer or channel name on the row; facet covers customer).
  - fulfillment or receiving or shipment: derive SO or vendor plus date.
  - manufacturing run or kitting or job run: derive output item or template; chip = `*_number`.
  - work assignment: has a real `title` field, use directly.
- Refactor `EntityLabel.tsx` to delegate to `displayTitle` so there is a single source.
- Scope note: the resolver governs the detail H1 and list rows in this pass. The command palette and search results already get server-computed titles from `search-api`; aligning those to the same resolver is a deferred follow-up (avoids porting the resolver to the edge).
- Tests: a unit-test table per kind, including the nameless-entity derivations and the UUID-in-flight fallback.

## Workstream B: shared DetailHeader (behind feature.detail_header)

- New `apps/web/src/components/ui/DetailHeader.tsx`, composing `PageHeader`:
  - H1 = `displayTitle.title`.
  - One chip row directly under it: number chip, `StatusBadge`, customer link, and headline money (`formatCents` of total or balance). Each fact once.
  - Drop the `"Customer:"` `meta` subtitle. The breadcrumb and chip carry it.
  - `StateStepper` stays above the header on FSM entities (unchanged pattern).
- Roll out on the four flagship pages first (quote, invoice, project, customer) behind `feature.detail_header`. Old header renders when the flag is off. Remaining detail pages are a deferred follow-up.
- Imported only by the (lazy) detail pages, so it lands in their chunks, not the index.

## Workstream C: server-side list toolbar plus indexing (behind feature.list_toolbar)

### Edge (backward compatible, optional params)

- Extend the list routes on `quotes-api`, `invoicing-api` (customers handled in crm-api), `crm-api` customers, `sales-config-api` items, and `projects-api` with: `search`, `sort_by` (per-entity allowlist), `sort_dir`. Keyset cursor extended to key on the chosen sort column plus `id`, with `COALESCE` for nullable sort columns. Default behavior (no sort param) is unchanged: created_at keyset.
- Per-list `search` covers the entity's own text columns (number, title or name) using `escapeIlike()` plus `.or()`. Customer filtering is a facet dropdown (filter by `customer_id`), not free-text. Cross-entity name search stays the global palette's job. MVP scope, noted.
- Sort allowlist per entity (NOT NULL or COALESCE-safe columns): created_at, number, status or state, total_cents, customer_id; invoices add balance_cents (COALESCE 0) and due_date (COALESCE sentinel).
- Org-scoping unchanged: `.eq('org_id', caller.orgId)` on the admin client, `org_id` never read from the client. Soft-delete gate `.is('deleted_at', null)` retained.

### Saved views (new entity)

- Migration 0124: `saved_views(id, org_id, user_id, entity_kind, name, definition jsonb, created_at, updated_at, deleted_at)`. RLS Pattern A: `org_id = current_org_id()` plus `user_id = auth.uid()` so a user manages their own. Idempotent DDL, RLS from creation. Header declares Wave, Closes, DOWN, date, constitutional alignment.
- Canon: `SavedViewSchema` added byte-identically to both `types.ts` mirrors. Contract test updated.
- Edge: saved-views CRUD added to `settings-api` (an already-deployed bundle, so no new bundle to register). Caps `settings.saved_view.read` and `settings.saved_view.write`. Non-GET enforces Idempotency-Key. Cross-tenant reads return empty, cross-tenant writes 404.
- SPA: `useSavedViews` hook plus service plus query keys; save, list, apply, delete UI in the toolbar.

### SPA toolbar

- New `apps/web/src/components/ui/ListToolbar.tsx`, built on `FilterBar`: a debounced search box (`useDebouncedValue` hook, new and unit-tested), facet chips (status or state, customer, kind, date range, amount or aging), a sort control, and the saved-view controls.
- `DataTable` gains optional `sortable` per column plus `sortBy`, `sortDir`, `onSort` props (backward compatible). Closes `F-Wave10-UI-KIT-DATATABLE-SORT-01`.
- `Pagination` gains a cursor-stack Prev/Next mode for keyset lists (no `total_count`; shows a count of loaded rows, not "of M").
- Wire quotes, invoices, customers, items to server pagination, search, sort, and facets. Invoices get the open-balance toggle (`balance_cents > 0`) and an aging-bucket facet (current, 30, 60, 90).
- Filter and sort persisted in the URL for deep-linking. Behind `feature.list_toolbar`; lists fall back to today's client-side behavior when off.

### Migrations

- 0123 search_indexes: `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions`; trigram GIN (partial `WHERE deleted_at IS NULL`) on quotes(number, title), invoices(invoice_number), customers(display_name, primary_email, primary_phone), items(sku, name), projects(number, name), vendors(display_name); btrees `(org_id, total_cents)` on quotes, `(org_id, balance_cents)` and `(org_id, due_date)` on invoices, `(org_id, unit_price_cents)` on items. All idempotent. Touches no RLS, money helpers, idempotency, or audit_log. Note: `CREATE INDEX CONCURRENTLY` is not possible inside a migration transaction; at current data volume a plain create is instant. Flag CONCURRENTLY rebuilds as a scale follow-up.
- 0124 saved_views: the table plus RLS plus grants (see above). RLS-bearing, so its merge is a HALT-for-operator gate.
- 0125 list_experience_flags: add `feature.detail_header` and `feature.list_toolbar` to `seed_org_settings()` plus an idempotent backfill (`ON CONFLICT DO NOTHING`) for existing orgs. Default OFF. Also seed the noted `billing.trial_gate.enabled` gap while here.

## PR sequence

1. PR1 (A): `displayTitle` plus `EntityLabel` refactor plus unit tests. Unflagged, no visible change.
2. PR2 (B): `DetailHeader` plus flagship rollout, behind `feature.detail_header`.
3. PR3 (C edge plus indexes): migration 0123 plus edge search, sort, and keyset-with-sort params plus the filter-query-builder unit tests. Ships safe with the flag off.
4. PR4 (C toolbar): `ListToolbar`, `DataTable` sort, `Pagination` cursor-stack, list wiring, segment presets, URL state. Behind `feature.list_toolbar`.
5. PR5 (saved views backend): migration 0124 plus `SavedViewSchema` canon plus `settings-api` CRUD plus caps. HALT-for-operator merge (new RLS table).
6. PR6 (saved views frontend): saved-view UI in the toolbar plus migration 0125 flag seed and backfill.

Each PR runs the full gate set: typecheck, lint (max-warnings 0), contract parity, unit plus regression, `deno check` (edge PRs), build, `size-limit`. Migrations apply to staging via the Supabase MCP first (staging only, to avoid phantom-version stamps), prod via the post-merge migrate workflow.

## Risk note

- Pagination semantics change (client slice to server keyset). Behind the flag, so old behavior is preserved when off. Edge param additions are backward compatible (optional, default to current behavior), so the edge ships safely without the flag.
- Keyset-with-sort on nullable columns (`balance_cents`, `due_date`, `title`) requires `COALESCE` in both the order and the cursor predicate. Tested explicitly.
- `saved_views` adds a tenant table and RLS. Merge HALTs for the operator. Standard Pattern A, probed by the nightly RLS fixtures; cross-tenant read empty, write 404.
- 36 detail pages: only the four flagship pages in PR2. The remaining pages keep the old header until a follow-up. A mixed window is acceptable behind the flag.
- Bundle budget ~4 kB headroom. New shared components are imported only by lazy pages. `size-limit` gate verifies index stays under 40 kB.
- Search `.or()` grammar: reuse `escapeIlike()` to neutralize `%`, `_`, `\\`, comma, and paren.
- Brand copy: humanized statuses via `StatusBadge`; no raw enums, ISO timestamps, or UUID fragments where a name belongs. The resolver enforces this.
- Contract test: the flag constant pair and `SavedViewSchema` must stay byte-identical across the mirrors.

## Deferred follow-ups

- `F-UISCAN-DETAIL-HEADER-TAIL-01`: roll `DetailHeader` to the remaining detail pages.
- `F-UISCAN-LIST-CUSTOMER-SEARCH-01`: per-list free-text search across customer name (needs a join or denormalized field).
- `F-UISCAN-PALETTE-RESOLVER-ALIGN-01`: align command palette and search-result titles to `displayTitle`.
- `F-UISCAN-INDEX-CONCURRENTLY-01`: rebuild trigram indexes with CONCURRENTLY when a list grows large.
- `F-UISCAN-NUMBER-TITLE-VALIDATION-01`: input validation on free-typed number and title fields (the junk rows like 123123123123 the scan flagged).

## Constitutional invariants verified or upheld

- Money: read-only display via `formatCents`; no new money inputs; receiving anti-pattern avoided.
- RLS: every new query org-scoped; `saved_views` gets RLS from creation; no `org_id` from the client.
- Migrations: forward-only, four-digit, idempotent, full headers. 0123 to 0125 net new on top of prod max 0122.
- Idempotency: every non-GET saved-views handler enforces Idempotency-Key.
- Canon: `SavedViewSchema` and the flag constant kept byte-identical; `displayTitle` is pure SPA (no canon touch).
- Capabilities: `requireCap` on the saved-views write handler.
