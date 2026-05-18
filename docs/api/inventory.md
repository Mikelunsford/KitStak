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

`quantity_available` is `GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED`. `quantity_on_hand` is recomputed from `stock_movements` via the `recompute_stock_level(warehouse_id, item_id)` helper, triggered AFTER INSERT on `stock_movements`.

### Stock movements (read-only)

- `GET /inventory-api/stock-movements?warehouse_id=&item_id=` cap `stock.movement.read`

Append-only ledger. Triggers on receiving / production / shipment status transitions emit rows; no user writes. `movement_type` is one of: `receipt`, `shipment`, `production_consumed`, `production_produced`, `adjustment`, `transfer_in`, `transfer_out`.

### BOM items

- `GET /inventory-api/bom-items?parent_item_id=` cap `stock.bom.read`
- `POST /inventory-api/bom-items` cap `stock.bom.write`
- `PATCH /inventory-api/bom-items/:id` cap `stock.bom.write`
- `DELETE /inventory-api/bom-items/:id` cap `stock.bom.write`

`(parent_item_id, component_item_id)` unique constraint.
