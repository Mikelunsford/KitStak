# Closeout: server-driven list toolbar completed across every list surface

Date: 2026-06-19. Type: read-path feature rollout plus three navigation fixes.
Branch: `feat/list-toolbar-migration`. Merged: PR #347, squash `968a65d`.

## Why

A whole-app current-state mapping pass found the server-driven list toolbar
(keyset pagination, free-text search, column sort, saved views; gated by
`feature.list_toolbar`, on for all six prod orgs) live on only four of about
thirty-five list surfaces (customers, quotes, items, invoices). Every other list
still ran the legacy client-side offset path, and filter state was URL-persisted
on some and ephemeral on others. The same mapping pass surfaced two HIGH
stock-ledger broken links and a stranded production-run detail page.

## What shipped

Thirty-one list entities across twelve edge bundles gained the toolbar, joining
the original four:

- crm-api: contacts, activities
- vendors-api: vendors, purchase orders, expenses
- ops-api: shipments, receiving orders
- invoicing-api: credit notes, payments
- inventory-api: warehouses
- copack-api: sales orders, fulfillments, kitting jobs, channels
- manufacturing-api: manufacturing runs
- three-pl-api: accounts, job templates, supply plans, job runs, billing reviews
- finance-api: journal entries
- kitforce-api: members, teams, shifts, assignments, time entries
- wms-api: locations, lots, putaway, bin stock
- projects-api: projects

Per entity the change is uniform and additive:

- Edge list handler converted to keyset through the shared `_shared/list-query.ts`
  helpers: `parseSearch` plus `parseSort(SORT_COLS, default)` plus
  `decodeSortCursor`; `.order(sortCol).order('id', sameDir).limit(limit + 1)`;
  `buildKeysetOr` applied only when a cursor is present; `paginateSorted` builds
  the `{ items, next_cursor }` page. SORT_COLS are NOT NULL columns only, so the
  cursor never straddles a null; nullable identifier columns (the various
  `*_number` fields) are search targets only. Existing `requireCap`, org scope,
  soft-delete filter, bundle and plugin gates, and facet parameters are all
  preserved.
- A `listXPage(params)` service method beside the intact legacy list method.
- A dual-path page: the legacy body preserved verbatim as the flag-off variant,
  the toolbar variant on `FEATURE_FLAGS.UI_LIST_TOOLBAR` composing `useServerList`,
  `SavedViewsBar`, and `CursorPager`, with the shared `DataTable` columns hoisted
  to module scope and `sortKey` set only on NOT NULL sortable columns.
- A `list-query` allowlist test per entity.

Skipped by design: the leads kanban (a board grouped over the full list, not a
DataTable list) and the bill-of-materials list (a derived per-parent rollup whose
component counts a single keyset page cannot reconstruct without a new server
aggregate endpoint, which the read-only scope forbids).

## Navigation fixes (same PR)

- `StockMovementsPage` `sourceLinkFor`: the `receiving_order` branch linked to
  `/3pl-operations/receiving-orders/:id`, a route that does not exist (a hard
  404); now `/3pl-operations/receiving/:id`. The `production_run` branch shared
  the `manufacturing_run` target `/manufacturing/runs/:id`, a different table;
  now the live `/3pl-operations/production/:id`. Both source rows are emitted by
  stock triggers, so both were operator-reachable dead-ends.
- `ProductionRunDetailPage`: the breadcrumb pointed at `/3pl-operations/production`,
  which redirects to `/manufacturing/runs`, a different pillar's list that never
  contained the run. `production_run` is a legacy-only entity (no reachable create
  path remains), so the leading crumbs are now display-only.

## How it was built

Dynamic multi-agent workflows. A foundation agent extracted the proven pattern
from the four shipped lists and `list-query.ts`; per-bundle agents co-migrated
edge, service, page, and test over disjoint file sets; adversarial reviewers
verified keyset correctness. The first twelve-wide edge-plus-page fan-out tripped
a transient server-side API capacity throttle, which killed seven bundles; a
resume hit the throttle harder. The recovery was small batches of two with
per-bundle retry, referencing the ten already-migrated entities as in-repo
templates, which completed all seven remaining bundles clean.

Three adversarial review passes over the 21 new entities returned:

- One LOW: a `journal_entries` response-envelope ternary inconsistent with the
  canonical handler. Fixed.
- Five false-positive HIGH: a reviewer flagged the three-pl list handlers as
  missing `requireCap`. A git-diff check showed those read handlers are RLS-only
  by design across the whole bundle (every list handler, pre-existing), the
  migration removed no capability, and the proposed `threepl.*.read` capabilities
  do not exist in the registry, so adding them would have denied every caller and
  broken all five lists. Rejected with evidence rather than applied.

## Gates

typecheck; lint (`--max-warnings 0`); 919 unit and regression tests; 47 contract
and parity tests (no byte-mirror canon drift); `deno check` on all twelve edge
bundles; production build with the SPA index chunk at 37.51 kB against the 40 kB
budget. Merged to main, CI green including RLS and e2e against staging on the
first run. Both prod deploys, edge functions and SPA, confirmed green.

## Constitutional invariants verified

Read-path only. No migration, no RLS change, no money-helper, idempotency,
`audit_log`, or capability change, no new dependency. Edge handlers preserve
`requireCap`, org scope, soft-delete, and bundle gates. The keyset envelope is
array-compatible, so a flag-off legacy reader still parses the response. All
twelve modified bundles are listed in `deploy-functions.yml`.

## Deploy note and follow-ups

The edge keyset change is additive, but a migrated page renders the toolbar
variant on deploy because the flag is on, so the edge must deploy with or before
the SPA. The single squash merge fires both deploy workflows together; the
array-compatible envelope keeps a brief ordering skew graceful.

Accepted tradeoff: flag-off legacy readers on the newly migrated lists now cap at
the default page size (50) rather than the old 200, identical to the four lists
shipped earlier and dormant while the flag is on. Follow-ups: the
copack/manufacturing channel-name and order-number cross-page lookups in the
flag-off path degrade past the first page (graceful, flag-off only); per-list
saved-view defaults are unset.
