# Wave 12 closeout: WMS Body B (warehouse execution, Phase 1 deepening core)

Date: 2026-06-15
Wave: 12 (3PL commercial pivot plus WMS sixth add-on)
Phase: Body B, Phase 1 (the WMS deepening core, B0 through B4, plus a receiving-to-dock insert and an RPC grant hardening).
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 7, Body B). Handoff: `03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md`. ADR: `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Release: CHANGELOG `0.18.0`. PRs #267, #268, #269, #271, #272, #273, #274.

This journal is written after the fact to close the documentation gap the `0.18.0` CHANGELOG entry flagged ("There is no WMS closeout journal yet; the migration headers and the Body B handoff spec are the authoritative record"). It closes `R-W14-DOCS-03`.

## Scope

The sixth Kitstak add-on shipped: WMS, warehouse execution. WMS deepens the spine's warehouse-level stock to bin level without replacing it. A nullable `location_id` dimension rides the existing append-only `stock_movements` ledger; the sum of the bins equals the warehouse `quantity_on_hand` by construction; and turning `plugins.wms` off leaves the spine totals untouched. WMS is a paid add-on gated by `plugins.wms` (default off) at a new `/wms/*` root behind a new `wms-api` edge bundle.

The deepens-not-replaces contract is the heart of the phase. The spine owns warehouse-grain `stock_levels`, derived from the ledger. WMS derives a bin-grain `bin_stock_levels` rollup from the same ledger, just grouped with the location dimension instead of without it. Both read the identical signed-quantity ledger, so the bin grain reconciles to the warehouse grain by construction, with no second count to keep in step.

## Deliverables

1. WMS chassis (B0). The `plugins.wms` flag in both canon mirrors, the `wms-api` bundle and gate, provisioning seeded with the flag off, and the `/wms` sidebar section.
2. Warehouse locations (B1). The `warehouse_locations` config table (bins, shelves, racks, docks, staging areas) with an audit trigger, WMS capabilities, byte-mirror types, the `wms-api` location routes, and the SPA `/wms/locations` surface.
3. Stock-movement bin dimension (B2), the spine stop-point. The additive nullable `location_id` on `stock_movements`, the `bin_stock_levels` rollup and its recompute, and one AFTER INSERT trigger that fires both the warehouse and the bin rollup off the same row. The SPA `/wms/bin-stock` surface.
4. Receiving-to-dock. A single header `dock_location_id` on `receiving_orders` (one dock per receipt, header column, never per line), threaded onto the ledger by the receipt emitter.
5. Directed putaway (B3). The `putaway_tasks` FSM and the SPA `/wms/putaway` surface.
6. Lots and lot capture (B4). The `lots` parent, end-to-end lot capture from receiving through putaway, and the SPA `/wms/lots` surface.
7. FSM action RPC grant hardening. `EXECUTE` revoked from `authenticated` on the state-changing action and transition RPCs.

## Migrations

Seven forward migrations, 0105 through 0111. Each header declares Wave, Phase, Closes, a DOWN MIGRATION block, a date stamp, and constitutional alignment.

- `0105_seed_plugins_wms_flag.sql` (B0). Extends `seed_org_settings` so the canonical flag set includes `plugins.wms`, seeded disabled, idempotent on conflict, with a backfill DO block re-running the seed for existing orgs. Permission-tight: PUBLIC and anon revoked, service_role granted. Closes `F-Wave12-WMS-B0-01`.
- `0106_warehouse_locations.sql` (B1). The `warehouse_locations` table (`location_type` in bin, shelf, rack, dock, staging; self-referential `parent_location_id` on delete set null; an `active` boolean). Pattern A RLS, write gated to the inventory three-role set (org_owner, org_admin, ops). A config-shape audit trigger (created, updated, deleted as the to-state). The `audit_log` entity_type CHECK extended with `warehouse_location` as a strict superset. Closes `F-Wave12-WMS-B1-01`.
- `0107_stock_movements_bin_dimension.sql` (B2, the spine stop-point). Additive nullable `location_id` (plus forward refs `lot_id` and `license_plate_id`) on `stock_movements`, with no default and no backfill, so existing rows stay null and the append-only posture is unchanged. The `bin_stock_levels` rollup (Pattern A, SELECT-only, no write policy), the `recompute_bin_stock_level` SECURITY DEFINER function (byte-identical signed-CASE to the warehouse recompute, skipping the null-location partition), and the redefined recompute trigger that fires both rollups. The sum-reconcile invariant holds by construction. Closes `F-Wave12-WMS-B2-01` and the carried operator stop-point risk `R-W12-CO-02`.
- `0108_receiving_to_dock.sql`. Additive nullable `dock_location_id` on `receiving_orders` (no default, no backfill). The receipt-emitting trigger restates its prior body verbatim and adds `location_id := new.dock_location_id` to the ledger insert. No new movement type. Closes `F-Wave12-WMS-RECEIVE-DOCK-01`.
- `0109_putaway_tasks.sql` (B3). The `putaway_tasks` table and its FSM (suggested, in_progress, done, cancelled), Pattern A RLS write-gated to the three-role set, an FSM audit trigger, and three cross-tenant-guarded SECURITY DEFINER transition RPCs (`start_putaway_task`, `complete_putaway_task`, `cancel_putaway_task`). Completing a task is a warehouse-flat internal move: it emits a `transfer_out` at the source and a `transfer_in` at the destination, same quantity each way, at `unit_cost_cents = 0`, so the warehouse total nets to zero while the bin grain shifts. A partial unique index backstops one out and one in per task. No new movement type. Closes `F-Wave12-WMS-B3-01`.
- `0110_lots.sql` (B4). The `lots` parent (status active, quarantined, expired, consumed; an `expiration_date` index as FEFO groundwork), Pattern A RLS, an FSM audit trigger, and the `quarantine_lot` transition RPC. Closes the three forward-ref lot FKs from B2 and B3 (`stock_movements`, `putaway_tasks`, `bin_stock_levels`) on delete set null, and adds `lot_id` to `receiving_order_line_items`. The receipt emitter restates its body verbatim again and threads `lot_id := li.lot_id` onto the ledger. FEFO consumption is a later phase. Closes `F-Wave12-WMS-B4-01`.
- `0111_revoke_authenticated_execute_on_fsm_action_rpcs.sql`. A permission-only change: revokes `EXECUTE` from `authenticated` on the 18 state-changing action and transition RPCs (Job Runs, Supply Plans, Billing Reviews, the new Putaway Tasks and Lot quarantine, Finance posting and period control, and quote conversion), keeping `service_role`. The SPA never calls an RPC directly; every action RPC runs from an Edge Function through the service-role client, so the `authenticated` grant was unused attack surface. The RLS-context helpers and the recompute, seed, and audit helpers keep their grant and are out of scope. Closes `F-Wave12-WMS-FSM-RPC-GRANT-HARDEN-01`.

## Risks closed

- `F-Wave12-WMS-B0-01` (chassis)
- `F-Wave12-WMS-B1-01` (locations)
- `F-Wave12-WMS-B2-01` (bin dimension), which also closes the carried operator stop-point `R-W12-CO-02`
- `F-Wave12-WMS-RECEIVE-DOCK-01` (receiving to dock)
- `F-Wave12-WMS-B3-01` (directed putaway)
- `F-Wave12-WMS-B4-01` (lots)
- `F-Wave12-WMS-FSM-RPC-GRANT-HARDEN-01` (RPC grant hardening)
- `F-Wave12-INDEX-BUDGET-HEADROOM-01` (the index lean-up that reclaimed budget for the WMS navigation weight)

## Risks carried with follow-up IDs

Body B was the Phase 1 deepening core. The following later WMS phases are named on the roadmap, not promised, and are carried:

- Holds and quarantine beyond the minimal `quarantine_lot` hold.
- Cycle counts and full physical inventory.
- Wave release and pick-path.
- Pack verification.
- Multi-carrier rate shopping, manifesting, and end-of-day close.
- Yard and dock scheduling.
- Returns disposition.
- Serials and slotting.
- FEFO (first-expired, first-out) consumption. B4 ships the `expiration_date` index as groundwork only.

Wave 12 risks carried from the parent plan and still open after Body B:

- `R-W12-CO-01` canon amendment (addressed by ADR 0002; verify wording at wave close).
- `R-W12-CO-03` Billing Review versus KitMeter boundary; metered billing deferred.
- `R-W12-CO-04` pillar-grouped sidebar supersedes UX-Q1; decision note and re-test.
- `R-W12-CO-05` labor reconcile to KitForce via a nullable forward link.
- `R-W12-CO-06` account-model generality deferred.

A follow-up `R-W13-WMS-01` later hardened directed putaway (migration 0114): completing a putaway now requires a destination bin (raises STATE_CONFLICT on null) and a `set_putaway_destination` RPC sets the bin on an in-progress task.

## Constitutional invariants verified

- Money. No new `_cents` valuation column was introduced by WMS. The putaway transfer movements carry `unit_cost_cents = 0` because they are relocations, not revaluations. The spine `recompute_stock_level` was not touched.
- RLS. Every new tenant-scoped table (`warehouse_locations`, `bin_stock_levels`, `putaway_tasks`, `lots`) ships Pattern A RLS from its creating migration. `bin_stock_levels` is SELECT-only with no write policy because it is a recompute-owned rollup. The transition RPCs return NOT_FOUND on a cross-tenant target, never 403.
- Append-only ledger. `stock_movements` stays append-only; WMS adds nullable dimensions only, invents no new movement type, and the receipt emitter restates its prior body verbatim at each step rather than rewriting it.
- Sum-reconcile. The bin rollup partitions the same signed-quantity ledger by location, so the sum of bins equals the warehouse total by construction. Turn `plugins.wms` off and handlers stop setting `location_id`; bin rollups go empty and warehouse totals are untouched.
- Audit. Each new state machine (putaway_tasks, lots) writes from-state to to-state transitions through an audit trigger. `warehouse_locations` is a config table and audits created, updated, and deleted. Each `audit_log` entity_type CHECK extension is a strict superset.
- Idempotency. The transition RPCs are idempotent on the target state, serialize with a row lock, and are backstopped by a partial unique index on the emitted movements. The additive schema changes leave the idempotency surface untouched.
- Migrations. All seven are forward-only, four-digit zero-padded, idempotent, and carry full headers with DOWN MIGRATION blocks. No applied migration was edited.
- Bundle gate. The `wms-api` bundle returns 404 on every route when `plugins.wms` is off.

## On record

The CHANGELOG `0.18.0` entry, the migration headers 0105 through 0111, the Body B handoff spec, and ADR 0002 remain the primary technical record. This journal is the wave-level closeout that ties them together.
