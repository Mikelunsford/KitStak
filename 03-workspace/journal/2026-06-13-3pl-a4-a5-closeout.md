# Closeout: 3PL A4 (project template snapshot) + A5 (Supply Plan), merged to prod

Date: 2026-06-13
Wave: 12 (3PL commercial layer)
PR: #257 (squash `0686e61`) merged to main; migrations 0094 to 0097 applied to prod.
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md`.

## What shipped

Two A-phases on one branch (kept together so migrations 0094 to 0097 stay
contiguous):

- **A4. Project conversion with template snapshotting.** `convert_quote_to_project`
  (migration 0094, forward redefinition of the 0093 4-arg RPC) records
  `source_job_template_id` on the quote and the project and freezes the source Job
  Builder template (header plus lines) into `projects.job_template_snapshot`, so
  later template edits never rewrite a project's origin. `quotes-api` validates the
  template in-org (`assertRefInOrg`, 404). SPA: the apply-template flow stamps the
  breadcrumb; the project detail page shows a "Built from template" link and a
  read-only TEMPLATE SNAPSHOT panel.

- **A5. Supply Plan.** `supply_plans` and `supply_plan_lines` (migration 0096)
  resolve a project's material demand against on-hand stock. `release_supply_plan`
  reserves `min(required, available)` per reserve-resolution line and records the
  shortage; `cancel_supply_plan` releases the holds. Both are 3-arg
  cross-tenant-guarded SECURITY DEFINER RPCs. SUP- numbering (0097). The app layer
  (caps in both canons, `three-pl-api` routes, byte-mirror types, the Supply Plans
  SPA, the sidebar entry, `StatusBadge` released / fulfilled states) shipped in the
  same PR.

## The load-bearing finding

The spine reservation path was dormant. `stock_levels.quantity_reserved` and the
GENERATED `quantity_available = on_hand - reserved` shipped in migration 0030, but
`recompute_stock_level` only ever derived on_hand and there was no reserve movement
type, so `quantity_reserved` had been 0 for the life of the app. Migration 0095
activates it: it adds the `reserve` / `reserve_release` movement types and derives
`quantity_reserved`, leaving the on_hand derivation byte-identical. Purely additive
(no existing reserve rows), so no current stock reading moved.

## Verification

- Staging (aborting transactions, nothing committed): the ledger moved
  `quantity_reserved` and the generated `quantity_available` correctly (10 to 6 to
  10, on_hand steady); a plan with a covered line (reserved 4, shortage 0) and a
  short line (reserved 10, shortage 5) released and cancelled with the spine
  reserved tracking it; A4 carried the breadcrumb and a three-line snapshot.
- Gates on the PR: typecheck, lint (max-warnings 0), 760 unit plus 475 regression,
  contract parity (byte-mirror caps and types intact), deno check across all 29
  edge bundles, build, size-limit (SPA index 39.6 kB gz, under 40).
- Post-merge: the `migrate` workflow applied 0094 to 0097 to prod and staging
  (prod verified at max 0097 via `list_migrations`); deploy-functions and
  deploy-prod ran on main.

## One judgment call (operator can revisit)

`threepl.supply_plan.*` capabilities and the 0096 RLS were set to the uniform 3PL
commercial roles (org_owner / org_admin / ops / sales), matching accounts and
job_templates, rather than the ops-only set drafted first. Caps and RLS list the
same roles.

## Reference / index documents updated

- `CHANGELOG.md`: new 0.16.0 entry covering the Wave 12 3PL commercial layer
  (A1 to A5).
- `docs/api/inventory.md`: the `reserve` / `reserve_release` movement types and the
  `quantity_reserved` derivation.
- `docs/api/sales.md`: `convert_quote_to_project` now carries `job_type_id` and
  `source_job_template_id` and freezes the template snapshot.
- `docs/api/threepl.md`: new reference for the 3PL commercial layer routes
  (accounts, job templates, supply plans).
- `STATUS.md`: A4 and A5 sections.

## Follow-ups carried

- F-Wave12-PROJECT-SNAPSHOT-DIFF-01: snapshot-vs-live-template drift view on the
  project page (optional).
- F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01: add `supply_plans.job_run_id` in A6.
- F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01: wire A6 job-run consumption to draw down
  a released plan's reservations and the fulfilled transition.
- F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01: sum-reconcile contract test
  (`quantity_reserved` equals the sum of open line `reserved_qty` per warehouse and
  item); pairs with the WMS B2 sum-reconcile test.
- F-Wave12-QUOTE-UPDATE-IMMUTABLE-FIELDS-01: tighten the quote PATCH schema
  (carried from A3).

## Next

A6. Job Runs and Daily Progress: `job_runs` snapshots `job_template_id` at
creation, consumes and produces via spine movements, and can draw down the Supply
Plan reservations. Then A7 Billing Review and Profitability, then WMS Body B
(B0 to B4) behind the B2 `stock_movements` `location_id` operator stop-point.
