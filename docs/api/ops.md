# ops-api

3PL Operations bundle. Receiving, production, shipments. **Bundle-gated by `plugins.three_pl`.** When the flag is off for the caller's org, every route returns `404 NOT_FOUND` (bundle-level gate). When on, the route table dispatches normally.

The 404 response is canonical:

```json
{ "error": { "code": "NOT_FOUND", "message": "NOT_FOUND" } }
```

Status 404, `x-request-id` echoed, CORS headers attached.

## Resources (when `plugins.three_pl=true`)

### Receiving orders

- `GET /ops-api/receiving-orders` cap `receiving.order.read`
- `POST /ops-api/receiving-orders` cap `receiving.order.create`
- `GET /ops-api/receiving-orders/:id` cap `receiving.order.read`
- `PATCH /ops-api/receiving-orders/:id` cap `receiving.order.update`
- `POST /ops-api/receiving-orders/:id/transition` cap `receiving.order.update`
- `POST /ops-api/receiving-orders/:id/receive` cap `receiving.receive`
  - Body: `{ received_date?, lines: [{ item_id, quantity, unit_cost_cents? }] }`
  - Transitions status to `received` and persists payload. Trigger `tg_receiving_orders_emit_movements` emits `stock_movements` rows of type `receipt`.

States: `created`, `in_progress`, `received`, `cancelled`.

### Production runs

- `GET /ops-api/production-runs` cap `production.run.read`
- `POST /ops-api/production-runs` cap `production.run.create`
- `GET /ops-api/production-runs/:id` cap `production.run.read`
- `PATCH /ops-api/production-runs/:id` cap `production.run.update`
- `POST /ops-api/production-runs/:id/start` cap `production.start`
  - Transitions to `in_progress`, sets `started_at = now()`.
- `POST /ops-api/production-runs/:id/complete` cap `production.complete`
  - Body: `{ quantity_produced, consumed: [...], produced?: {...} }`
  - Transitions to `completed`, sets `completed_at = now()`. Trigger `tg_production_runs_emit_movements` emits `stock_movements`: `production_consumed` per consumed line, `production_produced` for the output.

States: `planned`, `in_progress`, `completed`, `cancelled`.

### Shipments

- `GET /ops-api/shipments` cap `shipments.shipment.read`
- `POST /ops-api/shipments` cap `shipments.shipment.create`
- `GET /ops-api/shipments/:id` cap `shipments.shipment.read`
- `PATCH /ops-api/shipments/:id` cap `shipments.shipment.update`
- `POST /ops-api/shipments/:id/transition` cap `shipments.shipment.update`
- `POST /ops-api/shipments/:id/ship` cap `shipments.ship`
  - Body: `{ ship_date?, carrier?, tracking_number?, lines: [...] }`
  - Transitions to `shipped`. Trigger `tg_shipments_emit_movements` emits `stock_movements` of type `shipment`.

States: `created`, `picking`, `shipped`, `cancelled`.

## Auditing

All three state machines write to `audit_log` via per-table triggers in migration 0033. Hash chain is shared with the rest of the org's entries.

## Stock movement emission

Per constitution, stock movements are NEVER written by handlers. The handler updates the parent row's status; the AFTER UPDATE trigger reads the parent's `payload` JSON and inserts `stock_movements` rows. Movement-recompute trigger on `stock_movements` then updates `stock_levels`.
