# Per-line supply_source override (PR #329)

Date: 2026-06-17
Closes: F-UIUX-ENTITYPICKER-LINE-OVERRIDE-01 (the deferred follow-up from PR #327, Option A)
Status: SHIPPED and LIVE on prod. CHANGELOG `0.25.0`. No new migration (prod stays at `0122`).

## What shipped

The per-line supply_source override, wired end to end so operators can set it on an
individual consumption line. The override column already existed (migration 0121) and the
job-profitability view already honored it (0122); this pass exposed it on the read and
create schemas, accepted it on the edge handlers, and added an operator control on every
consumption-line editor. Merged as PR #329 (squash `0cf26c0`), live after deploy-functions
(ops-api, manufacturing-api, copack-api, three-pl-api) and deploy-prod went green.

Canon (byte-identical pairs, pnpm test:contract green):
- A local SupplySource enum and a nullable supply_source field on the read and create
  schemas of the five consumption-line types (receiving, shipment, manufacturing-consumed,
  kitting-consumed, job-run-daily-log-consumed), in both the _shared and apps/web mirrors of
  vendors_inventory_ops.ts, copack.ts, and threepl.ts. Read fields are nullable optional
  (the project_id deploy-window convention); create fields are nullable optional, where NULL
  inherits the item default.

Edge (ops-api, manufacturing-api, copack-api, three-pl-api):
- The POST insert and PATCH update for each of the five line handlers carry supply_source
  (insert ?? null; patch conditional on undefined), mirroring the existing column handling.
- No new cost-zeroing logic: the dashboard folds and view_job_profitability are the only
  cost sinks and were already supply-source aware (COALESCE(line, item)).

SPA:
- New SupplySourceSelect (nullable override; empty option = inherit from item) on the
  add-line form of all five consumption-line editors, threaded through the existing services
  (which forward the whole body) and reset on success.
- Receiving captures the picked item's default source and disables and nulls the unit-cost
  input when the effective source COALESCE(override, item default) is customer_supplied or
  third_party_consigned, so org cost is not captured for material the org neither owns nor
  pays for.

## One fix during the build

The first pass made the read fields required-nullable, which broke two handler-mock
regression tests in transition-status-guard-and-line-mirror (the fixtures omit the column).
Switched the read fields to nullable optional, the established convention for additive read
columns (mirrors ManufacturingRun.project_id), rather than doctor the fixtures.

## Verification

typecheck, lint (0 warnings), unit, regression (incl. the line-mirror handler suite),
contract parity, and the production build all green before merge. No migration, so no
staging/prod DB step; the post-merge workflows deployed the four edge bundles and the SPA.

## Feature complete

With this merged, the whole EntityPicker plus items.supply_source feature is fully shipped
with nothing deferred: the typeahead combobox pickers, the inline quick-create for all five
entities, the item-level supply_source dimension and costing, and now the per-line override
on every consumption-line editor.
