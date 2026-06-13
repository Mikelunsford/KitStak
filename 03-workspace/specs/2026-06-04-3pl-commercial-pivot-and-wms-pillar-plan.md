# 3PL Commercial Pivot and the WMS Add-on. Consolidated planning doc

Status: PLANNING. Direction approved by the operator on 2026-06-04. No code, edge
functions, or migrations were written this session. This document is the input to
a future build session, not a build record.

Date: 2026-06-04
Author: planning session (build agent)
Pillar plugins touched: a new `plugins.wms` (the sixth add-on) plus new surfaces
under the existing `plugins.three_pl`.
Delivery wave: 12 (Wave 11 is the KitForce pillar). Risk and follow-up ids below
use the W12 / Wave12 prefix accordingly.

## 0. What this is and what it is not

This plan covers two bodies of work that arrived as one parked product direction:

1. The 3PL pivot. 3PL Operations stops being thought of as the warehouse engine
   and becomes the commercial and operational planning layer: Accounts, Job
   Builders, Job Runs, Supply Plans, Billing Review, and Job Profitability.
2. A new sixth add-on, WMS (warehouse execution), which deepens the spine's
   inventory and warehouses to bin level without replacing them.

It is a planning artifact. It defines product shape, the namespace and gating map,
a data-model sketch, the ownership reconciliation, and a phased build plan with
risks. It does not change app code, edge functions, or migrations.

## 1. Source authority and provenance

Three sources informed this plan. They agree on intent and differ on one point of
ownership, which is resolved below in favor of the newest source.

- White paper V2, `PILLARS AND FEATURES CONCEPT/REVISED DRAFT/Customer Storefront
  Pillar Client O.md`, dated 2026-06-03. The newest and authoritative concept
  doc. It frames the product as one spine plus composable add-ons and lists WMS as
  a warehouse-execution add-on that deepens inventory rather than owning it.
- The 3PL Job Builder pivot summary, preserved in MEMORY.md
  (`3pl-job-builder-wms-pivot-spec`). The original spec file
  `3pl-job-builder-planning.md` is no longer present on disk anywhere under
  `KitStak v.02`; only its copack and kitforce siblings survive. The memory entry
  carries its detail: the commercial-layer surfaces, the eight-phase plan, the
  proposed sidebar, the state language, and the six open product questions.
- The older `CONCEPTS/3PL Operations module` doc. It predates the white paper and
  corroborates the commercial intent (job-type project creation, job-type-as-a-
  service with per-customer pricing, customer-scoped Pattern B portals, materials).
  It treats WMS as the plugin that drives deeper stock movement, which the white
  paper refines.

Conflict and resolution. The June 2 memory said WMS would own warehouses, stock,
and inventory movements. The June 3 white paper places warehouses, stock, and
orders on the spine and has WMS only deepen them to bin level. The operator
confirmed the white paper framing on 2026-06-04. The current code already matches
the white paper: the spine writes warehouse-level `stock_movements` today with no
WMS present (migrations 0030 and 0053). WMS therefore layers bins on top of a stock
truth that already exists.

## 2. Decisions resolved this session

| # | Decision | Resolution |
|---|---|---|
| D1 | Framing of the sixth add-on | Target the white-paper spine plus add-ons model. WMS is add-on number six with a `plugins.wms` gate. The CLAUDE.md and 00-canon amendment is a tracked ADR at build time (Phase A0). |
| D2 | Build sequence | 3PL commercial layer first, WMS second. |
| D3 | WMS Phase 1 scope | The deepening core: locations and bins, directed putaway, bin-level stock that reconciles to the spine warehouse total, and lot and expiration capture. Everything else is named, not promised. |
| D4 | Sidebar IA | Switch to a pillar-grouped sidebar. A spine backbone section plus one section per lit add-on. This supersedes the UX-Q1 job-mode decision. |
| D5 | Account UI name | Accounts. The service-relationship layer over a CRM customer, distinct from the CRM Customers record. |
| D6 | Reserve timing | At project release and Supply Plan computation, not at quote acceptance. |
| D7 | Job Run creation | Manual scheduling first. Auto-create can layer on later. |
| D8 | Labor source | Simple Job-Run labor logging first, with a nullable forward link to reconcile to KitForce later. |

Three lower-stakes calls are recommended here and open to override (section 9):
Sidekick as a branded job-template variant; customer-supplied inbound named an
Inbound Requirement that materializes as a spine inbound order; and a light Billing
Review now with metered billing deferred to a future KitMeter add-on.

## 3. Product shape

The vision is one loop that ties the commercial layer to the floor and back to the
books, every word meaning the same thing end to end:

Job Builder to Quote to accepted Project to Supply Plan to Job Run to Daily Logs to
actual profit and loss to Billing Review.

The platform is one spine plus composable add-ons. The spine ships with every
account and holds what every business reuses: its people, customers, money,
catalog, inventory, orders, and the shared building blocks. Each add-on adds one
clean slice and reads the spine instead of copying it. Any combination can run or
be turned off without breaking the others.

Two add-ons are in scope here. 3PL Operations gains the commercial and planning
layer on top of its existing execution surfaces. WMS is new and deepens inventory
and warehouses to bin level. Both compose on the spine, like the others.

## 4. Ownership reconciliation

This is the load-bearing section. It states who owns what so the add-ons never
double-count or compete. The governing rule, from the white paper, is one ladder
per shared surface: where the same surface could be described many ways, there is
one capability with rungs, not competing products.

### 4.1 Ownership table

| Concern | Spine (always on) | 3PL Operations add-on | WMS add-on |
|---|---|---|---|
| Customers | CRM customer is the truth | Accounts overlay (service relationship, references the customer) | reads |
| Pricing | one price book is the truth | per-account service rates (Rate Cards overlay) | reads |
| Catalog, Kits, BOMs | the truth | references | references |
| Orders (inbound and outbound) | the order record is the truth | receiving and shipping workflow on top | wave, pick-path, pack, manifest on top |
| Inventory and stock | warehouse-level truth: `stock_levels` (generated available) derived from the `stock_movements` ledger | reads; reserves via spine reserved movements | bin-level deepening: a location dimension on the same ledger that sum-reconciles to the warehouse total |
| Warehouses | the truth | references | bins and locations live under a warehouse |
| Production | shared building block (runs) | Job Runs consume and produce via spine movements | bin-level component pulls (later phase) |
| Job types | shared building block | Job Builders select a job type | not used |
| Value-added services and materials | shared catalog | per-account service definitions; materials per job | not used |
| Receiving | receipt against an inbound order | scan-to-confirm receiving | directed putaway, lot and pallet capture |
| Shipping | standard label, packing list, bill of lading | queue, pick, dispatch workflow | wave release, pick-path, pack verification, multi-carrier, manifest, end-of-day close |
| Returns | inbound order linked to the outbound | receive and restock | disposition: putaway, quarantine, or scrap |
| Billing | invoices and payments are the truth | Billing Review (estimate versus actual to an invoice draft) | not used; KitMeter meters activity later |
| Labor | My Team pay rates | simple Job-Run labor log (KitForce reconcile later) | not used |

### 4.2 The ladders

- Inventory. Spine warehouse-level stock, then WMS bin-level stock. Same ledger,
  finer grain.
- Receiving. Spine receipt, then 3PL scan-to-confirm, then WMS directed putaway
  with lot and pallet capture.
- Shipping. Spine standard paperwork, then 3PL queue and pick and dispatch, then
  WMS wave and pick-path and pack verification and multi-carrier and manifest.
- Returns. Spine inbound order linked to the outbound, then 3PL receive and
  restock, then WMS disposition.

### 4.3 What moves

Nothing physical moves out of the spine. The pivot is additive. No tables move and
no URLs rename. Two things change in posture only:

- 3PL's identity shifts from being thought of as the warehouse engine to being the
  commercial and planning layer plus light execution. Its existing execution
  surfaces (receiving, shipments) stay where they are.
- The bin-level execution that the old concept doc implied 3PL would own is now
  cleanly the WMS add-on, deepening the spine. This is a conceptual move, not a
  data move.

### 4.4 The deepens-not-replaces contract, in schema terms

Spine stock today (migration 0030): `stock_levels` is one row per warehouse and
item, with `quantity_on_hand` and `quantity_reserved` maintained by a trigger off
the append-only `stock_movements` ledger, and `quantity_available` a GENERATED
column equal to `on_hand` minus `reserved`. You cannot drift it by hand.

WMS deepens this by adding a nullable `location_id` dimension (and optional
`lot_id` and pallet or license-plate id) to the same `stock_movements` ledger, and
deriving a bin-level rollup (`bin_stock_levels`) the same way the spine derives the
warehouse-level rollup. Because both rollups read the same ledger, just grouped
with or without the location dimension, the sum of bin quantities for a warehouse
and item equals the warehouse `quantity_on_hand` by construction. A contract test
asserts this equality.

Turn WMS off and handlers stop setting `location_id` (it stays null, exactly as
every pre-WMS row already is). The bin rollups go empty and the warehouse totals
are untouched. Nothing is lost. This is the white-paper guarantee expressed in the
existing chassis.

## 5. Namespace, gating, and IA map

### 5.1 Build on the shipped spine plus add-ons URLs

The 2026-06-04 spine reroute (PR #247) already moved spine and shared surfaces to
neutral ungated roots and left only true add-ons gated. This plan builds on those
URLs. It proposes no rename. The reroute memory and STATUS.md record the high
friction of a rename; it is off the table.

Spine, ungated, already shipped: `/crm/*`, `/quotes`, `/projects`, `/catalog/*`
(items, boms, vas), `/inventory/*` (warehouses, stock/levels, stock/movements),
`/purchasing/*` (vendors, purchase-orders, vendor-bills, expenses),
`/settings/sales-config/*`, `/invoicing/*`, `/finance/*`.

### 5.2 New 3PL commercial surfaces (gated `plugins.three_pl`)

Root the commercial layer under the existing gated `/3pl-operations/*` namespace so
`inferPluginForPath` gates it automatically. These are new paths, not renames.

```
/3pl-operations/accounts
/3pl-operations/accounts/:id           (service definitions, rate cards live here)
/3pl-operations/job-builders           (job templates)
/3pl-operations/job-builders/:id
/3pl-operations/job-runs
/3pl-operations/job-runs/:id           (daily production log)
/3pl-operations/supply-plans
/3pl-operations/supply-plans/:id
/3pl-operations/billing-review
/3pl-operations/profitability
(existing) /3pl-operations/receiving, /3pl-operations/shipments
```

### 5.3 New WMS add-on surfaces (gated `plugins.wms`)

A new neutral pillar root `/wms/*`, gated by a new flag. Phase 1 surfaces:

```
/wms/locations        (bins and location map)
/wms/putaway          (directed putaway tasks)
/wms/bin-stock        (bin-level stock view)
/wms/lots             (lot and expiration capture)
```

Later phases, named not promised: `/wms/waves`, `/wms/pick-paths`,
`/wms/pack-stations`, `/wms/cycle-counts`, `/wms/shipping` (multi-carrier),
`/wms/yard`, `/wms/returns-disposition`, serial tracking, slotting.

### 5.4 Gating mechanics (confirmed against current code)

- Flag canon. Add `PLUGINS_WMS: 'plugins.wms'` to both byte-mirrored constants
  files: `apps/web/src/lib/constants.ts` and
  `supabase/functions/_shared/constants.ts`. Drift is a release blocker.
- SPA gate. Add one clause to `inferPluginForPath` in `apps/web/src/routes.ts`:
  `if (inPillar(spec.path, '/wms')) return FEATURE_FLAGS.PLUGINS_WMS;`. The
  `withPluginGate` mapper then injects `requiresPlugin` so the SPA renders
  NotFoundPage when the org lacks the flag.
- Edge gate. A new bundle `wms-api`, sibling to `manufacturing-api`, served through
  `serveBundleWithGate` on `plugins.wms`. Gate off returns the 404 NOT_FOUND
  envelope for every path, per the constitution.
- Deploy. Add `wms-api` to the `deploy-functions.yml` BUNDLES list. A new bundle
  that is not added to BUNDLES never deploys, which presents as CORS or ERR_FAILED
  on the new routes. This is a known repeat trap (see the deploy-functions BUNDLES
  memory).
- Default state. WMS defaults off. It is a paid add-on, unlike `three_pl` which
  defaults on for every tier. Org provisioning seeds `plugins.wms = false`.

### 5.5 Pillar-grouped sidebar (D4)

The sidebar moves from six job-modes (SELL, MAKE, SHIP, GET PAID, LIBRARY,
WORKFORCE) to pillar-grouped sections. This maps cleanly onto spine plus add-ons: a
backbone section that is always on, then one section per lit add-on. The change is
sidebar-only. `apps/web/src/components/shell/sidebarModes.ts` is fully decoupled
from the route table, URLs do not change, and search hrefs, deep links, and
canon-steward stay green. Proposed sections:

- SPINE (always on): CRM, Quotes, Projects, Catalog, Inventory, Purchasing,
  Invoicing, Finance, Settings. Sub-grouped by domain.
- 3PL OPERATIONS (gated `three_pl`): Accounts, Job Builders, Job Runs, Supply
  Plans, Receiving, Shipments, Billing Review, Profitability.
- MANUFACTURING (gated `manufacturing`): Runs.
- CO-PACK AND ECOM (gated `copack_ecom`): Sales orders, Kitting jobs,
  Fulfillments, Sales channels.
- WMS (gated `wms`): Locations, Putaway, Bin stock, Lots.
- KITFORCE (gated `kitforce`): Members, Teams, Schedule, Assignments, Time entries.
- KITCOST (gated `kitcost`): Cost dashboard.

This supersedes the UX-Q1 job-mode decision locked 2026-05-21. That supersession
is recorded as its own short decision note in Phase A1, and the nav and
accessibility tests are re-run because the grouping model changes.

## 6. Data-model sketch

Conventions reused from the chassis for every new table, stated once: org-scoped
with denormalized `org_id` for Pattern A RLS; standard `created_at`, `created_by`,
`updated_at`, `updated_by` columns, and `deleted_at` on parents for soft delete;
quantities `numeric(18,4)`; money BIGINT with the `_cents` suffix, banker's
rounding, currency snapshotted at issuance, never floats; org-scoped partial-unique
document numbers via the existing numbering chassis (`nextDocNumber`); state
machines as text columns with CHECK constraints; append-only audit via triggers
with new `entity_type` values added by the guarded drop-then-add CHECK extension
(the migration 0052 pattern); Zod schemas landed byte-identical in
`_shared/types/<domain>.ts` and the SPA `apps/web/src/lib/types/<domain>.ts`
mirror; capabilities registered byte-identical in both capability canons.

RLS posture. The constitutional rule that every tenant-scoped table has RLS from
migration 0001 means, for new tables, RLS in the same migration that creates the
table. Forward-only forbids editing 0001. Every table below ships its RLS policy in
its own creation migration.

Idempotency posture. Every non-GET handler enforces the `Idempotency-Key` header
and routes through `respondWithIdempotency`, identical to the chassis. No change to
the idempotency helpers.

Audit posture. State-machine parents get an AFTER UPDATE OF status audit trigger.
Line items and libraries get the insert, update, delete audit trigger with an
action verb. The hash chain is unaffected. No best-effort handler writes.

Migrations start at the next free id. The last applied is `0088`, so new files
number from `0089`, one concern per file, forward-only, idempotent DDL.

### 6.1 3PL commercial layer tables

- `three_pl_accounts` (parent, Pattern A). The service relationship over a CRM
  customer. `customer_id` references `customers(id)` and is validated in-org; the
  account never copies the customer. `account_number` (prefix ACC-), display name,
  `status` in (active, inactive), settings `payload jsonb`. Write roles
  org_owner, org_admin, sales, ops.
- `account_service_definitions` (child, Pattern B parent-join to the account).
  Per-customer co-pack, kit, rework, inspection, labeling, storage, or custom
  service definitions with per-customer rates. `vas_id` references the spine
  `value_added_services(id)`. `rate_cents`, `rate_uom`, `currency_code` snapshot,
  effective dates. This is the 3PL-local Rate Card overlay. See section 9 for the
  boundary with a future KitMeter.
- `job_templates` (parent, Pattern A). The Job Builders engine. `variant` in (kit,
  sidekick, repack, labeling, inspection, custom). `job_type_id` references the
  spine `job_types`. `default_bom_id` references the spine `boms`. Builder
  definition steps in `payload jsonb`. Active flag. `template_number` prefix JB-.
- `job_template_lines` (child, Pattern B). Component, value-added service, and step
  lines, with expected quantities and rates. References spine items, services, and
  materials.
- `job_runs` (parent, state machine, Pattern A). Day-by-day floor execution
  bridging a project and the floor. `project_id` references the spine `projects`.
  `account_id` references the account. `job_template_id` is snapshotted at creation
  so later template edits do not rewrite history (the BOM-versioning rationale).
  `warehouse_id` references the spine `warehouses`. `run_number` prefix RUN-.
  Created manually (D7). Header state machine:

  ```
  planned     -> in_progress
  in_progress -> completed
  completed   -> closed
  planned|in_progress -> cancelled
  closed      -> (terminal)
  ```

  The per-line material lifecycle adopts the spec's verbs as line states: Planned,
  Reserved, Staging Requested, Staged, Consumed, Produced. These describe stock and
  staging, not the header.
- `job_run_daily_logs` (child, Pattern B). The Daily Production Log. `log_date`,
  produced and consumed lines, `labor_hours`, optional `labor_rate_cents`, and a
  nullable `kitforce_time_entry_id` forward link for later reconcile (D8). Posting
  a daily log emits spine `stock_movements` (consumed out, produced in) when a
  warehouse is set, mirroring migration 0053. WMS-off behavior is identical:
  warehouse-level movements with a null location.
- `supply_plans` (parent, Pattern A). Shortage resolution, not auto-created
  receiving orders. `plan_number` prefix SUP-. References the project or job run.
  State in (draft, released, fulfilled, cancelled). On release (D6), compute
  shortages and create reservations for available stock.
- `supply_plan_lines` (child, Pattern B). Per item: required, available, shortage,
  and a `resolution` in (reserve, inbound, purchase, replenish) with a link to the
  resulting PO or inbound order. The reserve action writes a reserved
  `stock_movement` so the spine `quantity_reserved` reflects it and
  `quantity_available` auto-derives. This honors the generated-column contract.
- `billing_reviews` (parent, Pattern A). Estimate versus actual review before
  invoicing. Light scope. `review_number` prefix BILL-. References the account,
  project, or job run. State in (draft, approved, invoiced, cancelled). Approve
  creates a spine invoice draft with lines from actuals and account service rates,
  currency snapshotted.
- Job Profitability. A derived read model first, not a new write table. Quote
  estimate versus job-run actuals (consumption plus labor) versus billed revenue,
  exposed as a SQL view and a profitability page. A `job_profitability_snapshots`
  table to freeze numbers is a later option, noted not built.

New capabilities (registered in both capability canons):
`threepl.account.read|create|update|deactivate`,
`threepl.account.service_definition.create|update|delete`,
`threepl.job_template.read|create|update|delete`,
`threepl.job_run.create|update|start|complete|close|cancel`,
`threepl.job_run.daily_log.create|update|post`,
`threepl.supply_plan.create|release|cancel` plus line ops,
`threepl.billing_review.create|approve|cancel`,
`threepl.profitability.read`.

New audit entity types: `three_pl_account`, `account_service_definition`,
`job_template`, `job_template_line`, `job_run`, `job_run_daily_log`,
`supply_plan`, `supply_plan_line`, `billing_review`.

### 6.2 WMS Phase 1 tables (the deepening core)

- `warehouse_locations` (parent, Pattern A with denormalized `org_id`).
  `warehouse_id` references the spine `warehouses(id)`, validated in-org. `code`,
  `location_type` (bin, shelf, rack, dock, staging), a nullable self-referencing
  `parent_location_id` for hierarchy, `attributes jsonb` (pickable, putaway
  eligible, capacity), active flag.
- `putaway_tasks` (parent, state machine, Pattern A). `warehouse_id`, a source
  reference (receiving or return), `item_id`, `quantity`, `suggested_location_id`,
  `actual_location_id`, nullable `lot_id` and pallet or license-plate id. State in
  (suggested, in_progress, done, cancelled). Done writes a bin-dimensioned
  `stock_movement`.
- `lots` (parent, Pattern A). `item_id` references the spine `items`, `lot_code`,
  `expiration_date`, `received_at`, status in (active, quarantined, expired,
  consumed). Phase 1 captures lot and expiration. First-expired-first-out selection
  logic and a full holds and quarantine table are a later phase; the quarantined
  status flag is the minimal hold for now.
- `bin_stock_levels` (rollup, Pattern A). One row per org, warehouse, location,
  item, and lot, with `quantity_on_hand`, maintained by a recompute trigger that
  groups `stock_movements` by the location and lot dimensions. The spine
  `stock_levels` continues to derive its warehouse-level total from all movements
  regardless of location. The sum-reconcile invariant is a contract test.
- Spine ledger change. An additive, nullable `location_id` (and optional `lot_id`,
  pallet id) on the existing `stock_movements` table. Forward-only and idempotent.
  Existing rows keep a null location, which is the WMS-off default. This touches a
  load-bearing spine table and is gated behind explicit operator confirmation at
  Phase B2 (section 8 and section 10).

New WMS capabilities: `wms.location.read|create|update|deactivate`,
`wms.putaway.create|start|complete|cancel`,
`wms.lot.read|create|update|quarantine`, `wms.bin_stock.read`.

New audit entity types: `warehouse_location`, `putaway_task`, `lot`.

## 7. Phased build plan

3PL commercial layer first (D2), then WMS. Each phase is one coherent slice with
its own migrations, edge routes, SPA pages, tests, and PR. Migration numbers are
illustrative and confirmed against the tree at build time.

### Body A. 3PL commercial layer

- A0. Canon and framing. The ADR and CLAUDE.md plus 00-canon amendment for spine
  plus add-ons and WMS as add-on six, and the short decision note that the
  pillar-grouped sidebar supersedes UX-Q1. Docs and canon only. This gates
  everything else.
- A1. IA and Accounts. `three_pl_accounts` and `account_service_definitions`, RLS,
  audit, caps, `three-pl-api` routes, SPA pages under `/3pl-operations/accounts`.
  Ship the pillar-grouped sidebar here (sidebar-only).
- A2. Job Builder foundation. `job_templates` and `job_template_lines`, the builder
  UI, the branded variants.
- A3. Quote integration. A job template drives quote line generation; a won quote
  becomes a project and a job of the right type, reusing spine quoting, projects,
  and job types.
- A4. Project conversion with template snapshotting. On release, snapshot the
  template into the run so later template edits do not rewrite history.
- A5. Supply Plan. `supply_plans` and `supply_plan_lines`; reserve at release;
  shortage resolution writes spine reserved movements.
- A6. Job Runs and Daily Progress. `job_runs` and `job_run_daily_logs`; manual
  scheduling; the daily production log; simple labor logging; produced and consumed
  posts spine `stock_movements`.
- A7. Billing Review and Profitability. `billing_reviews` to an invoice draft; the
  profitability view. Light billing; KitMeter deferred.

### Body B. WMS add-on, Phase 1 deepening core

- B0. WMS chassis. The `plugins.wms` flag in both mirrors, the `inferPluginForPath`
  clause, the `wms-api` bundle and gate, the deploy BUNDLES entry, the WMS sidebar
  section, and provisioning seeding the flag off.
- B1. Locations and bins. `warehouse_locations`, RLS, caps, edge, SPA
  `/wms/locations`.
- B2. Stock-movement bin dimension. The additive nullable `location_id` on
  `stock_movements`, the `bin_stock_levels` rollup and recompute trigger, and the
  sum-reconcile contract test. Operator-confirmed spine change.
- B3. Directed putaway. `putaway_tasks`; done writes a bin-dimensioned movement.
- B4. Lot and expiration capture. `lots`; receiving and putaway capture lot and
  expiration; first-expired-first-out groundwork.

Later WMS phases (named, not promised): holds and quarantine, cycle counts and full
physical inventory, wave release and pick-path, pack verification, multi-carrier
rate shopping and manifesting and end-of-day close, yard and dock scheduling,
returns disposition, serials, slotting. Several of these (carriers, retailer EDI)
likely require KitLink connectors and a dependency review when they come.

## 8. Risks

### Closed by this plan

- R-W12-PIVOT-01. Ambiguity over who owns warehouses and stock. Closed: spine owns,
  WMS deepens, grounded in migration 0030.
- R-W12-PIVOT-02. URL churn from the pivot. Closed: build on the shipped spine plus
  add-ons URLs; new paths only; no rename.
- R-W12-PIVOT-03. WMS scope blowout. Closed: Phase 1 is the deepening core; the
  rest is named, not promised.

### Carried

- R-W12-CO-01. The canon amendment for six add-ons and spine language is not yet
  landed. Carried to Phase A0.
- R-W12-CO-02. The additive `location_id` column touches the load-bearing spine
  `stock_movements` ledger. Carried to Phase B2 with a sum-reconcile contract test
  and explicit operator confirmation.
- R-W12-CO-03. The Billing Review versus KitMeter boundary. Carried: light billing
  now, metered events and activity rate cards to a future KitMeter add-on.
- R-W12-CO-04. The pillar-grouped sidebar supersedes the UX-Q1 job-mode decision.
  Carried: a decision note plus a nav and accessibility re-test in Phase A1.
- R-W12-CO-05. Labor reconcile to KitForce deferred behind a nullable forward link.
- R-W12-CO-06. Account model generality. `three_pl_accounts` is 3PL-scoped for now;
  if other add-ons need accounts later, it may generalize to a neutral root with a
  redirect.

Proposed follow-up ids: F-Wave12-3PL-COMMERCIAL-01 through 07 for Body A phases,
F-Wave12-WMS-01 through B4 for Body B, F-Wave12-CANON-SPINE-ADDONS-ADR-01 for A0,
and F-Wave12-SIDEBAR-PILLAR-REGROUP-01 for the sidebar.

## 9. Open product questions, recommended and open to override

The eight decision points the operator chose are in section 2. Three lower-stakes
questions are recommended here. Say the word to change any.

- Sidekick. Recommend a branded `variant` of `job_templates` (a preset of the Job
  Builder), not a separate concept. It keeps one engine and lets marketing brand
  the preset.
- Customer-supplied inbound naming. Recommend one concept with ladder naming: an
  Inbound Requirement on the 3PL commercial planning side, which materializes as a
  spine inbound order and, with WMS on, becomes a WMS Expected Receipt for directed
  putaway. One record, three rungs, no duplicate entity.
- Billing Review versus KitMeter. Recommend a light Billing Review now (estimate
  versus actual to an invoice draft) inside 3PL, and defer true metered event
  capture and activity rate cards to a future KitMeter add-on. Rate Cards remain
  spine pricing, surfaced under Account settings. This keeps the one-price-book
  rule intact and avoids a second price list.

## 10. Constitution alignment and stop-points

- Six add-ons and spine language versus the branding canon "Five pillars in order."
  The operator approved the direction. This plan does not edit canon. The amendment
  is Phase A0, an ADR plus the CLAUDE.md branding and 00-canon update, with operator
  approval at that point. Stop-and-ask is honored by not editing canon this session.
- The `stock_movements` additive column. The constitution says a schema change that
  touches RLS, money helpers, idempotency, or audit_log requires a stop and a
  confirm. `stock_movements` is adjacent to those load-bearing surfaces. Treat
  Phase B2 as a stop-point: confirm with the operator before the column lands, and
  ship the sum-reconcile contract test in the same PR.
- No new top-level dependency is introduced by this plan. Later WMS phases such as
  multi-carrier rate shopping may need carrier connectors via KitLink and a
  separate dependency review at that time.
- Money, RLS, idempotency, and audit posture are unchanged in pattern. New tables
  reuse the chassis exactly. No floats, no 403 where 404 is constitutional, RLS
  from each table's creation migration, forward-only migrations.

## 11. Out of scope this plan

- Manufacturing, Co-Pack and Ecom, KitForce, and KitCost are unchanged here.
  Production stays a shared building block.
- Customer Storefront, KitMeter, and KitLink are future add-ons named in the white
  paper and not planned here beyond the boundaries noted.
- No app code, edge functions, or migrations were written this session. This is the
  planning input for a future build session.
