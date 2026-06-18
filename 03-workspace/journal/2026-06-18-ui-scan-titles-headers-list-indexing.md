# UI scan closeout: name-first titles, one detail header, server list toolbar

Date: 2026-06-18
Plan: `03-workspace/specs/2026-06-17-ui-scan-titles-headers-list-indexing-plan.md`
Scan: `kitstak-ui-indexing-scan.md`
CHANGELOG: `0.26.0`
PRs: #331, #332, #333, #334, #335 (all merged to prod)
Prod migration after run: `0124`

## Scope

The 2026-06-17 UI scan found three consistency gaps in the operator app: lists led with the system number instead of the human name; every detail page repeated its identity (number, customer) two or three times while the name sat smallest; and lists offered at most a single status dropdown, with no free-text search, sortable columns, facets, or saved views. The operator dropped a paired implementation prompt asking for three workstreams behind a feature flag with tests, one PR per workstream, after a plan sign-off.

The operator approved the plan, took the ambitious fork on the two open decisions (keyset-with-sort over offset; full DB-backed saved views over a URL-state MVP), and asked for a full auto sweep: build all, wait for CI, merge on green, close out, social post.

## What shipped, by PR

- **PR #331 (Workstream A): displayTitle resolver.** A pure `apps/web/src/lib/displayTitle.ts` resolving an entity record to `{ title, number }`: the human name leads, the system number becomes a chip, and the nameless entities (invoice, payment, sales order, fulfillment, receiving, shipment, runs) derive a title from already-resolved relations, with a short id-prefix fallback for the load-in-flight race. `EntityLabel` now shares the extracted `formatCodeName`. Pure SPA helper, no canon change; 28 unit tests. Unflagged plumbing with no visible change.
- **PR #332 (Workstream B): shared DetailHeader.** `apps/web/src/components/ui/DetailHeader.tsx` leads with the human name and carries the number chip, status pill, customer link, and headline money in one row, each shown once, dropping the duplicated "Customer:" subtitle. Rolled out on the quote, invoice, project, and customer pages behind a new `feature.detail_header` flag, default off (legacy `PageHeader` renders when off). Status appears once: the three FSM pages keep their StateStepper and pass no pill; the customer hub shows it. Added the `feature.detail_header` and `feature.list_toolbar` keys to the byte-identical `FEATURE_FLAGS` constants pair.
- **PR #333 (Workstream C, edge): server search, sort, keyset.** A shared `_shared/list-query.ts` (sort allowlist parse, search and keyset `.or()` builders, UTF-8-safe cursor, sorted paginator) wired into the quotes, invoices, customers, and items list routes as optional, backward-compatible params. Invoices gained an open-balance toggle and an overdue facet. Migration `0123` installs `pg_trgm` (in the `extensions` schema) and adds trigram GIN indexes on the searchable text columns plus money and date btrees. 23 pure unit tests on the helper. Ships dark: with no new params each route behaves as before.
- **PR #334 (Workstream C, SPA): list toolbar.** `ListToolbar`, sortable `DataTable` headers (closing `F-Wave10-UI-KIT-DATATABLE-SORT-01`), a keyset `CursorPager`, and a `useServerList` state machine (debounced search, URL-synced sort and facets so the dashboard `?state=` deep-link still works, a cursor stack that resets on filter change). Each of the four list pages renders the toolbar view when `feature.list_toolbar` is on and the original client-slice view, extracted verbatim, when off. `apiClient` gained `apiRequestWithMeta` plus a `parseResponseEnvelope` core so the invoices and customers lists, which carry `next_cursor` in `meta`, can paginate; `parseResponse` now delegates to it.
- **PR #335: saved views in the toolbar plus flag seed.** A `SavedViewsBar` on each toolbar list, wired entirely onto the existing saved_views feature. `useServerList` gained `viewConfig` and `applyView`. Migration `0124` seeds `feature.detail_header`, `feature.list_toolbar`, and `billing.trial_gate.enabled` into `seed_org_settings` and backfills every existing org (default off), closing the prior trial-gate seed gap.

## Key reframe

The plan's heaviest item, "full DB-backed saved views," turned out to be already built. The `saved_views` table, its RLS (org plus owner / `is_shared`), the `saved_views.saved_view.{read,create,delete}` capabilities, the `SavedView` canon in `cross_cutting.ts`, the collaboration-api CRUD, and the SPA `savedViewsService` plus `useCrossCutting` hooks all shipped in Wave 2 (migration `0034`). So the planned saved_views backend PR collapsed to UI wiring, and the HALT-for-operator gate the plan attached to a new RLS table was moot: there is no new RLS table this run. The only new migrations are additive (search indexes and a flag seed).

## Verification

- Every PR cleared the full gate set locally before merge: typecheck, lint (max-warnings 0), unit plus regression (grew from 728 to 751 with the new resolver and helper tests), contract parity (28), build, and size-limit (SPA index held at roughly 36.3 to 36.5 kB gz under the 40 kB budget throughout). The edge PR added `deno check` on the four changed bundles.
- Migration 0123's `pg_trgm` plus the `extensions.gin_trgm_ops` opclass were probed on staging before merge; the 0124 backfill was probed on staging too.
- Prod after the run: max migration `0124`; all six orgs carry the three seeded flags (default off); advisors unchanged (the two deliberate RLS-internal exceptions only; pg_trgm in the extensions schema adds none).

## Adversarial review

Two logic-heavy units were reviewed by an independent pass and the findings folded in:

- The keyset-with-sort helper: confirmed the directions, the value quoting and PostgREST cast, the sort-by injection defense, and org scoping; hardened `paginateSorted` to throw on a null cursor value rather than emit an empty one, made the cursor UTF-8 safe, and documented the dual-`.or()` AND contract.
- The `useServerList` state machine and the `apiClient.core` refactor: confirmed `parseResponse` behavior is preserved exactly and the new `parse` parameter shifts no existing argument; guarded the Next button against a double-click race under keepPreviousData; rewrote the search-to-URL mirror to the functional `setSearchParams` form to drop a stale-closure suppression.

## Constitutional invariants

- Money: display only via `formatCents`; no money inputs added (the receiving 100x anti-pattern avoided); money columns indexed, not changed.
- RLS: every new list query stays org-scoped; `org_id` is never read from the client; saved-views writes keep the existing org-plus-owner RLS. No new RLS table.
- Migrations: forward-only, four-digit, idempotent, full headers; 0123 and 0124 additive on top of prod 0122.
- Canon: `displayTitle` is pure SPA (no canon touch); the flag constant pair stays byte-identical; `SavedView` canon was already present.
- Idempotency and audit_log: untouched.

## Follow-ups (deferred, none blocking)

- `F-UISCAN-DETAIL-HEADER-TAIL-01`: roll DetailHeader to the remaining detail pages.
- Projects list toolbar; items category and supply_source facets; aging 30/60/90 buckets (overdue toggle ships now).
- `F-UISCAN-LIST-CUSTOMER-SEARCH-01`: per-list free-text search across customer name.
- `F-UISCAN-PALETTE-RESOLVER-ALIGN-01`: align command-palette and search-result titles to displayTitle.
- `F-UISCAN-INDEX-CONCURRENTLY-01`: rebuild trigram indexes with CONCURRENTLY at scale.
- `F-UISCAN-NUMBER-TITLE-VALIDATION-01`: input validation on free-typed number and title fields.
