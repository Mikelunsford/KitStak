# inventory-api

Bundle for warehouses, stock levels, stock movements, and BOM items. Stock levels and stock movements are read-only via constitutional design: movements are emitted by triggers on receiving / production / shipment state transitions; levels are recomputed by trigger from movements.

## Resources

### Warehouses

- `GET /inventory-api/warehouses` cap `warehouses.warehouse.read`
- `POST /inventory-api/warehouses` cap `warehouses.warehouse.create`
- `GET /inventory-api/warehouses/:id` cap `warehouses.warehouse.read`
- `PATCH /inventory-api/warehouses/:id` cap `warehouses.warehouse.update`
- `DELETE /inventory-api/warehouses/:id` cap `warehouses.warehouse.delete` (soft-delete)

`public.seed_org_default_warehouse(org_id)` SECURITY DEFINER helper exists for org-bootstrap flows. Returns the org's existing default warehouse if present, else creates `DEFAULT` and returns its id. Granted to `service_role` only.

### Stock levels (read-only)

- `GET /inventory-api/stock-levels?warehouse_id=&item_id=` cap `stock.level.read`

`quantity_available` is `GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED`. `quantity_on_hand` and `quantity_reserved` are recomputed from `stock_movements` via the `recompute_stock_level(warehouse_id, item_id)` helper, triggered AFTER INSERT on `stock_movements`. `quantity_reserved` was dormant (always 0) until migration 0095, which derives it from `reserve` minus `reserve_release` movements (Supply Plan, Wave 12 / A5); `quantity_on_hand` excludes those soft holds.

### Stock movements (read-only)

- `GET /inventory-api/stock-movements?warehouse_id=&item_id=` cap `stock.movement.read`

Append-only ledger. Triggers on receiving / production / shipment status transitions emit rows; the Supply Plan `release_supply_plan` / `cancel_supply_plan` RPCs (Wave 12 / A5) emit the soft-hold rows; no direct user writes. `movement_type` is one of: `receipt`, `shipment`, `production_consumed`, `production_produced`, `adjustment`, `transfer_in`, `transfer_out`, `reserve`, `reserve_release`. `reserve` and `reserve_release` move `quantity_reserved` only, never `quantity_on_hand`.

### WMS bin dimension (read-only; `plugins.wms`)

The WMS add-on (warehouse execution) deepens warehouse-level stock to bin level without owning warehouses or stock. Migration 0107 adds an additive nullable `stock_movements.location_id` (FK `warehouse_locations`, ON DELETE SET NULL) plus the forward-ref columns `lot_id` and `license_plate_id` (the `lot_id` FK closes in 0110). No new `movement_type` is added. Bins, shelves, racks, docks, and staging areas live in `warehouse_locations` (0106). Lots / batches with optional expiration live in `lots` (0110); a lot is threaded onto the ledger via the receiving line and the putaway transfer.

`bin_stock_levels` (0107) is a read-only rollup, one row per `(warehouse, location, item, lot)`, maintained by `recompute_bin_stock_level` off the same AFTER INSERT trigger that maintains `stock_levels`. The bin recompute uses a signed-CASE byte-identical to the warehouse recompute and skips the NULL no-bin partition, so the sum of `quantity_on_hand` over every located bin partition reconciles to `stock_levels.quantity_on_hand` for the same `(warehouse, item)` by construction. Movements with a NULL `location_id` (the WMS-off / pre-WMS partition) live only in the warehouse grain; off equals totals untouched.

See `docs/api/wms.md` for the full WMS surface (locations, bin stock, receiving-to-dock, directed putaway, lots).

### BOM items

- `GET /inventory-api/bom-items?parent_item_id=` cap `stock.bom.read`
- `POST /inventory-api/bom-items` cap `stock.bom.write`
- `PATCH /inventory-api/bom-items/:id` cap `stock.bom.write`
- `DELETE /inventory-api/bom-items/:id` cap `stock.bom.write`

`(parent_item_id, component_item_id)` unique constraint.
