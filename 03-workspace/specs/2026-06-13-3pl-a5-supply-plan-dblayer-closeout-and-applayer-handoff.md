# Handoff: 3PL Supply Plan DB layer shipped (Phase A5 backend), next is the A5 app layer

Date: 2026-06-13
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 6.1, section 7 Body A: A5).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
PR: #257 (open; the A5 DB layer is stacked on the Phase A4 work so migrations 0094 to 0097 stay contiguous). Do not merge without the operator.

## What the plan asked for

A5. Supply Plan: `supply_plans` and `supply_plan_lines`; reserve at release; shortage
resolution writes spine reserved movements; not auto-created receiving orders.

## Key finding (worth the operator's eyes at review)

The spine reservation path was dormant. `stock_levels.quantity_reserved` and the
GENERATED `quantity_available = on_hand - reserved` shipped in migration 0030, but
`recompute_stock_level` only ever derived `on_hand` and `stock_movements` had no
reserve movement type, so `quantity_reserved` was always 0. A5 step 1 (0095)
activates it. This is purely additive: the on_hand derivation is byte-identical,
and there are no existing reserve rows, so no current stock reading changes.

## What the A5 DB layer shipped (PR #257, stacked on A4)

Three migrations, all validated on staging in aborting transactions:

- `0095_stock_movements_reserve_type.sql`: extends the `stock_movements.movement_type`
  CHECK with `reserve` and `reserve_release` (guarded drop-then-add, strict
  superset of 0030); forward-redefines `recompute_stock_level` (only ever defined
  in 0030) to derive `quantity_reserved` from reserve minus reserve_release while
  leaving the on_hand CASE byte-identical. reserve movements are soft holds
  excluded from on_hand; the generated `quantity_available` is never written.
  Staging: reserve 4 then reserve_release 4 moved reserved 0 -> 4 -> 0 and available
  10 -> 6 -> 10, on_hand steady at 10.
- `0096_supply_plans.sql`: `supply_plans` (Pattern A; FSM draft / released /
  fulfilled / cancelled with paired timestamps; `warehouse_id` reservations draw
  from, defaults to the org default at release; `project_id` demand source) and
  `supply_plan_lines` (denormalised org_id, Pattern A; `item_id`; required /
  available / reserved / shortage qtys; `resolution` in reserve / inbound /
  purchase / replenish; nullable `resolved_po_id` and `resolved_receiving_order_id`
  manual links). Audit: supply_plans is a rich FSM (from_state -> to_state),
  supply_plan_lines uses the 0091 created / updated / deleted verbs; audit_log
  entity_type CHECK extended (supply_plan, supply_plan_line; db-0083 pin moved to
  0096). Two SECURITY DEFINER RPCs, 3-arg cross-tenant guard (NOT_FOUND never 403):
  - `release_supply_plan(p_plan_id, p_actor, p_caller_org_id)`: draft -> released.
    Per reserve-resolution line, reserves `least(required, available)` by writing a
    0095 reserve movement (source_entity_type 'supply_plan'); records available /
    reserved / shortage on every line. Non-reserve resolutions snapshot available
    and shortage but reserve nothing. Idempotent on an already-released plan.
  - `cancel_supply_plan(p_plan_id, p_actor, p_caller_org_id)`: writes
    reserve_release for each held line to restore the spine reserved, zeroes line
    reserved_qty, sets status cancelled. Idempotent on an already-cancelled plan.
  - Staging: a plan with line A (required 4, available 10) and line B (required 15,
    available 10) released to A reserved 4 / shortage 0 and B reserved 10 /
    shortage 5; the spine quantity_reserved tracked it; cancel released both to 0.
- `0097_supply_plans_numbering.sql`: wires `supply_plans.plan_number` into the
  numbering chassis with the SUP- prefix, mirroring 0090 (ACC-) and 0092 (JB-);
  extends `seed_org_numbering` (last in 0092) with supply_plan / SUP-.

Tests: `db-0095`, `db-0096`, `db-0097` static migration suites plus the moved
`db-0083` authoritative-redefinition pin. Gates green: typecheck, lint
(max-warnings 0), 759 unit + 475 regression, contract parity. No SPA / edge / type
changes this slice.

## Three modeling calls made (plan-faithful)

1. `supply_plans.warehouse_id` (the manufacturing-runs convention) since projects
   are not warehouse-scoped but reservations are. The release RPC resolves it to
   the plan's warehouse or the org default.
2. Release reserves `min(required, available)` and records the shortage; cancel
   releases the holds. `fulfilled` is a terminal no-stock marker (runs consume
   later, in A6).
3. `resolution` reserve is the active reserve-writing path; inbound / purchase /
   replenish are recorded intent plus nullable manual PO / receiving links. No
   auto-created orders (the plan's rule).

## Next: the A5 app layer (next slice, turnkey)

Mirror the A2 Job Builder app layer one-for-one. The `three-pl-api` bundle already
exists (A1) and is in the `deploy-functions.yml` BUNDLES list, so no new bundle
entry is needed; adding routes does not require a deploy-config change.

1. Capabilities (BOTH byte-mirror canons: `apps/web/src/lib/capabilities.ts` and the
   `_shared` mirror). Add `threepl.supply_plan.create|release|cancel` and
   `threepl.supply_plan.line.create|update|delete`. Roles: org_owner / org_admin /
   ops (matching the 0096 RLS). `requireCap` on every state-changing handler.
2. Byte-mirror types (`apps/web/src/lib/types/threepl.ts` and the `_shared` mirror,
   kept identical): `SupplyPlanSchema`, `SupplyPlanLineSchema`, plus Create / Patch
   request schemas. Quantities are numeric (number or numeric-string on the wire);
   no `_cents` here (quantities, not money). `resolution` is the four-value enum.
3. `three-pl-api` routes (mirror the job_template routes):
   - supply_plan CRUD: list (org-scoped, filters by status / project_id), get,
     create (nextDocNumber('supply_plan') -> SUP-, assertRefInOrg for project_id and
     warehouse_id), patch, soft-delete.
   - line CRUD: add / update / remove (assertRefInOrg for item_id, and for
     resolved_po_id / resolved_receiving_order_id when set).
   - release: `POST /supply-plans/:id/release` calls
     `client.rpc('release_supply_plan', { p_plan_id, p_actor: caller.userId,
     p_caller_org_id: caller.orgId })`, exactly like quotes-api calls
     convert_quote_to_project. requireCap threepl.supply_plan.release.
   - cancel: `POST /supply-plans/:id/cancel` calls `cancel_supply_plan` similarly.
   - All non-GET handlers enforce Idempotency-Key (the chassis helper) like the
     other three-pl-api routes.
4. SPA (mirror the A2 job-builders pages): `supplyPlansService.ts`,
   `useSupplyPlans.ts`, `supplyPlansKeys` in `queryKeys/threepl.ts`, and
   `pages/3pl-operations/supply-plans/` (List with status filter; Detail hub with a
   lines table showing required / available / reserved / shortage and a release /
   cancel action cluster gated to editable states; Create with project + warehouse
   pickers). Routes `/3pl-operations/supply-plans[/new|/:id]` (/new before /:id).
   Sidebar entry "Supply Plans" in the 3PL OPERATIONS section (gated
   plugins.three_pl) plus the sidebarModes test. Watch the index bundle (< 40 kB gz);
   keep the detail page lazy.

Then A6 Job Runs and Daily Progress (`job_runs` snapshots `job_template_id` at
creation, consumes / produces via spine movements, and can consume the Supply Plan
reservations), A7 Billing Review and Profitability, then WMS Body B (B0 to B4)
behind the B2 `stock_movements` `location_id` operator stop-point.

## Follow-ups

- F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01: add `supply_plans.job_run_id` (nullable FK)
  in A6 once `job_runs` exists, so a plan can reference a run as well as a project.
- F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01: in A6, wire job-run consumption to draw
  down a released plan's reservations (reserve_release as stock is consumed) and the
  fulfilled transition.
- F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01: a sum-reconcile contract test that
  asserts, across reserve / reserve_release, that stock_levels.quantity_reserved
  equals the sum of open supply_plan_line reserved_qty for a (warehouse, item). Pairs
  with the WMS B2 sum-reconcile test the operator flagged.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` stay identical; money
  is BIGINT cents; capabilities gate every write; the server is authority.
- Stack onto one branch, push when green, operator reviews the PR before merge.
- Delivery wave is Wave 12.
