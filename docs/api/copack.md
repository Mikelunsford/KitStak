# Co-Pack and Ecom API

One edge function bundle covers the Co-Pack and Ecom add-on.

## copack-api

The Co-Pack and Ecom add-on HTTP surface. Every non-GET requires `Idempotency-Key` (UUID v4) and an active org claim.

### Plugin gate

The whole bundle is gated by `plugins.copack_ecom`. When the flag is off the bundle returns `404 NOT_FOUND` on every path, so a disabled add-on leaks no surface. Co-Pack and Ecom is a paid add-on.

### sales_channels

Where an order came from. Channels are manual-only: a create or update must set `kind` to `manual`. Legacy `shopify`, `amazon`, and `other` rows remain readable, but a new or modified channel that is not `manual` returns `422 VALIDATION_ERROR`.

- `GET /copack-api/sales-channels` lists channels. RLS-only, filterable by `is_active` and `kind`.
- `POST /copack-api/sales-channels` creates a channel. `requireCap("copack.channel.write")`.
- `PATCH /copack-api/sales-channels/:id` updates a channel. `requireCap("copack.channel.write")`.

### sales_orders

The order document. Order numbers auto-generate with the `SO-` prefix from the org numbering sequence when not supplied.

#### CRUD

- `GET /copack-api/sales-orders` lists orders. RLS-only, filterable by `status`, `channel_id`, `customer_id`, and `project_id`.
- `POST /copack-api/sales-orders` creates an order in `draft`. `requireCap("copack.order.create")`.
- `GET /copack-api/sales-orders/:id` reads one order. RLS-only.
- `PATCH /copack-api/sales-orders/:id` updates header fields. Draft only. `requireCap("copack.order.update")`.
- `DELETE /copack-api/sales-orders/:id` soft-deletes. A shipped order refuses deletion with `409 STATE_CONFLICT`. `requireCap("copack.order.update")`.

#### State transitions

States: `draft`, `confirmed`, `picking`, `packed`, `shipped`, `cancelled`. `shipped` is terminal. Cancel is reachable from `draft`, `confirmed`, `picking`, and `packed`.

- `POST /copack-api/sales-orders/:id/confirm` moves `draft` to `confirmed`. `requireCap("copack.order.confirm")`.
- `POST /copack-api/sales-orders/:id/cancel` moves to `cancelled`. `requireCap("copack.order.cancel")`.

The `picking`, `packed`, and `shipped` states are advanced through the fulfillment flow below.

#### Line items

`item_id` is required.

- `GET /copack-api/sales-orders/:id/lines` lists lines ordered by position. RLS-only.
- `POST /copack-api/sales-orders/:id/lines` adds a line. `requireCap("copack.order.line_item.create")`.
- `PATCH /copack-api/sales-orders/:id/lines/:lineId` updates a line. `requireCap("copack.order.line_item.update")`.
- `DELETE /copack-api/sales-orders/:id/lines/:lineId` removes a line. `requireCap("copack.order.line_item.delete")`.

### kitting_jobs

A kitting or assembly job. Job numbers auto-generate with the `KIT-` prefix.

#### CRUD

- `GET /copack-api/kitting-jobs` lists jobs. RLS-only, filterable by `status`, `warehouse_id`, and `sales_order_id`.
- `POST /copack-api/kitting-jobs` creates a job in `draft`. `requireCap("copack.kitting_job.create")`.
- `GET /copack-api/kitting-jobs/:id` reads one job. RLS-only.
- `PATCH /copack-api/kitting-jobs/:id` updates header fields. Draft only. `requireCap("copack.kitting_job.update")`.
- `DELETE /copack-api/kitting-jobs/:id` soft-deletes. A completed job refuses deletion with `409 STATE_CONFLICT`. `requireCap("copack.kitting_job.delete")`.

#### State transitions

States: `draft`, `started`, `completed`, `cancelled`. `completed` is terminal.

- `POST /copack-api/kitting-jobs/:id/start` moves `draft` to `started`. `requireCap("copack.kitting_job.start")`.
- `POST /copack-api/kitting-jobs/:id/complete` moves `started` to `completed`. `requireCap("copack.kitting_job.complete")`. The job must carry a `warehouse_id` or the call returns `422 VALIDATION_ERROR`, because the completion trigger writes the consumed and produced `stock_movements`.
- `POST /copack-api/kitting-jobs/:id/cancel` moves `draft` or `started` to `cancelled`. `requireCap("copack.kitting_job.cancel")`.

#### Consumed and produced lines

Consumed lines require `item_id`. Produced lines allow a null `item_id`.

- `GET /copack-api/kitting-jobs/:id/consumed` and `GET /copack-api/kitting-jobs/:id/produced` list lines ordered by position. RLS-only.
- `POST` on either path adds a line. `requireCap("copack.kitting_job.line_item.create")`.
- `PATCH .../:lineId` updates a line. `requireCap("copack.kitting_job.line_item.update")`.
- `DELETE .../:lineId` removes a line. `requireCap("copack.kitting_job.line_item.delete")`.

### fulfillments

The pick-pack-ship flow against a sales order. Fulfillment numbers auto-generate with the `FULF-` prefix.

#### CRUD

- `GET /copack-api/fulfillments` lists fulfillments. RLS-only, filterable by `status`, `sales_order_id`, and `warehouse_id`.
- `POST /copack-api/fulfillments` creates a fulfillment in `pending` against a parent sales order. `requireCap("copack.fulfillment.pick")`.
- `GET /copack-api/fulfillments/:id` reads one fulfillment. RLS-only.

#### State transitions

States: `pending`, `picking`, `packed`, `shipped`, `cancelled`. `shipped` is terminal. Cancel is reachable from `pending`, `picking`, and `packed`.

- `POST /copack-api/fulfillments/:id/pick` moves `pending` to `picking`. `requireCap("copack.fulfillment.pick")`.
- `POST /copack-api/fulfillments/:id/pack` moves `picking` to `packed`. `requireCap("copack.fulfillment.pack")`.
- `POST /copack-api/fulfillments/:id/ship` moves `packed` to `shipped`. `requireCap("copack.fulfillment.ship")`. The DB trigger `tg_fulfillments_advance_order` then advances the parent sales order to `shipped`.
- `POST /copack-api/fulfillments/:id/cancel` moves to `cancelled`. `requireCap("copack.fulfillment.pick")`.

### warehouses

- `GET /copack-api/warehouses` lists warehouses, read-only. RLS-only. This list lives here so a Co-Pack-only org can populate its pickers without holding the 3PL add-on. Warehouse CRUD remains in `inventory-api`.

## Error envelope

Every error response is `{ "error": { "code", "message", "details" } }` with an `x-request-id` header. Codes the bundle emits:

- `UNAUTHORIZED` (401) Authorization missing.
- `NO_ACTIVE_ORG` (401) Token has no org claim.
- `FORBIDDEN` (403) Capability denied.
- `NOT_FOUND` (404) Row not in caller's org, or the add-on is gated off.
- `STATE_CONFLICT` (409) Illegal transition, or a write against a non-draft order or job.
- `IDEMPOTENCY_CONFLICT` (409) Same key, different body.
- `VALIDATION_ERROR` (422) Body failed Zod, a non-manual channel kind, or a kitting completion with no warehouse.
