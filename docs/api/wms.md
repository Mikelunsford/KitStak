# wms-api

Bundle for the WMS add-on (warehouse execution), the sixth add-on. Plugin-gated on `plugins.wms`, which defaults OFF (paid add-on). When the flag is off for the caller's org, every route returns the canonical `404 NOT_FOUND` envelope. The bundle gate fires BEFORE the route table, so even an unknown path under the bundle 404s when the flag is off. Every non-GET handler enforces the `Idempotency-Key` header and `requireCap` before any DB write; the server is authority. Cross-tenant or soft-deleted parents resolve to `404 NOT_FOUND`. Migrations 0106 through 0111.

## Overview: bin-level inventory on the spine ledger

WMS deepens the spine's warehouse-level stock down to bin level. It does NOT own warehouses or stock. The mechanism is one additive nullable `location_id` on the append-only `stock_movements` ledger (0107). The bin-grain `quantity_on_hand` is derived from the SAME movement set the spine uses for the warehouse grain, with a byte-identical signed-CASE, so the sum of every located bin partition reconciles to `stock_levels.quantity_on_hand` for the same `(warehouse, item)` by construction. Movements with a NULL `location_id` (the WMS-off / pre-WMS partition) live only in the warehouse grain. Off equals totals untouched.

Reads are RLS-only on most GET handlers (no read cap); bin-stock and lot reads carry a read cap. State-changing routes call `requireCap(caller, 'wms.<resource>.<action>')`. FSM transitions run through SECURITY DEFINER RPCs that read the entity's org from the row and surface a cross-tenant or missing entity as `NOT_FOUND` (never 403), idempotent on the target state, `STATE_CONFLICT` on an out-of-order transition. The 18 FSM action RPCs across 3PL and WMS had their `authenticated` EXECUTE grant revoked in 0111; `service_role` retains it, so the Edge call path through `admin()` is unchanged.

WMS is warehouse execution, not the 3PL commercial layer, so every WMS table's write policy is the inventory 3-role set (`org_owner`, `org_admin`, `ops`), matching `warehouses` (0030). It does NOT carry `sales`.

## Warehouse locations (Phase B1)

`warehouse_locations` (0106) is the bin / shelf / rack / dock / staging area inside a warehouse. A config table (no rich FSM); `active` is a boolean flag. `location_type` is one of `bin`, `shelf`, `rack`, `dock`, `staging`. `code` is unique per `(org, warehouse)` among live rows. `parent_location_id` is a nullable self-reference (arbitrary depth, ON DELETE SET NULL). `attributes` jsonb carries operational flags (pickable, putaway-eligible, capacity). `warehouse_id` references the spine `warehouses`. Audit trigger records created / updated / deleted.

- `GET /wms-api/locations` list (RLS-only; query filters)
- `POST /wms-api/locations` cap `wms.location.create`
- `GET /wms-api/locations/:id` (RLS-only)
- `PATCH /wms-api/locations/:id` cap `wms.location.update`
- `DELETE /wms-api/locations/:id` cap `wms.location.update` (soft-delete)
- `POST /wms-api/locations/:id/deactivate` cap `wms.location.deactivate` (sets `active = false`)

## Bin stock levels (Phase B2, the spine stop-point)

The append-only `stock_movements` ledger gains an additive nullable bin dimension (0107): `location_id` (FK `warehouse_locations`, ON DELETE SET NULL), plus the forward-ref columns `lot_id` and `license_plate_id`. `license_plate_id` is a bare uuid (pallet / license-plate grouping, no parent table in Phase 1); `lot_id` gets its FK in B4 (0110). No new `movement_type` is added.

`bin_stock_levels` (0107) is a read-only rollup: one row per `(warehouse, location, item, lot)`, modelled on the spine `stock_levels`. Its four-key unique uses `NULLS NOT DISTINCT` so the no-lot partition (`lot_id IS NULL`) dedups on upsert. `recompute_bin_stock_level(warehouse_id, item_id, location_id, lot_id)` (SECURITY DEFINER, service-role only) derives the bin-grain `quantity_on_hand` and upserts the row. It is fired off the AFTER INSERT trigger on `stock_movements` (`trg_stock_movements_recompute`, redefined in 0107) alongside the unchanged warehouse-grain `recompute_stock_level`. The bin branch runs only when the movement carries a non-null `location_id`; the NULL no-bin partition is skipped (it is captured by the warehouse grain, never double-counted). The signed-CASE is byte-identical to the warehouse recompute, so the sum-reconcile invariant holds by construction. `bin_stock_levels` is Pattern A SELECT-only with no write policy and is NOT audited, exactly like `stock_levels`.

- `GET /wms-api/bin-stock` cap `wms.bin_stock.read` (list; query filters)
- `GET /wms-api/bin-stock/:id` cap `wms.bin_stock.read` (read one rollup row)

## Receiving-to-dock

`receiving_orders` gains a single header `dock_location_id` (0108, FK `warehouse_locations`, ON DELETE SET NULL). One dock per receipt: the dock is a header column, never per line. The receipt-emit trigger `tg_receiving_orders_emit_movements` (redefined in 0108) applies the header dock as the `location_id` on every emitted `receipt` movement. `movement_type` stays `receipt`. When `dock_location_id` is null the receipt carries a NULL location and only the warehouse recompute runs, byte-identical to pre-WMS. When set, the 0107 bin recompute fires and the bin row lands. The receiving routes themselves live in the ops-api bundle (see `docs/api/ops.md`); this migration only threads the dock onto the emitted ledger rows.

## Directed putaway (Phase B3)

`putaway_tasks` (0109) is a directed move: take received stock off the dock and stow it in a final bin. Rich FSM `suggested` / `in_progress` / `done` / `cancelled`; `done` is terminal. `source_location_id` is the dock the stock is pulled from; `suggested_location_id` and `actual_location_id` are the recommended and final destination bins (all FK `warehouse_locations`, ON DELETE SET NULL). `lot_id` and `license_plate_id` are bare uuids (the lot FK closes in B4). `source_entity_type` / `source_entity_id` are a free-form audit ref (no FK), e.g. the receiving order the stock arrived on.

Completing a task is a warehouse-flat internal move: it emits TWO existing-type movements, `transfer_out` at `source_location_id` and `transfer_in` at `actual_location_id`, same quantity, `unit_cost_cents = 0` (a relocation, not a revaluation). Per the spine signed-CASE the pair nets to zero at the warehouse grain, so the warehouse total stays flat while the 0107 bin recompute shifts the quantity from the source bin to the destination bin. No new ledger type. When `actual_location_id` is null the complete is a status-only no-op. A `for update` row lock in each transition RPC plus the partial unique index `stock_movements_putaway_task_uniq` on `(source_entity_id, movement_type)` (where `source_entity_type = 'putaway_task'`) together guarantee the transfer pair is emitted at most once even under concurrency.

- `GET /wms-api/putaway` list (RLS-only; query filters)
- `POST /wms-api/putaway` cap `wms.putaway.create`
- `GET /wms-api/putaway/:id` (RLS-only)
- `PATCH /wms-api/putaway/:id` cap `wms.putaway.create`
- `DELETE /wms-api/putaway/:id` cap `wms.putaway.create` (soft-delete)
- `POST /wms-api/putaway/:id/start` cap `wms.putaway.start` (`suggested` to `in_progress`; RPC `start_putaway_task`)
- `POST /wms-api/putaway/:id/complete` cap `wms.putaway.complete` (`in_progress` to `done`, emits the move; RPC `complete_putaway_task`)
- `POST /wms-api/putaway/:id/cancel` cap `wms.putaway.cancel` (any state except `done` to `cancelled`; RPC `cancel_putaway_task`)

## Lots (Phase B4)

`lots` (0110) is a lot / batch of an item with optional expiration. A near-config FSM whose state is its status (`active` / `quarantined` / `expired` / `consumed`); Phase 1 ships only the `quarantine` hold (`active` to `quarantined`), and the CHECK reserves `expired` / `consumed` for a later phase. `lot_code` is unique per `(org, item)` among live rows.

0110 closes lot capture end to end. A received line can carry a lot (`receiving_order_line_items.lot_id`, FK `lots`, ON DELETE SET NULL). The receipt emitter is restated to thread that lot onto the spine ledger row alongside the 0108 dock `location_id`, so the receipt carries both dimensions and the 0107 bin recompute lands a bin row at the full `(location, lot)` grain. A putaway task auto-defaults its lot from the source receiving line so the putaway transfer cites the same lot the receipt credited at the dock. The bin recompute null-safe-matches `lot_id`, so a lot-keyed bin row reconciles at the `(location, lot)` grain. 0110 also closes the three forward-ref `lot_id` FKs (`stock_movements`, `putaway_tasks`, `bin_stock_levels`, each ON DELETE SET NULL). FEFO is groundwork only: the `(org, item, expiration_date)` index supports a soonest-expiry scan; FEFO consumption is a later phase.

- `GET /wms-api/lots` list (RLS-only, no read cap enforced; query filters `item_id` / `status`). The `wms.lot.read` capability exists in the canon but the list handler is RLS-only.
- `POST /wms-api/lots` cap `wms.lot.create`
- `GET /wms-api/lots/:id` (RLS-only)
- `PATCH /wms-api/lots/:id` cap `wms.lot.update`
- `DELETE /wms-api/lots/:id` cap `wms.lot.update` (soft-delete)
- `POST /wms-api/lots/:id/quarantine` cap `wms.lot.quarantine` (`active` to `quarantined`; RPC `quarantine_lot`)

## Capabilities

All `wms.*` capabilities are granted to the inventory roles: `org_owner`, `org_admin`, `ops`. The SPA mirrors the role policy to hide buttons only; the edge `requireCap` is the authority. The full set: `wms.location.read`, `wms.location.create`, `wms.location.update`, `wms.location.deactivate`, `wms.bin_stock.read`, `wms.putaway.create`, `wms.putaway.start`, `wms.putaway.complete`, `wms.putaway.cancel`, `wms.lot.read`, `wms.lot.create`, `wms.lot.update`, `wms.lot.quarantine`.

## Auditing

`warehouse_locations`, `putaway_tasks`, and `lots` write to `audit_log` via per-table triggers through the central `audit_append_state_change` helper. The `audit_log` entity_type CHECK is extended forward-only per migration: `warehouse_location` (0106), `putaway_task` (0109), `lot` (0110). `bin_stock_levels` is NOT audited (it is a pure derivation, like `stock_levels`). The emitted `stock_movements` are the spine ledger's own append-only record, with `source_entity_*` pointing back at the task.
