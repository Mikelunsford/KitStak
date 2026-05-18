# 3PL Operations

Kitstak's first pillar. Receiving, production, kitting, shipments. Backed by vendors, purchase orders, vendor bills, expenses, warehouses, stock levels, BOMs.

## Where to start

- Set up your first warehouse: `/3pl-operations/warehouses`. The provisioning flow seeds a default; you can rename it.
- Add vendors: `/3pl-operations/vendors`.
- Write purchase orders: `/3pl-operations/purchase-orders`.

## Receiving

A receiving order has four states: `created`, `in_progress`, `received`, `cancelled`. Use the **Receive** action to record received lines; this transitions the order to `received` and emits stock movements automatically.

## Production runs

A production run has four states: `planned`, `in_progress`, `completed`, `cancelled`. Start the run from the detail page; complete it with consumed components and produced output. Stock movements are emitted on completion.

## Shipments

A shipment has four states: `created`, `picking`, `shipped`, `cancelled`. The **Ship** action transitions a shipment from `picking` (or `created`) to `shipped` and records the outbound stock movement.

## Stock

Stock levels are read-only. Available quantity is `on_hand - reserved`, derived in the database. Movements are an append-only ledger; everything flows through triggers on receiving, production, and shipment transitions.

## Feature flag

The 3PL operations bundle is gated by `plugins.three_pl`. When disabled, the ops-api returns 404 for every route and the pillar pages render empty. Org admins enable it from `/admin/flags`.
