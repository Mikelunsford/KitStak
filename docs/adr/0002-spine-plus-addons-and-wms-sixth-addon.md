# ADR 0002: Spine plus add-ons, and WMS as the sixth add-on

Date: 2026-06-04
Status: Accepted

## Context

The white paper V2 (2026-06-03) reframes the product from five pillars to one spine
plus composable add-ons. The spine ships with every account and holds what every
business reuses: the business backbone plus the shared building blocks (orders,
catalog, kits and BOMs, inventory and stock, warehouses, job types, production,
pricing, value-added services, materials). Each add-on adds one clean slice and
reads the spine instead of copying it.

The SPA already shipped this shape. The 2026-06-04 spine reroute (PR #247) moved the
spine and shared surfaces to neutral ungated roots and left only true add-ons gated.

Two product moves now follow:

- 3PL Operations pivots from being thought of as the warehouse engine to being the
  commercial and operational planning layer (Accounts, Job Builders, Job Runs,
  Supply Plans, Billing Review, Job Profitability), keeping its light execution
  surfaces (receiving, shipments).
- A new sixth add-on, WMS (warehouse execution), deepens inventory and warehouses to
  bin level.

One conflict had to be resolved. An earlier 2026-06-02 note had WMS owning
warehouses and stock. The white paper places those on the spine and has WMS only
deepen them. The current code already matches the white paper: the spine writes
warehouse-level `stock_movements` today with no WMS present (migrations 0030 and
0053). The white paper framing wins.

The full plan is `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md`.

## Decision

- Adopt the spine plus add-ons framing in the canon. The five pillars are add-ons on
  the spine. Branding order is preserved (3PL Operations, Manufacturing, Co-Pack and
  Ecom, KitForce, KitCost) with WMS appended as the sixth add-on.
- WMS is gated by a new `plugins.wms` flag at a new `/wms/*` route root, and defaults
  off. It is a paid add-on, unlike `three_pl`, which defaults on for every tier.
- WMS deepens, it never replaces. WMS adds a nullable `location_id` dimension (and
  optional lot and pallet id) to the existing `stock_movements` ledger and derives a
  bin-level rollup the same way the spine derives the warehouse-level rollup. The sum
  of bin quantities for a warehouse and item equals the warehouse `quantity_on_hand`
  by construction, asserted by a contract test. Turn WMS off and `location_id` stays
  null, exactly as every pre-WMS row already is, and the warehouse totals are
  untouched.
- The 3PL commercial layer roots under the existing gated `/3pl-operations/*`
  namespace, so it gates automatically through `inferPluginForPath`. No URL rename.
- The sidebar moves to a pillar-grouped model: a spine backbone section plus one
  section per lit add-on. This supersedes the UX-Q1 job-mode decision of 2026-05-21.
- Build sequence: the 3PL commercial layer first, then the WMS Phase 1 deepening core
  (locations and bins, directed putaway, bin-level stock that reconciles to the spine
  total, lot and expiration capture).

## Consequences

- CLAUDE.md (the intro and the branding rules) and `00-canon/01-architecture.md` are
  amended to record the spine plus add-ons framing and the WMS deepening contract.
- `plugins.wms` is reserved here. Its flag wiring, the `wms-api` bundle, the
  `deploy-functions.yml` BUNDLES entry, and the provisioning default land in WMS
  Phase B0.
- The additive `location_id` column touches the load-bearing spine `stock_movements`
  ledger. That is a stop-point: confirm with the operator before it lands in Phase
  B2, and ship the sum-reconcile contract test in the same PR.
- Billing Review stays light inside 3PL for now. Metered event capture and activity
  rate cards defer to a future KitMeter add-on, so the one-price-book rule holds.
- No new top-level dependency is introduced by this decision. Later WMS phases such
  as multi-carrier rate shopping may need carrier connectors via a future KitLink
  add-on and a separate dependency review at that time.
- The money, RLS, idempotency, and audit posture are unchanged in pattern. New tables
  reuse the chassis exactly, with RLS in each table's creation migration, forward-only
  migrations, and audit triggers on state-machine parents.
